import { adminOdooClient } from '../../../odoo/odooClient.js';
import { wipRepo } from '../../wipRepository.js';

/**
 * Helper: Fetch current pricing from x_vendor_production in Odoo
 */
export async function fetchVendorPriceFromOdoo(warehouseId, productId, workcenterIds = []) {
  await adminOdooClient.authenticate();
  if (!warehouseId || !productId) return 0.0;

  try {
    const vendorPrices = await adminOdooClient._callObject('x_vendor_production', 'search_read', [
      [
        ['x_studio_warehouse', '=', warehouseId],
        ['x_studio_product', '=', productId]
      ]
    ], { fields: ['id', 'x_studio_value', 'x_studio_many2many_field_7h1_1k3jdkeub'], order: 'id desc' });

    if (!vendorPrices || vendorPrices.length === 0) return 0.0;

    if (workcenterIds.length > 0) {
      const targetWcSet = new Set(workcenterIds);
      const matched = vendorPrices.find((vp) => {
        const vpWcIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];
        if (vpWcIds.length !== targetWcSet.size) return false;
        return vpWcIds.every((id) => targetWcSet.has(id));
      });
      if (matched && matched.x_studio_value !== undefined) {
        return parseFloat(matched.x_studio_value) || 0.0;
      }
    }

    return parseFloat(vendorPrices[0].x_studio_value) || 0.0;
  } catch (err) {
    console.warn(`[WipSyncService] fetchVendorPriceFromOdoo error: ${err.message}`);
    return 0.0;
  }
}

/**
 * Triggered when Vendor Pricing (x_vendor_production) is created or updated in Odoo.
 * Groups matching WIPs by computed totalHarga to batch Odoo writes & Supabase updates.
 */
export async function onVendorPriceUpdated(vendorPriceId) {
  await adminOdooClient.authenticate();
  const id = Number(vendorPriceId);
  if (!id || isNaN(id)) {
    throw new Error(`Invalid Vendor Price ID: ${vendorPriceId}`);
  }

  console.log(`[WipSyncService] Handling Vendor Price Updated for ID #${id}...`);

  const records = await adminOdooClient._callObject('x_vendor_production', 'read', [[id]], {
    fields: ['id', 'x_studio_warehouse', 'x_studio_product', 'x_studio_value', 'x_studio_many2many_field_7h1_1k3jdkeub']
  });

  if (!records || records.length === 0) {
    console.warn(`[WipSyncService] Vendor Price record #${id} not found in Odoo.`);
    return { success: false, notFound: true };
  }

  const vp = records[0];
  const warehouseId = vp.x_studio_warehouse ? vp.x_studio_warehouse[0] : null;
  const productId = vp.x_studio_product ? vp.x_studio_product[0] : null;
  const newPrice = parseFloat(vp.x_studio_value) || 0.0;
  const vpWorkcenterIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];

  if (!warehouseId || !productId) {
    console.warn(`[WipSyncService] Vendor Price #${id} missing warehouse or product.`);
    return { success: false, reason: 'Missing warehouse or product' };
  }

  // Filter directly in Odoo search domain: exclude 'Selesai' & only fetch WIPs where price <= 0!
  const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
    [
      ['x_studio_warehouse', '=', warehouseId],
      ['x_studio_product', '=', productId],
      ['x_studio_status_produksi', 'not in', ['Selesai', 'selesai']],
      '|',
      ['x_studio_harga', '=', false],
      ['x_studio_harga', '<=', 0]
    ]
  ], {
    fields: [
      'id', 'x_name', 'x_studio_harga', 'x_studio_total_harga',
      'x_studio_qty_masuk_sfp', 'x_studio_manufacturing_order',
      'x_studio_many2many_field_869_1k3jdrdl1', 'x_studio_status_produksi'
    ],
    order: 'id desc'
  });

  const updatedWips = [];
  const groupsByTotalHarga = new Map();

  for (const w of wips || []) {
    if (vpWorkcenterIds.length > 0 && w.x_studio_many2many_field_869_1k3jdrdl1 && w.x_studio_many2many_field_869_1k3jdrdl1.length > 0) {
      const wipWcSet = new Set(w.x_studio_many2many_field_869_1k3jdrdl1);
      const matchesWc = vpWorkcenterIds.every((cid) => wipWcSet.has(cid));
      if (!matchesWc) continue;
    }

    const statusProduksi = (w.x_studio_status_produksi || '').trim().toLowerCase();
    if (statusProduksi === 'selesai') continue;

    const currentPrice = parseFloat(w.x_studio_harga) || 0.0;
    if (currentPrice > 0) continue;

    const sfpQty = parseFloat(w.x_studio_qty_masuk_sfp) || 0.0;
    const totalHarga = Number((newPrice * sfpQty).toFixed(2));

    if (!groupsByTotalHarga.has(totalHarga)) {
      groupsByTotalHarga.set(totalHarga, []);
    }
    groupsByTotalHarga.get(totalHarga).push(w.id);

    updatedWips.push({
      wipId: w.id,
      moName: w.x_name,
      hargaVendor: newPrice,
      sfpQty,
      totalHarga
    });
  }

  // Batch write to Odoo & Supabase per distinct totalHarga group (usually 1 single call for all open WIPs!)
  for (const [totalHarga, wipIds] of groupsByTotalHarga.entries()) {
    await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
      wipIds,
      {
        x_studio_harga: newPrice,
        x_studio_total_harga: totalHarga
      }
    ], {
      context: { tracking_disable: true, no_automation: true }
    });

    await wipRepo.updateWipPricingByOdooIds(wipIds, {
      harga_vendor: newPrice,
      total_harga: totalHarga
    });
  }

  return {
    success: true,
    priceId: id,
    newPrice,
    updatedCount: updatedWips.length,
    updatedWips
  };
}
