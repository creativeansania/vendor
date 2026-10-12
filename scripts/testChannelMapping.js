import assert from 'assert';
import { resolveCustomerAndNotes, detectChannelType } from '../src/utils/channelHelper.js';
import { config } from '../src/config/env.js';

console.log('🧪 Running Channel Mapping & Customer Resolution Tests...\n');

// Test Case 1: Shopee Order
const shopeeData = {
  channel_name: 'SHOPEE',
  store_name: 'Shopee - Ansania Official',
  buyer_name: 'Budi Shopee Buyer',
  customer_phone: '081234567890',
  customer_email: 'budi@shopee.user',
  shipper: 'SPX Express',
  tracking_number: 'SPXID0987654321',
  ref_no: '240902SHP8812',
  note: 'Tolong packing bubble wrap tebal'
};

const resShopee = resolveCustomerAndNotes(shopeeData);
console.log('✅ Test 1: Shopee Channel');
console.log('   Resolved Customer Name:', resShopee.customer.name);
console.log('   Is Generic Channel Customer:', resShopee.customer.isChannelCustomer);
console.log('   Formatted Order Note:\n' + resShopee.orderNote.split('\n').map(l => '     ' + l).join('\n'));
assert.strictEqual(resShopee.customer.name, config.channels.shopee);
assert.strictEqual(resShopee.customer.isChannelCustomer, true);
assert.ok(resShopee.orderNote.includes('Buyer: Budi Shopee Buyer'));
assert.ok(resShopee.orderNote.includes('SPX Express'));

// Test Case 2: Tokopedia / TikTok Order (Shop | Tokopedia)
const tokpedData = {
  channel_name: 'Shop | Tokopedia - Ansania',
  buyer_name: 'Siti Tokopedia',
  customer_phone: '085712345678',
  salesorder_no: '#TKP-99128',
  shipper: 'JNE Reguler',
  tracking_number: 'JNE001928374'
};

const resTokped = resolveCustomerAndNotes(tokpedData);
console.log('\n✅ Test 2: Tokopedia Channel');
console.log('   Resolved Customer Name:', resTokped.customer.name);
console.log('   Is Generic Channel Customer:', resTokped.customer.isChannelCustomer);
assert.strictEqual(resTokped.customer.name, config.channels.tokopedia);
assert.strictEqual(resTokped.customer.isChannelCustomer, true);

// Test Case 3: TikTok Shop Order
const tiktokData = {
  channel_name: 'TIKTOK',
  store_name: 'TikTok Shop Ansania',
  buyer_name: 'Rina TikTok',
  customer_phone: '087812345678'
};

const resTikTok = resolveCustomerAndNotes(tiktokData);
console.log('\n✅ Test 3: TikTok Shop Channel');
console.log('   Resolved Customer Name:', resTikTok.customer.name);
assert.strictEqual(resTikTok.customer.name, config.channels.tiktok);
assert.strictEqual(resTikTok.customer.isChannelCustomer, true);

// Test Case 4: Blibli Order
const blibliData = {
  channel_name: 'BLIBLI',
  store_name: 'BLIBLI - ANO-70023',
  buyer_name: 'Nurul Blibli',
  ref_no: 'BLI-12159302825'
};

const resBlibli = resolveCustomerAndNotes(blibliData);
console.log('\n✅ Test 4: Blibli Channel');
console.log('   Resolved Customer Name:', resBlibli.customer.name);
assert.strictEqual(resBlibli.customer.name, config.channels.blibli);
assert.strictEqual(resBlibli.customer.isChannelCustomer, true);

// Test Case 5: Evermos Order
const evermosData = {
  channel_name: 'Evermos',
  store_name: 'Evermos - Forall Hijab',
  customer_name: 'Casmia Reseller',
  tracking_number: 'JO0310523854'
};

const resEvermos = resolveCustomerAndNotes(evermosData);
console.log('\n✅ Test 5: Evermos Channel');
console.log('   Resolved Customer Name:', resEvermos.customer.name);
assert.strictEqual(resEvermos.customer.name, config.channels.evermos);
assert.strictEqual(resEvermos.customer.isChannelCustomer, true);

// Test Case 6: Internal / Telemarketing / Direct B2B (Non-Marketplace)
const internalData = {
  channel_name: 'INTERNAL',
  store_name: 'INTERNAL - Telemarketing',
  customer_name: 'Hawin Umiyati (House of neema)',
  customer_email: 'hawin@example.com',
  customer_phone: '08119876543',
  ref_no: 'SO-000008715'
};

const resInternal = resolveCustomerAndNotes(internalData);
console.log('\n✅ Test 6: Internal / B2B Order (Preserves Individual Customer)');
console.log('   Resolved Customer Name:', resInternal.customer.name);
console.log('   Is Generic Channel Customer:', resInternal.customer.isChannelCustomer);
assert.strictEqual(resInternal.customer.name, 'Hawin Umiyati (House of neema)');
assert.strictEqual(resInternal.customer.email, 'hawin@example.com');
assert.strictEqual(resInternal.customer.isChannelCustomer, false);

// Test Case 7: Jubelio Invoice Payload Format (from webhook /api/sales/invoices/...)
const jubelioInvoiceData = {
  invoice_id: 74683,
  invoice_no: 'INV-000074683',
  contact_id: -6,
  customer_name: 'SHOPEE',
  salesorder_no: 'SP-2609020RKUKSM7',
  buyer_name: 'A**l',
  ref_no: 'SP-2609020RKUKSM7',
  source: 64
};

const resJubelioInvoice = resolveCustomerAndNotes(jubelioInvoiceData);
console.log('\n✅ Test 7: Jubelio Invoice Payload Format');
console.log('   Resolved Customer Name:', resJubelioInvoice.customer.name);
console.log('   Is Generic Channel Customer:', resJubelioInvoice.customer.isChannelCustomer);
console.log('   Formatted Order Note:\n' + resJubelioInvoice.orderNote.split('\n').map(l => '     ' + l).join('\n'));
assert.strictEqual(resJubelioInvoice.customer.name, config.channels.shopee);
assert.strictEqual(resJubelioInvoice.customer.isChannelCustomer, true);
assert.ok(resJubelioInvoice.orderNote.includes('Buyer: A**l'));
assert.ok(resJubelioInvoice.orderNote.includes('Ref Jubelio: SP-2609020RKUKSM7'));

console.log('\n🎉 ALL 7 CHANNEL MAPPING TESTS PASSED SUCCESSFULLY!\n');

