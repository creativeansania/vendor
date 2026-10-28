import { adminOdooClient } from '../odoo/odooClient.js';
import {
  prefetchMovesAndGroups,
  createMoveMoResolver,
  prefetchMosAndSalesOrders
} from './transfer/transferPrefetcher.js';
import { buildPickingPlan, resolvePlanMoAndSo } from './transfer/transferMoSoResolver.js';
import { executeAutoSplitPicking, executeSinglePickingLink } from './transfer/transferAutoSplitter.js';

export class TransferService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

  /**
   * Resolve and link Manufacturing Order (x_studio_manufacturing_order) and
   * Sales Order (sale_id / x_studio_sales_order) on stock.picking (Transfer).
   */
  async resolveTransferMoAndSo(pickingIds) {
    let ids = [];
    if (Array.isArray(pickingIds)) {
      ids = pickingIds.map((id) => Number(id)).filter((id) => !isNaN(id) && id > 0);
    } else if (typeof pickingIds === 'number' || !isNaN(Number(pickingIds))) {
      ids = [Number(pickingIds)];
    }

    if (ids.length === 0) {
      throw new Error('No valid picking ID provided to resolve MO/SO');
    }

    console.log(`[Transfer MO/SO] Resolving references for ${ids.length} transfer(s): [${ids.join(', ')}]`);

    const pickings = await this.odoo._callObject('stock.picking', 'read', [
      ids,
      [
        'id', 'name', 'origin', 'picking_type_id', 'sale_id',
        'x_studio_manufacturing_order', 'x_studio_sales_order', 'move_ids',
        'company_id', 'state', 'location_id', 'location_dest_id', 'partner_id',
        'scheduled_date', 'date_deadline', 'move_type', 'create_uid', 'note',
        'x_studio_source_warehouse', 'x_studio_destination_warehouse'
      ]
    ]);

    if (!pickings || pickings.length === 0) {
      throw new Error(`None of the requested pickings found in Odoo: [${ids.join(', ')}]`);
    }

    const prefetched = await prefetchMovesAndGroups(this.odoo, pickings);
    const getMoRefForMove = createMoveMoResolver(prefetched);
    const pickingPlans = pickings.map((picking) =>
      buildPickingPlan(picking, prefetched.movesMap, getMoRefForMove)
    );
    const soMap = await prefetchMosAndSalesOrders(this.odoo, pickingPlans, prefetched.moMap);

    const results = [];
    const allCreatedPickingIds = [];

    for (const plan of pickingPlans) {
      try {
        const { resolvedMo, resolvedSo } = await resolvePlanMoAndSo(
          this.odoo,
          plan,
          prefetched.moMap,
          soMap
        );

        if (plan.canAutoSplit) {
          const splitResult = await executeAutoSplitPicking(
            this.odoo,
            plan,
            resolvedSo,
            prefetched.moMap
          );
          if (splitResult) {
            allCreatedPickingIds.push(...splitResult.createdPickingIds);
            results.push(splitResult);
          }
          continue;
        }

        const singleResult = await executeSinglePickingLink(this.odoo, plan, resolvedMo, resolvedSo);
        results.push(singleResult);
      } catch (pickErr) {
        console.error(`[Transfer MO/SO] Error processing picking ID ${plan.picking.id}:`, pickErr.message);
        results.push({
          pickingId: plan.picking.id,
          error: pickErr.message
        });
      }
    }

    return {
      success: true,
      count: results.length,
      createdPickingIds: allCreatedPickingIds,
      results
    };
  }
}

export const transferService = new TransferService();
