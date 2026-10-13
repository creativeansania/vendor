import { adminOdooClient } from '../src/core/odoo/odooClient.js';

async function resetTable() {
  await adminOdooClient.authenticate();

  const allWips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
    []
  ], { fields: ['id', 'x_name'] });

  console.log(`Found ${allWips.length} WIP records to delete.`);

  if (allWips.length > 0) {
    const ids = allWips.map(w => w.id);
    const res = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'unlink', [ids]);
    console.log('Unlink result:', res);
  }

  // Also check if any orphaned lines remain in x_monitoring_wip_vendo_line_4c93a
  const orphanLines = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'search', [
    []
  ]);
  console.log(`Remaining roll lines in system: ${orphanLines.length}`);
  if (orphanLines.length > 0) {
    console.log(`Unlinking ${orphanLines.length} orphaned roll lines...`);
    // Delete in chunks of 500
    for (let i = 0; i < orphanLines.length; i += 500) {
      const chunk = orphanLines.slice(i, i + 500);
      await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'unlink', [chunk]);
    }
  }

  console.log('🎉 Reset complete! Table x_monitoring_wip_vendo is now completely empty (0 records).');
}

resetTable().catch(console.error);
