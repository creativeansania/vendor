import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { deriveSpkInduk, computeSpkFamilyRecap } from '../src/lib/services/wip/sync/spkRecapSync.js';

const WIP_MODEL = 'x_monitoring_wip_vendo';
const PAGE_SIZE = 2000;
const WRITE_CHUNK_SIZE = 100;
const WRITE_CONCURRENCY = 1;
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

async function runWithConcurrency(tasks, concurrency) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor++;
      await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
}

async function main() {
  await adminOdooClient.authenticate();

  console.log('1. Fetching all done Vendor SFP move lines from Odoo...');
  const allSmls = [];
  let lastSmlId = 0;
  while (true) {
    const batch = await adminOdooClient._callObject('stock.move.line', 'search_read', [
      [['id', '>', lastSmlId], ['picking_id.name', '=like', 'VD%/SFP/%'], ['state', '=', 'done']],
      ['id', 'picking_id', 'product_id', 'quantity', 'origin', 'x_studio_manufacturing_order', 'date'],
      0, PAGE_SIZE, 'id asc'
    ]);
    if (!batch.length) break;
    allSmls.push(...batch);
    lastSmlId = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }
  console.log(`   Fetched ${allSmls.length} Vendor SFP move lines.`);

  console.log('2. Fetching all x_monitoring_wip_vendo rows from Odoo...');
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
    if (!batch.length) break;
    allWips.push(...batch);
    lastWipId = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }
  console.log(`   Fetched ${allWips.length} WIP rows.`);

  console.log('3. Calculating accurate Qty Masuk SFP & No Surat Jalan per WIP row...');
  const wipSfpUpdates = [];

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
      wip.x_studio_qty_masuk_sfp = targetQty; // update in-memory for subsequent recap
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
    }
  }

  console.log(`   Found ${wipSfpUpdates.length} WIP rows needing SFP updates.`);

  if (wipSfpUpdates.length > 0) {
    console.log('4. Writing SFP updates to Odoo in batches...');
    const batches = [];
    for (let i = 0; i < wipSfpUpdates.length; i += WRITE_CHUNK_SIZE) {
      batches.push(wipSfpUpdates.slice(i, i + WRITE_CHUNK_SIZE));
    }

    const tasks = batches.map((chunk, idx) => async () => {
      for (const item of chunk) {
        await adminOdooClient._callObject(WIP_MODEL, 'write', [[item.id], item.vals], {
          context: { tracking_disable: true, no_automation: true }
        });
        await sleep(SLEEP_MS);
      }
      process.stdout.write(`   Batch ${idx + 1}/${batches.length} done\r`);
    });

    await runWithConcurrency(tasks, WRITE_CONCURRENCY);
    console.log(`\n   Finished writing ${wipSfpUpdates.length} SFP updates.`);
  }

  console.log('5. Recomputing SPK Family Recap (% Susut & Total Estimasi SPB) across all families...');
  const families = new Map();
  for (const row of allWips) {
    const rawName = getRowMoName(row);
    const spkKey = deriveSpkInduk(rawName) || `__row_${row.id}`;
    if (!families.has(spkKey)) {
      families.set(spkKey, []);
    }
    families.get(spkKey).push(row);
  }
  console.log(`   Total SPK Induk families: ${families.size}`);

  const recapUpdates = [];
  for (const familyRows of families.values()) {
    const recap = computeSpkFamilyRecap(familyRows);
    if (!recap) continue;
    if (recap.rowUpdates.length > 0) {
      recapUpdates.push(...recap.rowUpdates);
    }
  }
  console.log(`   Found ${recapUpdates.length} WIP rows needing Family Recap updates.`);

  if (recapUpdates.length > 0) {
    console.log('6. Writing Family Recap updates to Odoo in payload-grouped batches...');
    const batchesByPayload = new Map();
    for (const upd of recapUpdates) {
      const key = JSON.stringify(upd.vals);
      if (!batchesByPayload.has(key)) {
        batchesByPayload.set(key, { vals: upd.vals, ids: [] });
      }
      batchesByPayload.get(key).ids.push(upd.id);
    }

    const batchChunks = [];
    for (const { vals, ids } of batchesByPayload.values()) {
      for (let i = 0; i < ids.length; i += WRITE_CHUNK_SIZE) {
        batchChunks.push({ vals, ids: ids.slice(i, i + WRITE_CHUNK_SIZE) });
      }
    }

    const tasks = batchChunks.map((chunk, idx) => async () => {
      await adminOdooClient._callObject(WIP_MODEL, 'write', [chunk.ids, chunk.vals], {
        context: { tracking_disable: true, no_automation: true }
      });
      await sleep(SLEEP_MS);
      process.stdout.write(`   Batch ${idx + 1}/${batchChunks.length} done\r`);
    });

    await runWithConcurrency(tasks, WRITE_CONCURRENCY);
    console.log(`\n   Finished writing ${recapUpdates.length} Family Recap updates.`);
  }

  console.log('All SFP quantities and SPK Induk % Susut successfully backfilled and synchronized!');
}

main().catch((err) => {
  console.error('Fatal error during SFP backfill:', err);
  process.exit(1);
});
