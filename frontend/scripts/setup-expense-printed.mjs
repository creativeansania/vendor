import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_BACKFILL = process.argv.includes('--skip-backfill');

const EXPENSE_MODEL_ID = 906; // hr.expense
const REPORT_EXPENSE_FINISH_ID = 984; // Expenses Report Finish
const REPORT_EXPENSE_FINISH_QWEB_VIEW_ID = 2917; // hr_expense.report_expense_sheet_copy_2

const FIELD_NAME = 'x_studio_printed';
const WEBHOOK_URL = 'https://vendor-sandy-eight.vercel.app/api/webhooks/odoo/expense-printed';

const LEGACY_SERVER_ACTION_NAME = '[Custom] Send Webhook Expense Printed';
const LEGACY_AUTOMATION_NAME = '[Custom] Mark Expense Printed on Expenses Report Finish';

const BACKFILL_CUTOFF_DATE = '2026-11-01'; // Paid expenses strictly before Nov 1, 2026 -> Printed = True
const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };

const EXPENSE_VIEW_SPECS = [
  {
    name: 'hr.expense.list.inherit.printed',
    model: 'hr.expense',
    type: 'list',
    inherit_id: 2730, // hr.expense.list (inherited by 2731 & 2732)
    priority: 25,
    arch_db: `<field name="state" position="after">
    <field name="x_studio_printed" widget="boolean_toggle" optional="show" string="Printed" readonly="0"/>
</field>`,
  },
  {
    name: 'hr.expense.form.inherit.printed',
    model: 'hr.expense',
    type: 'form',
    inherit_id: 2733, // hr.expense.view.form
    priority: 25,
    arch_db: `<xpath expr="//field[@name='analytic_distribution']" position="after">
    <field name="x_studio_printed" widget="boolean_toggle" string="Printed" readonly="0"/>
</xpath>`,
  },
  {
    name: 'hr.expense.search.inherit.printed',
    model: 'hr.expense',
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
  {
    name: 'hr_expense.report_expense_sheet_copy_2.inherit.printed',
    model: false,
    type: 'qweb',
    inherit_id: REPORT_EXPENSE_FINISH_QWEB_VIEW_ID,
    priority: 25,
    // Single invisible 1x1 PNG beacon per print job (emitted only on the first page if any doc is unprinted).
    // Handles both single and batch prints in 1 HTTP request & 1 Odoo write(), works across all states
    // (draft/approved/paid) without triggering hr_expense's ir.attachment AccessError.
    arch_db: `<xpath expr="//div[@class='page']" position="inside">
    <t t-if="o and docs and o.id == docs[0].id">
        <t t-set="unprinted_ids" t-value="[str(d.id) for d in docs if not d.x_studio_printed]"/>
        <img t-if="unprinted_ids" t-attf-src="${WEBHOOK_URL}?ids=#{','.join(unprinted_ids)}&amp;src=report_984" style="width:1px;height:1px;opacity:0;position:absolute;" alt=""/>
    </t>
</xpath>`,
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
  const searchDomain = spec.model
    ? [['model', '=', spec.model], ['name', '=', spec.name]]
    : [['type', '=', spec.type], ['name', '=', spec.name]];
  const existing = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    searchDomain,
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

  const vals = {
    name: spec.name,
    type: spec.type,
    mode: 'extension',
    inherit_id: spec.inherit_id,
    priority: spec.priority,
    arch_db: spec.arch_db,
    active: true,
  };
  if (spec.model) vals.model = spec.model;

  const viewId = await adminOdooClient._callObject('ir.ui.view', 'create', [vals]);
  console.log(`Created view ID ${viewId}: ${spec.name}`);
  return viewId;
}

async function cleanupLegacyAttachmentTrigger() {
  // Ensure Report #984 does not attempt ir.attachment creation (blocked by hr_expense on approved/paid)
  const [report] = await adminOdooClient._callObject('ir.actions.report', 'read', [
    [REPORT_EXPENSE_FINISH_ID],
    ['id', 'name', 'attachment', 'attachment_use'],
  ]);
  if (report && (report.attachment || report.attachment_use)) {
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would clear report #${report.id} attachment/attachment_use`);
    } else {
      await adminOdooClient._callObject('ir.actions.report', 'write', [[REPORT_EXPENSE_FINISH_ID], {
        attachment: false,
        attachment_use: false,
      }]);
      console.log(`Cleared legacy report #${report.id} attachment settings.`);
    }
  }

  const autos = await adminOdooClient._callObject('base.automation', 'search', [
    [['name', '=', LEGACY_AUTOMATION_NAME]],
  ]);
  if (autos.length > 0 && !DRY_RUN) {
    await adminOdooClient._callObject('base.automation', 'unlink', [autos]);
    console.log(`Removed legacy automation IDs: ${JSON.stringify(autos)}`);
  }

  const srvs = await adminOdooClient._callObject('ir.actions.server', 'search', [
    [['name', '=', LEGACY_SERVER_ACTION_NAME]],
  ]);
  if (srvs.length > 0 && !DRY_RUN) {
    await adminOdooClient._callObject('ir.actions.server', 'unlink', [srvs]);
    console.log(`Removed legacy server action IDs: ${JSON.stringify(srvs)}`);
  }
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
    console.log(`[DRY-RUN] Would backfill x_studio_printed=True on paid expenses with date < ${BACKFILL_CUTOFF_DATE} (total pre-Nov paid: ${preNovPaidIds.length}; ${novCount} Nov+ untouched)`);
    return { preNovPaidTotal: preNovPaidIds.length, novemberCount: novCount };
  }

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

  console.log(`Backfilled x_studio_printed=True on ${updated} pre-November paid expenses (total pre-Nov paid: ${preNovPaidIds.length}; ${novCount} Nov+ untouched).`);
  return { backfilledCount: updated, preNovPaidTotal: preNovPaidIds.length, novemberCount: novCount };
}

async function main() {
  console.log(`=== Setup Expense Printed Tracking (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  await adminOdooClient.authenticate();

  const fieldId = await ensurePrintedField();
  await cleanupLegacyAttachmentTrigger();

  const viewIds = {};
  for (const spec of EXPENSE_VIEW_SPECS) {
    viewIds[spec.name] = await upsertView(spec);
  }

  const backfill = await backfillPreNovemberPaidExpenses();

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    fieldId,
    viewIds,
    reportId: REPORT_EXPENSE_FINISH_ID,
    backfill,
  }, null, 2));
}

main().catch((err) => {
  console.error('Setup expense printed tracking failed:', err);
  process.exit(1);
});
