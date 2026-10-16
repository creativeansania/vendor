import xmlrpc from 'xmlrpc';

const url = process.env.ODOO_URL || 'https://kanti-sehati-sukses.odoo.com';
const db = process.env.ODOO_DB || 'kanti-sehati-sukses';
const username = process.env.ODOO_ADMIN_USERNAME || 'it@kantiss.com';
const password = process.env.ODOO_ADMIN_PASSWORD || 'jadiapaya';

function createClient(path) {
  return xmlrpc.createSecureClient({
    host: 'kanti-sehati-sukses.odoo.com',
    port: 443,
    path
  });
}

function callRpc(client, method, params) {
  return new Promise((resolve, reject) => {
    client.methodCall(method, params, (err, val) => {
      if (err) return reject(err);
      resolve(val);
    });
  });
}

async function run() {
  console.log('Authenticating with Odoo as admin...');
  const common = createClient('/xmlrpc/2/common');
  const uid = await callRpc(common, 'authenticate', [db, username, password, {}]);
  console.log(`Authenticated. UID: ${uid}`);

  const object = createClient('/xmlrpc/2/object');

  const updates = [
    { id: 1349, url: 'https://vendor.kantiss.com/api/webhooks/odoo/so-confirm' },
    { id: 1384, url: 'https://vendor.kantiss.com/api/webhooks/odoo/transfer-mo-reference' },
    { id: 1420, url: 'https://vendor.kantiss.com/api/webhooks/odoo/wip/mo-confirmed' },
    { id: 1421, url: 'https://vendor.kantiss.com/api/webhooks/odoo/wip/transfer-done' },
    { id: 1422, url: 'https://vendor.kantiss.com/api/webhooks/odoo/wip/production-result' },
    { id: 1383, url: 'https://vendor.kantiss.com/api/webhooks/odoo/duplicate-landed-cost' },
    { id: 1350, url: 'https://vendor.kantiss.com/api/webhooks/odoo/send-wa' },
  ];

  for (const item of updates) {
    console.log(`Updating Action #${item.id} -> ${item.url}...`);
    await callRpc(object, 'execute_kw', [
      db, uid, password,
      'ir.actions.server',
      'write',
      [[item.id], { webhook_url: item.url }]
    ]);
  }

  console.log('Verifying updated actions in Odoo...');
  const updatedRecords = await callRpc(object, 'execute_kw', [
    db, uid, password,
    'ir.actions.server',
    'read',
    [updates.map(u => u.id), ['id', 'name', 'model_name', 'webhook_url']]
  ]);

  console.log('\n--- VERIFICATION RESULT ---');
  for (const r of updatedRecords) {
    console.log(`[ID ${r.id}] ${r.name} (${r.model_name}): ${r.webhook_url}`);
  }
  console.log('\nAll 7 Odoo Webhook actions updated successfully!');
}

run().catch(err => {
  console.error('Update failed:', err);
  process.exit(1);
});
