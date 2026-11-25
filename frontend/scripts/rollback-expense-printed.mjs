import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_FIELD = process.argv.includes('--keep-field');

const REPORT_EXPENSE_FINISH_ID = 984;
const FIELD_NAME = 'x_studio_printed';
const LEGACY_SERVER_ACTION_NAME = '[Custom] Send Webhook Expense Printed';
const LEGACY_AUTOMATION_NAME = '[Custom] Mark Expense Printed on Expenses Report Finish';
const VIEW_NAMES = [
  'hr.expense.list.inherit.printed',
  'hr.expense.form.inherit.printed',
  'hr.expense.search.inherit.printed',
  'hr_expense.report_expense_sheet_copy_2.inherit.printed',
];

async function main() {
  console.log(`=== Rollback Expense Printed Tracking (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}, keepField=${KEEP_FIELD}) ===`);
  await adminOdooClient.authenticate();

  // 1. Ensure Report #984 attachment settings are clean
  const [report] = await adminOdooClient._callObject('ir.actions.report', 'read', [
    [REPORT_EXPENSE_FINISH_ID],
    ['id', 'name', 'attachment', 'attachment_use'],
  ]);
  if (report && (report.attachment || report.attachment_use)) {
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would reset report #${report.id} ("${report.name}") attachment=false, attachment_use=false`);
    } else {
      await adminOdooClient._callObject('ir.actions.report', 'write', [[REPORT_EXPENSE_FINISH_ID], {
        attachment: false,
        attachment_use: false,
      }]);
      console.log(`Reset report #${report.id} ("${report.name}") attachment=false, attachment_use=false`);
    }
  }

  // 2. Delete any legacy automation / server action if present
  const automations = await adminOdooClient._callObject('base.automation', 'search_read', [
    [['name', '=', LEGACY_AUTOMATION_NAME]],
  ], { fields: ['id', 'name'] });
  if (automations.length > 0) {
    const ids = automations.map((a) => a.id);
    if (DRY_RUN) console.log(`[DRY-RUN] Would unlink base.automation IDs: ${JSON.stringify(ids)}`);
    else {
      await adminOdooClient._callObject('base.automation', 'unlink', [ids]);
      console.log(`Deleted base.automation IDs: ${JSON.stringify(ids)}`);
    }
  }

  const srvs = await adminOdooClient._callObject('ir.actions.server', 'search_read', [
    [['name', '=', LEGACY_SERVER_ACTION_NAME]],
  ], { fields: ['id', 'name'] });
  if (srvs.length > 0) {
    const ids = srvs.map((s) => s.id);
    if (DRY_RUN) console.log(`[DRY-RUN] Would unlink ir.actions.server IDs: ${JSON.stringify(ids)}`);
    else {
      await adminOdooClient._callObject('ir.actions.server', 'unlink', [ids]);
      console.log(`Deleted ir.actions.server IDs: ${JSON.stringify(ids)}`);
    }
  }

  // 3. Delete all custom inherited views (list, form, search, QWeb beacon)
  const views = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['name', 'in', VIEW_NAMES]],
  ], { fields: ['id', 'name', 'type'] });
  if (views.length > 0) {
    const ids = views.map((v) => v.id);
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would unlink ir.ui.view IDs: ${JSON.stringify(ids)} (${views.map((v) => v.name).join(', ')})`);
    } else {
      await adminOdooClient._callObject('ir.ui.view', 'unlink', [ids]);
      console.log(`Deleted ir.ui.view IDs: ${JSON.stringify(ids)}`);
    }
  } else {
    console.log('Custom printed views not found; skipping.');
  }

  // 4. Delete custom field x_studio_printed (unless --keep-field)
  if (KEEP_FIELD) {
    console.log(`Keeping custom field ${FIELD_NAME} (--keep-field).`);
  } else {
    const fields = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
      [['model', '=', 'hr.expense'], ['name', '=', FIELD_NAME]],
    ], { fields: ['id', 'name'] });
    if (fields.length > 0) {
      const ids = fields.map((f) => f.id);
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would unlink ir.model.fields IDs: ${JSON.stringify(ids)} (${FIELD_NAME})`);
      } else {
        await adminOdooClient._callObject('ir.model.fields', 'unlink', [ids]);
        console.log(`Deleted ir.model.fields IDs: ${JSON.stringify(ids)} (${FIELD_NAME})`);
      }
    } else {
      console.log(`Custom field ${FIELD_NAME} not found; skipping.`);
    }
  }

  console.log('Rollback complete.');
}

main().catch((err) => {
  console.error('Rollback expense printed tracking failed:', err);
  process.exit(1);
});
