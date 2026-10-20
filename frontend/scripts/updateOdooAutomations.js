import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const action833Code = `# Compute Sales Order on mrp.production
for mo in (records or [record]):
    if mo.x_studio_sales_order:
        continue
    so = False
    # 1. sale_line_id
    if mo.sale_line_id and mo.sale_line_id.order_id:
        so = mo.sale_line_id.order_id
    # 2. direct or comma origin
    if not so and mo.origin:
        clean_orig = mo.origin.strip()
        so = env['sale.order'].search([('name', '=', clean_orig), ('state', '!=', 'cancel')], limit=1)
        if not so and ',' in clean_orig:
            for part in clean_orig.split(','):
                part = part.strip()
                so = env['sale.order'].search([('name', '=', part), ('state', '!=', 'cancel')], limit=1)
                if so:
                    break
        # 3. parent MO in origin (Turunan Grade B, Sisa Makloon, Pecahan)
        if not so and '/MO/' in clean_orig:
            for tok in clean_orig.split():
                if '/MO/' in tok:
                    parent_mo = env['mrp.production'].search([('name', '=', tok.strip())], limit=1)
                    if parent_mo and parent_mo.x_studio_sales_order:
                        so = parent_mo.x_studio_sales_order
                        break
                    elif parent_mo and parent_mo.sale_line_id and parent_mo.sale_line_id.order_id:
                        so = parent_mo.sale_line_id.order_id
                        break
                    elif parent_mo and parent_mo.origin:
                        so = env['sale.order'].search([('name', '=', parent_mo.origin.strip()), ('state', '!=', 'cancel')], limit=1)
                        if so:
                            break
    # 4. backorder sibling base prefix
    if not so and '-' in (mo.name or ''):
        base_prefix = mo.name.rsplit('-', 1)[0]
        sibling = env['mrp.production'].search([
            ('name', '=like', base_prefix + '%'),
            ('x_studio_sales_order', '!=', False)
        ], limit=1)
        if sibling and sibling.x_studio_sales_order:
            so = sibling.x_studio_sales_order
    # 5. x_studio_origin_mo
    if not so and mo.x_studio_origin_mo:
        orig_mo = env['mrp.production'].search([('name', '=', mo.x_studio_origin_mo.strip())], limit=1)
        if orig_mo and orig_mo.x_studio_sales_order:
            so = orig_mo.x_studio_sales_order
    if so:
        mo.write({'x_studio_sales_order': so.id})
`;

async function updateAutomations() {
  console.log('1. Updating Action #833 (Compute Sales Order on mrp.production)...');
  await adminOdooClient._callObject('ir.actions.server', 'write', [
    [833],
    {
      state: 'code',
      code: action833Code
    }
  ]);
  console.log('Action #833 updated to state="code" successfully!');

  console.log('2. Updating Automation #1 (No. Sales Order di MO)...');
  await adminOdooClient._callObject('base.automation', 'write', [
    [1],
    {
      filter_domain: '[("x_studio_sales_order", "=", False)]'
    }
  ]);
  console.log('Automation #1 filter_domain updated successfully!');

  console.log('3. Updating Automation #32 ([Custom] MO Reference in Transfer)...');
  // Trigger whenever manufacturing order or sales order is empty
  const auto32Domain = '["|", ("x_studio_manufacturing_order", "=", False), ("x_studio_sales_order", "=", False)]';
  await adminOdooClient._callObject('base.automation', 'write', [
    [32],
    {
      filter_domain: auto32Domain
    }
  ]);
  console.log('Automation #32 filter_domain updated successfully!');
}

updateAutomations().catch(console.error);
