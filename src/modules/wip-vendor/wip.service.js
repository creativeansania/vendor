import { adminOdooClient } from '../../core/odoo/odooClient.js';
import { logger } from '../../utils/logger.js';

export class WipVendorService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

  /**
   * Triggered when Manufacturing Order is Confirmed
   * Creates record in x_monitoring_wip_vendo if not already exists
   */
  async onMoConfirmed(moId) {
    logger.info(`[WIP Service] Handling MO Confirmed for MO ID #${moId}...`);
    // Placeholder - will be implemented during WIP automation logic migration
    return { success: true, moId };
  }

  /**
   * Triggered when Transfer (/PC/, /SPB/, /SFP/) is Done
   * Recalculates material consumption, roll details, SFP receiving, and vendor pricing
   */
  async onTransferDone(pickingId) {
    logger.info(`[WIP Service] Handling Transfer Done for picking ID #${pickingId}...`);
    // Placeholder - will be implemented during WIP automation logic migration
    return { success: true, pickingId };
  }

  /**
   * Updates production results (Grade A, Grade B, Sisa Makloon)
   * Callable from Odoo form or future Vendor PWA
   */
  async submitProductionResult({ wipId, qtyGradeA, qtyGradeB, sisaMakloonKg }) {
    logger.info(`[WIP Service] Updating production result for WIP #${wipId}: GradeA=${qtyGradeA}, GradeB=${qtyGradeB}, Sisa=${sisaMakloonKg}`);
    // Placeholder - will be implemented during WIP automation logic migration
    return { success: true, wipId };
  }
}

export const wipVendorService = new WipVendorService();
