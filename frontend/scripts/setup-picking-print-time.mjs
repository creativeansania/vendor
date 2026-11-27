import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const DRY_RUN = process.argv.includes('--dry-run');
const ROLLBACK = process.argv.includes('--rollback');

const PARENT_QWEB_VIEW_ID = 2930; // stock.report_picking_copy_1 (Surat Perintah Pengambilan)
const CHILD_VIEW_NAME = 'stock.report_picking_copy_1.inherit.print_time';

const ARCH_DB = `<xpath expr="//span[@class='info-value']" position="after">
    <div style="margin-top: 2px;">
        <span t-esc="context_timestamp(datetime.datetime.now()).strftime('%H:%M')"/>
    </div>
</xpath>`;

async function main() {
  const modeLabel = ROLLBACK ? 'ROLLBACK' : 'SETUP';
  console.log(`=== Picking Operation Print Time ${modeLabel} (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  await adminOdooClient.authenticate();

  const existing = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['name', '=', CHILD_VIEW_NAME], ['type', '=', 'qweb']],
  ], { fields: ['id', 'name', 'inherit_id', 'active'] });

  if (ROLLBACK) {
    if (existing.length === 0) {
      console.log(`View "${CHILD_VIEW_NAME}" not found; nothing to roll back.`);
      return;
    }
    const ids = existing.map((v) => v.id);
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would unlink ir.ui.view IDs: ${JSON.stringify(ids)} (${CHILD_VIEW_NAME})`);
      return;
    }
    await adminOdooClient._callObject('ir.ui.view', 'unlink', [ids]);
    console.log(`Deleted ir.ui.view IDs: ${JSON.stringify(ids)} (${CHILD_VIEW_NAME}). Parent view #${PARENT_QWEB_VIEW_ID} untouched.`);
    return;
  }

  let viewId;
  if (existing.length > 0) {
    viewId = existing[0].id;
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update view ID ${viewId} (${CHILD_VIEW_NAME})`);
    } else {
      await adminOdooClient._callObject('ir.ui.view', 'write', [[viewId], {
        inherit_id: PARENT_QWEB_VIEW_ID,
        priority: 25,
        arch_db: ARCH_DB,
        active: true,
      }]);
      console.log(`Updated view ID ${viewId}: ${CHILD_VIEW_NAME}`);
    }
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would create QWeb extension view "${CHILD_VIEW_NAME}" inheriting #${PARENT_QWEB_VIEW_ID}`);
  } else {
    viewId = await adminOdooClient._callObject('ir.ui.view', 'create', [{
      name: CHILD_VIEW_NAME,
      type: 'qweb',
      mode: 'extension',
      inherit_id: PARENT_QWEB_VIEW_ID,
      priority: 25,
      arch_db: ARCH_DB,
      active: true,
    }]);
    console.log(`Created view ID ${viewId}: ${CHILD_VIEW_NAME}`);
  }
}

main().catch((err) => {
  console.error('Picking print time script failed:', err);
  process.exit(1);
});
