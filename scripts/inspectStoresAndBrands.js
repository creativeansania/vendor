import axios from 'axios';
import dotenv from 'dotenv';
import { odooService } from '../src/services/odooService.js';

dotenv.config();

const API_URL = process.env.JUBELIO_API_URL || 'https://api2.jubelio.com';
const EMAIL = process.env.JUBELIO_EMAIL;
const PASSWORD = process.env.JUBELIO_PASSWORD;

async function checkStoresAndCompanies() {
  console.log('================ 1. JUBELIO STORES & LOCATIONS ================');
  try {
    const loginRes = await axios.post(`${API_URL}/login`, {
      email: EMAIL,
      password: PASSWORD
    });
    const token = loginRes.data?.token;
    const headers = { Authorization: `Bearer ${token}` };

    // Fetch locations in Jubelio
    try {
      const locRes = await axios.get(`${API_URL}/inventory/locations/`, { headers });
      console.log('\n📍 Jubelio Locations:', JSON.stringify(locRes.data, null, 2));
    } catch (e) {
      console.log('Location fetch error:', e.message);
    }

    // Fetch distinct stores across orders
    console.log('\nFetching 200 recent orders from Jubelio to map all stores & brands...');
    const allStores = new Map();

    for (let page = 1; page <= 10; page++) {
      const res = await axios.get(`${API_URL}/sales/orders/`, {
        headers,
        params: { page, pageSize: 50 }
      });
      const orders = res.data?.data || [];
      if (orders.length === 0) break;

      for (const o of orders) {
        const key = `${o.channel_name || 'N/A'} ||| ${o.store_name || o.store || 'N/A'}`;
        if (!allStores.has(key)) {
          allStores.set(key, {
            channel_name: o.channel_name,
            store_name: o.store_name,
            store: o.store,
            location_name: o.location_name,
            sample_order_no: o.salesorder_no
          });
        }
      }
    }

    console.log('\n🏪 All Detected Stores in Jubelio:');
    for (const [key, val] of allStores.entries()) {
      console.log(` - Channel: "${val.channel_name}" | Store Name: "${val.store_name}" | Store: "${val.store}" | Loc: "${val.location_name}" (Ex: ${val.sample_order_no})`);
    }

  } catch (error) {
    console.error('Jubelio Check Error:', error.message);
  }

  console.log('\n================ 2. ODOO COMPANIES & PARTNERS ================');
  try {
    // Authenticate Odoo
    await odooService.authenticate();
    const companies = await odooService._callObject('res.company', 'search_read', [[]], {
      fields: ['id', 'name']
    });
    console.log('\n🏢 Odoo Companies:');
    console.log(JSON.stringify(companies, null, 2));

    const existingPartners = await odooService._callObject('res.partner', 'search_read', [
      ['|', ['name', 'ilike', 'shopee'], '|', ['name', 'ilike', 'tokopedia'], '|', ['name', 'ilike', 'tiktok'], '|', ['name', 'ilike', 'ansania'], '|', ['name', 'ilike', 'muswe'], ['name', 'ilike', 'forall']]
    ], {
      fields: ['id', 'name', 'company_id'],
      limit: 50
    });
    console.log('\n👥 Matching Odoo Partners:');
    console.log(JSON.stringify(existingPartners, null, 2));

  } catch (err) {
    console.error('Odoo Check Error:', err.message);
  }
}

checkStoresAndCompanies();
