import { adminOdooClient } from '../odoo/odooClient.js';

export class SOBypassService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

  async validateDelivery(pickingIds) {
    if (!pickingIds || pickingIds.length === 0) return [];
    const validatedPickings = [];

    // Batch read all pickings in ONE RPC call
    const pickings = await this.odoo._callObject('stock.picking', 'read', [pickingIds], {
      fields: ['id', 'name', 'state', 'move_ids']
    });

    const activePickings = [];
    for (const picking of pickings || []) {
      if (picking.state === 'done') {
        validatedPickings.push(picking.name);
      } else if (picking.state !== 'cancel') {
        activePickings.push(picking);
      }
    }

    if (activePickings.length === 0) {
      return validatedPickings;
    }

    // Batch read all moves across active pickings in ONE RPC call
    const allMoveIds = [...new Set(activePickings.flatMap((p) => p.move_ids || []))];
    const movesById = new Map();
    if (allMoveIds.length > 0) {
      const moves = await this.odoo._callObject('stock.move', 'read', [allMoveIds], {
        fields: ['id', 'product_uom_qty', 'quantity', 'picked']
      });
      for (const m of moves || []) {
        movesById.set(m.id, m);
      }
    }

    for (const picking of activePickings) {
      try {
        if (picking.state === 'draft') {
          await this.odoo._callObject('stock.picking', 'action_confirm', [[picking.id]]);
        }

        const pMoves = (picking.move_ids || [])
          .map((mid) => movesById.get(mid))
          .filter(Boolean);

        if (pMoves.length > 0) {
          const moveCommands = pMoves.map((m) => [
            1,
            m.id,
            { quantity: m.product_uom_qty, picked: true }
          ]);
          try {
            // Single One2many write per picking instead of N individual stock.move writes
            await this.odoo._callObject('stock.picking', 'write', [
              [picking.id],
              { move_ids: moveCommands }
            ]);
          } catch {
            for (const m of pMoves) {
              try {
                await this.odoo._callObject('stock.move', 'write', [[m.id], {
                  quantity: m.product_uom_qty,
                  picked: true
                }]);
              } catch {
                await this.odoo._callObject('stock.move', 'write', [[m.id], {
                  quantity_done: m.product_uom_qty
                }]);
              }
            }
          }
        }

        const validateRes = await this.odoo._callObject('stock.picking', 'button_validate', [[picking.id]], {
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
          } catch {
            await this.odoo._callObject('stock.backorder.confirmation', 'process', [[wizardId]]);
          }
        }

        validatedPickings.push(picking.name);
      } catch (err) {
        console.error(`[SO Bypass] Error validating picking ${picking.id}:`, err.message);
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
        } catch {}
      } catch {}

      const soRecords = await this.odoo._callObject('sale.order', 'read', [[soId]], {
        fields: ['name', 'invoice_ids']
      });

      const invoiceIds = soRecords && soRecords[0] ? soRecords[0].invoice_ids : [];
      if (!invoiceIds || invoiceIds.length === 0) return [];

      // Batch read all invoices in ONE RPC call
      const invList = await this.odoo._callObject('account.move', 'read', [invoiceIds], {
        fields: ['id', 'name', 'state']
      });

      const postedInvoices = [];
      let formattedDateStr = null;
      if (invoiceDate) {
        const d = new Date(invoiceDate);
        if (!isNaN(d.getTime())) {
          formattedDateStr = d.toISOString().split('T')[0];
        }
      }

      const draftIds = [];
      for (const inv of invList || []) {
        if (inv.state === 'draft' && forcePost) {
          draftIds.push(inv.id);
          postedInvoices.push(inv.name || `INV#${inv.id}`);
        } else if (inv.state === 'posted') {
          postedInvoices.push(inv.name);
        }
      }

      if (draftIds.length > 0) {
        try {
          if (formattedDateStr) {
            await this.odoo._callObject('account.move', 'write', [draftIds, { invoice_date: formattedDateStr }]);
          }
          await this.odoo._callObject('account.move', 'action_post', [draftIds]);
        } catch (invErr) {
          console.error(`[SO Bypass] Error posting invoices [${draftIds.join(', ')}]:`, invErr.message);
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
        reason: 'Skipped: PT. KANTI SEHATI SUKSES rule',
        soId,
        soName,
        companyName
      };
    }

    let pickingIds = so.picking_ids || [];
    if (so.state === 'draft' || so.state === 'sent') {
      await this.odoo._callObject('sale.order', 'action_confirm', [[soId]]);
      const refreshedSO = await this.odoo._callObject('sale.order', 'read', [[soId]], {
        fields: ['picking_ids']
      });
      if (refreshedSO && refreshedSO[0]) {
        pickingIds = refreshedSO[0].picking_ids || [];
      }
    }

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
