import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { transferService } from '../src/lib/services/transferService.js';

async function backfillTransfers(limit = 100) {
  console.log(`=== STARTING TRANSFER REFERENCE BACKFILL (Limit: ${limit}) ===\n`);

  const pickings = await adminOdooClient._callObject('stock.picking', 'search_read', [
    [
      ['state', 'not in', ['cancel']],
      ['create_date', '>=', '2026-10-01'],
      '|',
      ['x_studio_manufacturing_order', '=', false],
      ['x_studio_sales_order', '=', false]
    ]
  ], {
    fields: ['id', 'name', 'origin'],
    limit,
    order: 'id desc'
  });

  console.log(`Found ${pickings.length} pickings to resolve.`);

  const BATCH_SIZE = 15;
  let totalUpdated = 0;

  for (let i = 0; i < pickings.length; i += BATCH_SIZE) {
    const batch = pickings.slice(i, i + BATCH_SIZE);
    const batchIds = batch.map(p => p.id);
    try {
      const res = await transferService.resolveTransferMoAndSo(batchIds);
      const updatedCount = res.results.filter(r => r.updated).length;
      totalUpdated += updatedCount;
      console.log(`Batch ${Math.floor(i / BATCH_SIZE) + 1} (${i + 1}-${Math.min(i + BATCH_SIZE, pickings.length)}/${pickings.length}): ${updatedCount} updated.`);
    } catch (err) {
      console.error(`Batch ${Math.floor(i / BATCH_SIZE) + 1} error:`, err.message);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n=== BACKFILL COMPLETE: ${totalUpdated} of ${pickings.length} pickings updated ===`);
}

const limitArg = process.argv[2] ? parseInt(process.argv[2], 10) : 100;
backfillTransfers(limitArg).catch(console.error);
