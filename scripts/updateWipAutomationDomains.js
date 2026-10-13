import { adminOdooClient } from '../src/core/odoo/odooClient.js';

async function updateRules() {
  await adminOdooClient.authenticate();
  const d59 = "['&', ('state', '=', 'confirmed'), '|', ('warehouse_id.code', '=like', 'VD%'), ('warehouse_id.name', 'ilike', 'VENDOR')]";
  const d60 = "['&', ('state', '=', 'done'), '&', ('name', '=like', 'VD%'), '|', '|', ('name', 'ilike', '/PC/'), ('name', 'ilike', '/SPB/'), ('name', 'ilike', '/SFP/')]";

  await adminOdooClient._callObject('base.automation', 'write', [[59], { filter_domain: d59 }]);
  await adminOdooClient._callObject('base.automation', 'write', [[60], { filter_domain: d60 }]);
  console.log('Successfully updated filter_domain on base.automation 59 & 60!');

  const updated = await adminOdooClient._callObject('base.automation', 'read', [
    [59, 60],
    ['id', 'name', 'filter_domain', 'active']
  ]);
  console.log('Updated rules:', updated);
}

updateRules().catch(console.error);
