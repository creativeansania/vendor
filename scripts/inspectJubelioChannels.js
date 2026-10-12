import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_URL = process.env.JUBELIO_API_URL || 'https://api2.jubelio.com';
const EMAIL = process.env.JUBELIO_EMAIL;
const PASSWORD = process.env.JUBELIO_PASSWORD;

async function checkStores() {
  const loginRes = await axios.post(`${API_URL}/login`, {
    email: EMAIL,
    password: PASSWORD
  });
  const token = loginRes.data?.token;
  const headers = { Authorization: `Bearer ${token}` };

  const endpoints = [
    '/setup/stores/',
    '/setup/stores',
    '/sales/stores',
    '/sales/stores/',
    '/marketplace/stores',
    '/marketplace/channels'
  ];

  for (const ep of endpoints) {
    try {
      const res = await axios.get(`${API_URL}${ep}`, { headers });
      console.log(`✅ [200] ${ep}:`, JSON.stringify(res.data, null, 2).slice(0, 1000));
    } catch (e) {
      // ignore 404
    }
  }
}

checkStores();
