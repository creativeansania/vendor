import { adminOdooClient } from '../src/core/odoo/odooClient.js';

async function cleanWhdgp() {
  await adminOdooClient.authenticate();

  const whdgpWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
    [['x_studio_warehouse.name', 'ilike', 'DGP']]
  ], { fields: ['id', 'x_name'] });

  console.log(`Found ${whdgpWips.length} WHDGP records to clean:`, whdgpWips.map(w => w.id));

  if (whdgpWips.length > 0) {
    const ids = whdgpWips.map(w => w.id);
    const res = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'unlink', [ids]);
    console.log('Unlink result:', res);
  }

  console.log('✅ All WHDGP records removed from Monitoring WIP Vendor!');
}

cleanWhdgp().catch(console.error);
