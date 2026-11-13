import { adminOdooClient } from '../../../odoo/odooClient.js';
import { deriveSpkInduk, computeSpkFamilyRecap } from './spkRecapSync.js';
import { syncPabrikRecapForApproval } from './pabrikRecapSync.js';

const WIP_MODEL = 'x_monitoring_wip_vendo';
const PAGE_SIZE = 2000;
const WRITE_CHUNK_SIZE = 100;
const SLEEP_MS = 120;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRowMoName(row) {
  const rawName = String(row.x_name || '').trim();
  if (rawName) return rawName;
  if (Array.isArray(row.x_studio_manufacturing_order) && row.x_studio_manufacturing_order[1]) {
    return String(row.x_studio_manufacturing_order[1]).trim();
  }
  return String(row.x_studio_spk_induk || '').trim();
}

/**
 * Self-healing reconcile engine:
 * Compares Odoo's physical stock.move.line entries against WIP records.
 * Automatically catches and repairs any dropped webhooks or missed SFP deliveries.
 */
export async function reconcileWipSfpAndRecap({ full = false, days = 60, dryRun = false } = {}) {
  const startTime = Date.now();
  await adminOdooClient.authenticate();

  const smlDomain = [
    ['picking_id.name', '=like', 'VD%/SFP/%'],
    ['state', '=', 'done']
  ];

  // 1. Fetch Vendor SFP move lines
  const allSmls = [];
  let lastSmlId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject('stock.move.line', 'search_read', [
      [['id', '>', lastSmlId], ...smlDomain],
      ['id', 'picking_id', 'product_id', 'quantity', 'origin', 'x_studio_manufacturing_order', 'date'],
      0, PAGE_SIZE, 'id asc'
    ]);
    if (!Array.isArray(batch) || batch.length === 0) break;
    allSmls.push(...batch);
    lastSmlId = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }

  // 2. Fetch WIP rows
  const allWips = [];
  let lastWipId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject(WIP_MODEL, 'search_read', [
      [['id', '>', lastWipId]],
      [
        'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_product',
        'x_studio_kain_dari_gudang_qty', 'x_studio_estimasi_dari_spb',
        'x_studio_qty_masuk_sfp', 'x_studio_no_surat_jalan_sfp',
        'x_studio_tanggal_sfp', 'x_studio_spk_induk',
        'x_studio_estimasi_spb_rekap', 'x_studio_persentase_susut'
      ],
      0, PAGE_SIZE, 'id asc'
    ]);
    if (!Array.isArray(batch) || batch.length === 0) break;
    allWips.push(...batch);
    lastWipId = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }

  // 3. Match SFP lines against WIP records
  const wipSfpUpdates = [];
  const impactedIndukSet = new Set();

  for (const wip of allWips) {
    const moName = (Array.isArray(wip.x_studio_manufacturing_order) && wip.x_studio_manufacturing_order[1]) || String(wip.x_name || '').trim();
    const altMoName = String(wip.x_name || '').trim();
    const moId = wip.x_studio_manufacturing_order ? wip.x_studio_manufacturing_order[0] : null;
    const moProdId = wip.x_studio_product ? wip.x_studio_product[0] : null;
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
      if (parts.includes(moName) || parts.includes(altMoName)) return true;
      return false;
    });

    const targetQty = Math.round(matching.reduce((s, l) => s + (parseFloat(l.quantity) || 0), 0) * 100) / 100;
    const currentQty = Math.round((parseFloat(wip.x_studio_qty_masuk_sfp) || 0) * 100) / 100;

    const pickingsMap = new Map();
    for (const l of matching) {
      if (l.picking_id && Array.isArray(l.picking_id)) {
        const pId = l.picking_id[0];
        const pName = l.picking_id[1];
        if (!pickingsMap.has(pId)) {
          pickingsMap.set(pId, { id: pId, name: pName, date: l.date });
        }
      }
    }
    const uniquePickings = Array.from(pickingsMap.values());
    uniquePickings.sort((a, b) => (new Date(a.date || 0) - new Date(b.date || 0)) || (a.id - b.id));

    const targetSfpNo = uniquePickings.length > 0 ? uniquePickings.map((p) => p.name).join(', ') : false;
    const currentSfpNo = wip.x_studio_no_surat_jalan_sfp || false;

    const vals = {};
    if (Math.abs(targetQty - currentQty) > 0.005) {
      vals.x_studio_qty_masuk_sfp = targetQty;
      wip.x_studio_qty_masuk_sfp = targetQty;
    }
    if (targetSfpNo !== currentSfpNo) {
      vals.x_studio_no_surat_jalan_sfp = targetSfpNo;
      wip.x_studio_no_surat_jalan_sfp = targetSfpNo;
    }
    if (uniquePickings.length > 0 && uniquePickings[uniquePickings.length - 1].date) {
      const targetDate = uniquePickings[uniquePickings.length - 1].date;
      if (wip.x_studio_tanggal_sfp !== targetDate) {
        vals.x_studio_tanggal_sfp = targetDate;
        wip.x_studio_tanggal_sfp = targetDate;
      }
    }

    if (Object.keys(vals).length > 0) {
      wipSfpUpdates.push({ id: wip.id, vals });
      if (spkInduk) impactedIndukSet.add(spkInduk);
    }
  }

  // 4. Apply WIP SFP writes if discrepancies exist
  if (!dryRun && wipSfpUpdates.length > 0) {
    for (const item of wipSfpUpdates) {
      await adminOdooClient._callObject(WIP_MODEL, 'write', [[item.id], item.vals], {
        context: { tracking_disable: true, no_automation: true }
      });
      await sleep(SLEEP_MS);
    }
  }

  // 5. Recompute SPK Family Recap for impacted families (or all families if full)
  let familiesUpdated = 0;
  if (!dryRun && (impactedIndukSet.size > 0 || full)) {
    const families = new Map();
    for (const row of allWips) {
      const rawName = getRowMoName(row);
      const spkKey = deriveSpkInduk(rawName) || `__row_${row.id}`;
      if (full || impactedIndukSet.has(spkKey)) {
        if (!families.has(spkKey)) {
          families.set(spkKey, []);
        }
        families.get(spkKey).push(row);
      }
    }

    const recapUpdates = [];
    for (const familyRows of families.values()) {
      const recap = computeSpkFamilyRecap(familyRows);
      if (recap && recap.rowUpdates.length > 0) {
        recapUpdates.push(...recap.rowUpdates);
      }
    }

    if (recapUpdates.length > 0) {
      const batchesByPayload = new Map();
      for (const upd of recapUpdates) {
        const key = JSON.stringify(upd.vals);
        if (!batchesByPayload.has(key)) {
          batchesByPayload.set(key, { vals: upd.vals, ids: [] });
        }
        batchesByPayload.get(key).ids.push(upd.id);
      }

      for (const { vals, ids } of batchesByPayload.values()) {
        for (let i = 0; i < ids.length; i += WRITE_CHUNK_SIZE) {
          const chunkIds = ids.slice(i, i + WRITE_CHUNK_SIZE);
          await adminOdooClient._callObject(WIP_MODEL, 'write', [chunkIds, vals], {
            context: { tracking_disable: true, no_automation: true }
          });
          await sleep(SLEEP_MS);
        }
      }
      familiesUpdated = families.size;
    }
  }

  // 6. Pabrik Approval Requests reconciliation (recent 30 days)
  let pabrikStats = { checkedApprovals: 0, syncedApprovals: 0 };
  if (!dryRun) {
    try {
      const dPabrik = new Date();
      dPabrik.setDate(dPabrik.getDate() - (days || 30));
      const pabrikDateStr = dPabrik.toISOString().split('T')[0];

      const recentPabrikMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [['write_date', '>=', pabrikDateStr], ['x_studio_approval_request', '!=', false], ['state', '!=', 'cancel']],
        ['id', 'x_studio_approval_request']
      ], { limit: 1000 });

      const apprIds = [...new Set((recentPabrikMos || []).map((m) => m.x_studio_approval_request?.[0]).filter(Boolean))];
      pabrikStats.checkedApprovals = apprIds.length;

      for (const apprId of apprIds) {
        const pRes = await syncPabrikRecapForApproval(apprId).catch((err) => {
          console.warn(`[Reconcile] Non-fatal Pabrik approval #${apprId} sync warning:`, err.message);
          return null;
        });
        if (pRes) pabrikStats.syncedApprovals++;
        await sleep(SLEEP_MS);
      }
    } catch (pabrikErr) {
      console.warn(`[Reconcile] Pabrik reconcile warning:`, pabrikErr.message);
    }
  }

  const durationMs = Date.now() - startTime;
  return {
    success: true,
    dryRun,
    vendor: {
      totalCheckedWips: allWips.length,
      totalSfpLines: allSmls.length,
      discrepanciesFound: wipSfpUpdates.length,
      wipsUpdated: dryRun ? 0 : wipSfpUpdates.length,
      familiesUpdated
    },
    pabrik: pabrikStats,
    durationMs
  };
}
