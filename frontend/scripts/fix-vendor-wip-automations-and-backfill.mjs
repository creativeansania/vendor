import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { onMoConfirmed } from '../src/lib/services/wip/sync/moAndTransferEvents.js';
import { syncWipFromPickings } from '../src/lib/services/wip/sync/singlePassCompute.js';
import { deriveSpkInduk, computeSpkFamilyRecap } from '../src/lib/services/wip/sync/spkRecapSync.js';
import { reconcileWipSfpAndRecap } from '../src/lib/services/wip/sync/sfpReconcileService.js';

const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_AUTOMATIONS = process.argv.includes('--only-automations');
const SKIP_BACKFILL = process.argv.includes('--skip-backfill');

const WIP_MODEL = 'x_monitoring_wip_vendo';
const BACKFILL_START_DATE = '2026-11-01';
const OUTAGE_START_DATE = '2026-11-12 00:00:00';
const CONCURRENCY = 5;

const AUTOMATION_FIXES = [
  {
    automationId: 59,
    automationName: '[Custom] Trigger WIP on MO Confirm',
    serverActionName: '[Custom] Send Webhook WIP MO Confirmed (Vendor)',
    modelId: 753, // mrp.production
    webhookUrl: 'https://vendor-sandy-eight.vercel.app/api/webhooks/odoo/wip/mo-confirmed',
    webhookFieldIds: [11033, 10956, 10985], // id, name, state
  },
  {
    automationId: 60,
    automationName: '[Custom] Trigger WIP on Transfer Done',
    serverActionName: '[Custom] Send Webhook WIP Transfer Done (Vendor)',
    modelId: 690, // stock.picking
    webhookUrl: 'https://vendor-sandy-eight.vercel.app/api/webhooks/odoo/wip/transfer-done',
    webhookFieldIds: [10001, 9942, 9951], // id, name, state
  },
];

const FULL_MO_FIELDS = [
  'id', 'name', 'state', 'origin', 'sale_line_id', 'x_studio_sales_order',
  'x_studio_origin_mo', 'product_id', 'product_qty', 'bom_id', 'workorder_ids',
  'picking_ids', 'production_group_id', 'company_id', 'warehouse_id',
  'picking_type_id', 'x_studio_approval_request', 'date_start', 'date_deadline',
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, label, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[Retry ${attempt}/${maxAttempts}] ${label}: ${err.message}`);
      if (attempt < maxAttempts) await sleep(1000 * attempt);
    }
  }
  throw lastErr;
}

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const results = [];
  async function next() {
    while (idx < items.length) {
      const current = idx;
      idx += 1;
      results[current] = await worker(items[current], current);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
  return results;
}

/**
 * Phase 1: Attach dedicated ir.actions.server webhook records to Vendor Automations #59 & #60
 * without touching Pabrik Automations #63 & #64 (which own #1420 & #1421).
 */
async function fixVendorAutomations() {
  console.log('\n=== PHASE 1: FIX VENDOR AUTOMATIONS #59 & #60 ===');
  const autos = await adminOdooClient._callObject('base.automation', 'read', [
    [59, 60, 63, 64],
    ['id', 'name', 'active', 'action_server_ids'],
  ]);
  const autoById = new Map(autos.map((a) => [a.id, a]));

  for (const spec of AUTOMATION_FIXES) {
    const auto = autoById.get(spec.automationId);
    if (!auto) throw new Error(`Automation #${spec.automationId} not found`);

    if (auto.action_server_ids && auto.action_server_ids.length > 0) {
      console.log(`Automation #${spec.automationId} ("${auto.name}") already has action_server_ids=${JSON.stringify(auto.action_server_ids)} -> keeping intact.`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would create dedicated ir.actions.server "${spec.serverActionName}" (${spec.webhookUrl}) linked to base_automation_id=${spec.automationId}`);
      continue;
    }

    const newSrvId = await adminOdooClient._callObject('ir.actions.server', 'create', [{
      name: spec.serverActionName,
      model_id: spec.modelId,
      state: 'webhook',
      webhook_url: spec.webhookUrl,
      webhook_field_ids: [[6, 0, spec.webhookFieldIds]],
      base_automation_id: spec.automationId,
    }]);
    console.log(`Created dedicated ir.actions.server #${newSrvId} ("${spec.serverActionName}") -> linked to Automation #${spec.automationId}`);
  }

  // Verify all 4 automations (#59, #60, #63, #64) have distinct non-empty action_server_ids
  const verified = await adminOdooClient._callObject('base.automation', 'read', [
    [59, 60, 63, 64],
    ['id', 'name', 'active', 'action_server_ids'],
  ]);
  console.log('Verified Automations #59, #60, #63, #64:');
  for (const a of verified) {
    console.log(`  #${a.id} (${a.name}) active=${a.active} action_server_ids=${JSON.stringify(a.action_server_ids)}`);
  }
}

/**
 * Phase 2: Find all existing WIPs with SFP discrepancies OR with post-outage done Vendor transfers,
 * and run full Single-Pass sync (syncWipFromPickings) so SFP, PC/SPB, Total Harga, Daftar Transfer,
 * and Supabase are all repaired cleanly.
 */
async function repairExistingWips() {
  console.log('\n=== PHASE 2: REPAIR EXISTING VENDOR WIPs (SFP + POST-OUTAGE TRANSFERS) ===');

  // 2A. Fetch all done Vendor SFP move lines
  const allSmls = [];
  let lastSmlId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject('stock.move.line', 'search_read', [
      [['id', '>', lastSmlId], ['picking_id.name', '=like', 'VD%/SFP/%'], ['state', '=', 'done']],
      ['id', 'picking_id', 'product_id', 'quantity', 'origin', 'x_studio_manufacturing_order', 'date'],
      0, 2000, 'id asc',
    ]);
    if (!batch.length) break;
    allSmls.push(...batch);
    lastSmlId = batch[batch.length - 1].id;
    if (batch.length < 2000) break;
  }

  // 2B. Fetch all existing WIPs
  const allWips = [];
  let lastWipId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject(WIP_MODEL, 'search_read', [
      [['id', '>', lastWipId]],
      [
        'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_product',
        'x_studio_qty_masuk_sfp', 'x_studio_no_surat_jalan_sfp',
        'x_studio_tanggal_sfp', 'x_studio_spk_induk',
      ],
      0, 2000, 'id asc',
    ]);
    if (!batch.length) break;
    allWips.push(...batch);
    lastWipId = batch[batch.length - 1].id;
    if (batch.length < 2000) break;
  }

  const wipsToRepair = new Map(); // wipId -> { wipId, moId, moName, spkInduk, reasons: Set }
  const wipByMoId = new Map();
  const wipByMoName = new Map();

  for (const wip of allWips) {
    const moId = wip.x_studio_manufacturing_order?.[0] || null;
    const moName = wip.x_studio_manufacturing_order?.[1] || String(wip.x_name || '').trim();
    const altMoName = String(wip.x_name || '').trim();
    if (moId) wipByMoId.set(moId, wip);
    if (moName) wipByMoName.set(moName, wip);
    if (altMoName) wipByMoName.set(altMoName, wip);

    if (!moId) continue;
    const moProdId = wip.x_studio_product?.[0] || null;
    const spkInduk = deriveSpkInduk(moName) || deriveSpkInduk(altMoName);

    const matching = allSmls.filter((l) => {
      if (moProdId && l.product_id && l.product_id[0] !== moProdId) return false;
      const lineOrigin = String(l.origin || '').trim();
      if (lineOrigin === moName || lineOrigin === altMoName) return true;
      if (lineOrigin && lineOrigin !== moName && lineOrigin !== altMoName && deriveSpkInduk(lineOrigin) === spkInduk) {
        return false;
      }
      if (Array.isArray(l.x_studio_manufacturing_order)) {
        if (l.x_studio_manufacturing_order[0] === moId || l.x_studio_manufacturing_order[1] === moName || l.x_studio_manufacturing_order[1] === altMoName) {
          return true;
        }
      }
      const parts = lineOrigin.split(/[,/]/).map((s) => s.trim());
      return parts.includes(moName) || parts.includes(altMoName);
    });

    const targetQty = Math.round(matching.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0) * 100) / 100;
    const currentQty = Math.round((parseFloat(wip.x_studio_qty_masuk_sfp) || 0) * 100) / 100;

    const pickingsMap = new Map();
    for (const l of matching) {
      if (Array.isArray(l.picking_id) && !pickingsMap.has(l.picking_id[0])) {
        pickingsMap.set(l.picking_id[0], { id: l.picking_id[0], name: l.picking_id[1], date: l.date });
      }
    }
    const uniquePickings = Array.from(pickingsMap.values())
      .sort((a, b) => (new Date(a.date || 0) - new Date(b.date || 0)) || (a.id - b.id));
    const targetSfpNo = uniquePickings.length > 0 ? uniquePickings.map((p) => p.name).join(', ') : false;
    const currentSfpNo = wip.x_studio_no_surat_jalan_sfp || false;
    const targetDate = uniquePickings.length > 0 ? uniquePickings[uniquePickings.length - 1].date : false;

    const needsSfpFix =
      Math.abs(targetQty - currentQty) > 0.005 ||
      targetSfpNo !== currentSfpNo ||
      (targetDate && wip.x_studio_tanggal_sfp !== targetDate);

    if (needsSfpFix) {
      wipsToRepair.set(wip.id, { wipId: wip.id, moId, moName, spkInduk, reasons: new Set(['sfp_mismatch']) });
    }
  }

  // 2C. Also include any existing WIPs with Vendor PC/SPB/SFP transfers completed during the outage (>= Nov 12)
  const outageTransfers = await adminOdooClient._callObject('stock.picking', 'search_read', [
    [
      ['state', '=', 'done'],
      ['date_done', '>=', OUTAGE_START_DATE],
      ['picking_type_id', 'ilike', 'vendor'],
      '|', '|', ['name', 'ilike', '/PC/'], ['name', 'ilike', '/SPB/'], ['name', 'ilike', '/SFP/'],
    ],
    ['id', 'name', 'origin', 'x_studio_manufacturing_order'],
  ], { limit: 5000 });

  for (const p of outageTransfers || []) {
    const candidateWips = [];
    if (Array.isArray(p.x_studio_manufacturing_order) && wipByMoId.has(p.x_studio_manufacturing_order[0])) {
      candidateWips.push(wipByMoId.get(p.x_studio_manufacturing_order[0]));
    }
    if (p.origin) {
      for (const part of String(p.origin).split(',').map((s) => s.trim()).filter(Boolean)) {
        if (wipByMoName.has(part)) candidateWips.push(wipByMoName.get(part));
      }
    }
    for (const wip of candidateWips) {
      const moId = wip.x_studio_manufacturing_order?.[0];
      if (!moId) continue;
      if (!wipsToRepair.has(wip.id)) {
        const moName = wip.x_studio_manufacturing_order?.[1] || wip.x_name;
        wipsToRepair.set(wip.id, { wipId: wip.id, moId, moName, spkInduk: deriveSpkInduk(moName), reasons: new Set() });
      }
      wipsToRepair.get(wip.id).reasons.add('outage_transfer');
    }
  }

  const list = Array.from(wipsToRepair.values());
  // Prioritize VDIP/MO/00626-002 (#4449) first!
  list.sort((a, b) => (a.wipId === 4449 ? -1 : b.wipId === 4449 ? 1 : a.wipId - b.wipId));
  console.log(`Found ${list.length} existing WIPs needing full Single-Pass sync (SFP mismatch + post-Nov-12 transfers).`);

  if (DRY_RUN) {
    return { repaired: 0, failed: 0, impactedInduks: new Set(list.map((x) => x.spkInduk).filter(Boolean)) };
  }

  // Preload MOs in chunks of 200 to cut RPC calls in half
  const moById = new Map();
  const allMoIds = [...new Set(list.map((x) => x.moId))];
  for (let i = 0; i < allMoIds.length; i += 200) {
    const chunk = allMoIds.slice(i, i + 200);
    const mos = await adminOdooClient._callObject('mrp.production', 'read', [chunk, FULL_MO_FIELDS]);
    for (const m of mos || []) moById.set(m.id, m);
  }

  let repaired = 0;
  let failed = 0;
  const impactedInduks = new Set();

  await runPool(list, CONCURRENCY, async (item, idx) => {
    try {
      const res = await withRetry(
        () => syncWipFromPickings(item.wipId, item.moId, {
          preloadedMo: moById.get(item.moId) || null,
          skipFamilyRecap: true,
        }),
        `syncWip #${item.wipId} (${item.moName})`
      );
      repaired += 1;
      if (res?.spkInduk) impactedInduks.add(res.spkInduk);
      if (item.spkInduk) impactedInduks.add(item.spkInduk);
      if (repaired % 50 === 0 || idx === 0) {
        console.log(`  [Phase 2] Repaired ${repaired}/${list.length} (latest: WIP #${item.wipId} ${item.moName})`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  [Phase 2 ERROR] WIP #${item.wipId} (${item.moName}): ${err.message}`);
    }
  });

  console.log(`Phase 2 complete: repaired=${repaired}, failed=${failed}`);
  return { repaired, failed, impactedInduks };
}

/**
 * Phase 3: Backfill all confirmed/in-progress/done Vendor MOs since Nov 1 that have no WIP record.
 * Grouped by SPK Induk family so parent MO (-001) always creates BEFORE backorders (-002, -003...).
 */
async function backfillMissingVendorWips() {
  if (SKIP_BACKFILL) {
    console.log('\n=== PHASE 3: SKIPPED (--skip-backfill) ===');
    return { created: 0, failed: 0, impactedInduks: new Set() };
  }

  console.log('\n=== PHASE 3: BACKFILL MISSING VENDOR WIPs SINCE NOV 1 ===');
  const allRecentMos = [];
  let lastId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject('mrp.production', 'search_read', [
      [
        ['id', '>', lastId],
        ['create_date', '>=', BACKFILL_START_DATE],
        ['state', 'not in', ['draft', 'cancel']],
        '|', ['warehouse_id.name', 'ilike', 'vendor'], ['name', '=like', 'VD%'],
      ],
      FULL_MO_FIELDS,
      0, 1000, 'id asc',
    ]);
    if (!batch.length) break;
    allRecentMos.push(...batch);
    lastId = batch[batch.length - 1].id;
    if (batch.length < 1000) break;
  }

  const moIds = allRecentMos.map((m) => m.id);
  const existingMoSet = new Set();
  for (let i = 0; i < moIds.length; i += 1000) {
    const chunk = moIds.slice(i, i + 1000);
    const wips = await adminOdooClient._callObject(WIP_MODEL, 'search_read', [
      [['x_studio_manufacturing_order', 'in', chunk]],
      ['x_studio_manufacturing_order'],
    ]);
    for (const w of wips || []) {
      if (w.x_studio_manufacturing_order) existingMoSet.add(w.x_studio_manufacturing_order[0]);
    }
  }

  const missingMos = allRecentMos.filter((m) => !existingMoSet.has(m.id));
  console.log(`Found ${missingMos.length} missing Vendor MOs since ${BACKFILL_START_DATE} (out of ${allRecentMos.length} total).`);

  if (DRY_RUN || missingMos.length === 0) {
    return { created: 0, failed: 0, impactedInduks: new Set(missingMos.map((m) => deriveSpkInduk(m.name)).filter(Boolean)) };
  }

  // Group missing MOs by spkInduk so siblings within the same family execute sequentially (id asc)
  const familyBuckets = new Map();
  for (const mo of missingMos) {
    const key = deriveSpkInduk(mo.name) || `__mo_${mo.id}`;
    if (!familyBuckets.has(key)) familyBuckets.set(key, []);
    familyBuckets.get(key).push(mo);
  }
  const families = Array.from(familyBuckets.entries());

  let created = 0;
  let failed = 0;
  const impactedInduks = new Set();

  await runPool(families, CONCURRENCY, async ([spkKey, familyMos]) => {
    familyMos.sort((a, b) => a.id - b.id);
    for (const mo of familyMos) {
      try {
        const res = await withRetry(
          () => onMoConfirmed(mo.id, { autoSync: false, preloadedMo: mo }),
          `onMoConfirmed MO #${mo.id} (${mo.name})`
        );
        if (res?.wipId) {
          await withRetry(
            () => syncWipFromPickings(res.wipId, mo.id, { preloadedMo: mo, skipFamilyRecap: true }),
            `syncWip #${res.wipId} (${mo.name})`
          );
          created += 1;
          const spk = deriveSpkInduk(mo.name);
          if (spk) impactedInduks.add(spk);
          if (created % 100 === 0) {
            console.log(`  [Phase 3] Backfilled ${created}/${missingMos.length} (latest: ${mo.name} -> WIP #${res.wipId})`);
          }
        }
      } catch (err) {
        failed += 1;
        console.error(`  [Phase 3 ERROR] MO #${mo.id} (${mo.name}): ${err.message}`);
      }
    }
  });

  console.log(`Phase 3 complete: created=${created}, failed=${failed}`);
  return { created, failed, impactedInduks };
}

/**
 * Phase 4: Recompute SPK Family Recap (Estimasi SPB Rekap & % Susut) in batched chunks
 * for all impacted SPK Induk families.
 */
async function recomputeImpactedFamilyRecaps(impactedInduks) {
  console.log(`\n=== PHASE 4: RECOMPUTE SPK INDUK FAMILY RECAP (${impactedInduks.size} families) ===`);
  if (DRY_RUN || impactedInduks.size === 0) return { familiesUpdated: 0, rowsWritten: 0 };

  const allWips = [];
  let lastId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject(WIP_MODEL, 'search_read', [
      [['id', '>', lastId]],
      [
        'id', 'x_name', 'x_studio_manufacturing_order',
        'x_studio_kain_dari_gudang_qty', 'x_studio_estimasi_dari_spb',
        'x_studio_qty_masuk_sfp', 'x_studio_spk_induk',
        'x_studio_estimasi_spb_rekap', 'x_studio_persentase_susut',
      ],
      0, 2000, 'id asc',
    ]);
    if (!batch.length) break;
    allWips.push(...batch);
    lastId = batch[batch.length - 1].id;
    if (batch.length < 2000) break;
  }

  const families = new Map();
  for (const row of allWips) {
    const rawName = String(row.x_name || '').trim() || row.x_studio_manufacturing_order?.[1] || '';
    const spkKey = deriveSpkInduk(rawName) || row.x_studio_spk_induk || `__row_${row.id}`;
    if (!impactedInduks.has(spkKey)) continue;
    if (!families.has(spkKey)) families.set(spkKey, []);
    families.get(spkKey).push(row);
  }

  const recapUpdates = [];
  for (const familyRows of families.values()) {
    const recap = computeSpkFamilyRecap(familyRows);
    if (recap && recap.rowUpdates.length > 0) {
      recapUpdates.push(...recap.rowUpdates);
    }
  }

  // Group identical payloads for fast batch writes
  const batchesByPayload = new Map();
  for (const upd of recapUpdates) {
    const key = JSON.stringify(upd.vals);
    if (!batchesByPayload.has(key)) batchesByPayload.set(key, { vals: upd.vals, ids: [] });
    batchesByPayload.get(key).ids.push(upd.id);
  }

  let rowsWritten = 0;
  const payloadGroups = Array.from(batchesByPayload.values());
  await runPool(payloadGroups, CONCURRENCY, async ({ vals, ids }) => {
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      await withRetry(
        () => adminOdooClient._callObject(WIP_MODEL, 'write', [chunk, vals], {
          context: { tracking_disable: true, no_automation: true },
        }),
        `recap write ${chunk.length} rows`
      );
      rowsWritten += chunk.length;
    }
  });

  console.log(`Phase 4 complete: familiesUpdated=${families.size}, rowsWritten=${rowsWritten}`);
  return { familiesUpdated: families.size, rowsWritten };
}

async function main() {
  const t0 = Date.now();
  console.log(`=== Vendor WIP Automations Fix & Full Recovery (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  await adminOdooClient.authenticate();

  await fixVendorAutomations();
  if (ONLY_AUTOMATIONS) return;

  const phase2 = await repairExistingWips();
  const phase3 = await backfillMissingVendorWips();

  const allImpactedInduks = new Set([...phase2.impactedInduks, ...phase3.impactedInduks]);
  allImpactedInduks.add('VDIP/MO/00626'); // always ensure VDIP/MO/00626 recap is fresh
  const phase4 = await recomputeImpactedFamilyRecaps(allImpactedInduks);

  // Final verification on VDIP/MO/00626* and overall SFP discrepancies
  console.log('\n=== FINAL VERIFICATION ===');
  const vdip626 = await adminOdooClient._callObject(WIP_MODEL, 'search_read', [
    [['x_name', 'ilike', 'VDIP/MO/00626']],
    [
      'id', 'x_name', 'x_studio_qty_spk', 'x_studio_qty_masuk_sfp',
      'x_studio_no_surat_jalan_sfp', 'x_studio_tanggal_sfp',
      'x_studio_estimasi_spb_rekap', 'x_studio_persentase_susut',
      'x_studio_harga', 'x_studio_total_harga',
    ],
  ]);
  console.log('VDIP/MO/00626* WIP records:', JSON.stringify(vdip626, null, 2));

  const verifyRec = await reconcileWipSfpAndRecap({ dryRun: true });
  console.log('Post-recovery SFP discrepancy check:', JSON.stringify(verifyRec.vendor, null, 2));
  console.log(`Total elapsed: ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log('SUMMARY:', JSON.stringify({ phase2: { repaired: phase2.repaired, failed: phase2.failed }, phase3: { created: phase3.created, failed: phase3.failed }, phase4 }));
}

main().catch((err) => {
  console.error('Recovery failed:', err);
  process.exit(1);
});
