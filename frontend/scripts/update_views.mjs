import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

async function ensureRekapField() {
  const existing = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
    [['model_id', '=', 1877], ['name', '=', 'x_studio_estimasi_spb_rekap']]
  ], { fields: ['id', 'name', 'state', 'store'] });

  if (existing && existing.length > 0) {
    console.log('Field x_studio_estimasi_spb_rekap already exists:', existing[0]);
    return existing[0].id;
  }

  const fieldId = await adminOdooClient._callObject('ir.model.fields', 'create', [{
    model_id: 1877,
    name: 'x_studio_estimasi_spb_rekap',
    field_description: 'Total Estimasi SPB',
    ttype: 'float',
    state: 'manual',
    store: true
  }]);
  console.log('Created field x_studio_estimasi_spb_rekap with ID:', fieldId);
  return fieldId;
}

async function updateViews() {
  await adminOdooClient.authenticate();
  console.log('Authenticated UID:', adminOdooClient.uid);

  await ensureRekapField();

  // 1. Update Search View 4409
  const searchArch = `<search>
  <field name="x_name" string="MO / SPK"/>
  <field name="x_studio_spk_induk" string="SPK Induk"/>
  <field name="x_studio_sales_order" string="Sales Order"/>
  <field name="x_studio_warehouse" string="Warehouse"/>
  <filter invisible="1" string="My Activities" name="filter_activities_my" domain="[['activity_user_id', '=', uid]]"/>
  <separator/>
  <filter invisible="1" string="Late Activities" name="activities_overdue" domain="[('my_activity_date_deadline', '&lt;', 'today')]"/>
  <filter invisible="1" string="Today Activities" name="activities_today" domain="[('my_activity_date_deadline', '=', 'today')]"/>
  <filter invisible="1" string="Future Activities" name="activities_upcoming_all" domain="[('my_activity_date_deadline', '&gt;', 'today')]"/>
  <separator/>
  <filter date="x_studio_date" name="studio_filter_date" string="Date"/>
  <separator/>
  <filter string="Archived" name="archived_x_monitoring_wip_vendo" domain="[['x_active', '=', False]]"/>
  <separator/>
  <group>
    <filter string="SPK Induk (Group Backorder)" name="group_by_spk_induk" domain="[]" context="{'group_by': 'x_studio_spk_induk'}"/>
    <filter string="Sales Order" name="group_by_sales_order" domain="[]" context="{'group_by': 'x_studio_sales_order'}"/>
    <filter string="Warehouse / Vendor" name="group_by_warehouse" domain="[]" context="{'group_by': 'x_studio_warehouse'}"/>
    <filter string="Status Produksi" name="group_by_status_produksi" domain="[]" context="{'group_by': 'x_studio_status_produksi'}"/>
  </group>
</search>`;

  await adminOdooClient._callObject('ir.ui.view', 'write', [
    [4409],
    { arch: searchArch }
  ]);
  console.log('Successfully updated Search View 4409!');

  // 2. Update List View 4433
  const listArch = `<data>
  <xpath expr="/list//field[@name='x_studio_value']" position="replace"/>
  <xpath expr="/list//field[@name='x_studio_currency_id']" position="replace">
    <field name="x_studio_spk_induk" optional="show" string="SPK Induk"/>
    <field name="x_studio_start_spk" optional="show"/>
    <field name="x_studio_sales_order" optional="show"/>
    <field name="x_studio_qty_spk" optional="show" sum="Total SPK"/>
    <field name="x_studio_estimasi_spb_rekap" optional="show" string="Total Estimasi SPB" sum="Total Estimasi SPB"/>
    <field name="x_studio_qty_masuk_sfp" optional="show" sum="Total SFP"/>
    <field name="x_studio_persentase_susut" optional="show" string="% Susut" avg="Rata-rata Susut"/>
    <field name="x_studio_qty_kirim_a_grade" optional="show" sum="Total Kirim A"/>
    <field name="x_studio_qty_kirim_b_grade" optional="show" sum="Total Kirim B"/>
    <field name="x_studio_sisa_makloon_kg" optional="show" sum="Total BSKL (Kg)"/>
    <field name="x_studio_kain_dari_gudang_qty" optional="hide"/>
    <field name="x_studio_estimasi_dari_spb" optional="hide" string="Estimasi SPB (Baris)"/>
    <field name="x_studio_actual_cutting" optional="hide" sum="Total Cutting"/>
  </xpath>
</data>`;

  await adminOdooClient._callObject('ir.ui.view', 'write', [
    [4433],
    { arch: listArch }
  ]);
  console.log('Successfully updated List View 4433!');

  // 3. Ensure "Rekap Susut Vendor" Window Action & Menu Item remain configured
  const existingActions = await adminOdooClient._callObject('ir.actions.act_window', 'search_read', [
    [['name', '=', 'Rekap Susut Vendor'], ['res_model', '=', 'x_monitoring_wip_vendo']]
  ], { fields: ['id', 'name'] });

  let actionId;
  if (existingActions && existingActions.length > 0) {
    actionId = existingActions[0].id;
    await adminOdooClient._callObject('ir.actions.act_window', 'write', [
      [actionId],
      {
        context: "{'search_default_group_by_spk_induk': 1}",
        view_mode: 'list,form,pivot,graph'
      }
    ]);
    console.log(`Updated existing action ${actionId}`);
  } else {
    actionId = await adminOdooClient._callObject('ir.actions.act_window', 'create', [{
      name: 'Rekap Susut Vendor',
      res_model: 'x_monitoring_wip_vendo',
      view_mode: 'list,form,pivot,graph',
      context: "{'search_default_group_by_spk_induk': 1}"
    }]);
    console.log(`Created new action ${actionId}`);
  }

  const existingMenus = await adminOdooClient._callObject('ir.ui.menu', 'search_read', [
    [['parent_id', '=', 686], ['name', '=', 'Rekap Susut Vendor']]
  ], { fields: ['id', 'name'] });

  if (existingMenus && existingMenus.length > 0) {
    await adminOdooClient._callObject('ir.ui.menu', 'write', [
      [existingMenus[0].id],
      {
        action: `ir.actions.act_window,${actionId}`,
        sequence: 14
      }
    ]);
    console.log(`Updated menu ${existingMenus[0].id}`);
  } else {
    const menuId = await adminOdooClient._callObject('ir.ui.menu', 'create', [{
      name: 'Rekap Susut Vendor',
      parent_id: 686,
      action: `ir.actions.act_window,${actionId}`,
      sequence: 14
    }]);
    console.log(`Created menu ${menuId} under Vendoran!`);
  }
}

updateViews().catch(err => {
  console.error('Error updating views:', err);
  process.exit(1);
});
