import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { recalculateSoSfpQuantities } from '../src/lib/services/soSfpService.js';

async function main() {
  await adminOdooClient.authenticate();

  const args = process.argv.slice(2);
  const targetSoArg = args.find((a) => a.startsWith('--so='));
  const targetSoIds = targetSoArg
    ? targetSoArg.replace('--so=', '').split(',').map((s) => Number(s.trim())).filter(Boolean)
    : [];

  let soIds = targetSoIds;
  if (soIds.length === 0) {
    console.log('Fetching all Sales Order IDs linked to Done Vendor SFPs...');
    const sfps = await adminOdooClient._callObject('stock.picking', 'search_read', [
      [
        ['state', '=', 'done'],
        ['name', '=like', 'VD%/SFP/%'],
        '|',
        ['x_studio_sales_order', '!=', false],
        ['sale_id', '!=', false]
      ]
    ], { fields: ['x_studio_sales_order', 'sale_id'], limit: 10000 });

    const set = new Set();
    for (const p of sfps || []) {
      if (Array.isArray(p.x_studio_sales_order) && p.x_studio_sales_order[0]) {
        set.add(p.x_studio_sales_order[0]);
      }
      if (Array.isArray(p.sale_id) && p.sale_id[0]) {
        set.add(p.sale_id[0]);
      }
    }
    soIds = Array.from(set);
  }

  console.log(`Backfilling Qty SFP (x_studio_qty_sfp_done) for ${soIds.length} Sales Order(s)...`);

  let updatedSos = 0;
  let updatedLines = 0;
  for (let i = 0; i < soIds.length; i++) {
    const soId = soIds[i];
    try {
      const res = await recalculateSoSfpQuantities(adminOdooClient, soId);
      if (res.updatedLineCount > 0) {
        updatedSos++;
        updatedLines += res.updatedLineCount;
      }
      if ((i + 1) % 20 === 0 || i + 1 === soIds.length) {
        console.log(`Progress: ${i + 1} / ${soIds.length} SOs checked (updated ${updatedSos} SOs, ${updatedLines} lines)...`);
      }
    } catch (err) {
      console.warn(`Warning for SO #${soId}: ${err.message}`);
    }
  }

  console.log(`Done! Updated ${updatedLines} line(s) across ${updatedSos} Sales Order(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
