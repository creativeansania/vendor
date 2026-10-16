import { wipService } from '../src/lib/services/wipService.js';
import { supabaseServer } from '../src/lib/supabaseServer.js';

async function main() {
  console.log('=== Memulai Initial Sync dari Odoo ke Supabase ===');
  const startTime = Date.now();

  try {
    const res = await wipService.syncAllFromOdoo();
    console.log(`✅ Sukses Sync! Total WIP Orders Tersinkron: ${res.totalSynced}`);

    const { count: wipCount } = await supabaseServer.from('wip_orders').select('*', { count: 'exact', head: true });
    const { count: vendorCount } = await supabaseServer.from('vendors').select('*', { count: 'exact', head: true });
    const { count: rollCount } = await supabaseServer.from('wip_roll_lines').select('*', { count: 'exact', head: true });

    console.log('\n=== Status Data di Supabase Sekarang ===');
    console.log(`- Vendors: ${vendorCount}`);
    console.log(`- WIP Orders: ${wipCount}`);
    console.log(`- Roll Lines: ${rollCount}`);
    console.log(`Durasi: ${((Date.now() - startTime) / 1000).toFixed(1)} detik.`);
  } catch (err) {
    console.error('❌ Sync Gagal:', err);
    process.exit(1);
  }
}

main();
