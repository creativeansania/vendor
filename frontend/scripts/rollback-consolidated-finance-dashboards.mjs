import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const DRY_RUN = process.argv.includes('--dry-run');

const FINANCE_GROUP_ID = 1;
const INTERCOMPANY_TAG_NAME = 'Intercompany';
const TARGET_DASHBOARD_NAMES = [
  'Accounting Consolidated',
  'Invoicing Consolidated',
];

async function main() {
  console.log(`=== Rollback Consolidated Finance Dashboards (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  await adminOdooClient.authenticate();

  // 1. Find and delete ONLY our custom consolidated dashboards (never touch built-in is_from_data=true)
  const dashboards = await adminOdooClient._callObject('spreadsheet.dashboard', 'search_read', [
    [['name', 'in', TARGET_DASHBOARD_NAMES], ['dashboard_group_id', '=', FINANCE_GROUP_ID]],
  ], { fields: ['id', 'name', 'is_from_data'] });

  const safeDashboardIds = [];
  for (const d of dashboards) {
    if (d.is_from_data) {
      console.warn(`SKIP built-in dashboard ID ${d.id} (${d.name}) because is_from_data=true`);
      continue;
    }
    safeDashboardIds.push(d.id);
  }

  if (safeDashboardIds.length === 0) {
    console.log('No consolidated custom dashboards found to remove.');
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would unlink spreadsheet.dashboard IDs: ${JSON.stringify(safeDashboardIds)} (${dashboards.map((d) => d.name).join(', ')})`);
  } else {
    await adminOdooClient._callObject('spreadsheet.dashboard', 'unlink', [safeDashboardIds]);
    console.log(`Deleted spreadsheet.dashboard IDs: ${JSON.stringify(safeDashboardIds)}`);
  }

  // 2. Find "Intercompany" Contact Tag, detach from partners, and delete tag cleanly
  const tags = await adminOdooClient._callObject('res.partner.category', 'search_read', [
    [['name', '=', INTERCOMPANY_TAG_NAME]],
  ], { fields: ['id', 'name'] });

  if (tags.length === 0) {
    console.log(`Contact tag "${INTERCOMPANY_TAG_NAME}" not found; nothing to clean up.`);
  } else {
    for (const tag of tags) {
      const taggedPartners = await adminOdooClient._callObject('res.partner', 'search_read', [
        [['category_id', 'in', [tag.id]]],
      ], { fields: ['id', 'name'] });

      if (taggedPartners.length > 0) {
        if (DRY_RUN) {
          console.log(`[DRY-RUN] Would remove tag ID ${tag.id} ("${tag.name}") from ${taggedPartners.length} partners: ${taggedPartners.map((p) => `${p.id}:${p.name}`).join(', ')}`);
        } else {
          await adminOdooClient._callObject('res.partner', 'write', [
            taggedPartners.map((p) => p.id),
            { category_id: [[3, tag.id, 0]] },
          ]);
          console.log(`Detached tag ID ${tag.id} from ${taggedPartners.length} partners.`);
        }
      }

      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would unlink res.partner.category ID ${tag.id} ("${tag.name}")`);
      } else {
        await adminOdooClient._callObject('res.partner.category', 'unlink', [[tag.id]]);
        console.log(`Deleted res.partner.category ID ${tag.id} ("${tag.name}").`);
      }
    }
  }

  // 3. Verify built-in dashboards #1 and #2 are intact
  const builtIn = await adminOdooClient._callObject('spreadsheet.dashboard', 'read', [
    [1, 2],
    ['id', 'name', 'is_published'],
  ]);
  console.log('Built-in dashboards verified intact:', JSON.stringify(builtIn));
}

main().catch((err) => {
  console.error('Rollback consolidated finance dashboards failed:', err);
  process.exit(1);
});
