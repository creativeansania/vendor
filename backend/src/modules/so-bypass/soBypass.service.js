import { adminOdooClient } from '../../core/odoo/odooClient.js';
import { config } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export class SOBypassService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

  /**
   * Automatically validates stock pickings (Delivery Orders) linked to confirmed Sales Order
   */
  async validateDelivery(pickingIds) {
    if (!pickingIds || pickingIds.length === 0) return [];

    const validatedPickings = [];

    for (const pickingId of pickingIds) {
      try {
        const pickings = await this.odoo._callObject('stock.picking', 'read', [[pickingId]], {
          fields: ['id', 'name', 'state', 'move_ids']
        });

        if (!pickings || pickings.length === 0) continue;
        const picking = pickings[0];

        if (picking.state === 'done') {
          logger.info(`Picking ${picking.name} (ID: ${pickingId}) is already in "done" state.`);
          validatedPickings.push(picking.name);
          continue;
        }

        if (picking.state === 'draft') {
          await this.odoo._callObject('stock.picking', 'action_confirm', [[pickingId]]);
        }

        if (picking.move_ids && picking.move_ids.length > 0) {
          const moves = await this.odoo._callObject('stock.move', 'read', [picking.move_ids], {
            fields: ['id', 'product_uom_qty', 'quantity', 'picked']
          });

          for (const m of moves) {
            try {
              await this.odoo._callObject('stock.move', 'write', [[m.id], {
                quantity: m.product_uom_qty,
                picked: true
              }]);
            } catch (moveErr) {
              logger.debug(`Could not write quantity on stock.move ${m.id}, trying quantity_done fallback: ${moveErr.message}`);
              await this.odoo._callObject('stock.move', 'write', [[m.id], {
                quantity_done: m.product_uom_qty
              }]);
            }
          }
        }

        logger.info(`Validating Delivery Order ${picking.name} (ID: ${pickingId})...`);
        const validateRes = await this.odoo._callObject('stock.picking', 'button_validate', [[pickingId]], {
          context: {
            skip_backorder: true,
            skip_immediate: true,
            skip_sms: true
          }
        });

        if (validateRes && typeof validateRes === 'object' && validateRes.res_model === 'stock.backorder.confirmation') {
          const wizardId = validateRes.res_id;
          logger.info(`Handling backorder confirmation wizard for picking ${picking.name} (Wizard ID: ${wizardId})...`);
          try {
            await this.odoo._callObject('stock.backorder.confirmation', 'process_cancel_backorder', [[wizardId]], {
              context: { skip_backorder: true }
            });
          } catch (wizErr) {
            logger.warn(`process_cancel_backorder failed: ${wizErr.message}. Calling process()...`);
            await this.odoo._callObject('stock.backorder.confirmation', 'process', [[wizardId]]);
          }
        }

        logger.info(`Successfully validated Delivery Order ${picking.name} (Status: DONE).`);
        validatedPickings.push(picking.name);
      } catch (err) {
        logger.error(`Error validating delivery picking ID ${pickingId}`, err.message);
      }
    }

    return validatedPickings;
  }

  /**
   * Automatically creates customer invoice from confirmed Sales Order and posts it
   */
  async createAndPostInvoice(soId, invoiceDate, forcePost = false) {
    try {
      logger.info(`Creating customer invoice for Sales Order ID ${soId}...`);

      try {
        const wizardId = await this.odoo._callObject('sale.advance.payment.inv', 'create', [{
          sale_order_ids: [[6, 0, [soId]]]
        }]);
        try {
          await this.odoo._callObject('sale.advance.payment.inv', 'create_invoices', [[wizardId]]);
        } catch (wizErr) {
          logger.debug('Wizard create_invoices response handled:', wizErr.message);
        }
      } catch (wizardCreateErr) {
        logger.warn(`Could not create invoice via wizard: ${wizardCreateErr.message}`);
      }

      const soRecords = await this.odoo._callObject('sale.order', 'read', [[soId]], {
        fields: ['name', 'invoice_ids']
      });

      const invoiceIds = soRecords && soRecords[0] ? soRecords[0].invoice_ids : [];
      if (!invoiceIds || invoiceIds.length === 0) {
        logger.warn(`No invoice found for Sales Order ID ${soId}.`);
        return [];
      }

      const postedInvoices = [];

      for (const invId of invoiceIds) {
        try {
          const invList = await this.odoo._callObject('account.move', 'read', [[invId]], {
            fields: ['id', 'name', 'state']
          });

          if (!invList || invList.length === 0) continue;
          const inv = invList[0];

          if (inv.state === 'draft' && (forcePost || config.settings.autoPostInvoice)) {
            if (invoiceDate) {
              const d = new Date(invoiceDate);
              if (!isNaN(d.getTime())) {
                const dateStr = d.toISOString().split('T')[0];
                await this.odoo._callObject('account.move', 'write', [[invId], {
                  invoice_date: dateStr
                }]);
              }
            }

            logger.info(`Posting Customer Invoice ID ${invId}...`);
            await this.odoo._callObject('account.move', 'action_post', [[invId]]);

            const postedInv = await this.odoo._callObject('account.move', 'read', [[invId]], {
              fields: ['name', 'state', 'payment_state']
            });
            const invName = postedInv && postedInv[0] ? postedInv[0].name : `INV#${invId}`;
            logger.info(`Successfully posted Customer Invoice ${invName} (ID: ${invId}, State: POSTED).`);
            postedInvoices.push(invName);
          } else if (inv.state === 'posted') {
            postedInvoices.push(inv.name);
          }
        } catch (invErr) {
          logger.error(`Error posting invoice ID ${invId}`, invErr.message);
        }
      }

      return postedInvoices;
    } catch (error) {
      logger.error(`Error in createAndPostInvoice for SO ID ${soId}`, error);
      return [];
    }
  }

  /**
   * Process bypass of delivery and invoice for a Sales Order confirmed in Odoo.
   * Excludes company "PT. KANTI SEHATI SUKSES".
   */
  async processSOBypass(soIdOrName) {
    if (!soIdOrName) {
      throw new Error('Missing Sales Order ID or Name');
    }

    logger.info(`[Odoo SO Bypass] Processing Sales Order identifier: ${soIdOrName}...`);

    let soRecords = [];
    const isNumeric = !isNaN(soIdOrName) && !isNaN(parseFloat(soIdOrName));

    if (isNumeric) {
      soRecords = await this.odoo._callObject('sale.order', 'read', [[parseInt(soIdOrName, 10)]], {
        fields: ['id', 'name', 'state', 'company_id', 'picking_ids', 'invoice_ids', 'date_order']
      });
    } else {
      soRecords = await this.odoo._callObject('sale.order', 'search_read', [
        [['name', '=', String(soIdOrName).trim()]]
      ], {
        fields: ['id', 'name', 'state', 'company_id', 'picking_ids', 'invoice_ids', 'date_order'],
        limit: 1
      });
    }

    if (!soRecords || soRecords.length === 0) {
      const msg = `[Odoo SO Bypass] Sales Order not found for identifier: "${soIdOrName}"`;
      logger.warn(msg);
      return { success: false, notFound: true, message: msg };
    }

    const so = soRecords[0];
    const soId = so.id;
    const soName = so.name;
    const companyId = so.company_id ? so.company_id[0] : null;
    const companyName = so.company_id ? so.company_id[1] : '';

    logger.info(`[Odoo SO Bypass] Found Sales Order: ${soName} (ID: ${soId}, State: ${so.state}, Company: "${companyName}")`);

    // Hardcoded check: Skip if company is PT. KANTI SEHATI SUKSES
    const isExcludedCompany = companyName && companyName.toUpperCase().includes('KANTI SEHATI SUKSES');
    if (isExcludedCompany) {
      const skipMsg = `[Odoo SO Bypass] Skipped Sales Order ${soName} because company "${companyName}" matches exclusion rule (PT. KANTI SEHATI SUKSES).`;
      logger.info(skipMsg);
      return {
        success: true,
        skipped: true,
        reason: skipMsg,
        soId,
        soName,
        companyName
      };
    }

    // 1. Confirm SO if it's still in draft or sent state
    if (so.state === 'draft' || so.state === 'sent') {
      logger.info(`[Odoo SO Bypass] Confirming Sales Order ${soName} (ID: ${soId})...`);
      await this.odoo._callObject('sale.order', 'action_confirm', [[soId]]);
      logger.info(`[Odoo SO Bypass] Sales Order ${soName} confirmed.`);
    }

    // 2. Fetch fresh picking_ids from SO
    const refreshedSO = await this.odoo._callObject('sale.order', 'read', [[soId]], {
      fields: ['picking_ids', 'invoice_ids']
    });
    const pickingIds = refreshedSO && refreshedSO[0] ? refreshedSO[0].picking_ids : (so.picking_ids || []);

    // 3. Bypass Delivery (force done, allow negative stock)
    let pickings = [];
    if (pickingIds && pickingIds.length > 0) {
      logger.info(`[Odoo SO Bypass] Validating ${pickingIds.length} delivery picking(s) for ${soName}...`);
      pickings = await this.validateDelivery(pickingIds);
    } else {
      logger.info(`[Odoo SO Bypass] No delivery pickings linked to ${soName}.`);
    }

    // 4. Bypass Invoice (create if not exists & post it)
    logger.info(`[Odoo SO Bypass] Creating/Posting invoice for ${soName}...`);
    const invoices = await this.createAndPostInvoice(soId, so.date_order, true);

    logger.info(`[Odoo SO Bypass] Finished processing ${soName}: Delivery=[${pickings.join(', ')}], Invoices=[${invoices.join(', ')}]`);

    return {
      success: true,
      soId,
      soName,
      companyName,
      pickings,
      invoices
    };
  }
}

export const soBypassService = new SOBypassService();
