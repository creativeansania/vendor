import { supabaseServer } from '../../../supabaseServer.js';
import { adminOdooClient } from '../../../odoo/odooClient.js';
import { rawMovesCache, transfersCache, lazyFieldsCache, setBoundedCache, CACHE_TTL } from '../wipCache.js';
import { fetchVendorPriceFromOdoo } from '../sync/vendorPricingSync.js';
import { resolveFinishing } from '../sync/syncMapper.js';

/**
 * Coalesced & cooldown-guarded lazy metadata sync (max once per 10 mins per order)
 */
export async function runCoalescedLazyMetadataSync(order, showPrice) {
  const orderStatus = (order.status_produksi || '').trim().toLowerCase();
  const needsConsumption = order.consumption_per_pcs == null;
  const needsSpec = order.finishing == null && order.packing == null;
  const needsPrice = showPrice && Number(order.harga_vendor || 0) === 0 && orderStatus !== 'selesai';
  const lastLazyCheck = lazyFieldsCache.get(order.id) || 0;

  if (!order.odoo_wip_id || !(needsConsumption || needsSpec || needsPrice) || Date.now() - lastLazyCheck <= CACHE_TTL) {
    return;
  }

  setBoundedCache(lazyFieldsCache, order.id, Date.now());
  try {
    await adminOdooClient.authenticate();
    const wipData = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
      fields: [
        'x_studio_consumption_per_pcs_1',
        'x_studio_unit_consumption_per_pcs',
        'x_studio_related_field_77l_1k5rj70p4',
        'x_studio_related_field_52c_1k5rj7ik0',
        'x_studio_qc_pass_1',
        'x_studio_qty_qc_pass_1',
        'x_studio_qc_status',
        'x_studio_keterangan_qms',
        'x_studio_gambar_qc',
        'x_studio_product',
        'x_studio_warehouse',
        'x_studio_qty_masuk_sfp',
        'x_studio_many2many_field_869_1k3jdrdl1'
      ],
      // bin_size: true avoids downloading multi-MB base64 QC images while preserving boolean presence check
      context: { bin_size: true }
    });

    if (wipData && wipData[0]) {
      const w = wipData[0];
      const dbPatch = {};

      if (needsConsumption) {
        const cVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
          ? Number(w.x_studio_consumption_per_pcs_1)
          : null;
        const cUom = w.x_studio_unit_consumption_per_pcs
          ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
          : null;
        if (cVal !== null || cUom !== null) {
          order.consumption_per_pcs = cVal;
          order.consumption_uom = cUom;
          dbPatch.consumption_per_pcs = cVal;
          dbPatch.consumption_uom = cUom;
        }
      }

      const fin = resolveFinishing(w.x_studio_related_field_77l_1k5rj70p4);
      const pack = w.x_studio_related_field_52c_1k5rj7ik0 || null;
      const qpId = w.x_studio_qc_pass_1 ? (Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[0] : w.x_studio_qc_pass_1) : null;
      const qpName = w.x_studio_qc_pass_1 && Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[1] : null;
      const qQty = Number(w.x_studio_qty_qc_pass_1 || 0);
      const qStatus = w.x_studio_qc_status || null;
      const qKeterangan = w.x_studio_keterangan_qms || null;
      const hasGambar = Boolean(w.x_studio_gambar_qc);

      if (fin !== null) {
        order.finishing = fin;
        dbPatch.finishing = fin;
      }
      if (pack !== null) {
        order.packing = pack;
        dbPatch.packing = pack;
      }
      if (order.qc_pass_id == null && qpId !== null) {
        order.qc_pass_id = qpId;
        dbPatch.qc_pass_id = qpId;
      }
      if (order.qc_pass_name == null && qpName !== null) {
        order.qc_pass_name = qpName;
        dbPatch.qc_pass_name = qpName;
      }
      if ((order.qty_qc_pass == null || order.qty_qc_pass === 0) && qQty > 0) {
        order.qty_qc_pass = qQty;
        dbPatch.qty_qc_pass = qQty;
      }
      if (order.qc_status == null && qStatus !== null) {
        order.qc_status = qStatus;
        dbPatch.qc_status = qStatus;
      }
      if (order.keterangan_qms == null && qKeterangan !== null) {
        order.keterangan_qms = qKeterangan;
        dbPatch.keterangan_qms = qKeterangan;
      }
      if (hasGambar && !order.has_gambar_qc) {
        order.has_gambar_qc = true;
        dbPatch.has_gambar_qc = true;
      }

      if (needsPrice && w.x_studio_product) {
        const prodId = w.x_studio_product[0];
        const whId = w.x_studio_warehouse ? w.x_studio_warehouse[0] : order.odoo_warehouse_id;
        const sfpQty = parseFloat(w.x_studio_qty_masuk_sfp) || Number(order.qty_masuk_sfp || 0);
        const wcIds = w.x_studio_many2many_field_869_1k3jdrdl1 || [];

        const freshPrice = await fetchVendorPriceFromOdoo(whId, prodId, wcIds);
        if (freshPrice > 0) {
          const freshTotal = freshPrice * sfpQty;
          order.harga_vendor = freshPrice;
          order.total_harga = freshTotal;
          dbPatch.harga_vendor = freshPrice;
          dbPatch.total_harga = freshTotal;

          await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
            [order.odoo_wip_id],
            { x_studio_harga: freshPrice, x_studio_total_harga: freshTotal }
          ], { context: { tracking_disable: true, no_automation: true } });
        }
      }

      if (Object.keys(dbPatch).length > 0) {
        await supabaseServer
          .from('wip_orders')
          .update(dbPatch)
          .eq('id', order.id);
      }
    }
  } catch (lazyErr) {
    console.warn(`[WipQueryService] Coalesced lazy sync warning for order #${order.id}: ${lazyErr.message}`);
  }
}

/**
 * Fetch raw moves (BOM lines) for a given manufacturing order
 */
export async function fetchOrderRawMoves(order) {
  if (!order.odoo_mo_id) return [];
  const cached = rawMovesCache.get(order.odoo_mo_id);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  try {
    await adminOdooClient.authenticate();
    const mo = await adminOdooClient._callObject('mrp.production', 'read', [[order.odoo_mo_id]], {
      fields: ['id', 'name', 'state', 'move_raw_ids']
    });

    if (mo && mo[0]) {
      const moPatch = {};
      if (mo[0].name && mo[0].name !== order.mo_name) {
        order.mo_name = mo[0].name;
        moPatch.mo_name = mo[0].name;
      }
      if (mo[0].state && mo[0].state !== order.mo_state) {
        order.mo_state = mo[0].state;
        moPatch.mo_state = mo[0].state;
      }
      if (Object.keys(moPatch).length > 0) {
        await supabaseServer.from('wip_orders').update(moPatch).eq('id', order.id);
      }
    }

    if (!mo || !mo[0] || !mo[0].move_raw_ids || mo[0].move_raw_ids.length === 0) {
      setBoundedCache(rawMovesCache, order.odoo_mo_id, { time: Date.now(), data: [] });
      return [];
    }

    const moveIds = mo[0].move_raw_ids;
    const moves = await adminOdooClient._callObject('stock.move', 'read', [
      moveIds,
      ['id', 'product_id', 'product_uom_qty', 'quantity', 'product_uom', 'state']
    ]);

    const stateMap = {
      done: 'Selesai Terpenuhi',
      assigned: 'Tersedia / Siap',
      confirmed: 'Menunggu Bahan Masuk',
      waiting: 'Menunggu Operasi Lain',
      draft: 'Draft',
      cancel: 'Dibatalkan'
    };

    const mapped = (moves || []).map((m) => ({
      id: m.id,
      productName: Array.isArray(m.product_id) ? m.product_id[1] : (m.product_id || '-'),
      demandQty: Number(m.product_uom_qty || 0),
      quantityDone: Number(m.quantity || 0),
      uom: Array.isArray(m.product_uom) ? m.product_uom[1] : (m.product_uom || 'yard'),
      state: m.state,
      stateDisplay: stateMap[m.state] || m.state
    }));

    setBoundedCache(rawMovesCache, order.odoo_mo_id, { time: Date.now(), data: mapped });
    return mapped;
  } catch (err) {
    console.warn(`[WipQueryService] BOM fetch error for MO #${order.odoo_mo_id}:`, err.message);
    return [];
  }
}

/**
 * Fetch stock transfers associated with this order
 */
export async function fetchOrderTransfers(order) {
  const cacheKey = order.odoo_mo_id || `wip_${order.odoo_wip_id}`;
  if (!order.odoo_mo_id && !order.odoo_wip_id) return [];
  const cached = transfersCache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  try {
    await adminOdooClient.authenticate();
    const [moRes, wipRes] = await Promise.all([
      order.odoo_mo_id
        ? adminOdooClient._callObject('mrp.production', 'read', [[order.odoo_mo_id]], {
            fields: ['picking_ids']
          }).catch(() => [])
        : Promise.resolve([]),
      order.odoo_wip_id
        ? adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [[order.odoo_wip_id]], {
            fields: ['x_studio_daftar_transfer']
          }).catch(() => [])
        : Promise.resolve([])
    ]);

    let pickingIds = [];
    if (moRes && moRes[0]?.picking_ids?.length) {
      pickingIds.push(...moRes[0].picking_ids);
    }
    if (wipRes && wipRes[0]?.x_studio_daftar_transfer?.length) {
      pickingIds.push(...wipRes[0].x_studio_daftar_transfer);
    }

    pickingIds = Array.from(new Set(pickingIds.filter(Boolean)));
    if (pickingIds.length === 0) {
      setBoundedCache(transfersCache, cacheKey, { time: Date.now(), data: [] });
      return [];
    }

    const pickings = await adminOdooClient._callObject('stock.picking', 'read', [pickingIds], {
      fields: ['id', 'name', 'origin', 'picking_type_id', 'state', 'date_done', 'scheduled_date', 'move_ids']
    });

    const stateMap = {
      done: 'Selesai',
      assigned: 'Siap Kirim / Diproses',
      confirmed: 'Menunggu Bahan',
      waiting: 'Menunggu Operasi Lain',
      draft: 'Draft',
      cancel: 'Dibatalkan'
    };

    const validPickings = (pickings || []).filter(
      (p) => !(p.state === 'draft' && (!p.move_ids || p.move_ids.length === 0))
    );

    const mapped = validPickings.map((p) => {
      const typeName = Array.isArray(p.picking_type_id) ? p.picking_type_id[1] : (p.picking_type_id || '');
      const pName = p.name || '';
      let category = 'lainnya';
      if (pName.includes('/PC/') || typeName.toLowerCase().includes('komponen') || typeName.toLowerCase().includes('pilih')) {
        category = 'komponen';
      } else if (pName.includes('/SFP/') || typeName.toLowerCase().includes('simpan') || typeName.toLowerCase().includes('produk jadi')) {
        category = 'produk_jadi';
      } else if (pName.includes('BSKL') || (p.origin && (p.origin.toLowerCase().includes('retur') || p.origin.toLowerCase().includes('sisa makloon')))) {
        category = 'bskl';
      }

      return {
        id: p.id,
        name: p.name,
        origin: p.origin || '-',
        pickingType: typeName,
        category,
        state: p.state,
        stateDisplay: stateMap[p.state] || p.state,
        dateDone: p.date_done || null,
        scheduledDate: p.scheduled_date || null
      };
    });

    setBoundedCache(transfersCache, cacheKey, { time: Date.now(), data: mapped });
    return mapped;
  } catch (err) {
    console.warn(`[WipQueryService] Transfers fetch error for MO #${order.odoo_mo_id}:`, err.message);
    return [];
  }
}
