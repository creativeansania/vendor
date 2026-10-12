import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('='.repeat(70));
  console.log(' BERSIHKAN CUSTOMER DELIVERY (PICK/OUT) DARI TRANSFER MO');
  console.log('='.repeat(70));

  await odooAdminService.authenticate();

  // 1. Ambil seluruh picking type yang merupakan Customer Delivery (PICK / OUT / DELIVERY / Outgoing)
  const allTypes = await odooAdminService._callObject('stock.picking.type', 'search_read', [], {
    fields: ['id', 'name', 'code', 'sequence_code']
  });

  const deliveryTypeIds = allTypes.filter(t => {
    const seq = (t.sequence_code || '').toUpperCase();
    const name = (t.name || '').toLowerCase();
    return t.code === 'outgoing' || seq === 'PICK' || seq === 'OUT' || seq === 'DELIVERY' || name.includes('pengiriman');
  }).map(t => t.id);

  console.log(`[1/3] Tipe Customer Delivery yang diproteksi: ${deliveryTypeIds.length} tipe`);

  // 2. Cari picking bertipe delivery yang salah terisi x_studio_sales_order
  const mixedPickings = await odooAdminService._callObject('stock.picking', 'search_read', [
    [['picking_type_id', 'in', deliveryTypeIds], ['x_studio_sales_order', '!=', false]]
  ], { fields: ['id', 'name', 'sale_id', 'x_studio_sales_order'] });

  console.log(`[2/3] Ditemukan ${mixedPickings.length} picking delivery yang tercampur di Transfer MO`);

  if (mixedPickings.length === 0) {
    console.log('Tidak ada picking delivery yang tercampur. Bersih!');
    return;
  }

  // 3. Update bertahap: pastikan sale_id tetap ada (masuk Delivery), dan hapus x_studio_sales_order (keluar dari Transfer MO)
  console.log(`[3/3] Membersihkan ${mixedPickings.length} picking...`);
  const mixedIds = mixedPickings.map(p => p.id);

  // Group dalam chunk 50
  let updated = 0;
  for (let i = 0; i < mixedIds.length; i += 50) {
    const chunk = mixedIds.slice(i, i + 50);
    await odooAdminService._callObject('stock.picking', 'write', [
      chunk,
      { x_studio_sales_order: false }
    ], {
      context: {
        tracking_disable: true,
        no_automation: true,
        mail_auto_delete: true
      }
    });
    updated += chunk.length;
    console.log(` -> Progress: ${updated}/${mixedIds.length} picking dibersihkan...`);
  }

  console.log('\n' + '='.repeat(70));
  console.log(' SELESAI!');
  console.log('='.repeat(70));
  console.log(` Total Picking Delivery Dibersihkan dari Transfer MO: ${updated}`);
  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('[ERROR]:', err);
});
