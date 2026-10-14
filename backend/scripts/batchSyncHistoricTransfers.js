import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Script: batchSyncHistoricTransfers.js
 * 
 * Purpose:
 *   Sinkronisasi menyeluruh transfer internal pabrik (PC, SFP, INT) secara aman dan bertahap:
 *   1. Memindahkan link Sales Order ke field custom `x_studio_sales_order`.
 *   2. Memastikan `x_studio_manufacturing_order` terisi.
 *   3. Menghapus `sale_id` dari transfer internal (PC, SFP, INT) agar TIDAK mengotori tombol Delivery.
 *   4. PERLINDUNGAN KETAT: `sale_id` pada PICK dan OUT (Customer Delivery) 100% DIPERTAHANKAN dan TIDAK DISENTUH!
 * 
 * Usage:
 *   - Dry Run (Simulasi Aman tanpa mengubah database):
 *       node scripts/batchSyncHistoricTransfers.js
 *   - Eksekusi Nyata:
 *       node scripts/batchSyncHistoricTransfers.js --execute
 *   - Opsi Tambahan:
 *       --limit 100            (Batasi total record)
 *       --batch-size 50        (Ukuran chunk per putaran, default 50)
 *       --delay-ms 250         (Jeda antar putaran dalam ms, default 250)
 *       --since 2026-09-01     (Hanya proses data sejak tanggal tertentu)
 */

const args = process.argv.slice(2);
const IS_EXECUTE = args.includes('--execute');

function getArgValue(flag, defaultValue) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return defaultValue;
}

const BATCH_SIZE = parseInt(getArgValue('--batch-size', '50'), 10);
const DELAY_MS = parseInt(getArgValue('--delay-ms', '250'), 10);
const LIMIT = getArgValue('--limit', null) ? parseInt(getArgValue('--limit'), 10) : null;
const SINCE_DATE = getArgValue('--since', null);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function safeCall(model, method, args = [], kwargs = {}, maxRetries = 10) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await odooAdminService._callObject(model, method, args, kwargs);
    } catch (err) {
      const isNetErr =
        err.code === 'ENOTFOUND' ||
        err.code === 'ECONNRESET' ||
        err.code === 'ETIMEDOUT' ||
        err.code === 'EAI_AGAIN' ||
        (err.message && (
          err.message.includes('ENOTFOUND') ||
          err.message.includes('ECONNRESET') ||
          err.message.includes('ETIMEDOUT') ||
          err.message.includes('EAI_AGAIN') ||
          err.message.includes('fetch failed')
        ));
      if (isNetErr && attempt < maxRetries) {
        console.warn(`[Network Warning] Network blip (${err.message}). Retrying in 5s (attempt ${attempt}/${maxRetries})...`);
        await sleep(5000);
        try {
          await odooAdminService.authenticate();
        } catch (_) {}
        continue;
      }
      throw err;
    }
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log(' BATCH SYNC HISTORIC TRANSFERS (PC, SFP, INT) -> ODOO');
  console.log('='.repeat(70));
  console.log(` Mode:        ${IS_EXECUTE ? '>>> REAL EXECUTE (DATABASE WRITE) <<<' : 'DRY RUN (SIMULASI - TANPA PERUBAHAN DATABASE)'}`);
  console.log(` Batch Size:  ${BATCH_SIZE} record per putaran`);
  console.log(` Delay:       ${DELAY_MS} ms antar putaran`);
  console.log(` Limit:       ${LIMIT || 'Semua Data'}`);
  console.log(` Filter Tgl:  ${SINCE_DATE ? 'Sejak ' + SINCE_DATE : 'Seluruh Tahun'}`);
  console.log('='.repeat(70));

  await odooAdminService.authenticate();

  // 1. Ambil seluruh picking type dan kategorikan secara ketat
  console.log('\n[1/4] Mengklasifikasikan Tipe Operasi (Picking Types)...');
  const allTypes = await safeCall('stock.picking.type', 'search_read', [], {
    fields: ['id', 'name', 'code', 'sequence_code']
  });

  const mfgTypeIds = [];
  const protectedDeliveryTypeIds = [];

  for (const t of allTypes) {
    const seq = (t.sequence_code || '').toUpperCase();
    const name = (t.name || '').toLowerCase();
    const code = t.code;

    // Delivery Types yang WAJIB DILINDUNGI (sale_id tidak boleh diubah):
    if (code === 'outgoing' || seq === 'PICK' || seq === 'OUT' || seq === 'POS' || seq === 'DELIVERY' || name.includes('pengiriman')) {
      protectedDeliveryTypeIds.push(t.id);
      continue;
    }

    // Manufacturing Internal Types (PC, SFP, INT) yang akan diproses:
    if (code === 'internal') {
      if (
        seq === 'PC' || seq === 'SFP' || seq === 'INT' ||
        name.includes('pilih komponen') ||
        name.includes('simpan produk') ||
        name.includes('store finished') ||
        name.includes('internal')
      ) {
        mfgTypeIds.push(t.id);
      }
    }
  }

  console.log(` -> Tipe Delivery / Pick / Out yang DILINDUNGI: ${protectedDeliveryTypeIds.length} tipe`);
  console.log(` -> Tipe Internal Pabrik (PC / SFP / INT) Target: ${mfgTypeIds.length} tipe`);

  // 2. Query target pickings
  console.log('\n[2/4] Mencari Transfer Target yang Memerlukan Update...');
  const domain = [
    '&',
    ['picking_type_id', 'in', mfgTypeIds],
    '|', '|',
    ['sale_id', '!=', false],
    '&', ['x_studio_manufacturing_order', '=', false], ['origin', 'like', '/MO/'],
    '&', ['x_studio_sales_order', '=', false], '|', ['origin', 'like', '/MKT/'], ['origin', 'like', '/SO/']
  ];

  if (SINCE_DATE) {
    domain.unshift('&');
    domain.push(['create_date', '>=', SINCE_DATE]);
  }

  const totalCount = await safeCall('stock.picking', 'search_count', [domain]);
  const toProcessCount = LIMIT ? Math.min(LIMIT, totalCount) : totalCount;

  console.log(` -> Total Transfer Ditemukan: ${totalCount} record`);
  console.log(` -> Target Diproses Sesi Ini:  ${toProcessCount} record`);

  if (toProcessCount === 0) {
    console.log('\nSemua transfer internal sudah bersih dan sinkron! Selesai.');
    return;
  }

  // 3. Cache SO & MO lookup
  console.log('\n[3/4] Memulai Pemrosesan Batch Bertahap...');
  let processed = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let lastId = 0;
  const startTime = Date.now();

  const moCache = new Map(); // name or id -> { id, origin, x_studio_sales_order }
  const soCache = new Map(); // name -> id

  while (processed < toProcessCount) {
    const currentBatchLimit = Math.min(BATCH_SIZE, toProcessCount - processed);
    const batchDomain = [...domain];
    if (lastId > 0) {
      batchDomain.unshift('&');
      batchDomain.push(['id', '>', lastId]);
    }

    const pickings = await safeCall('stock.picking', 'search_read', [
      batchDomain
    ], {
      fields: ['id', 'name', 'origin', 'sale_id', 'x_studio_sales_order', 'x_studio_manufacturing_order', 'picking_type_id'],
      limit: currentBatchLimit,
      order: 'id asc'
    });

    if (!pickings || pickings.length === 0) {
      break;
    }

    lastId = pickings[pickings.length - 1].id;

    // Kumpulkan nama MO & SO yang perlu dicari dalam batch ini
    const originsToLookupMo = [];
    const namesToLookupSo = [];

    for (const p of pickings) {
      if (p.origin) {
        const originParts = p.origin.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of originParts) {
          if (part.includes('/MO/')) {
            if (!moCache.has(part)) originsToLookupMo.push(part);
          } else if (part.includes('/MKT/') || part.includes('/SO/')) {
            if (!soCache.has(part)) namesToLookupSo.push(part);
          }
        }
      }
    }

    // Pre-fetch MOs
    if (originsToLookupMo.length > 0) {
      const foundMos = await safeCall('mrp.production', 'search_read', [
        [['name', 'in', originsToLookupMo]]
      ], { fields: ['id', 'name', 'origin', 'x_studio_sales_order'] });
      for (const m of foundMos) {
        moCache.set(m.name, m);
        moCache.set(m.id, m);
        if (m.origin && (m.origin.includes('/MKT/') || m.origin.includes('/SO/')) && !soCache.has(m.origin)) {
          namesToLookupSo.push(m.origin);
        }
      }
    }

    // Pre-fetch SOs
    if (namesToLookupSo.length > 0) {
      const foundSos = await safeCall('sale.order', 'search_read', [
        [['name', 'in', namesToLookupSo]]
      ], { fields: ['id', 'name'] });
      for (const s of foundSos) {
        soCache.set(s.name, s.id);
      }
    }

    // Resolve & Siapkan updates
    const updates = []; // { id, vals, name }

    for (const p of pickings) {
      let resolvedSoId = null;
      let resolvedMoId = p.x_studio_manufacturing_order ? p.x_studio_manufacturing_order[0] : null;

      // Prioritas 1: Jika picking.sale_id sebelumnya sudah terisi (seperti kata user)
      if (p.sale_id && p.sale_id[0]) {
        resolvedSoId = p.sale_id[0];
      }

      // Prioritas 2: Dari origin MO
      if (p.origin) {
        const originParts = p.origin.split(',').map(s => s.trim()).filter(Boolean);
        for (const part of originParts) {
          if (part.includes('/MO/')) {
            const mo = moCache.get(part);
            if (mo) {
              if (!resolvedMoId) resolvedMoId = mo.id;
              if (!resolvedSoId) {
                if (mo.x_studio_sales_order) resolvedSoId = mo.x_studio_sales_order[0];
                else if (mo.origin && soCache.has(mo.origin)) resolvedSoId = soCache.get(mo.origin);
              }
            }
          } else if (soCache.has(part) && !resolvedSoId) {
            resolvedSoId = soCache.get(part);
          }
        }
      }

      // Jika ada MO tapi belum ada SO, coba lookup MO
      if (!resolvedSoId && resolvedMoId) {
        let mo = moCache.get(resolvedMoId);
        if (!mo) {
          const [foundMo] = await safeCall('mrp.production', 'read', [
            [resolvedMoId], ['x_studio_sales_order', 'origin']
          ]);
          mo = foundMo || null;
          moCache.set(resolvedMoId, mo);
        }
        if (mo) {
          if (mo.x_studio_sales_order) {
            resolvedSoId = mo.x_studio_sales_order[0];
          } else if (mo.origin && (mo.origin.includes('/MKT/') || mo.origin.includes('/SO/'))) {
            if (!soCache.has(mo.origin)) {
              const [so] = await safeCall('sale.order', 'search_read', [[['name', '=', mo.origin]]], { fields: ['id', 'name'] });
              if (so) soCache.set(mo.origin, so.id);
              else soCache.set(mo.origin, null);
            }
            resolvedSoId = soCache.get(mo.origin);
          }
        }
      }

      // Bangun nilai write
      const vals = {};
      let needsWrite = false;

      // 1. Set x_studio_sales_order jika belum ada dan SO ditemukan
      if (resolvedSoId && (!p.x_studio_sales_order || p.x_studio_sales_order[0] !== resolvedSoId)) {
        vals.x_studio_sales_order = resolvedSoId;
        needsWrite = true;
      }

      // 2. Set x_studio_manufacturing_order jika belum ada dan MO ditemukan
      if (resolvedMoId && (!p.x_studio_manufacturing_order || p.x_studio_manufacturing_order[0] !== resolvedMoId)) {
        vals.x_studio_manufacturing_order = resolvedMoId;
        needsWrite = true;
      }

      // 3. HAPUS sale_id dari internal transfer (agar tidak mengotori Delivery)
      if (p.sale_id) {
        vals.sale_id = false;
        needsWrite = true;
      }

      if (needsWrite) {
        updates.push({ id: p.id, vals, name: p.name });
      } else {
        skippedCount++;
      }
    }

    // Eksekusi update per batch
    if (updates.length > 0) {
      if (IS_EXECUTE) {
        // Group by identical vals to minimize XML-RPC calls
        const grouped = new Map();
        for (const u of updates) {
          const key = JSON.stringify(u.vals);
          if (!grouped.has(key)) {
            grouped.set(key, { ids: [], vals: u.vals });
          }
          grouped.get(key).ids.push(u.id);
        }

        for (const g of grouped.values()) {
          try {
            await safeCall('stock.picking', 'write', [g.ids, g.vals], {
              context: {
                tracking_disable: true,
                no_automation: true,
                mail_auto_delete: true
              }
            });
            updatedCount += g.ids.length;
          } catch (writeErr) {
            console.warn(`[Batch Warning] Error writing group of ${g.ids.length} records: ${writeErr.message}. Retrying individually...`);
            for (const id of g.ids) {
              try {
                await safeCall('stock.picking', 'write', [[id], g.vals], {
                  context: { tracking_disable: true, no_automation: true, mail_auto_delete: true }
                });
                updatedCount++;
              } catch (singleErr) {
                console.error(`[Record Error] Skipping picking ID ${id}: ${singleErr.message}`);
                skippedCount++;
              }
            }
          }
        }
      } else {
        updatedCount += updates.length;
      }
    }

    processed += pickings.length;
    const pct = ((processed / toProcessCount) * 100).toFixed(1);
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`[Batch Progress] ${processed}/${toProcessCount} (${pct}%) | Di-update: ${updatedCount} | Dilewati: ${skippedCount} | Waktu: ${elapsedSec}s`);

    if (DELAY_MS > 0 && processed < toProcessCount) {
      await sleep(DELAY_MS);
    }
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n' + '='.repeat(70));
  console.log(' SELESAI!');
  console.log('='.repeat(70));
  console.log(` Total Diproses: ${processed}`);
  console.log(` Total Di-update:  ${updatedCount} record`);
  console.log(` Total Dilewati:   ${skippedCount} record`);
  console.log(` Total Waktu:      ${totalSec} detik`);
  console.log(` Status:           ${IS_EXECUTE ? 'BERHASIL DISIMPAN KE DATABASE' : 'DRY RUN BERHASIL (TIDAK ADA PERUBAHAN DATABASE)'}`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('\n[FATAL ERROR]:', err);
});
