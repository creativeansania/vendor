import { adminOdooClient } from '../src/core/odoo/odooClient.js';
import { wipVendorService } from '../src/modules/wip-vendor/wip.service.js';
import { logger } from '../src/utils/logger.js';

async function backfill() {
  console.log('=====================================================');
  console.log('🚀 STARTING WIP VENDOR BACKFILL (SO >= 2026-09-01)');
  console.log('=====================================================\n');

  await adminOdooClient.authenticate();

  // 1. Fetch all Sales Orders created since 1 September 2026
  console.log('1. Searching Sales Orders created >= 2026-09-01...');
  const soIds = await adminOdooClient._callObject('sale.order', 'search', [
    [['create_date', '>=', '2026-09-01 00:00:00']]
  ]);
  console.log(`   Found ${soIds.length} Sales Orders.\n`);

  if (soIds.length === 0) {
    console.log('No Sales Orders found. Exiting.');
    return;
  }

  // 2. Fetch all Vendor MOs linked to those Sales Orders (confirmed & done)
  console.log('2. Searching linked Vendor MOs (confirmed, done, progress)...');
  const vendorMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
    [
      ['x_studio_sales_order', 'in', soIds],
      ['picking_type_id', 'ilike', 'vendor'],
      ['state', 'in', ['confirmed', 'progress', 'to_close', 'done']]
    ]
  ], {
    fields: ['id', 'name', 'state', 'warehouse_id', 'create_date'],
    order: 'id asc'
  });

  const total = vendorMos.length;
  console.log(`   Found ${total} Vendor MOs to process.\n`);

  if (total === 0) {
    console.log('No Vendor MOs found to backfill. Exiting.');
    return;
  }

  // 3. Process each MO sequentially
  console.log('3. Processing MOs into Monitoring WIP Vendor...\n');
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;
  const startTime = Date.now();

  for (let i = 0; i < total; i++) {
    const mo = vendorMos[i];
    const index = i + 1;
    const prefix = `[${index}/${total}]`;

    try {
      const res = await wipVendorService.onMoConfirmed(mo.id, { autoSync: true });

      if (res && res.alreadyExists) {
        skipCount++;
        // If already exists, still ensure sync is up to date
        try {
          await wipVendorService._syncWipFromPickings(res.wipId, mo.id);
        } catch (e) {}
      } else if (res && res.success) {
        successCount++;
      } else {
        skipCount++;
      }

      if (index % 25 === 0 || index === total) {
        const elapsedSec = Math.round((Date.now() - startTime) / 1000);
        const percent = Math.round((index / total) * 100);
        console.log(`⏳ Progress: ${prefix} (${percent}%) - Success: ${successCount}, Skips: ${skipCount}, Errors: ${errorCount} (${elapsedSec}s elapsed)`);
      }
    } catch (err) {
      errorCount++;
      console.error(`❌ Error on MO #${mo.id} (${mo.name}): ${err.message}`);
    }
  }

  const durationMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log('\n=====================================================');
  console.log(`🎉 BACKFILL COMPLETED in ${durationMin} minutes!`);
  console.log(`   Total Processed: ${total}`);
  console.log(`   Newly Created/Synced: ${successCount}`);
  console.log(`   Existing/Skipped: ${skipCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log('=====================================================');
}

backfill().catch(console.error);
