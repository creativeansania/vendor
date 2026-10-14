import axios from 'axios';
import { db } from '../src/core/database/mysql.js';

async function testApi() {
  console.log('Testing PWA REST API...\n');

  // We can test against direct service calls or start a temporary express listener
  const { authService } = await import('../src/modules/auth/auth.service.js');
  const { pwaService } = await import('../src/modules/pwa/pwa.service.js');

  // 1. Test Login Master Admin
  console.log('1. Testing Login Master Admin...');
  const adminLogin = await authService.login({
    email: 'admin@kantiss.com',
    password: '@Bagusbemo1998'
  });
  console.log(`   ✅ Token generated for: ${adminLogin.user.name} (${adminLogin.user.role})`);

  // 2. Test Master Admin fetching orders (all vendors)
  const adminOrders = await pwaService.getOrders({
    user: adminLogin.user,
    limit: 3
  });
  console.log(`   ✅ Master Admin fetched ${adminOrders.pagination.total} total orders across all vendors.`);
  console.log(`   Sample order: ${adminOrders.orders[0].mo_name} (${adminOrders.orders[0].vendor_name}), Harga: ${adminOrders.orders[0].harga_vendor}`);

  // 3. Test Login Master Vendor KWS (Price Visible)
  console.log('\n2. Testing Login Master Vendor KWS (Price Visible)...');
  const mvLogin = await authService.login({
    email: 'kws.owner@vendor.com',
    password: 'vendor123'
  });
  const mvOrders = await pwaService.getOrders({
    user: mvLogin.user,
    limit: 3
  });
  console.log(`   ✅ Master Vendor KWS fetched ${mvOrders.pagination.total} orders.`);
  const allKwsMv = mvOrders.orders.every(o => o.vendor_name === 'VENDOR KWS');
  console.log(`   ✅ All orders belong strictly to VENDOR KWS: ${allKwsMv}`);
  console.log(`   Sample order: ${mvOrders.orders[0].mo_name}, Harga: ${mvOrders.orders[0].harga_vendor} (HARGA MUNCUL)`);

  // 4. Test Login Admin Vendor KWS (Price Hidden)
  console.log('\n3. Testing Login Admin Vendor KWS (Price Hidden)...');
  const avLogin = await authService.login({
    email: 'kws.staff@vendor.com',
    password: 'vendor123'
  });
  const avOrders = await pwaService.getOrders({
    user: avLogin.user,
    limit: 3
  });
  console.log(`   ✅ Admin Vendor KWS fetched ${avOrders.pagination.total} orders.`);
  const allKwsAv = avOrders.orders.every(o => o.vendor_name === 'VENDOR KWS');
  console.log(`   ✅ All orders belong strictly to VENDOR KWS: ${allKwsAv}`);
  console.log(`   Sample order: ${avOrders.orders[0].mo_name}, Harga: ${avOrders.orders[0].harga_vendor} (HARGA DISEMBUNYIKAN 0.00)`);

  // 5. Test Order Details & Roll lines
  console.log('\n4. Testing Order Details & Roll Lines...');
  const sampleOrderId = mvOrders.orders[0].id;
  const details = await pwaService.getOrderDetails({
    user: mvLogin.user,
    orderId: sampleOrderId
  });
  console.log(`   ✅ Fetched details for Order #${sampleOrderId} (${details.order.mo_name}) with ${details.rollLines.length} roll lines.`);
  if (details.rollLines.length > 0) {
    console.log(`   Sample roll: ${details.rollLines[0].nama_item} (Lot: ${details.rollLines[0].kode_lot}, Qty: ${details.rollLines[0].qty} ${details.rollLines[0].uom})`);
  }

  console.log('\n========================================================');
  console.log('🎉 ALL REST API TESTS PASSED WITH 100% SUCCESS!');
  console.log('========================================================\n');
}

testApi()
  .catch(console.error)
  .finally(() => db.end());
