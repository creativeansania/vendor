import { odooService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

async function checkMorePartners() {
  await odooService.authenticate();
  
  const keywords = ['muswe', 'forall', 'persada', 'shopee', 'tokopedia', 'tiktok', 'blibli', 'lazada', 'evermos'];
  for (const kw of keywords) {
    const res = await odooService._callObject('res.partner', 'search_read', [
      [['name', 'ilike', kw]]
    ], {
      fields: ['id', 'name', 'company_id', 'is_company', 'customer_rank'],
      limit: 10
    });
    console.log(`\n🔍 Search partner "${kw}": (${res.length} found)`);
    for (const p of res) {
      console.log(`  - [ID: ${p.id}] ${p.name} (Company: ${JSON.stringify(p.company_id)})`);
    }
  }
}

checkMorePartners();
