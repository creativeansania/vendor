import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.JUBELIO_API_URL || 'https://api2.jubelio.com';
const EMAIL = process.env.JUBELIO_EMAIL;
const PASSWORD = process.env.JUBELIO_PASSWORD;

async function checkBrandsInJubelio() {
  const loginRes = await axios.post(`${API_URL}/login`, {
    email: EMAIL,
    password: PASSWORD
  });
  const token = loginRes.data?.token;
  const headers = { Authorization: `Bearer ${token}` };

  console.log('Inspecting items in Jubelio for store_names and brands...');
  const storeNamesFound = new Set();
  const brandsFound = new Set();

  for (let page = 1; page <= 10; page++) {
    const res = await axios.get(`${API_URL}/inventory/items/`, {
      headers,
      params: { page, pageSize: 50 }
    });
    const items = res.data?.data || [];
    if (items.length === 0) break;

    for (const it of items) {
      if (it.item_name) {
        if (it.item_name.toLowerCase().includes('muswe')) brandsFound.add('Muswe');
        if (it.item_name.toLowerCase().includes('forall')) brandsFound.add('Forall Hijab');
        if (it.item_name.toLowerCase().includes('persada')) brandsFound.add('Persada');
        if (it.item_name.toLowerCase().includes('ansania')) brandsFound.add('Ansania');
      }

      if (it.online_status && Array.isArray(it.online_status)) {
        for (const st of it.online_status) {
          if (st.store_name) storeNamesFound.add(st.store_name);
        }
      }
      if (it.variants && Array.isArray(it.variants)) {
        for (const v of it.variants) {
          if (v.store_names && Array.isArray(v.store_names)) {
            for (const sn of v.store_names) {
              if (sn.store_name) storeNamesFound.add(sn.store_name);
            }
          }
        }
      }
    }
  }

  console.log('Brands identified in Jubelio Items:', Array.from(brandsFound));
  console.log('All Online Store Names attached to Items:', Array.from(storeNamesFound));
}

checkBrandsInJubelio();
