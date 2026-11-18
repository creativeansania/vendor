import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

// Automation #32 ([Custom] MO Reference in Transfer) on stock.picking
const AUTO_MO_REF_ID = 32;
const PICKING_TRIGGER_FIELD_IDS = [
  9943,  // origin
  9963,  // move_ids
  9951,  // state
  12958, // sale_id
  9966   // picking_type_id
];

// Automation #67 & Action #1454 (BoM Precision Sync) on mrp.bom.line
const AUTO_BOM_PREC_ID = 67;
const ACTION_BOM_PREC_ID = 1454;
const BOM_LINE_QTY_FIELD_IDS = [
  10731, // product_qty
  38381  // x_studio_qty_presisi
];

async function main() {
  await adminOdooClient.authenticate();

  await adminOdooClient._callObject('base.automation', 'write', [
    [AUTO_MO_REF_ID],
    { trigger_field_ids: [[6, 0, PICKING_TRIGGER_FIELD_IDS]] }
  ]);
  console.log(`Updated Automation #${AUTO_MO_REF_ID} trigger_field_ids -> [${PICKING_TRIGGER_FIELD_IDS.join(', ')}]`);

  await adminOdooClient._callObject('ir.actions.server', 'write', [
    [ACTION_BOM_PREC_ID],
    { webhook_field_ids: [[6, 0, BOM_LINE_QTY_FIELD_IDS]] }
  ]);
  console.log(`Updated Server Action #${ACTION_BOM_PREC_ID} webhook_field_ids -> [${BOM_LINE_QTY_FIELD_IDS.join(', ')}]`);

  await adminOdooClient._callObject('base.automation', 'write', [
    [AUTO_BOM_PREC_ID],
    { trigger_field_ids: [[6, 0, BOM_LINE_QTY_FIELD_IDS]] }
  ]);
  console.log(`Updated Automation #${AUTO_BOM_PREC_ID} trigger_field_ids -> [${BOM_LINE_QTY_FIELD_IDS.join(', ')}]`);

  const verifiedAutos = await adminOdooClient._callObject('base.automation', 'read', [
    [AUTO_MO_REF_ID, AUTO_BOM_PREC_ID],
    ['id', 'name', 'trigger', 'trigger_field_ids', 'active']
  ]);
  const verifiedAct = await adminOdooClient._callObject('ir.actions.server', 'read', [
    [ACTION_BOM_PREC_ID],
    ['id', 'name', 'state', 'webhook_field_ids']
  ]);

  console.log('Verified Automations:', JSON.stringify(verifiedAutos, null, 2));
  console.log('Verified Server Action:', JSON.stringify(verifiedAct, null, 2));
}

main().catch((err) => {
  console.error('Hardening setup failed:', err);
  process.exit(1);
});
