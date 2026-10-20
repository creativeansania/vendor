import { adminOdooClient } from '../../core/odoo/odooClient.js';
import { logger } from '../../utils/logger.js';
import { wipMysqlRepo } from './wip.mysql.repo.js';
import { db } from '../../core/database/mysql.js';

export class WipVendorService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
    this._locks = new Map();
  }

  /**
   * Helper: Mutex to serialize concurrent operations on the same resource key (e.g. wipId or moId)
   */
  async _withLock(key, fn) {
    const prev = this._locks.get(key) || Promise.resolve();
    let release;
    const next = new Promise(resolve => { release = resolve; });
    this._locks.set(key, prev.then(() => next, () => next));

    await prev;
    try {
      return await fn();
    } finally {
      release();
      if (this._locks.get(key) === next) {
        this._locks.delete(key);
      }
    }
  }

  /**
   * Helper: Ensure authenticated
   */
  async _ensureAuth() {
    if (!this.odoo.uid) {
      await this.odoo.authenticate();
    }
  }

  /**
   * 1. Triggered when Manufacturing Order is Confirmed
   * Replaces Odoo Automation: [Custom] Buat WIP dari MO
   */
  async onMoConfirmed(moId, { autoSync = true } = {}) {
    await this._ensureAuth();
    const id = Number(moId);
    if (!id || isNaN(id)) {
      throw new Error(`Invalid MO ID: ${moId}`);
    }

    return this._withLock(`mo_${id}`, async () => {
      logger.info(`[WIP Service] Checking WIP record for MO ID #${id}...`);

      // Check if WIP already exists for this MO
      const existingWips = await this.odoo._callObject('x_monitoring_wip_vendo', 'search_read', [
        [['x_studio_manufacturing_order', '=', id]]
      ], { fields: ['id', 'x_name'] });

      if (existingWips && existingWips.length > 0) {
        logger.info(`[WIP Service] WIP record already exists for MO #${id} (WIP ID: ${existingWips[0].id}, Name: ${existingWips[0].x_name}). Skipping creation.`);
        return { success: true, alreadyExists: true, wipId: existingWips[0].id };
      }

      // Read MO details
      const mos = await this.odoo._callObject('mrp.production', 'read', [[id]], {
        fields: ['id', 'name', 'product_id', 'product_qty', 'bom_id', 'workorder_ids', 'picking_ids', 'company_id', 'warehouse_id', 'picking_type_id']
      });

      if (!mos || mos.length === 0) {
        throw new Error(`Manufacturing Order #${id} not found in Odoo`);
      }

      const mo = mos[0];
      const moName = mo.name || `MO#${id}`;
      const ptName = (mo.picking_type_id && mo.picking_type_id[1]) ? mo.picking_type_id[1].toUpperCase() : '';
      const whName = (mo.warehouse_id && mo.warehouse_id[1]) ? mo.warehouse_id[1].toUpperCase() : '';
      const isVendorMo = ptName.includes('VENDOR') || whName.includes('VENDOR') || moName.startsWith('VD');

      if (!isVendorMo) {
        logger.info(`[WIP Service] MO "${moName}" (#${id}) Operation Type "${ptName}" / Warehouse "${whName}" is not Vendor. Skipping Monitoring WIP Vendor creation.`);
        return { success: true, skipped: true, reason: `Non-vendor operation type: ${ptName}` };
      }

      logger.info(`[WIP Service] Creating new WIP record for MO "${moName}" (ID: ${id}, Operation Type: "${ptName}")...`);

      // Calculate initial cloth requirement from BoM lines
      let consumptionPerPcs = 0.0;
      if (mo.bom_id && mo.bom_id[0]) {
        try {
          const bomLines = await this.odoo._callObject('mrp.bom.line', 'search_read', [
            [['bom_id', '=', mo.bom_id[0]]]
          ], { fields: ['id', 'product_id', 'product_qty'] });

          if (bomLines && bomLines.length > 0) {
            // Look for line containing 'KAIN' or take primary line
            const clothLine = bomLines.find(bl => (bl.product_id && bl.product_id[1] && bl.product_id[1].toUpperCase().includes('KAIN'))) || bomLines[0];
            consumptionPerPcs = parseFloat(clothLine.product_qty) || 0.0;
          }
        } catch (errBom) {
          logger.warn(`[WIP Service] Could not fetch BoM lines for BoM #${mo.bom_id[0]}: ${errBom.message}`);
        }
      }

      const qtyKebutuhanKain = (parseFloat(mo.product_qty) || 0.0) * consumptionPerPcs;

      // Fetch Work Centers from Work Orders
      let workcenterIds = [];
      if (mo.workorder_ids && mo.workorder_ids.length > 0) {
        try {
          const workorders = await this.odoo._callObject('mrp.workorder', 'read', [
            mo.workorder_ids,
            ['workcenter_id']
          ]);
          workcenterIds = [...new Set(workorders.filter(wo => wo.workcenter_id).map(wo => wo.workcenter_id[0]))];
        } catch (errWo) {
          logger.warn(`[WIP Service] Could not fetch workcenters for MO #${id}: ${errWo.message}`);
        }
      }

      const newWipPayload = {
        x_name: moName,
        x_studio_manufacturing_order: id,
        x_studio_qty_kebutuhan_kain: qtyKebutuhanKain,
        x_studio_status_produksi: 'Proses'
      };

      if (workcenterIds.length > 0) {
        newWipPayload.x_studio_many2many_field_869_1k3jdrdl1 = [[6, 0, workcenterIds]];
      }

      const newWipId = await this.odoo._callObject('x_monitoring_wip_vendo', 'create', [newWipPayload]);
      logger.info(`[WIP Service] 🎉 Created WIP record #${newWipId} for MO "${moName}".`);

      // Trigger sync if MO already has pickings and autoSync is enabled
      if (autoSync && mo.picking_ids && mo.picking_ids.length > 0) {
        try {
          await this._syncWipFromPickings(newWipId, id);
        } catch (syncErr) {
          logger.warn(`[WIP Service] Post-creation sync warning for WIP #${newWipId}: ${syncErr.message}`);
        }
      } else {
        // Initial MySQL sync even if no pickings yet
        try {
          const whId = mo.warehouse_id ? mo.warehouse_id[0] : null;
          const whName = mo.warehouse_id ? mo.warehouse_id[1] : '';
          let parentMoName = null;
          if (moName.includes('-')) {
            const parts = moName.split('-');
            if (/^\d+$/.test(parts[parts.length - 1])) {
              parentMoName = moName.substring(0, moName.lastIndexOf('-'));
            }
          }
          await wipMysqlRepo.upsertWipOrder({
            odoo_wip_id: newWipId,
            odoo_mo_id: id,
            odoo_warehouse_id: whId,
            vendor_name: whName,
            parent_mo_name: parentMoName,
            mo_name: moName,
            mo_state: 'confirmed',
            product_name: mo.product_id ? mo.product_id[1] : null,
            qty_spk: parseFloat(mo.product_qty || 0),
            qty_kebutuhan_kain: qtyKebutuhanKain,
            status_produksi: 'Proses'
          });
        } catch (mErr) {
          logger.warn(`[WIP Service] Initial MySQL sync warning for WIP #${newWipId}: ${mErr.message}`);
        }
      }

      return {
        success: true,
        wipId: newWipId,
        moId: id,
        moName
      };
    });
  }

  /**
   * 2. Triggered when Transfer (/PC/, /SPB/, /SFP/) is Done
   * Replaces Odoo Automations: [Custom] Toggle dari Transfer & [Custom] Sinkron WIP + 8 Studio Formula Rules
   */
  async onTransferDone(pickingId) {
    await this._ensureAuth();
    const id = Number(pickingId);
    if (!id || isNaN(id)) {
      throw new Error(`Invalid Picking ID: ${pickingId}`);
    }

    logger.info(`[WIP Service] Handling Transfer Done for Picking ID #${id}...`);

    const pickings = await this.odoo._callObject('stock.picking', 'read', [[id]], {
      fields: ['id', 'name', 'origin', 'state', 'x_studio_manufacturing_order', 'reference_ids', 'company_id', 'picking_type_id']
    });

    if (!pickings || pickings.length === 0) {
      logger.warn(`[WIP Service] Picking #${id} not found in Odoo.`);
      return { success: false, notFound: true };
    }

    const picking = pickings[0];
    const pickingName = picking.name || '';
    const ptName = (picking.picking_type_id && picking.picking_type_id[1]) ? picking.picking_type_id[1].toUpperCase() : '';

    // Only process relevant transfers (/PC/, /SPB/, /SFP/) belonging to Vendor Operation Type
    const isRelevantCode = ['/PC/', '/SPB/', '/SFP/'].some(code => pickingName.includes(code));
    const isVendorTransfer = ptName.includes('VENDOR') || pickingName.startsWith('VD');

    if (!isRelevantCode || !isVendorTransfer) {
      logger.info(`[WIP Service] Picking ${pickingName} (#${id}) Operation Type "${ptName}" is not a vendor PC/SPB/SFP transfer. Skipping WIP sync.`);
      return { success: true, skipped: true, reason: 'Not a vendor PC/SPB/SFP transfer' };
    }

    // Resolve target MO(s)
    let moIds = [];

    // Case 1: SFP transfers have origin == MO name
    if (pickingName.includes('/SFP/') && picking.origin) {
      const mos = await this.odoo._callObject('mrp.production', 'search_read', [
        [['name', '=', picking.origin.trim()]]
      ], { fields: ['id', 'name'], limit: 1 });
      if (mos && mos.length > 0) {
        moIds.push(mos[0].id);
      }
    }

    // Case 2: PC/SPB transfers linked via x_studio_manufacturing_order or reference_ids
    if (moIds.length === 0 && picking.x_studio_manufacturing_order) {
      moIds.push(picking.x_studio_manufacturing_order[0]);
    }

    if (moIds.length === 0 && picking.reference_ids && picking.reference_ids.length > 0) {
      const refMos = await this.odoo._callObject('mrp.production', 'search_read', [
        [['reference_ids', 'in', picking.reference_ids]]
      ], { fields: ['id', 'name'] });
      moIds.push(...refMos.map(m => m.id));
    }

    moIds = [...new Set(moIds)];

    if (moIds.length === 0) {
      logger.info(`[WIP Service] No MO associated with transfer ${pickingName} (#${id}). Skipping WIP sync.`);
      return { success: true, skipped: true, reason: 'No linked MO found' };
    }

    // Strictly filter for Vendor MOs by Operation Type / Warehouse
    const vendorMoIds = [];
    const targetMos = await this.odoo._callObject('mrp.production', 'read', [
      moIds,
      ['id', 'name', 'warehouse_id', 'picking_type_id']
    ]);
    for (const m of targetMos) {
      const mPt = (m.picking_type_id && m.picking_type_id[1]) ? m.picking_type_id[1].toUpperCase() : '';
      const mWh = (m.warehouse_id && m.warehouse_id[1]) ? m.warehouse_id[1].toUpperCase() : '';
      const name = m.name || '';
      if (mPt.includes('VENDOR') || mWh.includes('VENDOR') || name.startsWith('VD')) {
        vendorMoIds.push(m.id);
      } else {
        logger.info(`[WIP Service] Skipping MO ${name} (#${m.id}) with non-vendor Operation Type "${mPt}".`);
      }
    }

    if (vendorMoIds.length === 0) {
      logger.info(`[WIP Service] Transfer ${pickingName} (#${id}) has no vendor MOs associated. Skipping WIP sync.`);
      return { success: true, skipped: true, reason: 'No vendor MO found' };
    }

    logger.info(`[WIP Service] Transfer ${pickingName} (#${id}) relates to ${vendorMoIds.length} Vendor MO(s): [${vendorMoIds.join(', ')}]`);

    const syncedWips = [];

    for (const moId of vendorMoIds) {
      // Find or create WIP record
      let wips = await this.odoo._callObject('x_monitoring_wip_vendo', 'search_read', [
        [['x_studio_manufacturing_order', '=', moId]]
      ], { fields: ['id', 'x_name'] });

      let wipId = wips && wips.length > 0 ? wips[0].id : null;
      if (!wipId) {
        logger.info(`[WIP Service] No WIP record found for Vendor MO #${moId}. Creating on-the-fly...`);
        const created = await this.onMoConfirmed(moId, { autoSync: false });
        if (created && created.wipId) {
          wipId = created.wipId;
        }
      }

      if (wipId) {
        const syncRes = await this._syncWipFromPickings(wipId, moId);
        syncedWips.push(syncRes);
      }
    }

    return {
      success: true,
      pickingId: id,
      pickingName,
      syncedWips
    };
  }

  /**
   * Core Single-Pass Compute: Synchronizes all data and formulas for a WIP record
   */
  async _syncWipFromPickings(wipId, moId) {
    return this._withLock(`wip_${wipId}`, async () => {
      logger.info(`[WIP Service] 🔄 Executing Single-Pass Compute for WIP #${wipId} (MO #${moId})...`);

      // 1. Read WIP record current state
    const wips = await this.odoo._callObject('x_monitoring_wip_vendo', 'read', [[wipId]], {
      fields: [
        'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_detail_roll_kain',
        'x_studio_warehouse', 'x_studio_product', 'x_studio_consumption_per_pcs_1',
        'x_studio_qty_kebutuhan_kain', 'x_studio_unit_kain_dari_gudang',
        'x_studio_unit_consumption_per_pcs', 'x_studio_actual_cutting',
        'x_studio_harga', 'x_studio_total_harga', 'x_studio_daftar_transfer',
        'x_studio_many2many_field_869_1k3jdrdl1'
      ]
    });

    if (!wips || wips.length === 0) {
      throw new Error(`WIP record #${wipId} not found`);
    }
    const wip = wips[0];

    // 2. Read MO details
    const mos = await this.odoo._callObject('mrp.production', 'read', [[moId]], {
      fields: [
        'id', 'name', 'product_id', 'product_qty', 'picking_ids',
        'warehouse_id', 'bom_id', 'workorder_ids', 'company_id'
      ]
    });
    if (!mos || mos.length === 0) {
      throw new Error(`MO record #${moId} not found`);
    }
    const mo = mos[0];
    const moName = mo.name || '';

    // 3. Read all pickings linked to MO
    const pickingIds = mo.picking_ids || [];
    if (pickingIds.length === 0) {
      logger.info(`[WIP Service] MO ${moName} has no pickings linked yet.`);
      return { wipId, updated: false };
    }

    const allPickings = await this.odoo._callObject('stock.picking', 'read', [
      pickingIds,
      ['id', 'name', 'state', 'origin', 'date_done', 'move_line_ids', 'picking_type_id']
    ]);

    // Filter pickings:
    // - PC & SPB: All related to MO
    // - SFP: ONLY where origin === mo.name (STRICT FILTER)
    const validDaftarTransferIds = allPickings
      .filter(p => {
        const name = p.name || '';
        if (name.includes('/PC/') || name.includes('/SPB/')) return true;
        if (name.includes('/SFP/') && p.origin === moName) return true;
        return false;
      })
      .map(p => p.id);

    const donePickings = allPickings.filter(p => p.state === 'done');
    const donePcSpb = donePickings.filter(p => (p.name || '').includes('/PC/') || (p.name || '').includes('/SPB/'));
    const doneSfp = donePickings.filter(p => (p.name || '').includes('/SFP/') && p.origin === moName).sort((a, b) => new Date(a.date_done || 0) - new Date(b.date_done || 0));

    // 4. Fetch move lines for done PC/SPB
    const pcMoveLineIds = [...new Set(donePcSpb.flatMap(p => p.move_line_ids || []))];
    let kainQty = 0.0;
    let totalMaterialQty = 0.0;
    let pcMoveLines = [];

    if (pcMoveLineIds.length > 0) {
      pcMoveLines = await this.odoo._callObject('stock.move.line', 'read', [
        pcMoveLineIds,
        ['id', 'product_id', 'lot_id', 'quantity', 'product_uom_id']
      ]);

      const activeMoveLines = pcMoveLines.filter(l => (parseFloat(l.quantity) || 0) > 0);
      for (const l of activeMoveLines) {
        const q = parseFloat(l.quantity) || 0.0;
        totalMaterialQty += q;
        const prodName = (l.product_id && l.product_id[1] ? l.product_id[1] : '').toUpperCase();
        if (prodName.includes('KAIN')) {
          kainQty += q;
        }
      }
    }

    const accsQty = Math.max(0, totalMaterialQty - kainQty);

    // 5. Roll Lines Management (x_studio_detail_roll_kain)
    const rawRollLines = wip.x_studio_detail_roll_kain && wip.x_studio_detail_roll_kain.length > 0
      ? await this.odoo._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
          wip.x_studio_detail_roll_kain,
          ['id', 'x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_berat_kg']
        ])
      : [];

    // Deduplicate any existing lines in Odoo if duplicates exist
    const seenRollKeys = new Map();
    const duplicateLineIdsToDelete = [];
    const existingRollLines = [];

    for (const line of rawRollLines) {
      const key = `${line.x_name || ''}:::${line.x_studio_kode_warna_roll || 'Tanpa Lot'}`;
      if (seenRollKeys.has(key)) {
        // Redundant duplicate: only delete if cutting weight has not been inputted yet
        if ((parseFloat(line.x_studio_qty_berat_kg) || 0) === 0) {
          duplicateLineIdsToDelete.push(line.id);
          continue;
        }
      } else {
        seenRollKeys.set(key, line);
      }
      existingRollLines.push(line);
    }

    if (duplicateLineIdsToDelete.length > 0) {
      logger.warn(`[WIP Service] Found ${duplicateLineIdsToDelete.length} duplicate roll lines in WIP #${wipId}. Cleaning up IDs [${duplicateLineIdsToDelete.join(', ')}]...`);
      try {
        await this.odoo._callObject('x_monitoring_wip_vendo_line_4c93a', 'unlink', [duplicateLineIdsToDelete]);
      } catch (delErr) {
        logger.warn(`[WIP Service] Failed to unlink duplicate lines: ${delErr.message}`);
      }
    }

    const newRollLines = [];

    // Backorder logic: If no roll lines exist and MO is backorder (e.g. MO/001-1), copy from previous WIP in family
    if (existingRollLines.length === 0 && moName.includes('-') && /^\d+$/.test(moName.rsplit ? moName.rsplit('-', 1)[-1] : moName.split('-').pop())) {
      const basePrefix = moName.substring(0, moName.lastIndexOf('-'));
      try {
        const prevWips = await this.odoo._callObject('x_monitoring_wip_vendo', 'search_read', [
          [
            ['x_studio_manufacturing_order.name', '=like', `${basePrefix}-%`],
            ['id', '<', wipId],
            ['x_studio_detail_roll_kain', '!=', false]
          ]
        ], { fields: ['id', 'x_studio_detail_roll_kain'], order: 'id desc', limit: 1 });

        if (prevWips && prevWips.length > 0 && prevWips[0].x_studio_detail_roll_kain.length > 0) {
          const prevLines = await this.odoo._callObject('x_monitoring_wip_vendo_line_4c93a', 'read', [
            prevWips[0].x_studio_detail_roll_kain,
            ['x_name', 'x_studio_kode_warna_roll', 'x_studio_yards', 'x_studio_uom', 'x_studio_qty_berat_kg']
          ]);

          for (const l of prevLines) {
            newRollLines.push([0, 0, {
              x_name: l.x_name,
              x_studio_kode_warna_roll: l.x_studio_kode_warna_roll,
              x_studio_yards: l.x_studio_yards,
              x_studio_uom: l.x_studio_uom,
              x_studio_qty_berat_kg: l.x_studio_qty_berat_kg
            }]);
          }
          logger.info(`[WIP Service] Copied ${newRollLines.length} roll lines from backorder family (${basePrefix}-*) for WIP #${wipId}.`);
        }
      } catch (errFamily) {
        logger.warn(`[WIP Service] Backorder family copy error: ${errFamily.message}`);
      }
    }

    // New PC transfer lines arrived: add rows that do not exist yet
    if (newRollLines.length === 0 && pcMoveLines.length > 0) {
      const existingKeySet = new Set(
        existingRollLines.map(l => `${l.x_name || ''}:::${l.x_studio_kode_warna_roll || 'Tanpa Lot'}`)
      );

      for (const l of pcMoveLines) {
        const prodName = l.product_id ? l.product_id[1] : '';
        const lotName = l.lot_id ? l.lot_id[1] : 'Tanpa Lot';
        const key = `${prodName}:::${lotName}`;

        if (!existingKeySet.has(key)) {
          existingKeySet.add(key);
          newRollLines.push([0, 0, {
            x_name: prodName,
            x_studio_kode_warna_roll: lotName,
            x_studio_yards: l.quantity,
            x_studio_uom: l.product_uom_id ? l.product_uom_id[1] : '',
            x_studio_qty_berat_kg: 0.0 // Default 0 for physical vendor input
          }]);
        }
      }
    }

    // 6. SFP Receiving Details
    let sfpVals = {};
    let sfpQtyMasuk = 0.0;
    if (doneSfp.length > 0) {
      const latestSfp = doneSfp[doneSfp.length - 1];
      let sfpLineQty = 0.0;
      if (latestSfp.move_line_ids && latestSfp.move_line_ids.length > 0) {
        const sfpLines = await this.odoo._callObject('stock.move.line', 'read', [
          latestSfp.move_line_ids,
          ['quantity']
        ]);
        sfpLineQty = sfpLines.reduce((sum, l) => sum + (parseFloat(l.quantity) || 0.0), 0.0);
      }
      sfpQtyMasuk = sfpLineQty;
      sfpVals = {
        x_studio_no_surat_jalan_sfp: latestSfp.name,
        x_studio_tanggal_sfp: latestSfp.date_done,
        x_studio_qty_masuk_sfp: sfpQtyMasuk
      };
    }

    // 7. Estimasi dari SPB & Status Kecukupan Kain (Formula Automations 43 & 45)
    const consumptionPerPcs = parseFloat(wip.x_studio_consumption_per_pcs_1) || 0.0;
    const unitKain = wip.x_studio_unit_kain_dari_gudang ? wip.x_studio_unit_kain_dari_gudang[1] : '';
    const unitCons = wip.x_studio_unit_consumption_per_pcs ? wip.x_studio_unit_consumption_per_pcs[1] : '';
    const conversionFactor = (unitKain && unitCons && unitKain !== unitCons) ? 0.9144 : 1.0;

    const estimasiDariSpb = consumptionPerPcs > 0
      ? (conversionFactor * kainQty) / consumptionPerPcs
      : 0.0;

    const targetKebutuhanKain = parseFloat(wip.x_studio_qty_kebutuhan_kain) || 0.0;
    const statusKebutuhanKain = kainQty >= targetKebutuhanKain ? 'Cukup' : 'Kurang';

    // 8. Actual Cutting & Selisih (Formula Automations 53 & 47)
    // Combine existing lines + newly planned lines
    const allLinesToSum = [
      ...existingRollLines,
      ...newRollLines.map(r => r[2])
    ];
    const actualCutting = allLinesToSum
      .filter(l => (l.x_name || '').toUpperCase().includes('KAIN'))
      .reduce((sum, l) => sum + (parseFloat(l.x_studio_qty_berat_kg) || 0.0), 0.0);

    const selisihCutting = actualCutting - estimasiDariSpb;

    // 9. Work Centers & Vendor Pricing (Formula Automations 54, 55, 51)
    let workcenterIds = [];
    if (mo.workorder_ids && mo.workorder_ids.length > 0) {
      try {
        const wos = await this.odoo._callObject('mrp.workorder', 'read', [
          mo.workorder_ids,
          ['workcenter_id']
        ]);
        workcenterIds = [...new Set(wos.filter(w => w.workcenter_id).map(w => w.workcenter_id[0]))];
      } catch (errWo) {
        logger.debug(`Workcenter fetch error: ${errWo.message}`);
      }
    }

    let hargaVendor = parseFloat(wip.x_studio_harga) || 0.0;
    const warehouseId = mo.warehouse_id ? mo.warehouse_id[0] : (wip.x_studio_warehouse ? wip.x_studio_warehouse[0] : null);
    const productId = mo.product_id ? mo.product_id[0] : (wip.x_studio_product ? wip.x_studio_product[0] : null);

    if (warehouseId && productId && workcenterIds.length > 0) {
      try {
        const vendorPrices = await this.odoo._callObject('x_vendor_production', 'search_read', [
          [
            ['x_studio_warehouse', '=', warehouseId],
            ['x_studio_product', '=', productId]
          ]
        ], { fields: ['id', 'x_studio_value', 'x_studio_many2many_field_7h1_1k3jdkeub'] });

        if (vendorPrices && vendorPrices.length > 0) {
          const targetWcSet = new Set(workcenterIds);
          const matched = vendorPrices.find(vp => {
            const vpWcIds = vp.x_studio_many2many_field_7h1_1k3jdkeub || [];
            if (vpWcIds.length !== targetWcSet.size) return false;
            return vpWcIds.every(id => targetWcSet.has(id));
          }) || vendorPrices[0];

          if (matched && matched.x_studio_value !== undefined) {
            hargaVendor = parseFloat(matched.x_studio_value) || 0.0;
          }
        }
      } catch (errPrice) {
        logger.warn(`[WIP Service] Could not fetch vendor pricing: ${errPrice.message}`);
      }
    }

    const totalHarga = hargaVendor * sfpQtyMasuk;

    // 10. Assemble complete update payload (ONE SINGLE WRITE!)
    const vals = {
      x_studio_kain_dari_gudang_qty: kainQty,
      x_studio_accessories_dari_gudang: accsQty,
      x_studio_estimasi_dari_spb: estimasiDariSpb,
      x_studio_status_kebutuhan_kain: statusKebutuhanKain,
      x_studio_actual_cutting: actualCutting,
      x_studio_selisih_hasil_cutting: selisihCutting,
      x_studio_harga: hargaVendor,
      x_studio_total_harga: totalHarga,
      ...sfpVals
    };

    if (validDaftarTransferIds.length > 0) {
      vals.x_studio_daftar_transfer = [[6, 0, validDaftarTransferIds]];
    }

    if (workcenterIds.length > 0) {
      vals.x_studio_many2many_field_869_1k3jdrdl1 = [[6, 0, workcenterIds]];
    }

    if (newRollLines.length > 0) {
      vals.x_studio_detail_roll_kain = newRollLines;
    }

    logger.info(`[WIP Service] Writing Single-Pass computed values to WIP #${wipId}:`, vals);
    await this.odoo._callObject('x_monitoring_wip_vendo', 'write', [[wipId], vals], {
      context: { tracking_disable: true, no_automation: true }
    });

    logger.info(`[WIP Service] ✅ Successfully synchronized WIP #${wipId} in 1 single transaction!`);

    // Live MySQL synchronization
    try {
      const whId = mo.warehouse_id ? mo.warehouse_id[0] : (wip.x_studio_warehouse ? wip.x_studio_warehouse[0] : null);
      const whName = mo.warehouse_id ? mo.warehouse_id[1] : (wip.x_studio_warehouse ? wip.x_studio_warehouse[1] : '');
      let parentMoName = null;
      if (moName.includes('-')) {
        const parts = moName.split('-');
        if (/^\d+$/.test(parts[parts.length - 1])) {
          parentMoName = moName.substring(0, moName.lastIndexOf('-'));
        }
      }

      const mysqlWipId = await wipMysqlRepo.upsertWipOrder({
        odoo_wip_id: wipId,
        odoo_mo_id: moId,
        odoo_warehouse_id: whId,
        vendor_name: whName,
        parent_mo_name: parentMoName,
        mo_name: moName,
        mo_state: mo.state || 'confirmed',
        sales_order: mo.x_studio_sales_order ? mo.x_studio_sales_order[1] : (wip.x_studio_sales_order ? wip.x_studio_sales_order[1] : null),
        product_name: mo.product_id ? mo.product_id[1] : (wip.x_studio_product ? wip.x_studio_product[1] : null),
        qty_spk: parseFloat(mo.product_qty || wip.x_studio_qty_spk || 0),
        start_spk: mo.date_start || wip.x_studio_start_spk || null,
        deadline_spk: mo.date_deadline || wip.x_studio_deadline_spk || null,
        qty_kebutuhan_kain: parseFloat(wip.x_studio_qty_kebutuhan_kain || 0),
        kain_dari_gudang: kainQty,
        unit_kain: unitKain,
        accessories_dari_gudang: accsQty,
        estimasi_dari_spb: estimasiDariSpb,
        status_kebutuhan_kain: statusKebutuhanKain,
        actual_cutting: actualCutting,
        selisih_hasil_cutting: selisihCutting,
        qty_grade_a: parseFloat(wip.x_studio_qty_kirim_a_grade || 0),
        qty_grade_b: parseFloat(wip.x_studio_qty_kirim_b_grade || 0),
        sisa_makloon_kg: parseFloat(wip.x_studio_sisa_makloon_kg || 0),
        no_surat_jalan_sfp: sfpVals.x_studio_no_surat_jalan_sfp || null,
        tanggal_sfp: sfpVals.x_studio_tanggal_sfp || null,
        qty_masuk_sfp: sfpVals.x_studio_qty_masuk_sfp || 0,
        harga_vendor: hargaVendor,
        total_harga: totalHarga,
        status_produksi: wip.x_studio_status_produksi || 'Proses',
        is_active: 1,
        odoo_write_date: new Date().toISOString().slice(0, 19).replace('T', ' ')
      });

      if (allLinesToSum.length > 0) {
        await wipMysqlRepo.upsertRollLines(mysqlWipId, allLinesToSum);
      }

      // Propagate roll weights to child backorders if any
      await wipMysqlRepo.propagateRollWeightsToBackorders(mysqlWipId);
    } catch (mysqlErr) {
      logger.warn(`[WIP Service] Live MySQL sync warning for WIP #${wipId}: ${mysqlErr.message}`);
    }
    return {
      wipId,
      moId,
      kainQty,
      accsQty,
      estimasiDariSpb,
      statusKebutuhanKain,
      actualCutting,
      selisihCutting,
      hargaVendor,
      totalHarga,
      updated: true
    };
    });
  }

  /**
   * 3. Updates production results (Grade A, Grade B, Sisa Makloon)
   * Replaces Odoo Automation: [Custom] Grade A, B & Makloon
   * Enforces:
   * - Grade B MO created in DRAFT and in the SAME PRODUCTION GROUP
   * - Internal Transfer BSKL created in DRAFT/WAITING for physical validation
   */
  async submitProductionResult({ wipId, qtyGradeA, qtyGradeB, sisaPotongPanjang, sisaPotongSedang, sisaPotongPendek, sisaMakloonKg }) {
    await this._ensureAuth();
    const id = Number(wipId);
    if (!id || isNaN(id)) {
      throw new Error(`Invalid WIP ID: ${wipId}`);
    }

    const pKg = Math.max(0, parseFloat(sisaPotongPanjang) || 0.0);
    const sKg = Math.max(0, parseFloat(sisaPotongSedang) || 0.0);
    const pdkKg = Math.max(0, parseFloat(sisaPotongPendek) || 0.0);
    const hasCats = sisaPotongPanjang !== undefined || sisaPotongSedang !== undefined || sisaPotongPendek !== undefined;
    const catSum = Number((pKg + sKg + pdkKg).toFixed(2));
    const sisaKg = hasCats ? catSum : Math.max(0, parseFloat(sisaMakloonKg) || 0.0);

    logger.info(`[WIP Service] Submitting production result for WIP #${id}: GradeA=${qtyGradeA}, GradeB=${qtyGradeB}, Sisa=${sisaKg} (P=${pKg}, S=${sKg}, Pdk=${pdkKg})...`);

    const wips = await this.odoo._callObject('x_monitoring_wip_vendo', 'read', [[id]], {
      fields: [
        'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_product',
        'x_studio_warehouse', 'x_studio_sales_order', 'x_studio_qty_kirim_a_grade',
        'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
        'x_studio_sisa_potong_panjang', 'x_studio_sisa_potong_sedang', 'x_studio_sisa_potong_pendek',
        'x_studio_nama_mo_grade_b', 'x_studio_nama_transfer_makloon'
      ]
    });

    if (!wips || wips.length === 0) {
      throw new Error(`WIP record #${id} not found`);
    }
    const wip = wips[0];
    const moId = wip.x_studio_manufacturing_order ? wip.x_studio_manufacturing_order[0] : null;

    if (!moId) {
      throw new Error(`WIP #${id} is not linked to any Manufacturing Order.`);
    }

    const mos = await this.odoo._callObject('mrp.production', 'read', [[moId]], {
      fields: [
        'id', 'name', 'state', 'qty_producing', 'product_id', 'product_uom_id',
        'company_id', 'picking_type_id', 'production_group_id', 'reference_ids'
      ]
    });
    if (!mos || mos.length === 0) {
      throw new Error(`MO #${moId} not found`);
    }
    const mo = mos[0];
    const updatedWipVals = {};

    // =========================================================
    // 1. QTY KIRIM A GRADE -> qty_producing MO utama
    // =========================================================
    const aGrade = parseFloat(qtyGradeA) || 0.0;
    if (aGrade > 0 && !['done', 'cancel'].includes(mo.state)) {
      if (parseFloat(mo.qty_producing) !== aGrade) {
        logger.info(`[WIP Service] Updating MO ${mo.name} qty_producing to ${aGrade}...`);
        await this.odoo._callObject('mrp.production', 'write', [[mo.id], { qty_producing: aGrade }]);
      }
    }
    updatedWipVals.x_studio_qty_kirim_a_grade = aGrade;

    // =========================================================
    // 2. QTY KIRIM B GRADE -> buat / update MO Grade B
    // (STRICT: State DRAFT & Same Production Group)
    // =========================================================
    const bGrade = parseFloat(qtyGradeB) || 0.0;
    updatedWipVals.x_studio_qty_kirim_b_grade = bGrade;

    if (bGrade > 0 && wip.x_studio_product) {
      // Find Grade B product variant
      const prods = await this.odoo._callObject('product.product', 'read', [[wip.x_studio_product[0]]], {
        fields: ['product_tmpl_id']
      });
      const tmplId = prods && prods[0] && prods[0].product_tmpl_id ? prods[0].product_tmpl_id[0] : null;

      if (tmplId) {
        const prodBs = await this.odoo._callObject('product.product', 'search_read', [
          [
            ['product_tmpl_id', '=', tmplId],
            ['name', 'ilike', 'GRADE B']
          ]
        ], { fields: ['id', 'name', 'uom_id'], limit: 1 });

        if (prodBs && prodBs.length > 0) {
          const prodB = prodBs[0];
          const originB = `Turunan Grade B - ${wip.x_name}`;

          // Search existing MO Grade B
          const existingMoBs = await this.odoo._callObject('mrp.production', 'search_read', [
            [
              ['product_id', '=', prodB.id],
              ['origin', '=', originB]
            ]
          ], { fields: ['id', 'name', 'state', 'product_qty'], limit: 1 });

          if (existingMoBs && existingMoBs.length > 0) {
            const moB = existingMoBs[0];
            if (!['done', 'cancel'].includes(moB.state) && parseFloat(moB.product_qty) !== bGrade) {
              logger.info(`[WIP Service] Updating existing MO Grade B ${moB.name} product_qty to ${bGrade}...`);
              await this.odoo._callObject('mrp.production', 'write', [[moB.id], { product_qty: bGrade }]);
            }
            updatedWipVals.x_studio_nama_mo_grade_b = moB.name;
          } else {
            // Create NEW MO Grade B in DRAFT state and SAME production group
            const moPayload = {
              product_id: prodB.id,
              product_qty: bGrade,
              product_uom_id: prodB.uom_id ? prodB.uom_id[0] : mo.product_uom_id[0],
              origin: originB,
              company_id: mo.company_id[0],
              picking_type_id: mo.picking_type_id[0]
            };

            if (mo.production_group_id && mo.production_group_id[0]) {
              moPayload.production_group_id = mo.production_group_id[0];
            }

            logger.info(`[WIP Service] Creating new MO Grade B in Draft with Production Group:`, moPayload);
            const newMoBId = await this.odoo._callObject('mrp.production', 'create', [moPayload]);

            const readMoB = await this.odoo._callObject('mrp.production', 'read', [[newMoBId]], { fields: ['name'] });
            const moBName = readMoB && readMoB[0] ? readMoB[0].name : `MO#${newMoBId}`;
            updatedWipVals.x_studio_nama_mo_grade_b = moBName;
            logger.info(`[WIP Service] ✅ Created MO Grade B ${moBName} (Draft state preserved).`);
          }
        }
      }
    }

    // =========================================================
    // 3. SISA POTONG KAIN (BSKL) -> buat / update / cancel Transfer BSKL 3 item
    // =========================================================
    updatedWipVals.x_studio_sisa_potong_panjang = pKg;
    updatedWipVals.x_studio_sisa_potong_sedang = sKg;
    updatedWipVals.x_studio_sisa_potong_pendek = pdkKg;
    updatedWipVals.x_studio_sisa_reject = sisaKg;
    updatedWipVals.x_studio_sisa_makloon_kg = sisaKg;

    const whId = wip.x_studio_warehouse ? wip.x_studio_warehouse[0] : null;
    if (whId) {
      const warehouses = await this.odoo._callObject('stock.warehouse', 'read', [[whId]], {
        fields: ['id', 'name', 'lot_stock_id']
      });
      const wh = warehouses && warehouses[0] ? warehouses[0] : null;

      if (wh && wh.lot_stock_id) {
        const soName = wip.x_studio_sales_order ? wip.x_studio_sales_order[1] : '';
        const prefix = `Sisa Makloon - ${wip.x_name} |`;
        const originM = soName ? `${prefix} SO ${soName}` : `${prefix} MO ${mo.name}`;

        const existingPicks = await this.odoo._callObject('stock.picking', 'search_read', [
          [['origin', '=like', `${prefix}%`]]
        ], { fields: ['id', 'name', 'state', 'move_ids'], limit: 1 });

        const pick = existingPicks && existingPicks.length > 0 ? existingPicks[0] : null;

        if (sisaKg > 0) {
          // Find BSKL products & WHGB/Stock destination
          const bsklProds = await this.odoo._callObject('product.product', 'search_read', [
            [['name', 'in', ['BSKL PANJANG', 'BSKL SEDANG', 'BSKL PENDEK', 'BSKL']]]
          ], { fields: ['id', 'name', 'uom_id'] });

          const destLocs = await this.odoo._callObject('stock.location', 'search_read', [
            [
              ['complete_name', 'ilike', 'WHGB/Stock'],
              ['usage', '=', 'internal'],
              ['company_id', 'in', [mo.company_id[0], false]]
            ]
          ], { fields: ['id'], limit: 1 });

          const prodMap = {};
          (bsklProds || []).forEach(p => {
            prodMap[p.name] = p;
          });

          const targetItems = [];
          if (pKg > 0) {
            const prod = prodMap['BSKL PANJANG'] || { id: 320936, name: 'BSKL PANJANG', uom_id: [12, 'kg'] };
            targetItems.push({ prod, qty: pKg });
          }
          if (sKg > 0) {
            const prod = prodMap['BSKL SEDANG'] || { id: 320937, name: 'BSKL SEDANG', uom_id: [12, 'kg'] };
            targetItems.push({ prod, qty: sKg });
          }
          if (pdkKg > 0) {
            const prod = prodMap['BSKL PENDEK'] || { id: 320938, name: 'BSKL PENDEK', uom_id: [12, 'kg'] };
            targetItems.push({ prod, qty: pdkKg });
          }
          if (targetItems.length === 0 && sisaKg > 0) {
            const fallbackProd = prodMap['BSKL'] || { id: 312078, name: 'BSKL', uom_id: [12, 'kg'] };
            targetItems.push({ prod: fallbackProd, qty: sisaKg });
          }

          if (destLocs && destLocs.length > 0 && targetItems.length > 0) {
            const destId = destLocs[0].id;
            const srcId = wh.lot_stock_id[0];

            if (pick) {
              if (!['done', 'cancel'].includes(pick.state)) {
                const existingMoves = pick.move_ids && pick.move_ids.length > 0
                  ? await this.odoo._callObject('stock.move', 'read', [
                      pick.move_ids,
                      ['id', 'product_id', 'product_uom_qty', 'state']
                    ])
                  : [];

                for (const item of targetItems) {
                  const existingMove = existingMoves.find(m => m.product_id && m.product_id[0] === item.prod.id);
                  if (existingMove) {
                    if (parseFloat(existingMove.product_uom_qty) !== item.qty && !['done', 'cancel'].includes(existingMove.state)) {
                      await this.odoo._callObject('stock.move', 'write', [[existingMove.id], { product_uom_qty: item.qty }]);
                      logger.info(`[WIP Service] Updated Transfer ${pick.name} ${item.prod.name} qty to ${item.qty} kg.`);
                    }
                  } else {
                    await this.odoo._callObject('stock.move', 'create', [{
                      name: item.prod.name,
                      product_id: item.prod.id,
                      product_uom_qty: item.qty,
                      product_uom: item.prod.uom_id ? item.prod.uom_id[0] : 12,
                      picking_id: pick.id,
                      location_id: srcId,
                      location_dest_id: destId,
                      company_id: mo.company_id[0]
                    }]);
                  }
                }

                for (const m of existingMoves) {
                  const stillNeeded = targetItems.some(ti => ti.prod.id === m.product_id[0]);
                  if (!stillNeeded && !['done', 'cancel'].includes(m.state)) {
                    try {
                      await this.odoo._callObject('stock.move', '_action_cancel', [[m.id]]);
                    } catch (cErr) {
                      await this.odoo._callObject('stock.move', 'write', [[m.id], { product_uom_qty: 0 }]);
                    }
                  }
                }
              }
              updatedWipVals.x_studio_nama_transfer_makloon = pick.name;
            } else {
              // Create NEW Transfer
              const ptypes = await this.odoo._callObject('stock.picking.type', 'search_read', [
                [
                  ['code', '=', 'internal'],
                  '|',
                  ['warehouse_id', '=', wh.id],
                  ['company_id', '=', mo.company_id[0]]
                ]
              ], { fields: ['id', 'warehouse_id'], limit: 5 });

              if (ptypes && ptypes.length > 0) {
                const chosenPtype = ptypes.find(p => p.warehouse_id && p.warehouse_id[0] === wh.id) || ptypes[0];
                const pickPayload = {
                  picking_type_id: chosenPtype.id,
                  location_id: srcId,
                  location_dest_id: destId,
                  origin: originM,
                  company_id: mo.company_id[0],
                  note: `Sisa bahan makloon dari MO ${mo.name}`
                };

                if (mo.reference_ids && mo.reference_ids.length > 0) {
                  pickPayload.reference_ids = [[6, 0, mo.reference_ids]];
                }

                const newPickId = await this.odoo._callObject('stock.picking', 'create', [pickPayload]);

                for (const item of targetItems) {
                  await this.odoo._callObject('stock.move', 'create', [{
                    name: item.prod.name,
                    product_id: item.prod.id,
                    product_uom_qty: item.qty,
                    product_uom: item.prod.uom_id ? item.prod.uom_id[0] : 12,
                    picking_id: newPickId,
                    location_id: srcId,
                    location_dest_id: destId,
                    company_id: mo.company_id[0]
                  }]);
                }

                const readPick = await this.odoo._callObject('stock.picking', 'read', [[newPickId]], { fields: ['name'] });
                const pickName = readPick && readPick[0] ? readPick[0].name : `PICK#${newPickId}`;
                updatedWipVals.x_studio_nama_transfer_makloon = pickName;
                logger.info(`[WIP Service] ✅ Created Internal Transfer ${pickName} for BSKL items (${sisaKg} kg). Waiting for physical validation.`);
              }
            }
          }
        } else if (pick && !['done', 'cancel'].includes(pick.state)) {
          // If sisa is 0 and pick exists, cancel it
          logger.info(`[WIP Service] Sisa makloon is 0. Cancelling transfer ${pick.name}...`);
          await this.odoo._callObject('stock.picking', 'action_cancel', [[pick.id]]);
        }
      }
    }

    // 4. Write updated values back to WIP record
    logger.info(`[WIP Service] Saving production results to WIP #${id}:`, updatedWipVals);
    await this.odoo._callObject('x_monitoring_wip_vendo', 'write', [[id], updatedWipVals], {
      context: { tracking_disable: true, no_automation: true }
    });

    // Update MySQL WIP Order production results and lock result
    try {
      await db.query(
        `UPDATE wip_orders 
         SET qty_grade_a = ?, qty_grade_b = ?, sisa_makloon_kg = ?, 
             result_locked_at = COALESCE(result_locked_at, NOW()) 
         WHERE odoo_wip_id = ?`,
        [aGrade, bGrade, sisaKg, id]
      );
    } catch (mErr) {
      logger.warn(`[WIP Service] MySQL production result update warning for WIP #${id}: ${mErr.message}`);
    }

    return {
      success: true,
      wipId: id,
      qtyGradeA: aGrade,
      qtyGradeB: bGrade,
      sisaMakloonKg: sisaKg,
      namaMoGradeB: updatedWipVals.x_studio_nama_mo_grade_b || wip.x_studio_nama_mo_grade_b,
      namaTransferMakloon: updatedWipVals.x_studio_nama_transfer_makloon || wip.x_studio_nama_transfer_makloon
    };
  }

  /**
   * 4. Updates physical roll cutting weights and/or actual cutting (Callable from Vendor PWA)
   */
  async updateCuttingRolls({ wipId, rollUpdates = [], actualCutting }) {
    await this._ensureAuth();
    const id = Number(wipId);
    if (!id || isNaN(id)) {
      throw new Error(`Invalid WIP ID: ${wipId}`);
    }

    const updates = Array.isArray(rollUpdates) ? rollUpdates : [];

    logger.info(`[WIP Service] Updating cutting for WIP #${id} (rolls: ${updates.length}, actualCutting: ${actualCutting})...`);

    for (const update of updates) {
      const lineId = Number(update.lineId || update.id);
      const qtyBeratKg = parseFloat(
        update.qtyBeratKg !== undefined
          ? update.qtyBeratKg
          : update.qty_berat_kg !== undefined
          ? update.qty_berat_kg
          : update.x_studio_qty_berat_kg
      ) || 0.0;

      if (lineId) {
        await this.odoo._callObject('x_monitoring_wip_vendo_line_4c93a', 'write', [
          [lineId],
          { x_studio_qty_berat_kg: qtyBeratKg }
        ]);
      }
    }

    // If explicit actualCutting is provided, write to Odoo WIP record
    if (actualCutting !== undefined && actualCutting !== null && actualCutting !== '') {
      const parsedActual = Math.max(0, parseFloat(actualCutting) || 0);
      const wips = await this.odoo._callObject('x_monitoring_wip_vendo', 'read', [[id]], {
        fields: ['x_studio_manufacturing_order', 'x_studio_estimasi_dari_spb']
      });
      const wip = wips && wips[0] ? wips[0] : null;
      const estimasi = wip ? (parseFloat(wip.x_studio_estimasi_dari_spb) || 0) : 0;
      const selisih = parsedActual - estimasi;

      await this.odoo._callObject('x_monitoring_wip_vendo', 'write', [[id], {
        x_studio_actual_cutting: parsedActual,
        x_studio_selisih_hasil_cutting: selisih
      }]);

      if (wip && wip.x_studio_manufacturing_order) {
        const moId = wip.x_studio_manufacturing_order[0];
        return this._syncWipFromPickings(id, moId);
      }
      return { success: true, wipId: id, actualCutting: parsedActual };
    }

    // Re-trigger sync compute to recalculate actual cutting and variance
    const wips = await this.odoo._callObject('x_monitoring_wip_vendo', 'read', [[id]], {
      fields: ['x_studio_manufacturing_order']
    });
    const moId = wips && wips[0] && wips[0].x_studio_manufacturing_order ? wips[0].x_studio_manufacturing_order[0] : null;

    if (moId) {
      return this._syncWipFromPickings(id, moId);
    }

    return { success: true, wipId: id };
  }
}

export const wipVendorService = new WipVendorService();
