import { adminOdooClient } from '../odoo/odooClient.js';

export class SOBypassService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

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
              await this.odoo._callObject('stock.move', 'write', [[m.id], {
                quantity_done: m.product_uom_qty
              }]);
            }
          }
        }

        const validateRes = await this.odoo._callObject('stock.picking', 'button_validate', [[pickingId]], {
          context: {
            skip_backorder: true,
            skip_immediate: true,
            skip_sms: true
          }
        });

        if (validateRes && typeof validateRes === 'object' && validateRes.res_model === 'stock.backorder.confirmation') {
          const wizardId = validateRes.res_id;
          try {
            await this.odoo._callObject('stock.backorder.confirmation', 'process_cancel_backorder', [[wizardId]], {
              context: { skip_backorder: true }
            });
          } catch (wizErr) {
            await this.odoo._callObject('stock.backorder.confirmation', 'process', [[wizardId]]);
          }
        }

        validatedPickings.push(picking.name);
      } catch (err) {
        console.error(`[SO Bypass] Error validating picking ${pickingId}:`, err.message);
      }
    }

    return validatedPickings;
  }

  async createAndPostInvoice(soId, invoiceDate, forcePost = true) {
    try {
      try {
        const wizardId = await this.odoo._callObject('sale.advance.payment.inv', 'create', [{
          sale_order_ids: [[6, 0, [soId]]]
        }]);
        try {
          await this.odoo._callObject('sale.advance.payment.inv', 'create_invoices', [[wizardId]]);
        } catch (wizErr) {}
      } catch (wizardCreateErr) {}

      const soRecords = await this.odoo._callObject('sale.order', 'read', [[soId]], {
        fields: ['name', 'invoice_ids']
      });

      const invoiceIds = soRecords && soRecords[0] ? soRecords[0].invoice_ids : [];
      if (!invoiceIds || invoiceIds.length === 0) return [];

      const postedInvoices = [];

      for (const invId of invoiceIds) {
        try {
          const invList = await this.odoo._callObject('account.move', 'read', [[invId]], {
            fields: ['id', 'name', 'state']
          });

          if (!invList || invList.length === 0) continue;
          const inv = invList[0];

          if (inv.state === 'draft' && forcePost) {
            if (invoiceDate) {
              const d = new Date(invoiceDate);
              if (!isNaN(d.getTime())) {
                const dateStr = d.toISOString().split('T')[0];
                await this.odoo._callObject('account.move', 'write', [[invId], { invoice_date: dateStr }]);
              }
            }

            await this.odoo._callObject('account.move', 'action_post', [[invId]]);
            postedInvoices.push(inv.name || `INV#${invId}`);
          } else if (inv.state === 'posted') {
            postedInvoices.push(inv.name);
          }
        } catch (invErr) {
          console.error(`[SO Bypass] Error posting invoice ${invId}:`, invErr.message);
        }
      }

      return postedInvoices;
    } catch (error) {
      console.error(`[SO Bypass] createAndPostInvoice error for SO #${soId}:`, error.message);
      return [];
    }
  }

  async processSOBypass(soIdOrName) {
    if (!soIdOrName) throw new Error('Missing Sales Order ID or Name');

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
      return { success: false, notFound: true, message: `SO not found: ${soIdOrName}` };
    }

    const so = soRecords[0];
    const soId = so.id;
    const soName = so.name;
    const companyName = so.company_id ? so.company_id[1] : '';

    const isExcludedCompany = companyName && companyName.toUpperCase().includes('KANTI SEHATI SUKSES');
    if (isExcludedCompany) {
      return {
        success: true,
        skipped: true,
        reason: `Skipped: PT. KANTI SEHATI SUKSES rule`,
        soId,
        soName,
        companyName
      };
    }

    if (so.state === 'draft' || so.state === 'sent') {
      await this.odoo._callObject('sale.order', 'action_confirm', [[soId]]);
    }

    const refreshedSO = await this.odoo._callObject('sale.order', 'read', [[soId]], {
      fields: ['picking_ids', 'invoice_ids']
    });
    const pickingIds = refreshedSO && refreshedSO[0] ? refreshedSO[0].picking_ids : (so.picking_ids || []);

    let pickings = [];
    if (pickingIds && pickingIds.length > 0) {
      pickings = await this.validateDelivery(pickingIds);
    }

    const invoices = await this.createAndPostInvoice(soId, so.date_order, true);

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
