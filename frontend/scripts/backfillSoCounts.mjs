import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { updateSaleOrderCounts } from '../src/lib/services/soCountService.js';

async function main() {
  console.log('=== Starting Backfill for Sales Order MO & Transfer PC Counts ===');

  try {
    // 1. Collect all SO IDs from mrp.production
    console.log('Fetching SO IDs linked to MOs...');
    const mosWithSo = await adminOdooClient._callObject('mrp.production', 'search_read', [
      [['x_studio_sales_order', '!=', false]]
    ], { fields: ['x_studio_sales_order'], limit: 5000 });

    const soIdSet = new Set();
    for (const m of mosWithSo) {
      if (m.x_studio_sales_order && m.x_studio_sales_order[0]) {
        soIdSet.add(m.x_studio_sales_order[0]);
      }
    }
    console.log(`Found ${soIdSet.size} unique SO IDs linked to MOs.`);

    // 2. Collect all SO IDs from stock.picking
    console.log('Fetching SO IDs linked to Pickings...');
    const picksWithSo = await adminOdooClient._callObject('stock.picking', 'search_read', [
      [['x_studio_sales_order', '!=', false]]
    ], { fields: ['x_studio_sales_order'], limit: 5000 });

    for (const p of picksWithSo) {
      if (p.x_studio_sales_order && p.x_studio_sales_order[0]) {
        soIdSet.add(p.x_studio_sales_order[0]);
      }
    }
    console.log(`Total unique SO IDs to backfill: ${soIdSet.size}`);

    const soIds = Array.from(soIdSet);
    const BATCH_SIZE = 10;
    let processed = 0;

    for (let i = 0; i < soIds.length; i += BATCH_SIZE) {
      const chunk = soIds.slice(i, i + BATCH_SIZE);
      await updateSaleOrderCounts(adminOdooClient, chunk);
      processed += chunk.length;
      console.log(`Progress: ${processed} / ${soIds.length} SOs updated...`);
    }

    console.log('=== Backfill Completed Successfully! ===');
  } catch (err) {
    console.error('Backfill error:', err);
  }
}

main();

