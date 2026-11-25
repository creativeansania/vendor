import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_BACKFILL = process.argv.includes('--skip-backfill');

const EXPENSE_MODEL_ID = 906; // hr.expense
const ATTACHMENT_MODEL_ID = 29; // ir.attachment
const REPORT_EXPENSE_FINISH_ID = 984; // Expenses Report Finish (hr_expense.report_expense_sheet_copy_2)

const FIELD_NAME = 'x_studio_printed';
const PRINT_MARKER_EXPR = "'[EXPENSE_PRINT_LOG]_%s.pdf' % (object.id)";
const WEBHOOK_URL = 'https://vendor-sandy-eight.vercel.app/api/webhooks/odoo/expense-printed';

const SERVER_ACTION_NAME = '[Custom] Send Webhook Expense Printed';
const AUTOMATION_NAME = '[Custom] Mark Expense Printed on Expenses Report Finish';

const BACKFILL_CUTOFF_DATE = '2026-11-01'; // Paid expenses strictly before Nov 1, 2026 -> Printed = True
const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };

const VIEW_SPECS = [
  {
    name: 'hr.expense.list.inherit.printed',
    type: 'list',
    inherit_id: 2730, // hr.expense.list (inherited by 2731 & 2732)
    priority: 25,
    arch_db: `<field name="state" position="after">
    <field name="x_studio_printed" widget="boolean_toggle" optional="show" string="Printed" readonly="0"/>
</field>`,
  },
  {
    name: 'hr.expense.form.inherit.printed',
    type: 'form',
    inherit_id: 2733, // hr.expense.view.form
    priority: 25,
    arch_db: `<xpath expr="//field[@name='analytic_distribution']" position="after">
    <field name="x_studio_printed" widget="boolean_toggle" string="Printed" readonly="0"/>
</xpath>`,
  },
  {
    name: 'hr.expense.search.inherit.printed',
    type: 'search',
    inherit_id: 2741, // hr.expense.view.search (inherited by 4167 search with panel)
    priority: 25,
    arch_db: `<data>
    <filter name="draft" position="before">
        <filter string="Belum Di-print" name="not_printed" domain="[('x_studio_printed', '=', False)]"/>
        <filter string="Sudah Di-print" name="is_printed" domain="[('x_studio_printed', '=', True)]"/>
        <separator/>
    </filter>
    <xpath expr="//group[@name='group_filters']" position="inside">
        <filter string="Printed" name="group_by_printed" domain="[]" context="{'group_by': 'x_studio_printed'}"/>
    </xpath>
</data>`,
  },
];

async function ensurePrintedField() {
  const existing = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
    [['model', '=', 'hr.expense'], ['name', '=', FIELD_NAME]],
  ], { fields: ['id', 'name', 'ttype', 'copied', 'readonly'] });

  if (existing.length > 0) {
    const rec = existing[0];
    if (rec.copied !== false) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would update ${FIELD_NAME} (ID ${rec.id}) copied=false`);
      } else {
        await adminOdooClient._callObject('ir.model.fields', 'write', [[rec.id], { copied: false }]);
        console.log(`Updated existing field ${FIELD_NAME} (ID ${rec.id}) copied=false`);
      }
    } else {
      console.log(`Reusing existing field ${FIELD_NAME} (ID ${rec.id}, copied=false)`);
    }
    return rec.id;
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would create boolean field ${FIELD_NAME} ("Printed", copied=false) on hr.expense`);
    return null;
  }

  const fieldId = await adminOdooClient._callObject('ir.model.fields', 'create', [{
    model_id: EXPENSE_MODEL_ID,
    name: FIELD_NAME,
    field_description: 'Printed',
    ttype: 'boolean',
    copied: false,
    readonly: false,
    store: true,
  }]);
  console.log(`Created boolean field ${FIELD_NAME} on hr.expense -> ID ${fieldId}`);
  return fieldId;
}

async function upsertView(spec) {
  const existing = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['model', '=', 'hr.expense'], ['name', '=', spec.name]],
  ], { fields: ['id', 'name', 'active'] });

  if (existing.length > 0) {
    const viewId = existing[0].id;
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update view ID ${viewId} (${spec.name})`);
      return viewId;
    }
    await adminOdooClient._callObject('ir.ui.view', 'write', [[viewId], {
      inherit_id: spec.inherit_id,
      priority: spec.priority,
      arch_db: spec.arch_db,
      active: true,
    }]);
    console.log(`Updated view ID ${viewId}: ${spec.name}`);
    return viewId;
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would create view ${spec.name} (type=${spec.type}, inherit_id=${spec.inherit_id})`);
    return null;
  }

  const viewId = await adminOdooClient._callObject('ir.ui.view', 'create', [{
    name: spec.name,
    model: 'hr.expense',
    type: spec.type,
    mode: 'extension',
    inherit_id: spec.inherit_id,
    priority: spec.priority,
    arch_db: spec.arch_db,
    active: true,
  }]);
  console.log(`Created view ID ${viewId}: ${spec.name}`);
  return viewId;
}

async function configureReportAttachment() {
  const [report] = await adminOdooClient._callObject('ir.actions.report', 'read', [
    [REPORT_EXPENSE_FINISH_ID],
    ['id', 'name', 'report_name', 'attachment', 'attachment_use'],
  ]);
  if (!report) {
    throw new Error(`Report ID ${REPORT_EXPENSE_FINISH_ID} not found`);
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would configure report #${report.id} ("${report.name}"): attachment=${PRINT_MARKER_EXPR}, attachment_use=false (was attachment=${JSON.stringify(report.attachment)}, attachment_use=${report.attachment_use})`);
    return;
  }

  await adminOdooClient._callObject('ir.actions.report', 'write', [[REPORT_EXPENSE_FINISH_ID], {
    attachment: PRINT_MARKER_EXPR,
    attachment_use: false,
  }]);
  console.log(`Configured report #${report.id} ("${report.name}") with attachment=${PRINT_MARKER_EXPR}, attachment_use=false`);
}

async function upsertWebhookAutomation() {
  // Look up ir.attachment field IDs dynamically (id, name, res_model, res_id)
  const attFields = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
    [['model', '=', 'ir.attachment'], ['name', 'in', ['id', 'name', 'res_model', 'res_id']]],
  ], { fields: ['id', 'name'] });
  const webhookFieldIds = attFields.map((f) => f.id);

  // 1. Upsert ir.actions.server (0-LoC state='webhook')
  const existingSrvs = await adminOdooClient._callObject('ir.actions.server', 'search_read', [
    [['name', '=', SERVER_ACTION_NAME], ['model_id', '=', ATTACHMENT_MODEL_ID]],
  ], { fields: ['id', 'name'] });

  let serverActionId;
  if (existingSrvs.length > 0) {
    serverActionId = existingSrvs[0].id;
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update ir.actions.server ID ${serverActionId} (${SERVER_ACTION_NAME}) -> ${WEBHOOK_URL}`);
    } else {
      await adminOdooClient._callObject('ir.actions.server', 'write', [[serverActionId], {
        state: 'webhook',
        webhook_url: WEBHOOK_URL,
        webhook_field_ids: [[6, 0, webhookFieldIds]],
      }]);
      console.log(`Updated ir.actions.server ID ${serverActionId}: ${SERVER_ACTION_NAME}`);
    }
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would create ir.actions.server "${SERVER_ACTION_NAME}" (state=webhook, url=${WEBHOOK_URL}, fields=${JSON.stringify(webhookFieldIds)})`);
    serverActionId = null;
  } else {
    serverActionId = await adminOdooClient._callObject('ir.actions.server', 'create', [{
      name: SERVER_ACTION_NAME,
      model_id: ATTACHMENT_MODEL_ID,
      state: 'webhook',
      webhook_url: WEBHOOK_URL,
      webhook_field_ids: [[6, 0, webhookFieldIds]],
    }]);
    console.log(`Created ir.actions.server ID ${serverActionId}: ${SERVER_ACTION_NAME}`);
  }

  // 2. Upsert base.automation (on_create on ir.attachment matching [EXPENSE_PRINT_LOG]_% for hr.expense)
  const filterDomain = "[('res_model', '=', 'hr.expense'), ('name', '=like', '[EXPENSE_PRINT_LOG]_%')]";
  const existingAutos = await adminOdooClient._callObject('base.automation', 'search_read', [
    [['name', '=', AUTOMATION_NAME]],
  ], { fields: ['id', 'name', 'active'] });

  let automationId;
  if (existingAutos.length > 0) {
    automationId = existingAutos[0].id;
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update base.automation ID ${automationId} (${AUTOMATION_NAME}), filter_domain=${filterDomain}`);
    } else {
      await adminOdooClient._callObject('base.automation', 'write', [[automationId], {
        model_id: ATTACHMENT_MODEL_ID,
        trigger: 'on_create',
        filter_domain: filterDomain,
        action_server_ids: [[6, 0, [serverActionId]]],
        active: true,
      }]);
      console.log(`Updated base.automation ID ${automationId}: ${AUTOMATION_NAME}`);
    }
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would create base.automation "${AUTOMATION_NAME}" (on_create, filter_domain=${filterDomain})`);
    automationId = null;
  } else {
    automationId = await adminOdooClient._callObject('base.automation', 'create', [{
      name: AUTOMATION_NAME,
      model_id: ATTACHMENT_MODEL_ID,
      trigger: 'on_create',
      filter_domain: filterDomain,
      action_server_ids: [[6, 0, [serverActionId]]],
      active: true,
    }]);
    console.log(`Created base.automation ID ${automationId}: ${AUTOMATION_NAME}`);
  }

  return { serverActionId, automationId };
}

async function backfillPreNovemberPaidExpenses() {
  if (SKIP_BACKFILL) {
    console.log('Skipping backfill (--skip-backfill).');
    return { backfilledCount: 0, novemberCount: 0 };
  }

  const preNovPaidIds = await adminOdooClient._callObject('hr.expense', 'search', [
    [['date', '<', BACKFILL_CUTOFF_DATE], ['state', '=', 'paid']],
  ]);
  const novCount = await adminOdooClient._callObject('hr.expense', 'search_count', [
    [['date', '>=', BACKFILL_CUTOFF_DATE]],
  ]);

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would backfill x_studio_printed=True on ${preNovPaidIds.length} paid expenses with date < ${BACKFILL_CUTOFF_DATE} (leaving ${novCount} expenses from ${BACKFILL_CUTOFF_DATE} onward untouched)`);
    return { backfilledCount: preNovPaidIds.length, novemberCount: novCount };
  }

  // Filter only those not yet marked printed (idempotent)
  const toUpdateIds = await adminOdooClient._callObject('hr.expense', 'search', [
    [['date', '<', BACKFILL_CUTOFF_DATE], ['state', '=', 'paid'], [FIELD_NAME, '=', false]],
  ]);

  const BATCH_SIZE = 200;
  let updated = 0;
  for (let i = 0; i < toUpdateIds.length; i += BATCH_SIZE) {
    const chunk = toUpdateIds.slice(i, i + BATCH_SIZE);
    await adminOdooClient._callObject('hr.expense', 'write', [
      chunk,
      { [FIELD_NAME]: true },
    ], { context: NO_TRACK_CTX });
    updated += chunk.length;
  }

  console.log(`Backfilled x_studio_printed=True on ${updated} pre-November paid expenses (total pre-Nov paid: ${preNovPaidIds.length}; ${novCount} Nov+ expenses left untouched).`);
  return { backfilledCount: updated, preNovPaidTotal: preNovPaidIds.length, novemberCount: novCount };
}

async function main() {
  console.log(`=== Setup Expense Printed Tracking (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  await adminOdooClient.authenticate();

  const fieldId = await ensurePrintedField();

  const viewIds = {};
  for (const spec of VIEW_SPECS) {
    viewIds[spec.name] = await upsertView(spec);
  }

  await configureReportAttachment();
  const { serverActionId, automationId } = await upsertWebhookAutomation();
  const backfill = await backfillPreNovemberPaidExpenses();

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    fieldId,
    viewIds,
    reportId: REPORT_EXPENSE_FINISH_ID,
    serverActionId,
    automationId,
    backfill,
  }, null, 2));
}

main().catch((err) => {
  console.error('Setup expense printed tracking failed:', err);
  process.exit(1);
});
