import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const DRY_RUN = process.argv.includes('--dry-run');
const KEEP_FIELD = process.argv.includes('--keep-field');

const REPORT_EXPENSE_FINISH_ID = 984;
const FIELD_NAME = 'x_studio_printed';
const SERVER_ACTION_NAME = '[Custom] Send Webhook Expense Printed';
const AUTOMATION_NAME = '[Custom] Mark Expense Printed on Expenses Report Finish';
const VIEW_NAMES = [
  'hr.expense.list.inherit.printed',
  'hr.expense.form.inherit.printed',
  'hr.expense.search.inherit.printed',
];

async function main() {
  console.log(`=== Rollback Expense Printed Tracking (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}, keepField=${KEEP_FIELD}) ===`);
  await adminOdooClient.authenticate();

  // 1. Restore Report #984 (Expenses Report Finish) attachment settings back to false
  const [report] = await adminOdooClient._callObject('ir.actions.report', 'read', [
    [REPORT_EXPENSE_FINISH_ID],
    ['id', 'name', 'attachment', 'attachment_use'],
  ]);
  if (report) {
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

  // 2. Delete Automation
  const automations = await adminOdooClient._callObject('base.automation', 'search_read', [
    [['name', '=', AUTOMATION_NAME]],
  ], { fields: ['id', 'name'] });
  if (automations.length > 0) {
    const ids = automations.map((a) => a.id);
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would unlink base.automation IDs: ${JSON.stringify(ids)}`);
    } else {
      await adminOdooClient._callObject('base.automation', 'unlink', [ids]);
      console.log(`Deleted base.automation IDs: ${JSON.stringify(ids)}`);
    }
  } else {
    console.log('Automation not found; skipping.');
  }

  // 3. Delete Server Action
  const srvs = await adminOdooClient._callObject('ir.actions.server', 'search_read', [
    [['name', '=', SERVER_ACTION_NAME]],
  ], { fields: ['id', 'name'] });
  if (srvs.length > 0) {
    const ids = srvs.map((s) => s.id);
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would unlink ir.actions.server IDs: ${JSON.stringify(ids)}`);
    } else {
      await adminOdooClient._callObject('ir.actions.server', 'unlink', [ids]);
      console.log(`Deleted ir.actions.server IDs: ${JSON.stringify(ids)}`);
    }
  } else {
    console.log('Server action not found; skipping.');
  }

  // 4. Delete custom inherited views on hr.expense
  const views = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['model', '=', 'hr.expense'], ['name', 'in', VIEW_NAMES]],
  ], { fields: ['id', 'name'] });
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

  // 5. Remove any leftover temporary [EXPENSE_PRINT_LOG]_% attachments
  const tempAtts = await adminOdooClient._callObject('ir.attachment', 'search', [
    [['res_model', '=', 'hr.expense'], ['name', '=like', '[EXPENSE_PRINT_LOG]_%']],
  ]);
  if (tempAtts.length > 0) {
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would unlink ${tempAtts.length} leftover [EXPENSE_PRINT_LOG] attachments`);
    } else {
      await adminOdooClient._callObject('ir.attachment', 'unlink', [tempAtts]);
      console.log(`Deleted ${tempAtts.length} leftover [EXPENSE_PRINT_LOG] attachments`);
    }
  }

  // 6. Delete custom field x_studio_printed (unless --keep-field)
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
