import { adminOdooClient } from '../src/core/odoo/odooClient.js';

async function checkRecentActivity() {
  await adminOdooClient.authenticate();
  const sinceUtc = '2026-10-13 01:00:00'; // ~3 hours ago from 11:07 WIB (04:07 UTC)
  console.log(`Checking activity since: ${sinceUtc} UTC (08:00:00 WIB)...`);

  // 1. Search Vendor MOs created or written since then
  const recentMos = await adminOdooClient._callObject('mrp.production', 'search_read', [
    [
      ['picking_type_id', 'ilike', 'vendor'],
      '|',
      ['write_date', '>=', sinceUtc],
      ['create_date', '>=', sinceUtc]
    ]
  ], {
    fields: ['id', 'name', 'state', 'create_date', 'write_date', 'write_uid', 'x_studio_sales_order', 'warehouse_id', 'picking_type_id'],
    order: 'write_date desc'
  });

  console.log(`\n--- VENDOR MOs MODIFIED / CREATED IN LAST 3 HOURS (${recentMos.length} found) ---`);
  for (const mo of recentMos) {
    const wip = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
      [['x_studio_manufacturing_order', '=', mo.id]]
    ], { fields: ['id', 'x_name', 'x_studio_status_produksi', 'x_studio_detail_roll_kain', 'x_studio_daftar_transfer'] });
    const hasWip = wip.length > 0;
    const wipInfo = hasWip 
      ? `WIP #${wip[0].id} (${wip[0].x_studio_detail_roll_kain.length} rolls, ${wip[0].x_studio_daftar_transfer.length} pickings)` 
      : 'TIDAK ADA DI WIP';
    console.log(`- [${mo.state}] ${mo.name} (ID: ${mo.id}) | Edited: ${mo.write_date} UTC by ${mo.write_uid ? mo.write_uid[1] : 'unknown'} | WIP: ${wipInfo}`);
  }

  // 2. Search Vendor Transfers done since then
  const recentPickings = await adminOdooClient._callObject('stock.picking', 'search_read', [
    [
      ['picking_type_id', 'ilike', 'vendor'],
      ['state', '=', 'done'],
      '|',
      ['date_done', '>=', sinceUtc],
      ['write_date', '>=', sinceUtc]
    ]
  ], {
    fields: ['id', 'name', 'state', 'date_done', 'write_date', 'write_uid', 'origin', 'picking_type_id'],
    order: 'write_date desc'
  });

  console.log(`\n--- VENDOR TRANSFERS DONE IN LAST 3 HOURS (${recentPickings.length} found) ---`);
  for (const p of recentPickings) {
    console.log(`- ${p.name} (ID: ${p.id}) | Type: ${p.picking_type_id ? p.picking_type_id[1] : ''} | Done: ${p.date_done || p.write_date} UTC by ${p.write_uid ? p.write_uid[1] : 'unknown'} | Origin: ${p.origin}`);
  }
}

checkRecentActivity().catch(console.error);
