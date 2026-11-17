import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const WEBHOOK_URL = 'https://vendor-sandy-eight.vercel.app/api/webhooks/odoo/so-sfp-done';
const SERVER_ACTION_NAME = '[Custom] Send Webhook SO SFP Done';
const AUTOMATION_NAME = '[Custom] Trigger SO Activity & Qty SFP on Vendor SFP Done';
const STUDIO_SO_FORM_VIEW_ID = 2522;
const SALE_ORDER_LINE_MODEL_ID = 806;
const STOCK_PICKING_MODEL_ID = 690;
const STOCK_PICKING_STATE_DONE_ID = 2337;
const STOCK_PICKING_NAME_FIELD_ID = 9942;

async function ensureQtySfpField() {
  const existing = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
    [['model', '=', 'sale.order.line'], ['name', '=', 'x_studio_qty_sfp_done']]
  ], { fields: ['id', 'name'] });

  if (existing && existing.length > 0) {
    console.log('Field x_studio_qty_sfp_done already exists with ID:', existing[0].id);
    return existing[0].id;
  }

  const fieldId = await adminOdooClient._callObject('ir.model.fields', 'create', [{
    name: 'x_studio_qty_sfp_done',
    field_description: 'Qty SFP',
    model_id: SALE_ORDER_LINE_MODEL_ID,
    model: 'sale.order.line',
    ttype: 'float',
    state: 'manual',
    store: true,
    copied: false
  }]);
  console.log('Created field x_studio_qty_sfp_done with ID:', fieldId);
  return fieldId;
}

async function ensureSaleOrderFormColumn() {
  const views = await adminOdooClient._callObject('ir.ui.view', 'read', [
    [STUDIO_SO_FORM_VIEW_ID],
    ['id', 'name', 'arch']
  ]);
  if (!views || views.length === 0) {
    throw new Error(`Studio view #${STUDIO_SO_FORM_VIEW_ID} not found`);
  }

  const currentArch = views[0].arch || '';
  if (currentArch.includes('x_studio_qty_sfp_done')) {
    console.log(`View #${STUDIO_SO_FORM_VIEW_ID} already contains x_studio_qty_sfp_done.`);
    return;
  }

  const targetAnchor = `<xpath expr="/form/sheet/notebook/page[@name='order_lines']/field[@name='order_line']/list//field[@name='qty_invoiced']" position="attributes">`;
  if (!currentArch.includes(targetAnchor)) {
    throw new Error(`Anchor not found in Studio view #${STUDIO_SO_FORM_VIEW_ID}`);
  }

  const insertSnippet = [
    `<xpath expr="/form/sheet/notebook/page[@name='order_lines']/field[@name='order_line']/list//field[@name='qty_invoiced']" position="before">`,
    `    <field name="x_studio_qty_sfp_done" string="Qty SFP" readonly="True" sum="Sum of Qty SFP" column_invisible="parent.state != 'sale'" optional="show"/>`,
    `  </xpath>`,
    `  ${targetAnchor}`
  ].join('\n');

  const updatedArch = currentArch.replace(targetAnchor, insertSnippet);
  await adminOdooClient._callObject('ir.ui.view', 'write', [
    [STUDIO_SO_FORM_VIEW_ID],
    { arch: updatedArch }
  ]);
  console.log(`Updated Studio view #${STUDIO_SO_FORM_VIEW_ID} with Qty SFP column.`);
}

async function ensureWebhookAndAutomation() {
  const existingActions = await adminOdooClient._callObject('ir.actions.server', 'search_read', [
    [['name', '=', SERVER_ACTION_NAME], ['model_id', '=', STOCK_PICKING_MODEL_ID]]
  ], { fields: ['id'] });

  const actionPayload = {
    name: SERVER_ACTION_NAME,
    model_id: STOCK_PICKING_MODEL_ID,
    state: 'webhook',
    webhook_url: WEBHOOK_URL,
    webhook_field_ids: [[6, 0, [STOCK_PICKING_NAME_FIELD_ID]]]
  };

  let actionId;
  if (existingActions && existingActions.length > 0) {
    actionId = existingActions[0].id;
    await adminOdooClient._callObject('ir.actions.server', 'write', [[actionId], actionPayload]);
    console.log('Updated 0-LoC Webhook Server Action ID:', actionId);
  } else {
    actionId = await adminOdooClient._callObject('ir.actions.server', 'create', [actionPayload]);
    console.log('Created 0-LoC Webhook Server Action ID:', actionId);
  }

  const existingAutos = await adminOdooClient._callObject('base.automation', 'search_read', [
    [['name', '=', AUTOMATION_NAME]]
  ], { fields: ['id'] });

  const autoPayload = {
    name: AUTOMATION_NAME,
    model_id: STOCK_PICKING_MODEL_ID,
    trigger: 'on_state_set',
    trg_selection_field_id: STOCK_PICKING_STATE_DONE_ID,
    filter_domain: "['&', ('state', '=', 'done'), '&', ('name', 'ilike', '/SFP/'), '|', ('name', '=like', 'VD%'), ('picking_type_id', 'ilike', 'vendor')]",
    action_server_ids: [[6, 0, [actionId]]],
    active: true
  };

  if (existingAutos && existingAutos.length > 0) {
    await adminOdooClient._callObject('base.automation', 'write', [[existingAutos[0].id], autoPayload]);
    console.log('Updated Automation ID:', existingAutos[0].id);
  } else {
    const autoId = await adminOdooClient._callObject('base.automation', 'create', [autoPayload]);
    console.log('Created Automation ID:', autoId);
  }
}

async function main() {
  await adminOdooClient.authenticate();
  await ensureQtySfpField();
  await ensureSaleOrderFormColumn();
  await ensureWebhookAndAutomation();

  // Verify sale.order form view compiles cleanly
  const viewCheck = await adminOdooClient._callObject('sale.order', 'get_views', [
    [[false, 'form']]
  ]);
  console.log('sale.order form view loaded cleanly:', Boolean(viewCheck?.views?.form));
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
