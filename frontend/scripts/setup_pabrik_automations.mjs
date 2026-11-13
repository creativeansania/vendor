import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

async function main() {
  await adminOdooClient.authenticate();

  // 1. Automation for Pabrik MO Done
  const existingMoAuto = await adminOdooClient._callObject('base.automation', 'search_read', [
    [['name', '=', '[Custom] Trigger Rekap Susut on Pabrik MO Done']]
  ], { fields: ['id'] });

  const moAutoPayload = {
    name: '[Custom] Trigger Rekap Susut on Pabrik MO Done',
    model_id: 753, // mrp.production
    trigger: 'on_state_set',
    trg_selection_field_id: 2431, // Done
    filter_domain: "['&', ('state', '=', 'done'), '|', ('picking_type_id', 'ilike', 'pabrik'), ('warehouse_id.name', 'ilike', 'pabrik')]",
    action_server_ids: [[6, 0, [1420]]],
    active: true
  };

  if (!existingMoAuto || existingMoAuto.length === 0) {
    const id = await adminOdooClient._callObject('base.automation', 'create', [moAutoPayload]);
    console.log('Created MO Done automation ID:', id);
  } else {
    await adminOdooClient._callObject('base.automation', 'write', [[existingMoAuto[0].id], moAutoPayload]);
    console.log('Updated MO Done automation ID:', existingMoAuto[0].id);
  }

  // 2. Automation for Pabrik Transfer Done
  const existingTrfAuto = await adminOdooClient._callObject('base.automation', 'search_read', [
    [['name', '=', '[Custom] Trigger Rekap Susut on Pabrik Transfer Done']]
  ], { fields: ['id'] });

  const trfAutoPayload = {
    name: '[Custom] Trigger Rekap Susut on Pabrik Transfer Done',
    model_id: 690, // stock.picking
    trigger: 'on_state_set',
    trg_selection_field_id: 2337, // Done
    filter_domain: "['&', ('state', '=', 'done'), '&', '|', ('picking_type_id', 'ilike', 'pabrik'), ('warehouse_id.name', 'ilike', 'pabrik'), '|', ('name', 'ilike', '/SFP/'), ('name', 'ilike', '/PC/')]",
    action_server_ids: [[6, 0, [1421]]],
    active: true
  };

  if (!existingTrfAuto || existingTrfAuto.length === 0) {
    const id = await adminOdooClient._callObject('base.automation', 'create', [trfAutoPayload]);
    console.log('Created Transfer Done automation ID:', id);
  } else {
    await adminOdooClient._callObject('base.automation', 'write', [[existingTrfAuto[0].id], trfAutoPayload]);
    console.log('Updated Transfer Done automation ID:', existingTrfAuto[0].id);
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
