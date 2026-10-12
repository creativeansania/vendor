import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const WEBHOOK_URL = `http://localhost:${PORT}/api/webhooks/jubelio/invoice`;
const SECRET = process.env.JUBELIO_WEBHOOK_SECRET || '';

const samplePayload = {
  event: 'postNew Invoice',
  invoice_id: 10001,
  invoice_no: `INV-ANS-TEST-${Math.floor(1000 + Math.random() * 9000)}`,
  channel_name: 'SHOPEE',
  store_name: 'Shopee - Ansania Official',
  created_at: new Date().toISOString(),
  buyer_name: 'Budi Ansania Customer',
  customer_name: 'Budi Ansania Customer',
  customer_email: 'budi.customer@example.com',
  customer_phone: '081234567890',
  shipper: 'SPX Express',
  tracking_number: 'SPXID0987654321',
  items: [
    {
      sku: '1121101111101104',
      item_name: 'KRD KEISHA SHAMORA A - ELZATTA',
      qty: 2,
      price: 16000
    },
    {
      sku: '1121101111101108',
      item_name: 'KRD KEISHA SHAMORA A - ELZATTA',
      qty: 1,
      price: 16000
    }
  ]
};

async function runTest() {
  console.log(`📡 Sending test webhook to ${WEBHOOK_URL}...`);
  console.log('📦 Sample Payload:', JSON.stringify(samplePayload, null, 2));

  const bodyString = JSON.stringify(samplePayload);
  const headers = {
    'Content-Type': 'application/json'
  };

  if (SECRET) {
    const signature = crypto.createHmac('sha256', SECRET).update(bodyString).digest('hex');
    headers['x-jubelio-signature'] = signature;
    console.log(`🔐 Calculated Signature Header: ${signature}`);
  }

  try {
    const response = await axios.post(WEBHOOK_URL, samplePayload, { headers });

    console.log('\n✅ Webhook Response Status:', response.status);
    console.log('🎉 Response Data:', JSON.stringify(response.data, null, 2));
  } catch (error) {
    if (error.response) {
      console.error('\n❌ Webhook Error Response:', error.response.status, error.response.data);
    } else {
      console.error('\n❌ Failed to connect to server:', error.message);
    }
  }
}

runTest();
