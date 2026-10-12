/**
 * Backward-Compatibility Facade
 * All core XML-RPC methods now live in src/core/odoo/odooClient.js
 * Domain logic lives in src/modules/{jubelio, so-bypass, transfer, landed-cost, notification-wa, wip-vendor}
 */
import { defaultOdooClient, adminOdooClient } from '../core/odoo/odooClient.js';
import { jubelioService } from '../modules/jubelio/jubelio.service.js';
import { soBypassService } from '../modules/so-bypass/soBypass.service.js';
import { landedCostService } from '../modules/landed-cost/landedCost.service.js';
import { transferService } from '../modules/transfer/transfer.service.js';

class OdooServiceFacade {
  constructor(client) {
    this.client = client;
  }

  // Core properties & methods
  get uid() { return this.client.uid; }
  set uid(v) { this.client.uid = v; }
  get companyId() { return this.client.companyId; }
  set companyId(v) { this.client.companyId = v; }
  get allowedCompanyIds() { return this.client.allowedCompanyIds; }
  set allowedCompanyIds(v) { this.client.allowedCompanyIds = v; }

  async _callCommon(method, params) { return this.client._callCommon(method, params); }
  async _callObject(model, method, args, kwargs = {}) { return this.client._callObject(model, method, args, kwargs); }
  async executeKw(model, method, args, kwargs = {}) { return this.client.executeKw(model, method, args, kwargs); }
  async authenticate() { return this.client.authenticate(); }
  async getCompanyId(companyName) { return this.client.getCompanyId(companyName); }
  async getWarehouseId(warehouseName, companyId) { return this.client.getWarehouseId(warehouseName, companyId); }
  async getWebSessionCookie() { return this.client.getWebSessionCookie(); }
  async getDocumentDetails(model, recordId) { return this.client.getDocumentDetails(model, recordId); }
  async downloadDocumentPdf(model, recordId, customReportName) { return this.client.downloadDocumentPdf(model, recordId, customReportName); }
  async getOrCreatePublicAttachment(model, recordId, buffer, filename) { return this.client.getOrCreatePublicAttachment(model, recordId, buffer, filename); }

  // Jubelio Domain Methods
  async findProductBySKU(sku) { return jubelioService.findProductBySKU(sku); }
  async findOrCreatePartner(customerInfo, companyId) { return jubelioService.findOrCreatePartner(customerInfo, companyId); }
  async checkExistingSalesOrder(ref, companyId) { return jubelioService.checkExistingSalesOrder(ref, companyId); }
  async createSalesOrder(args) { return jubelioService.createSalesOrder(args); }

  // SO Bypass Domain Methods
  async validateDelivery(pickingIds) { return soBypassService.validateDelivery(pickingIds); }
  async createAndPostInvoice(soId, invoiceDate, forcePost) { return soBypassService.createAndPostInvoice(soId, invoiceDate, forcePost); }
  async processSOBypass(soIdOrName) { return soBypassService.processSOBypass(soIdOrName); }

  // Landed Cost Domain Methods
  async duplicateLandedCostWithMO(landedCostIds) { return landedCostService.duplicateLandedCostWithMO(landedCostIds); }

  // Transfer Domain Methods
  async resolveTransferMoAndSo(pickingIds) { return transferService.resolveTransferMoAndSo(pickingIds); }
}

export const odooService = new OdooServiceFacade(defaultOdooClient);
export const odooAdminService = new OdooServiceFacade(adminOdooClient);
export const odooBypassService = odooAdminService;
