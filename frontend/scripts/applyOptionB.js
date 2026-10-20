import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

async function applyOptionB() {
  console.log('=== APPLYING OPTION B (NO CODE IN ODOO) ===\n');

  // 1. Revert Action #833 to standard object_write equation
  console.log('1. Setting Action #833 to standard object_write equation...');
  const equation = "record.sale_line_id.order_id or (record.origin and env['sale.order'].search([('name', '=', record.origin)], limit=1) or False)";
  await adminOdooClient._callObject('ir.actions.server', 'write', [
    [833],
    {
      state: 'object_write',
      update_field_id: 13766,
      update_path: 'x_studio_sales_order',
      evaluation_type: 'equation',
      value: equation,
      code: false
    }
  ]);
  console.log('Action #833 successfully updated to object_write (Studio Equation)!');

  // 2. Set Automation #1 filter_domain
  // Runs whenever x_studio_sales_order is False, so Odoo natively fills standard SOs
  console.log('2. Setting Automation #1 filter_domain...');
  await adminOdooClient._callObject('base.automation', 'write', [
    [1],
    {
      filter_domain: '[("x_studio_sales_order", "=", False)]'
    }
  ]);
  console.log('Automation #1 filter_domain set to [("x_studio_sales_order", "=", False)]!');

  // 3. Set Automation #32 (Transfer MO Reference)
  // Keeps type=webhook (Action #1384), and triggers when either MO or SO is empty
  console.log('3. Setting Automation #32 filter_domain...');
  const auto32Domain = '["|", ("x_studio_manufacturing_order", "=", False), ("x_studio_sales_order", "=", False)]';
  await adminOdooClient._callObject('base.automation', 'write', [
    [32],
    {
      filter_domain: auto32Domain
    }
  ]);
  console.log('Automation #32 filter_domain set!');

  // 4. Verify in Odoo
  const [a833] = await adminOdooClient._callObject('ir.actions.server', 'read', [
    [833],
    ['id', 'name', 'state', 'evaluation_type', 'value', 'code', 'update_field_id', 'update_path']
  ]);
  console.log('\nVerified Action 833 in Odoo:\n', JSON.stringify(a833, null, 2));

  const [auto1] = await adminOdooClient._callObject('base.automation', 'read', [
    [1],
    ['id', 'name', 'trigger', 'filter_domain', 'action_server_ids']
  ]);
  console.log('\nVerified Automation 1 in Odoo:\n', JSON.stringify(auto1, null, 2));

  const [auto32] = await adminOdooClient._callObject('base.automation', 'read', [
    [32],
    ['id', 'name', 'trigger', 'filter_domain', 'action_server_ids']
  ]);
  console.log('\nVerified Automation 32 in Odoo:\n', JSON.stringify(auto32, null, 2));

  console.log('\n=== OPTION B APPLIED SUCCESSFULLY ===');
}

applyOptionB().catch(console.error);
