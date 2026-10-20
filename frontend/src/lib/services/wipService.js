/**
 * WipService Facade
 * 
 * Provides a unified, backward-compatible entry point for WIP domain services:
 * - wipQueryService: Orders list, metrics, order details, BOM moves, transfers
 * - wipCuttingService: Roll lines submissions, physical weight updates, Odoo stock moves sync
 * - wipProductionService: Production results, Grade B MO creation, BSKL transfers, stage unlocking
 * - wipSyncService: Live Odoo pulls, event-driven webhooks (MO confirmed, transfer done, pricing)
 */

import { withWipLock } from './wip/wipLock.js';
import * as queryService from './wip/wipQueryService.js';
import * as cuttingService from './wip/wipCuttingService.js';
import * as productionService from './wip/wipProductionService.js';
import * as syncService from './wip/wipSyncService.js';

export class WipService {
  constructor() {
    this._locks = new Map();
  }

  /**
   * Concurrency control lock per key
   */
  async _withLock(key, fn) {
    return withWipLock(key, fn);
  }

  // --- Query & Metric Services ---

  async getOrders(params) {
    return queryService.getOrders(params);
  }

  async _getMetrics(user, vendorId) {
    return queryService.getMetrics(user, vendorId);
  }

  async getOrderDetails(params) {
    return queryService.getOrderDetails(params);
  }

  async _fetchOrderRawMoves(order) {
    return queryService.fetchOrderRawMoves(order);
  }

  async _fetchOrderTransfers(order) {
    return queryService.fetchOrderTransfers(order);
  }

  // --- Cutting Services ---

  async submitCuttingRolls(params) {
    return cuttingService.submitCuttingRolls(params);
  }

  async _syncCuttingToOdoo(orderOrWipId, rollUpdates, actualCutting) {
    return cuttingService.syncCuttingToOdoo(orderOrWipId, rollUpdates, actualCutting);
  }

  // --- Production & Stage Services ---

  async submitProductionResult(params) {
    return productionService.submitProductionResult(params);
  }

  async _syncProductionToOdoo(orderOrWipId, aGrade, bGrade, sisaKg, categories) {
    return productionService.syncProductionToOdoo(orderOrWipId, aGrade, bGrade, sisaKg, categories);
  }

  async unlockOrder(params) {
    return productionService.unlockOrder(params);
  }

  // --- Sync & ERP Webhook Services ---

  async syncOrderFromOdoo(params) {
    return syncService.syncOrderFromOdoo(params);
  }

  async syncAllFromOdoo() {
    return syncService.syncAllFromOdoo();
  }

  async onMoConfirmed(moId, options) {
    return syncService.onMoConfirmed(moId, options);
  }

  async ensureDedicatedComponentPickings(moId) {
    return syncService.ensureDedicatedComponentPickings(moId);
  }

  async onTransferDone(pickingId) {
    return syncService.onTransferDone(pickingId);
  }

  async _syncWipFromPickings(wipId, moId) {
    return syncService.syncWipFromPickings(wipId, moId);
  }

  async fetchVendorPriceFromOdoo(warehouseId, productId, workcenterIds) {
    return syncService.fetchVendorPriceFromOdoo(warehouseId, productId, workcenterIds);
  }

  async onVendorPriceUpdated(vendorPriceId) {
    return syncService.onVendorPriceUpdated(vendorPriceId);
  }
}

export const wipService = new WipService();
