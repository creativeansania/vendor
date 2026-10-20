import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { resolveSalesOrderForMo } from '../src/lib/services/wip/wipSyncService.js';
import { transferService } from '../src/lib/services/transferService.js';

async function main() {
  console.log('=== STARTING REFERENCE BACKFILL ===\n');

  // -------------------------------------------------------------
  // PART 1: Backfill MO Sales Orders
  // -------------------------------------------------------------
  console.log('--- PART 1: MO Sales Orders (mrp.production) ---');
  const emptyMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
    [
      ['state', 'not in', ['cancel']],
      ['create_date', '>=', '2026-09-01'],
      ['x_studio_sales_order', '=', false]
    ]
  ], {
    fields: ['id', 'name', 'origin'],
    limit: 150,
    order: 'id desc'
  });

  console.log(`Found ${emptyMos.length} MOs with empty x_studio_sales_order.`);
  let moResolvedCount = 0;

  for (let idx = 0; idx < emptyMos.length; idx++) {
    const mo = emptyMos[idx];
    try {
      const res = await resolveSalesOrderForMo(mo.id);
      if (res) {
        moResolvedCount++;
        console.log(`[MO Backfill] MO #${mo.id} (${mo.name}) -> SO: ${res.name} (ID: ${res.id})`);
      }
    } catch (e) {
      console.warn(`[MO Backfill] Error resolving MO #${mo.id}: ${e.message}`);
    }

    if ((idx + 1) % 25 === 0 || idx + 1 === emptyMos.length) {
      console.log(`[MO Backfill] Progress: ${idx + 1}/${emptyMos.length} MOs checked (Resolved: ${moResolvedCount})`);
    }
  }

  console.log(`\nMO Backfill Completed: Resolved ${moResolvedCount} of ${emptyMos.length} MOs.\n`);

  // -------------------------------------------------------------
  // PART 2: Backfill Transfer References (stock.picking)
  // -------------------------------------------------------------
  console.log('--- PART 2: Transfer References (stock.picking) ---');
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
    limit: 150,
    order: 'id desc'
  });

  console.log(`Found ${emptyPickings.length} pickings with missing MO or SO reference.`);

  // Process in batches of 15
  const BATCH_SIZE = 15;
  let pickingUpdatedCount = 0;

  for (let i = 0; i < emptyPickings.length; i += BATCH_SIZE) {
    const batch = emptyPickings.slice(i, i + BATCH_SIZE);
    const batchIds = batch.map(p => p.id);
    try {
      const res = await transferService.resolveTransferMoAndSo(batchIds);
      const updatedInBatch = res.results.filter(r => r.updated).length;
      pickingUpdatedCount += updatedInBatch;
      console.log(`[Transfer Backfill] Batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}-${Math.min(i + BATCH_SIZE, emptyPickings.length)}/${emptyPickings.length}): ${updatedInBatch} updated.`);
    } catch (e) {
      console.error(`[Transfer Backfill] Error processing batch: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\nTransfer Backfill Completed: Updated ${pickingUpdatedCount} of ${emptyPickings.length} pickings.`);
  console.log('\n=== BACKFILL COMPLETE ===');
}

main().catch(console.error);
