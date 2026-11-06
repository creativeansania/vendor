import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { resolveSalesOrderForMo } from '../src/lib/services/wip/wipSyncService.js';
import { transferService } from '../src/lib/services/transferService.js';
import { updateSaleOrderCounts } from '../src/lib/services/soCountService.js';

async function main() {
  console.log('=== MEMULAI BACKFILL REFERENSI SO & MO SEJAK SEPTEMBER 2026 ===\n');
  const startTime = Date.now();
  await adminOdooClient.authenticate();

  // -------------------------------------------------------------
  // BAGIAN 1: Backfill Sales Order pada MO (mrp.production)
  // -------------------------------------------------------------
  console.log('--- BAGIAN 1: Tautkan Sales Order ke mrp.production ---');
  const emptyMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
    [
      ['state', 'not in', ['cancel']],
      ['create_date', '>=', '2026-09-01'],
      ['x_studio_sales_order', '=', false]
    ]
  ], {
    fields: ['id', 'name', 'origin', 'sale_line_id', 'x_studio_origin_mo'],
    order: 'id desc'
  });

  console.log(`Ditemukan ${emptyMos.length} MO sejak September yang belum memiliki x_studio_sales_order.`);
  let moResolvedCount = 0;
  const resolvedSoIds = new Set();

  for (let idx = 0; idx < emptyMos.length; idx++) {
    const mo = emptyMos[idx];
    try {
      const res = await resolveSalesOrderForMo(mo.id, { preloadedMo: mo });
      if (res && res.id) {
        moResolvedCount++;
        resolvedSoIds.add(res.id);
        console.log(`[MO Backfill] MO #${mo.id} (${mo.name}) -> SO: ${res.name} (ID: ${res.id})`);
      }
    } catch (e) {
      console.warn(`[MO Backfill] Warning resolving MO #${mo.id}: ${e.message}`);
    }

    if ((idx + 1) % 25 === 0 || idx + 1 === emptyMos.length) {
      console.log(`[MO Backfill] Progress: ${idx + 1}/${emptyMos.length} MO diperiksa (Berhasil terhubung: ${moResolvedCount})`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(`\nSelesai Bagian 1: Berhasil menautkan ${moResolvedCount} dari ${emptyMos.length} MO ke Sales Order.\n`);

  // -------------------------------------------------------------
  // BAGIAN 2: Backfill Transfer References (stock.picking)
  // -------------------------------------------------------------
  console.log('--- BAGIAN 2: Tautkan MO & SO ke stock.picking (Transfers) ---');
  const emptyPickings = await adminOdooClient._callObject('stock.picking', 'search_read', [
    [
      ['state', 'not in', ['cancel']],
      ['create_date', '>=', '2026-09-01'],
      '|',
      ['x_studio_manufacturing_order', '=', false],
      ['x_studio_sales_order', '=', false]
    ]
  ], {
    fields: ['id', 'name', 'origin'],
    order: 'id desc'
  });

  console.log(`Ditemukan ${emptyPickings.length} transfer sejak September yang belum lengkap referensi MO/SO-nya.`);

  const BATCH_SIZE = 15;
  let pickingUpdatedCount = 0;

  for (let i = 0; i < emptyPickings.length; i += BATCH_SIZE) {
    const batch = emptyPickings.slice(i, i + BATCH_SIZE);
    const batchIds = batch.map((p) => p.id);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(emptyPickings.length / BATCH_SIZE);

    try {
      const res = await transferService.resolveTransferMoAndSo(batchIds);
      const updatedInBatch = (res.results || []).filter((r) => r.updated).length;
      pickingUpdatedCount += updatedInBatch;

      for (const r of res.results || []) {
        if (Array.isArray(r.affectedSoIds)) {
          for (const sid of r.affectedSoIds) {
            if (sid) resolvedSoIds.add(sid);
          }
        }
      }

      console.log(`[Transfer Backfill] Batch ${batchNum}/${totalBatches} (${i + batch.length}/${emptyPickings.length}): ${updatedInBatch} transfer berhasil diupdate.`);
    } catch (e) {
      console.error(`[Transfer Backfill] Error pada batch ${batchNum}: ${e.message}`);
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  console.log(`\nSelesai Bagian 2: Berhasil menautkan ${pickingUpdatedCount} dari ${emptyPickings.length} transfer.`);

  // -------------------------------------------------------------
  // BAGIAN 3: Update Counts pada Sales Order Odoo
  // -------------------------------------------------------------
  if (resolvedSoIds.size > 0) {
    console.log(`\n--- BAGIAN 3: Refresh Counter MO & Transfer pada ${resolvedSoIds.size} Sales Order ---`);
    const soList = Array.from(resolvedSoIds);
    await updateSaleOrderCounts(adminOdooClient, soList);
    console.log('Counter Sales Order berhasil diperbarui.');
  }

  const durationMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n=== SELURUH PROSES BACKFILL SELESAI (${durationMin} menit) ===`);
}

main().catch(console.error);

