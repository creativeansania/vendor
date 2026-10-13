import { adminOdooClient } from '../src/core/odoo/odooClient.js';

async function deduplicateAll() {
  await adminOdooClient.authenticate();

  const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
    [['x_studio_detail_roll_kain', '!=', false]]
  ], { fields: ['id', 'x_name', 'x_studio_detail_roll_kain'] });

  let totalCleanedWips = 0;
  let totalDeletedLines = 0;

  for (const w of wips) {
    const lines = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
      w.x_studio_detail_roll_kain,
      ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_qty_berat_kg']
    ]);

    const seen = new Map();
    const toDelete = [];

    for (const l of lines) {
      const key = `${l.x_name || ''}:::${l.x_studio_kode_warna_roll || 'Tanpa Lot'}`;
      if (seen.has(key)) {
        // Redundant duplicate: only remove if cutting weight is 0
        if ((parseFloat(l.x_studio_qty_berat_kg) || 0) === 0) {
          toDelete.push(l.id);
          continue;
        }
      } else {
        seen.set(key, l);
      }
    }

    if (toDelete.length > 0) {
      console.log(`WIP #${w.id} (${w.x_name}): unlinking ${toDelete.length} duplicate lines...`);
      await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'unlink', [toDelete]);
      totalCleanedWips++;
      totalDeletedLines += toDelete.length;
    }
  }

  console.log(`\n🎉 Finished! Cleaned ${totalCleanedWips} WIP records, removed ${totalDeletedLines} duplicate lines.`);
}

deduplicateAll().catch(console.error);
