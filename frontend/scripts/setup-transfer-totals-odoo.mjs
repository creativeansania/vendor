import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const WEBHOOK_URL = 'https://vendor-sandy-eight.vercel.app/api/webhooks/odoo/transfer-totals';

const STOCK_PICKING_MODEL_ID = 690;
const STOCK_MOVE_MODEL_ID = 683;

const PICKING_NAME_FIELD_ID = 9942;
const PICKING_STATE_FIELD_ID = 9951;
const PICKING_MOVE_IDS_FIELD_ID = 9963;

const MOVE_PRODUCT_UOM_QTY_FIELD_ID = 9629;
const MOVE_PICKING_ID_FIELD_ID = 9641;
const MOVE_QUANTITY_FIELD_ID = 9663;

const VIEW_STOCK_PICKING_LIST_ID = 2881;
const VIEW_WIP_FORM_ID = 4413;

const PICKING_TOTAL_FIELDS = [
  { name: 'x_studio_total_demand', fieldDescription: 'Total Demand' },
  { name: 'x_studio_total_quantity', fieldDescription: 'Total Quantity' }
];

const PICKING_ACTION_NAME = '[Custom] Send Webhook Transfer Totals (Picking)';
const PICKING_AUTO_NAME = '[Custom] Sync Transfer Totals on Move/State Change';

const MOVE_ACTION_NAME = '[Custom] Send Webhook Transfer Totals (Unlocked Move)';
const MOVE_AUTO_NAME = '[Custom] Sync Transfer Totals on Unlocked Done Move Edit';

async function ensureFloatField({ name, fieldDescription }) {
  const existing = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
    [['model', '=', 'stock.picking'], ['name', '=', name]]
  ], { fields: ['id', 'name', 'store', 'ttype', 'readonly'] });

  if (existing && existing.length > 0) {
    console.log(`Field ${name} already exists with ID: ${existing[0].id} (store=${existing[0].store}, ttype=${existing[0].ttype})`);
    return existing[0].id;
  }

  const fieldId = await adminOdooClient._callObject('ir.model.fields', 'create', [{
    name,
    field_description: fieldDescription,
    model_id: STOCK_PICKING_MODEL_ID,
    model: 'stock.picking',
    ttype: 'float',
    state: 'manual',
    store: true,
    readonly: true,
    copied: false
  }]);
  console.log(`Created field ${name} with ID: ${fieldId}`);
  return fieldId;
}

async function replaceColumnsInStudioView(viewId, oldSnippet, newSnippet) {
  const views = await adminOdooClient._callObject('ir.ui.view', 'read', [
    [viewId],
    ['id', 'name', 'arch']
  ]);
  if (!views || views.length === 0) {
    throw new Error(`Studio view #${viewId} not found`);
  }

  const viewName = views[0].name;
  const currentArch = views[0].arch || '';

  if (
    currentArch.includes('name="x_studio_total_demand"') &&
    currentArch.includes('name="x_studio_total_quantity"')
  ) {
    console.log(`View #${viewId} (${viewName}) already uses x_studio_total_demand and x_studio_total_quantity.`);
    return false;
  }

  if (!currentArch.includes(oldSnippet)) {
    throw new Error(`Expected column snippet not found in view #${viewId} (${viewName}).`);
  }

  const updatedArch = currentArch.replace(oldSnippet, newSnippet);
  await adminOdooClient._callObject('ir.ui.view', 'write', [
    [viewId],
    { arch: updatedArch }
  ]);
  console.log(`Updated View #${viewId} (${viewName}) to display x_studio_total_demand & x_studio_total_quantity.`);
  return true;
}

async function ensureStudioViews() {
  await replaceColumnsInStudioView(
    VIEW_STOCK_PICKING_LIST_ID,
    [
      '    <field optional="show" name="x_studio_demand" sum="Sum of Demand" options="{}"/>',
      '    <field optional="show" name="x_studio_related_field_47t_1jgjd4hoh" string="Quantity" sum="Sum of Quantity" options="{}"/>'
    ].join('\n'),
    [
      '    <field optional="show" name="x_studio_total_demand" string="Demand" sum="Sum of Demand" options="{}" readonly="True"/>',
      '    <field optional="show" name="x_studio_total_quantity" string="Quantity" sum="Sum of Quantity" options="{}" readonly="True"/>'
    ].join('\n')
  );

  await replaceColumnsInStudioView(
    VIEW_WIP_FORM_ID,
    [
      '              <field optional="show" name="x_studio_demand" sum="Sum of Demand"/>',
      '              <field optional="show" name="x_studio_related_field_47t_1jgjd4hoh" string="Quantity" sum="Sum of Quantity"/>'
    ].join('\n'),
    [
      '              <field optional="show" name="x_studio_total_demand" string="Demand" sum="Sum of Demand" readonly="True"/>',
      '              <field optional="show" name="x_studio_total_quantity" string="Quantity" sum="Sum of Quantity" readonly="True"/>'
    ].join('\n')
  );
}

async function upsertWebhookServerAction({ name, modelId, webhookFieldIds }) {
  const existing = await adminOdooClient._callObject('ir.actions.server', 'search_read', [
    [['name', '=', name], ['model_id', '=', modelId]]
  ], { fields: ['id'] });

  const payload = {
    name,
    model_id: modelId,
    state: 'webhook',
    webhook_url: WEBHOOK_URL,
    webhook_field_ids: [[6, 0, webhookFieldIds]]
  };

  if (existing && existing.length > 0) {
    const actionId = existing[0].id;
    await adminOdooClient._callObject('ir.actions.server', 'write', [[actionId], payload]);
    console.log(`Updated 0-LoC Webhook Server Action "${name}" ID: ${actionId}`);
    return actionId;
  }

  const actionId = await adminOdooClient._callObject('ir.actions.server', 'create', [payload]);
  console.log(`Created 0-LoC Webhook Server Action "${name}" ID: ${actionId}`);
  return actionId;
}

async function upsertAutomation({ name, modelId, trigger, triggerFieldIds, filterDomain, actionId }) {
  const existing = await adminOdooClient._callObject('base.automation', 'search_read', [
    [['name', '=', name]]
  ], { fields: ['id'] });

  const payload = {
    name,
    model_id: modelId,
    trigger,
    trigger_field_ids: [[6, 0, triggerFieldIds]],
    filter_domain: filterDomain,
    action_server_ids: [[6, 0, [actionId]]],
    active: true
  };

  if (existing && existing.length > 0) {
    const autoId = existing[0].id;
    await adminOdooClient._callObject('base.automation', 'write', [[autoId], payload]);
    console.log(`Updated Automation "${name}" ID: ${autoId}`);
    return autoId;
  }

  const autoId = await adminOdooClient._callObject('base.automation', 'create', [payload]);
  console.log(`Created Automation "${name}" ID: ${autoId}`);
  return autoId;
}

async function verifyViewsAndZeroLoC() {
  const pickingListView = await adminOdooClient._callObject('stock.picking', 'get_views', [
    [[false, 'list']]
  ]);
  const pickingListArch = pickingListView?.views?.list?.arch || '';
  if (!pickingListArch.includes('x_studio_total_demand') || !pickingListArch.includes('x_studio_total_quantity')) {
    throw new Error('Verification failed: stock.picking list view missing new total fields.');
  }
  console.log('Verified stock.picking list view loads cleanly with x_studio_total_demand & x_studio_total_quantity.');

  const wipFormView = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'get_views', [
    [[false, 'form']]
  ]);
  const wipFormArch = wipFormView?.views?.form?.arch || '';
  if (!wipFormArch.includes('x_studio_total_demand') || !wipFormArch.includes('x_studio_total_quantity')) {
    throw new Error('Verification failed: x_monitoring_wip_vendo form view missing new total fields.');
  }
  console.log('Verified x_monitoring_wip_vendo form view loads cleanly with x_studio_total_demand & x_studio_total_quantity.');

  const allAutos = await adminOdooClient._callObject('base.automation', 'search_read', [
    []
  ], { fields: ['id', 'name', 'action_server_ids'] });
  const linkedActionIds = [...new Set(allAutos.flatMap((a) => a.action_server_ids || []))];
  if (linkedActionIds.length > 0) {
    const linkedActions = await adminOdooClient._callObject('ir.actions.server', 'read', [
      linkedActionIds,
      ['id', 'name', 'state']
    ]);
    const codeActions = (linkedActions || []).filter((a) => a.state === 'code');
    console.log(`Custom automation server actions with state='code': ${codeActions.length}`);
    if (codeActions.length > 0) {
      throw new Error(`Unexpected state='code' automation actions found: ${JSON.stringify(codeActions)}`);
    }
  }
}

async function main() {
  await adminOdooClient.authenticate();

  for (const fieldSpec of PICKING_TOTAL_FIELDS) {
    await ensureFloatField(fieldSpec);
  }

  await ensureStudioViews();

  // Rule 1: stock.picking on_create_or_write watching ONLY state & move_ids
  const pickingActionId = await upsertWebhookServerAction({
    name: PICKING_ACTION_NAME,
    modelId: STOCK_PICKING_MODEL_ID,
    webhookFieldIds: [PICKING_NAME_FIELD_ID, PICKING_STATE_FIELD_ID]
  });

  await upsertAutomation({
    name: PICKING_AUTO_NAME,
    modelId: STOCK_PICKING_MODEL_ID,
    trigger: 'on_create_or_write',
    triggerFieldIds: [PICKING_STATE_FIELD_ID, PICKING_MOVE_IDS_FIELD_ID],
    filterDomain: "[('move_ids', '!=', False)]",
    actionId: pickingActionId
  });

  // Rule 2: stock.move on_write watching product_uom_qty & quantity ONLY when Done picking is unlocked
  const moveActionId = await upsertWebhookServerAction({
    name: MOVE_ACTION_NAME,
    modelId: STOCK_MOVE_MODEL_ID,
    webhookFieldIds: [MOVE_PICKING_ID_FIELD_ID]
  });

  await upsertAutomation({
    name: MOVE_AUTO_NAME,
    modelId: STOCK_MOVE_MODEL_ID,
    trigger: 'on_write',
    triggerFieldIds: [MOVE_PRODUCT_UOM_QTY_FIELD_ID, MOVE_QUANTITY_FIELD_ID],
    filterDomain: "['&', ('picking_id', '!=', False), '&', ('picking_id.state', '=', 'done'), ('picking_id.is_locked', '=', False)]",
    actionId: moveActionId
  });

  await verifyViewsAndZeroLoC();
  console.log('Transfer Totals Odoo setup complete.');
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
