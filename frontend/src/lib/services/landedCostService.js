import { adminOdooClient } from '../odoo/odooClient.js';

export class LandedCostService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

  /**
   * Duplicate stock.landed.cost record(s) preserving mrp_production_ids
   */
  async duplicateLandedCostWithMO(landedCostIds) {
    let ids = [];
    if (Array.isArray(landedCostIds)) {
      ids = landedCostIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof landedCostIds === 'number' || !isNaN(Number(landedCostIds))) {
      ids = [Number(landedCostIds)];
    }

    if (ids.length === 0) {
      throw new Error('No valid Landed Cost ID provided for duplication');
    }

    console.log(`[Landed Cost] Starting duplication with MO for ${ids.length} record(s): [${ids.join(', ')}]`);

    const originalRecords = await this.odoo._callObject('stock.landed.cost', 'read', [
      ids,
      ['id', 'name', 'target_model', 'mrp_production_ids', 'company_id', 'state']
    ]);

    if (!originalRecords || originalRecords.length === 0) {
      throw new Error(`None of the requested Landed Cost records were found in Odoo: [${ids.join(', ')}]`);
    }

    const createdRecords = [];
    const errors = [];

    for (const record of originalRecords) {
      try {
        const mrpIds = record.mrp_production_ids || [];
        const defaultVals = {
          mrp_production_ids: [[6, 0, mrpIds]]
        };

        if (record.target_model) {
          defaultVals.target_model = record.target_model;
        }

        console.log(`[Landed Cost] Duplicating LC #${record.id} (${record.name}) with ${mrpIds.length} MOs...`);

        const rawNewId = await this.odoo._callObject('stock.landed.cost', 'copy', [
          record.id,
          defaultVals
        ]);

        const newId = Array.isArray(rawNewId) ? rawNewId[0] : rawNewId;

        const newRecInfo = await this.odoo._callObject('stock.landed.cost', 'read', [
          [newId],
          ['id', 'name', 'state', 'target_model', 'mrp_production_ids']
        ]);

        const newRec = newRecInfo && newRecInfo[0] ? newRecInfo[0] : { id: newId };
        console.log(`[Landed Cost] Successfully duplicated LC #${record.id} (${record.name}) -> New LC #${newId} (${newRec.name || 'New'}) with ${mrpIds.length} MO(s).`);

        createdRecords.push({
          originalId: record.id,
          originalName: record.name,
          newId: newId,
          newName: newRec.name,
          targetModel: newRec.target_model,
          state: newRec.state,
          mrpProductionIds: mrpIds,
          mrpProductionCount: mrpIds.length
        });
      } catch (err) {
        console.error(`[Landed Cost] Failed to duplicate LC #${record.id} (${record.name}): ${err.message}`);
        errors.push({
          id: record.id,
          name: record.name,
          error: err.message
        });
      }
    }

    return {
      success: createdRecords.length > 0,
      count: createdRecords.length,
      newRecordIds: createdRecords.map(r => r.newId),
      createdRecords,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Helper to post chatter notes on Landed Cost records
   */
  async postChatterNote(recordId, body) {
    return this.odoo._callObject('stock.landed.cost', 'message_post', [
      [Number(recordId)]
    ], {
      body,
      message_type: 'comment',
      subtype_xmlid: 'mail.mt_note'
    });
  }
}

export const landedCostService = new LandedCostService();
