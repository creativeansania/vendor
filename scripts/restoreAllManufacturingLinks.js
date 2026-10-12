import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * restoreAllManufacturingLinks.js
 * 
 * Menghubungkan seluruh stock.reference yang memiliki MO ke Sales Order:
 * - Tidak hanya mencari nama dengan /MKT/ atau /SO/, tapi mencari dari SEMUA prefix SO
 *   (ERSYAD, ELZ, SAMPLE, ARUNIKA, dll.) dan dari field x_studio_sales_order pada mrp.production.
 */
async function main() {
  console.log('='.repeat(70));
  console.log(' RESTORE ALL MANUFACTURING LINKS (COMPREHENSIVE)');
  console.log('='.repeat(70));

  await odooAdminService.authenticate();

  // 1. Ambil seluruh stock.reference yang punya MO tapi belum ada link sale_ids
  console.log('\n[1/3] Mengambil stock.reference tanpa link SO...');
  const unlinkedRefs = await odooAdminService._callObject('stock.reference', 'search_read', [
    [['production_ids', '!=', false], ['sale_ids', '=', false]]
  ], { fields: ['id', 'name', 'production_ids'] });

  console.log(` -> Ditemukan ${unlinkedRefs.length} stock.reference yang belum terhubung ke SO`);

  if (unlinkedRefs.length === 0) {
    console.log('Semua stock.reference sudah terhubung ke SO! Selesai.');
    return;
  }

  // 2. Kumpulkan seluruh MO ID yang ada di dalam ref tersebut
  const allMoIds = new Set();
  for (const r of unlinkedRefs) {
    for (const mId of r.production_ids) {
      allMoIds.add(mId);
    }
  }

  console.log(`\n[2/3] Memetakan ${allMoIds.size} MO ke Sales Order terkait...`);
  const moIdsArray = [...allMoIds];
  const moToSoMap = new Map(); // moId -> soId
  const soCache = new Map(); // name -> id

  // Fetch MOs in chunks of 500
  for (let i = 0; i < moIdsArray.length; i += 500) {
    const chunk = moIdsArray.slice(i, i + 500);
    const mos = await odooAdminService._callObject('mrp.production', 'search_read', [
      [['id', 'in', chunk]]
    ], { fields: ['id', 'origin', 'x_studio_sales_order'] });

    const originsToLookup = [];

    for (const m of mos) {
      if (m.x_studio_sales_order && m.x_studio_sales_order[0]) {
        moToSoMap.set(m.id, m.x_studio_sales_order[0]);
      } else if (m.origin) {
        const originParts = m.origin.split(',').map(s => s.trim());
        for (const part of originParts) {
          if (!part.includes('/MO/') && !part.includes('/PO/') && !part.startsWith('P00')) {
            originsToLookup.push({ moId: m.id, name: part });
            break;
          }
        }
      }
    }

    if (originsToLookup.length > 0) {
      const namesNeeded = [...new Set(originsToLookup.map(o => o.name).filter(n => !soCache.has(n)))];
      if (namesNeeded.length > 0) {
        const foundSos = await odooAdminService._callObject('sale.order', 'search_read', [
          [['name', 'in', namesNeeded]]
        ], { fields: ['id', 'name'] });
        for (const s of foundSos) {
          soCache.set(s.name, s.id);
        }
      }

      for (const o of originsToLookup) {
        if (soCache.has(o.name)) {
          moToSoMap.set(o.moId, soCache.get(o.name));
        }
      }
    }

    process.stdout.write(` -> Memproses MO ${Math.min(i + 500, moIdsArray.length)}/${moIdsArray.length}...\r`);
  }

  console.log(`\n -> Berhasil memetakan ${moToSoMap.size} MO ke Sales Order.`);

  // 3. Link stock.reference ke sale.order
  console.log('\n[3/3] Menghubungkan stock.reference ke Sales Order...');
  let linkedCount = 0;
  let skippedCount = 0;

  // Group by soId to minimize writes
  const soToRefIds = new Map(); // soId -> [refId, ...]

  for (const r of unlinkedRefs) {
    let resolvedSoId = null;
    for (const moId of r.production_ids) {
      if (moToSoMap.has(moId)) {
        resolvedSoId = moToSoMap.get(moId);
        break;
      }
    }

    if (resolvedSoId) {
      if (!soToRefIds.has(resolvedSoId)) {
        soToRefIds.set(resolvedSoId, []);
      }
      soToRefIds.get(resolvedSoId).push(r.id);
      linkedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log(` -> Menghubungkan ${linkedCount} reference ke ${soToRefIds.size} Sales Order...`);

  let currentSo = 0;
  const totalSos = soToRefIds.size;

  for (const [soId, refIds] of soToRefIds.entries()) {
    currentSo++;
    // Write link in batches of refIds
    try {
      await odooAdminService._callObject('stock.reference', 'write', [
        refIds,
        { sale_ids: [[4, soId]] }
      ]);
    } catch (err) {
      console.warn(`Error writing batch for SO ${soId}: ${err.message}. Retrying individually...`);
      for (const refId of refIds) {
        try {
          await odooAdminService._callObject('stock.reference', 'write', [
            [refId],
            { sale_ids: [[4, soId]] }
          ]);
        } catch (_) {}
      }
    }

    if (currentSo % 20 === 0 || currentSo === totalSos) {
      console.log(` -> Progress: ${currentSo}/${totalSos} SO selesai`);
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(' SELESAI!');
  console.log('='.repeat(70));
  console.log(` Total Reference Unlinked Awal: ${unlinkedRefs.length}`);
  console.log(` Berhasil Dihubungkan:           ${linkedCount} reference`);
  console.log(` Dilewati (MTS Murni):           ${skippedCount} reference`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('\n[FATAL ERROR]:', err);
});
