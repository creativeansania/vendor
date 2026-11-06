import { adminOdooClient } from '../odoo/odooClient.js';

const NO_TRACK_CTX = { tracking_disable: true, no_automation: true, mail_auto_delete: true };

/**
 * Service to recalculate and persist `x_studio_manufacturing_order_count`
 * and `x_studio_transfer_pc_count` on `sale.order`.
 *
 * This achieves 0 Lines of Code (LoC) in Odoo by keeping the fields in Odoo
 * as purely static integer fields without any Python Compute scripts.
 */
export async function updateSaleOrderCounts(odoo = adminOdooClient, soIds = []) {
  const ids = (Array.isArray(soIds) ? soIds : [soIds])
    .map((id) => Number(id))
    .filter((id) => !isNaN(id) && id > 0);

  const uniqueSoIds = Array.from(new Set(ids));
  if (uniqueSoIds.length === 0) return [];

  const results = [];

  for (const soId of uniqueSoIds) {
    try {
      // 1. MO Count: mrp.production linked to this SO via x_studio_sales_order
      // (Replaces Studio compute: len(record.x_studio_manufacturing_order_ids))
      const moCountPromise = odoo._callObject('mrp.production', 'search_count', [
        [['x_studio_sales_order', '=', soId]]
      ]);

      // 2. Transfer PC Count: stock.picking internal linked to this SO via x_studio_sales_order
      // (Replaces Studio compute: len(record.x_studio_transfer_pc_ids.filtered(lambda p: p.picking_type_id.code == 'internal')))
      const transferCountPromise = odoo._callObject('stock.picking', 'search_count', [
        [
          ['x_studio_sales_order', '=', soId],
          ['picking_type_id.code', '=', 'internal']
        ]
      ]);

      const [moCount, transferPcCount] = await Promise.all([moCountPromise, transferCountPromise]);

      await odoo._callObject('sale.order', 'write', [
        [soId],
        {
          x_studio_manufacturing_order_count: moCount,
          x_studio_transfer_pc_count: transferPcCount
        }
      ], { context: NO_TRACK_CTX });

      console.log(`[soCountService] Updated SO #${soId}: MO count = ${moCount}, Transfer PC count = ${transferPcCount}`);

      results.push({
        soId,
        moCount,
        transferPcCount,
        updated: true
      });
    } catch (err) {
      console.warn(`[soCountService] Warning updating counts for SO #${soId}: ${err.message}`);
      results.push({ soId, updated: false, error: err.message });
    }
  }

  return results;
}

