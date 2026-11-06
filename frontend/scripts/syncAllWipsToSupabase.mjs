import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { wipRepo } from '../src/lib/services/wipRepository.js';
import { supabaseServer } from '../src/lib/supabaseServer.js';
import { WIP_ODOO_SYNC_FIELDS, mapOdooWipToDbPayload } from '../src/lib/services/wip/sync/syncMapper.js';

async function main() {
  console.log('=== MEMULAI SINKRONISASI SEMUA WIP DARI ODOO KE SUPABASE ===\n');
  const startTime = Date.now();

  await Promise.all([
    adminOdooClient.authenticate(),
    wipRepo.preloadVendors()
  ]);

  // 1. Ambil semua odoo_wip_id yang sudah ada di Supabase
  console.log('1. Mengambil data WIP yang sudah tersimpan di Supabase...');
  let existingSupaWipIds = new Set();
  let from = 0;
  while (true) {
    const { data, error } = await supabaseServer
      .from('wip_orders')
      .select('odoo_wip_id')
      .range(from, from + 999);
    if (error) {
      console.error('Error mengambil data Supabase:', error.message);
      break;
    }
    for (const d of data) {
      if (d.odoo_wip_id) existingSupaWipIds.add(Number(d.odoo_wip_id));
    }
    if (data.length < 1000) break;
    from += 1000;
  }
  console.log(`-> Ditemukan ${existingSupaWipIds.size} WIP yang sudah ada di Supabase.`);

  // 2. Ambil semua ID x_monitoring_wip_vendo dari Odoo
  console.log('\n2. Mengambil semua ID x_monitoring_wip_vendo dari Odoo...');
  const allOdooWipIds = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search', [
    [['x_name', '!=', false]]
  ], { order: 'id desc' });
  console.log(`-> Total record WIP di Odoo: ${allOdooWipIds.length}`);

  // 3. Filter hanya WIP yang belum ada di Supabase
  const missingIds = allOdooWipIds.filter((id) => !existingSupaWipIds.has(Number(id)));
  console.log(`-> Total WIP yang BELUM tersinkron ke Supabase: ${missingIds.length}\n`);

  if (missingIds.length === 0) {
    console.log('✅ Semua WIP di Odoo sudah tersinkron penuh ke Supabase!');
    return;
  }

  // 4. Proses sinkronisasi dalam batch 25 per request
  const CHUNK_SIZE = 25;
  let totalSynced = 0;
  let totalErrors = 0;

  for (let i = 0; i < missingIds.length; i += CHUNK_SIZE) {
    const chunkIds = missingIds.slice(i, i + CHUNK_SIZE);
    const batchNum = Math.floor(i / CHUNK_SIZE) + 1;
    const totalBatches = Math.ceil(missingIds.length / CHUNK_SIZE);

    try {
      const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [
        chunkIds,
        WIP_ODOO_SYNC_FIELDS
      ], { context: { bin_size: true } });

      const allRollIds = Array.from(
        new Set(wips.flatMap((w) => w.x_studio_detail_roll_kain || []))
      );

      const rollsById = new Map();
      if (allRollIds.length > 0) {
        try {
          const chunkRolls = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
            allRollIds,
            ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
          ]);
          for (const r of chunkRolls || []) {
            rollsById.set(r.id, r);
          }
        } catch (rollErr) {
          console.warn(`[Batch ${batchNum}] Warning membaca detail roll: ${rollErr.message}`);
        }
      }

      // Upsert ke Supabase
      const waveSize = 5;
      for (let j = 0; j < wips.length; j += waveSize) {
        const wave = wips.slice(j, j + waveSize);
        const results = await Promise.allSettled(
          wave.map(async (w) => {
            const savedId = await wipRepo.upsertWipOrder(mapOdooWipToDbPayload(w));
            if (w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0) {
              const rolls = w.x_studio_detail_roll_kain
                .map((rid) => rollsById.get(rid))
                .filter(Boolean);
              if (rolls.length > 0) {
                await wipRepo.upsertRollLines(savedId, rolls);
              }
            }
            return savedId;
          })
        );

        for (const res of results) {
          if (res.status === 'fulfilled') {
            totalSynced++;
          } else {
            totalErrors++;
            console.warn(`[Batch ${batchNum}] Gagal upsert WIP: ${res.reason?.message}`);
          }
        }
      }

      const pct = (((i + chunkIds.length) / missingIds.length) * 100).toFixed(1);
      console.log(`[Batch ${batchNum}/${totalBatches}] (${i + chunkIds.length}/${missingIds.length} - ${pct}%): Synced ${wips.length} WIPs.`);
    } catch (batchErr) {
      console.error(`[Batch ${batchNum}] Gagal memproses batch: ${batchErr.message}`);
      totalErrors += chunkIds.length;
    }

    // Delay kecil untuk mencegah lonjakan koneksi Supabase/Odoo
    await new Promise((r) => setTimeout(r, 100));
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log('\n=== SINKRONISASI SELESAI ===');
  console.log(`Total Berhasil Tersinkron: ${totalSynced}`);
  console.log(`Total Error / Dilewati: ${totalErrors}`);
  console.log(`Durasi: ${durationSec} detik.`);

  const { count: finalWipCount } = await supabaseServer.from('wip_orders').select('*', { count: 'exact', head: true });
  console.log(`Total WIP Orders di Supabase sekarang: ${finalWipCount}`);
}

main().catch(console.error);

