import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * restoreManufacturingLinks.js
 * 
 * Re-links stock.reference records that have production_ids (MOs)
 * back to their respective sale.order so that mrp_production_count
 * is correctly computed and the Manufacturing button (fa-wrench)
 * appears on all Sales Orders.
 */
async function main() {
  console.log('='.repeat(70));
  console.log(' RESTORE MANUFACTURING LINKS ON ALL SALES ORDERS');
  console.log('='.repeat(70));

  await odooAdminService.authenticate();

  // 1. Ambil seluruh stock.reference yang memiliki production_ids
  console.log('\n[1/3] Mencari stock.reference yang memiliki production_ids...');
  const refs = await odooAdminService._callObject('stock.reference', 'search_read', [
    [['production_ids', '!=', false]]
  ], { fields: ['id', 'name', 'sale_ids', 'production_ids'] });

  console.log(` -> Total stock.reference dengan MO: ${refs.length} record`);

  // 2. Kumpulkan MO yang perlu di-lookup jika name bukan SO
  const unlinkedRefs = refs.filter(r => !r.sale_ids || r.sale_ids.length === 0);
  console.log(` -> stock.reference tanpa link SO: ${unlinkedRefs.length} record`);

  if (unlinkedRefs.length === 0) {
    console.log('\nSemua stock.reference sudah terhubung ke SO! Selesai.');
    return;
  }

  // Pre-fetch Sales Orders
  const soCache = new Map(); // name -> id
  const allSoNames = new Set();

  for (const r of unlinkedRefs) {
    if (r.name && (r.name.includes('/MKT/') || r.name.includes('/SO/'))) {
      allSoNames.add(r.name.trim());
    }
  }

  console.log(`\n[2/3] Mencari ID untuk ${allSoNames.size} Sales Order terkait...`);
  if (allSoNames.size > 0) {
    const sos = await odooAdminService._callObject('sale.order', 'search_read', [
      [['name', 'in', [...allSoNames]]]
    ], { fields: ['id', 'name'] });
    for (const s of sos) {
      soCache.set(s.name, s.id);
    }
  }

  // Juga lookup MO jika ada ref yang namanya bukan SO
  const moIdsToLookup = [];
  for (const r of unlinkedRefs) {
    if (!soCache.has(r.name) && r.production_ids && r.production_ids.length > 0) {
      moIdsToLookup.push(r.production_ids[0]);
    }
  }

  const moCache = new Map(); // id -> origin SO name
  if (moIdsToLookup.length > 0) {
    const mos = await odooAdminService._callObject('mrp.production', 'search_read', [
      [['id', 'in', moIdsToLookup]]
    ], { fields: ['id', 'origin', 'x_studio_sales_order'] });
    for (const m of mos) {
      if (m.origin && (m.origin.includes('/MKT/') || m.origin.includes('/SO/'))) {
        moCache.set(m.id, m.origin.trim());
        if (!soCache.has(m.origin.trim())) {
          allSoNames.add(m.origin.trim());
        }
      } else if (m.x_studio_sales_order) {
        moCache.set(m.id, m.x_studio_sales_order[1].trim());
      }
    }

    // Fetch missing SOs
    const missingNames = [...allSoNames].filter(name => !soCache.has(name));
    if (missingNames.length > 0) {
      const moreSos = await odooAdminService._callObject('sale.order', 'search_read', [
        [['name', 'in', missingNames]]
      ], { fields: ['id', 'name'] });
      for (const s of moreSos) {
        soCache.set(s.name, s.id);
      }
    }
  }

  // 3. Hubungkan stock.reference ke sale.order
  console.log('\n[3/3] Menghubungkan stock.reference ke Sales Order...');
  let linkedCount = 0;
  let skippedCount = 0;

  for (const r of unlinkedRefs) {
    let targetSoName = null;
    if (soCache.has(r.name)) {
      targetSoName = r.name;
    } else if (r.production_ids && r.production_ids.length > 0 && moCache.has(r.production_ids[0])) {
      targetSoName = moCache.get(r.production_ids[0]);
    }

    if (targetSoName && soCache.has(targetSoName)) {
      const soId = soCache.get(targetSoName);
      try {
        await odooAdminService._callObject('stock.reference', 'write', [[r.id], {
          sale_ids: [[4, soId]] // many2many link
        }]);
        linkedCount++;
      } catch (err) {
        console.error(`Error linking ref ${r.id} to SO ${targetSoName}:`, err.message);
        skippedCount++;
      }
    } else {
      skippedCount++;
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(' SELESAI!');
  console.log('='.repeat(70));
  console.log(` Total Unlinked Diproses: ${unlinkedRefs.length}`);
  console.log(` Berhasil Dihubungkan:     ${linkedCount} reference`);
  console.log(` Dilewati (MTS / No SO):   ${skippedCount} reference`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('\n[FATAL ERROR]:', err);
});
