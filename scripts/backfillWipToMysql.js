import { adminOdooClient } from '../src/core/odoo/odooClient.js';
import { wipMysqlRepo } from '../src/modules/wip-vendor/wip.mysql.repo.js';
import { db } from '../src/core/database/mysql.js';

async function backfillToMysql() {
  console.log('========================================================');
  console.log('🚀 BACKFILL WIP VENDOR RECORDS TO MYSQL (cPanel)');
  console.log('========================================================\n');

  await adminOdooClient.authenticate();

  // 1. Seed vendor warehouses
  console.log('1. Seeding vendor warehouses...');
  const whs = await adminOdooClient._callObject('stock.warehouse', 'search_read', [
    [['name', 'ilike', 'vendor']]
  ], { fields: ['id', 'name', 'code'] });
  await wipMysqlRepo.seedVendors(whs);
  console.log(`   Seeded ${whs.length} vendor warehouses.\n`);

  // 2. Fetch all valid WIP Vendor records
  console.log('2. Fetching all WIP Vendor records from Odoo...');
  const wipFields = [
    'id', 'x_name', 'write_date',
    'x_studio_manufacturing_order', 'x_studio_warehouse', 'x_studio_sales_order',
    'x_studio_product', 'x_studio_status_spk', 'x_studio_qty_spk',
    'x_studio_start_spk', 'x_studio_deadline_spk', 'x_studio_qty_kebutuhan_kain',
    'x_studio_kain_dari_gudang_qty', 'x_studio_unit_kain_dari_gudang',
    'x_studio_accessories_dari_gudang', 'x_studio_estimasi_dari_spb',
    'x_studio_status_kebutuhan_kain', 'x_studio_actual_cutting',
    'x_studio_selisih_hasil_cutting', 'x_studio_qty_kirim_a_grade',
    'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
    'x_studio_no_surat_jalan_sfp', 'x_studio_tanggal_sfp', 'x_studio_qty_masuk_sfp',
    'x_studio_harga', 'x_studio_total_harga', 'x_studio_status_produksi',
    'x_studio_detail_roll_kain'
  ];

  const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
    [['x_studio_manufacturing_order', '!=', false]]
  ], { fields: wipFields, order: 'id asc' });

  const totalWips = wips.length;
  console.log(`   Found ${totalWips} valid WIP Vendor records in Odoo.\n`);

  // 3. Collect all roll line IDs to batch fetch
  console.log('3. Batch fetching roll lines...');
  const allLineIds = [];
  for (const w of wips) {
    if (Array.isArray(w.x_studio_detail_roll_kain)) {
      allLineIds.push(...w.x_studio_detail_roll_kain);
    }
  }

  const lineMap = new Map(); // lineId -> line object
  const BATCH_SIZE = 500;
  for (let i = 0; i < allLineIds.length; i += BATCH_SIZE) {
    const chunk = allLineIds.slice(i, i + BATCH_SIZE);
    const lines = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
      chunk,
      ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_berat_kg']
    ]);
    for (const l of lines) {
      lineMap.set(l.id, l);
    }
  }
  console.log(`   Fetched ${lineMap.size} roll lines from Odoo.\n`);

  // 4. Insert WIP Orders into MySQL
  console.log('4. Inserting WIP Orders and Roll Lines into MySQL...');
  let processed = 0;
  let rollLinesInserted = 0;
  const startTime = Date.now();

  for (const w of wips) {
    processed++;
    const moName = w.x_name || (w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[1] : `WIP#${w.id}`);
    const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : null;
    const whName = w.x_studio_warehouse ? w.x_studio_warehouse[1] : '';

    // Check if backorder e.g. VDKWS/MO/04802-001 -> parent prefix VDKWS/MO/04802
    let parentMoName = null;
    if (moName.includes('-')) {
      const parts = moName.split('-');
      if (/^\d+$/.test(parts[parts.length - 1])) {
        parentMoName = moName.substring(0, moName.lastIndexOf('-'));
      }
    }

    const wipData = {
      odoo_wip_id: w.id,
      odoo_mo_id: w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : 0,
      odoo_warehouse_id: whId,
      vendor_name: whName,
      parent_mo_name: parentMoName,
      mo_name: moName,
      mo_state: w.x_studio_status_spk || 'confirmed',
      sales_order: w.x_studio_sales_order ? w.x_studio_sales_order[1] : null,
      product_name: w.x_studio_product ? w.x_studio_product[1] : null,
      qty_spk: w.x_studio_qty_spk || 0,
      start_spk: w.x_studio_start_spk || null,
      deadline_spk: w.x_studio_deadline_spk || null,
      qty_kebutuhan_kain: w.x_studio_qty_kebutuhan_kain || 0,
      kain_dari_gudang: w.x_studio_kain_dari_gudang_qty || 0,
      unit_kain: w.x_studio_unit_kain_dari_gudang ? w.x_studio_unit_kain_dari_gudang[1] : null,
      accessories_dari_gudang: w.x_studio_accessories_dari_gudang || 0,
      estimasi_dari_spb: w.x_studio_estimasi_dari_spb || 0,
      status_kebutuhan_kain: w.x_studio_status_kebutuhan_kain || null,
      actual_cutting: w.x_studio_actual_cutting || 0,
      selisih_hasil_cutting: w.x_studio_selisih_hasil_cutting || 0,
      qty_grade_a: w.x_studio_qty_kirim_a_grade || 0,
      qty_grade_b: w.x_studio_qty_kirim_b_grade || 0,
      sisa_makloon_kg: w.x_studio_sisa_makloon_kg || 0,
      no_surat_jalan_sfp: w.x_studio_no_surat_jalan_sfp || null,
      tanggal_sfp: w.x_studio_tanggal_sfp || null,
      qty_masuk_sfp: w.x_studio_qty_masuk_sfp || 0,
      harga_vendor: w.x_studio_harga || 0,
      total_harga: w.x_studio_total_harga || 0,
      status_produksi: w.x_studio_status_produksi || 'Proses',
      is_active: 1,
      odoo_write_date: w.write_date || null
    };

    const mysqlWipId = await wipMysqlRepo.upsertWipOrder(wipData);

    // Roll lines
    const rollIds = w.x_studio_detail_roll_kain || [];
    if (rollIds.length > 0) {
      const lines = rollIds.map(rid => lineMap.get(rid)).filter(Boolean);
      if (lines.length > 0) {
        await wipMysqlRepo.upsertRollLines(mysqlWipId, lines);
        rollLinesInserted += lines.length;
      }
    }

    if (processed % 100 === 0 || processed === totalWips) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const pct = Math.round((processed / totalWips) * 100);
      console.log(`⏳ Progress: [${processed}/${totalWips}] (${pct}%) - Roll lines: ${rollLinesInserted} (${elapsed}s)`);
    }
  }

  // 5. Link parent-child backorders
  console.log('\n5. Linking parent-child backorder relationships in MySQL...');
  await db.query(`
    UPDATE wip_orders child
    JOIN wip_orders parent ON parent.mo_name = SUBSTRING_INDEX(child.mo_name, '-', 1)
    SET child.parent_wip_order_id = parent.id
    WHERE child.mo_name LIKE '%-%' AND child.parent_wip_order_id IS NULL AND parent.id != child.id
  `);

  const [wipCount] = await db.query('SELECT COUNT(*) AS total FROM wip_orders');
  const [rollCount] = await db.query('SELECT COUNT(*) AS total FROM wip_roll_lines');
  const [parentCount] = await db.query('SELECT COUNT(*) AS total FROM wip_orders WHERE parent_wip_order_id IS NOT NULL');

  console.log('\n========================================================');
  console.log('🎉 MYSQL BACKFILL COMPLETED SUCCESSFULLY!');
  console.log(`   Total WIP Orders in MySQL: ${wipCount[0].total}`);
  console.log(`   Total Roll Lines in MySQL: ${rollCount[0].total}`);
  console.log(`   Backorder Child Orders Linked: ${parentCount[0].total}`);
  console.log('========================================================\n');
}

backfillToMysql()
  .catch(err => {
    console.error('Backfill failed:', err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
