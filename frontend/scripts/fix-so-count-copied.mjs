import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { updateSaleOrderCounts } from '../src/lib/services/soCountService.js';

const SO_COUNT_FIELD_NAMES = [
  'x_studio_manufacturing_order_count',
  'x_studio_transfer_pc_count'
];

const STALE_DRAFT_SO_IDS = [11512];

async function main() {
  await adminOdooClient.authenticate();

  const fields = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
    [['model', '=', 'sale.order'], ['name', 'in', SO_COUNT_FIELD_NAMES]]
  ], { fields: ['id', 'name', 'copied'] });

  const fieldIds = (fields || []).map((f) => f.id);
  if (fieldIds.length !== SO_COUNT_FIELD_NAMES.length) {
    throw new Error(`Expected ${SO_COUNT_FIELD_NAMES.length} SO count fields, found ${fieldIds.length}`);
  }

  await adminOdooClient._callObject('ir.model.fields', 'write', [
    fieldIds,
    { copied: false }
  ]);
  console.log(`Updated copied=false on ir.model.fields IDs: [${fieldIds.join(', ')}]`);

  const verifiedFields = await adminOdooClient._callObject('ir.model.fields', 'read', [
    fieldIds,
    ['id', 'name', 'copied']
  ]);
  console.log('Verified fields:', JSON.stringify(verifiedFields));

  const recalcResults = await updateSaleOrderCounts(adminOdooClient, STALE_DRAFT_SO_IDS);
  console.log('Recalculated stale SO counts:', JSON.stringify(recalcResults));

  const verifiedSos = await adminOdooClient._callObject('sale.order', 'read', [
    STALE_DRAFT_SO_IDS,
    ['id', 'name', 'state', 'x_studio_manufacturing_order_count', 'x_studio_transfer_pc_count']
  ]);
  console.log('Verified SOs:', JSON.stringify(verifiedSos));
}

main().catch((err) => {
  console.error('Fix SO count copied failed:', err);
  process.exit(1);
});
