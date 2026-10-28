import { adminOdooClient } from '../../../odoo/odooClient.js';
import { wipRepo } from '../../wipRepository.js';
import { invalidateOrderCache } from '../wipCache.js';
import { getOrderDetails } from '../wipQueryService.js';
import { WIP_ODOO_SYNC_FIELDS, mapOdooWipToDbPayload } from './syncMapper.js';
import { fetchVendorPriceFromOdoo } from './vendorPricingSync.js';
import { resolveSalesOrderForMo } from './soMoResolver.js';

const MANUAL_SYNC_MO_FIELDS = [
  'id',
  'name',
  'state',
  'date_planned_start',
  'date_deadline',
  'product_qty',
  'sale_line_id',
  'origin',
  'x_studio_sales_order',
  'x_studio_origin_mo'
];

/**
 * Pull single order live from Odoo into Supabase (parallelized WIP + MO read)
 */
export async function syncOrderFromOdoo({ user, orderId }) {
  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });
  if (!order.odoo_wip_id) {
    throw new Error('Order tidak memiliki link Odoo WIP ID.');
  }

  await adminOdooClient.authenticate();

  // Read WIP and known MO in parallel (saves 1 full round-trip!)
  const [wips, preMos] = await Promise.all([
    adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
      fields: WIP_ODOO_SYNC_FIELDS,
      context: { bin_size: true }
    }),
    order.odoo_mo_id
      ? adminOdooClient._callObject('mrp.production', 'read', [[order.odoo_mo_id]], {
          fields: MANUAL_SYNC_MO_FIELDS
        }).catch(() => [])
      : Promise.resolve([])
  ]);

  if (!wips || wips.length === 0) {
    throw new Error(`Data WIP #${order.odoo_wip_id} tidak ditemukan di Odoo.`);
  }

  const w = wips[0];
  const moId = w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : order.odoo_mo_id;

  let moObj = preMos && preMos[0] && preMos[0].id === moId ? preMos[0] : null;
  if (!moObj && moId) {
    try {
      const mos = await adminOdooClient._callObject('mrp.production', 'read', [[moId]], {
        fields: MANUAL_SYNC_MO_FIELDS
      });
      moObj = mos && mos[0] ? mos[0] : null;
    } catch {}
  }

  let moState = order.mo_state;
  let moName = order.mo_name || w.x_name;
  let deadlineSpk = w.x_studio_deadline_spk || order.deadline_spk;
  let startSpk = w.x_studio_start_spk || order.start_spk;
  let qtySpk = Number(w.x_studio_qty_spk || order.qty_spk || 0);
  let salesOrder = w.x_studio_sales_order
    ? (Array.isArray(w.x_studio_sales_order) ? w.x_studio_sales_order[1] : String(w.x_studio_sales_order))
    : order.sales_order;

  if (moObj) {
    if (moObj.name) moName = moObj.name;
    moState = moObj.state || moState;
    if (!startSpk && moObj.date_planned_start) startSpk = moObj.date_planned_start.split(' ')[0];
    if (!deadlineSpk && moObj.date_deadline) deadlineSpk = moObj.date_deadline.split(' ')[0];
    if (!qtySpk && moObj.product_qty) qtySpk = Number(moObj.product_qty);
    if (!salesOrder && moObj.x_studio_sales_order) {
      salesOrder = Array.isArray(moObj.x_studio_sales_order)
        ? moObj.x_studio_sales_order[1]
        : String(moObj.x_studio_sales_order);
    }
  }

  // Read roll lines in parallel with optional SO/price enrichment!
  const rollPromise = w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0
    ? adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
        w.x_studio_detail_roll_kain,
        ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
      ])
    : Promise.resolve([]);

  const wipEnrichPatch = {};

  if (!salesOrder && moId) {
    try {
      const resolved = await resolveSalesOrderForMo(moId, { preloadedMo: moObj });
      if (resolved && resolved.name) {
        salesOrder = resolved.name;
        if (w.id && resolved.id) {
          wipEnrichPatch.x_studio_sales_order = resolved.id;
        }
      }
    } catch {}
  }

  const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : null;
  const whName = w.x_studio_warehouse ? w.x_studio_warehouse[1] : 'Unknown';
  const prodId = w.x_studio_product ? w.x_studio_product[0] : null;

  let hargaVendor = Number(w.x_studio_harga || 0);
  let totalHarga = Number(w.x_studio_total_harga || 0);
  const qtyMasukSfp = Number(w.x_studio_qty_masuk_sfp || 0);

  const statusProduksi = (w.x_studio_status_produksi || '').trim().toLowerCase();
  if (hargaVendor === 0 && statusProduksi !== 'selesai' && whId && prodId) {
    try {
      const freshPrice = await fetchVendorPriceFromOdoo(whId, prodId);
      if (freshPrice > 0) {
        hargaVendor = freshPrice;
        totalHarga = hargaVendor * qtyMasukSfp;
        wipEnrichPatch.x_studio_harga = hargaVendor;
        wipEnrichPatch.x_studio_total_harga = totalHarga;
      }
    } catch (errPrice) {
      console.warn(`[WipSyncService] Note on auto-fetching vendor price: ${errPrice.message}`);
    }
  }

  // Coalesce SO + price write into ONE single Odoo write instead of 2 separate writes
  if (w.id && Object.keys(wipEnrichPatch).length > 0) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
      [w.id],
      wipEnrichPatch
    ], { context: { tracking_disable: true, no_automation: true } }).catch(() => {});
  }

  const odooActualCutting = Number(w.x_studio_actual_cutting || 0);
  const preservedActualCutting = odooActualCutting > 0
    ? odooActualCutting
    : Number(order.actual_cutting || 0);
  const estimasiSpbVal = Number(w.x_studio_estimasi_dari_spb || 0);
  const preservedSelisihCutting = odooActualCutting > 0
    ? Number(w.x_studio_selisih_hasil_cutting || (odooActualCutting - estimasiSpbVal))
    : (preservedActualCutting > 0 ? preservedActualCutting - estimasiSpbVal : 0);

  const [, rolls] = await Promise.all([
    wipRepo.upsertWipOrder(mapOdooWipToDbPayload(w, {
      odoo_mo_id: moId,
      odoo_warehouse_id: whId,
      vendor_name: whName,
      mo_name: moName || w.x_name,
      mo_state: moState,
      sales_order: salesOrder,
      product_name: order.product_name,
      qty_spk: qtySpk,
      start_spk: startSpk,
      deadline_spk: deadlineSpk,
      actual_cutting: preservedActualCutting,
      selisih_hasil_cutting: preservedSelisihCutting,
      qty_masuk_sfp: qtyMasukSfp,
      harga_vendor: hargaVendor,
      total_harga: totalHarga
    })),
    rollPromise
  ]);

  if (rolls && rolls.length > 0) {
    await wipRepo.upsertRollLines(order.id, rolls);
  }

  invalidateOrderCache(order.odoo_mo_id, order.id);

  return getOrderDetails({ user, orderId, includeRawMoves: true });
}

/**
 * Pull all active WIPs from Odoo (Initial / Bulk Sync with vendor preload & parallel DB chunks)
 */
export async function syncAllFromOdoo() {
  await Promise.all([
    adminOdooClient.authenticate(),
    wipRepo.preloadVendors()
  ]);
  console.log('[WipSyncService] Pulling active WIP records from Odoo...');

  const wipIds = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search', [
    [['x_name', '!=', false]]
  ], { limit: 100, order: 'id desc' });

  let syncedCount = 0;
  const chunkSize = 25;
  for (let i = 0; i < wipIds.length; i += chunkSize) {
    const chunk = wipIds.slice(i, i + chunkSize);
    const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [
      chunk,
      WIP_ODOO_SYNC_FIELDS
    ], { context: { bin_size: true } });

    const allRollIdsInChunk = Array.from(
      new Set(wips.flatMap((w) => w.x_studio_detail_roll_kain || []))
    );
    const rollsById = new Map();
    if (allRollIdsInChunk.length > 0) {
      try {
        const chunkRolls = await adminOdooClient._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
          allRollIdsInChunk,
          ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_penerimaan', 'x_studio_qty_berat_kg']
        ]);
        for (const r of chunkRolls || []) {
          rollsById.set(r.id, r);
        }
      } catch (rollErr) {
        console.warn(`[WipSyncService] Batch roll read warning: ${rollErr.message}`);
      }
    }

    // Bounded parallel Supabase upserts (5 concurrent items per wave)
    const waveSize = 5;
    for (let j = 0; j < wips.length; j += waveSize) {
      const wave = wips.slice(j, j + waveSize);
      const results = await Promise.allSettled(
        wave.map(async (w) => {
          const savedId = await wipRepo.upsertWipOrder(mapOdooWipToDbPayload(w));
          if (w.x_studio_detail_roll_kain && w.x_studio_detail_roll_kain.length > 0) {
            const rolls = w.x_studio_detail_roll_kain
              .map((rid) => rollsById.get(rid))
              .filter(Boolean);
            if (rolls.length > 0) {
              await wipRepo.upsertRollLines(savedId, rolls);
            }
          }
          return savedId;
        })
      );

      for (const r of results) {
        if (r.status === 'fulfilled') syncedCount++;
        else console.warn(`[WipSyncService] Skip WIP item: ${r.reason?.message}`);
      }
    }
  }

  return {
    success: true,
    totalSynced: syncedCount
  };
}
