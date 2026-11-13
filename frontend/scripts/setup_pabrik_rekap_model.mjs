import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const MODEL = 'x_rekap_susut_pabrik';
const MODEL_NAME = 'Rekap Susut Pabrik';

const DESIRED_FIELDS = [
  { name: 'x_studio_approval_request', field_description: 'Approval Request', ttype: 'many2one', relation: 'approval.request' },
  { name: 'x_studio_approval_name', field_description: 'No Approval', ttype: 'char' },
  { name: 'x_studio_tanggal_approval', field_description: 'Tanggal Approval', ttype: 'datetime' },
  { name: 'x_studio_date_confirmed', field_description: 'Date Confirmed', ttype: 'datetime' },
  { name: 'x_studio_pabrik', field_description: 'Pabrik', ttype: 'many2one', relation: 'stock.warehouse' },
  { name: 'x_studio_pabrik_name', field_description: 'Nama Pabrik', ttype: 'char' },
  { name: 'x_studio_manufacturing_order', field_description: 'Manufacturing Order', ttype: 'char' },
  { name: 'x_studio_sales_order', field_description: 'Sales Order', ttype: 'many2one', relation: 'sale.order' },
  { name: 'x_studio_sales_order_name', field_description: 'Nama Sales Order', ttype: 'char' },
  { name: 'x_studio_so_ids', field_description: 'Daftar Sales Order', ttype: 'many2many', relation: 'sale.order' },
  { name: 'x_studio_daftar_mo', field_description: 'Daftar MO', ttype: 'text' },
  { name: 'x_studio_mo_ids', field_description: 'Daftar MO', ttype: 'many2many', relation: 'mrp.production' },
  { name: 'x_studio_jenis_kain', field_description: 'Jenis Kain', ttype: 'char' },
  { name: 'x_studio_warna', field_description: 'Warna', ttype: 'char' },
  { name: 'x_studio_consumption_grey_yd', field_description: 'Consumed Grey (Yd)', ttype: 'float' },
  { name: 'x_studio_qty_grade_a', field_description: 'Grade A (Yd)', ttype: 'float' },
  { name: 'x_studio_qty_grade_b', field_description: 'Grade B (Yd)', ttype: 'float' },
  { name: 'x_studio_qty_grade_c', field_description: 'Grade C (Yd)', ttype: 'float' },
  { name: 'x_studio_qty_bs', field_description: 'BS (Yd)', ttype: 'float' },
  { name: 'x_studio_total_finish', field_description: 'Total Finish (Yd)', ttype: 'float' },
  { name: 'x_studio_persentase_susut_approval', field_description: '% Susut Total Approval', ttype: 'float' },
  { name: 'x_studio_persentase_susut_celup', field_description: '% Susut Celup', ttype: 'float' },
  { name: 'x_studio_persentase_susut_b_c', field_description: '% Susut B+C', ttype: 'float' },
  { name: 'x_studio_persentase_susut_bs', field_description: '% Susut BS', ttype: 'float' },
  { name: 'x_studio_susut_approval_display', field_description: '% Susut Total Approval', ttype: 'char' },
  { name: 'x_studio_susut_celup_display', field_description: '% Susut Celup', ttype: 'char' },
  { name: 'x_studio_susut_bc_display', field_description: '% Susut B+C', ttype: 'char' },
  { name: 'x_studio_susut_bs_display', field_description: '% Susut BS', ttype: 'char' },
  { name: 'x_studio_mo_count', field_description: 'Jumlah MO', ttype: 'integer' },
  { name: 'x_studio_status', field_description: 'Status', ttype: 'char' }
];

async function main() {
  await adminOdooClient.authenticate();

  // 1. Get or create model
  let models = await adminOdooClient._callObject('ir.model', 'search_read', [
    [['model', '=', MODEL]]
  ], { fields: ['id', 'model', 'name'] });

  let modelId;
  if (!models || models.length === 0) {
    modelId = await adminOdooClient._callObject('ir.model', 'create', [{
      model: MODEL,
      name: MODEL_NAME,
      state: 'manual'
    }]);
    console.log(`Created model ${MODEL} (ID: ${modelId})`);
  } else {
    modelId = models[0].id;
    console.log(`Found model ${MODEL} (ID: ${modelId})`);
  }

  // 2. Ensure model access
  const existingAcc = await adminOdooClient._callObject('ir.model.access', 'search_read', [
    [['model_id', '=', modelId]]
  ], { fields: ['id', 'name', 'group_id'] });

  if (!existingAcc || existingAcc.length === 0) {
    await adminOdooClient._callObject('ir.model.access', 'create', [{
      name: `${MODEL}_user`,
      model_id: modelId,
      group_id: 1, // Internal User
      perm_read: true,
      perm_write: true,
      perm_create: true,
      perm_unlink: false
    }]);
    await adminOdooClient._callObject('ir.model.access', 'create', [{
      name: `${MODEL}_admin`,
      model_id: modelId,
      group_id: 4, // Role / Administrator
      perm_read: true,
      perm_write: true,
      perm_create: true,
      perm_unlink: true
    }]);
    console.log('Created access rights for Internal Users and Admins');
  } else {
    console.log(`Access rights exist: ${existingAcc.length} rule(s)`);
  }

  // 3. Create or update fields
  const existingFields = await adminOdooClient._callObject('ir.model.fields', 'search_read', [
    [['model_id', '=', modelId]]
  ], { fields: ['id', 'name', 'field_description', 'ttype'] });
  const existingFieldMap = new Map(existingFields.map((f) => [f.name, f]));

  for (const f of DESIRED_FIELDS) {
    if (!existingFieldMap.has(f.name)) {
      const payload = {
        model_id: modelId,
        name: f.name,
        field_description: f.field_description,
        ttype: f.ttype,
        state: 'manual',
        store: true
      };
      if (f.relation) payload.relation = f.relation;
      const createdFid = await adminOdooClient._callObject('ir.model.fields', 'create', [payload]);
      console.log(`Created field ${f.name} (ID: ${createdFid})`);
    } else {
      console.log(`Field ${f.name} already exists (ID: ${existingFieldMap.get(f.name).id})`);
    }
  }

  // 4. Create List and Form Views
  const LIST_ARCH = `<list string="Rekap Susut Pabrik" decoration-danger="x_studio_persentase_susut_celup &gt; 10" decoration-warning="x_studio_persentase_susut_b_c &gt; 2">
  <field name="x_name" string="Kode Rekap" optional="hide"/>
  <field name="x_studio_approval_request" string="Approval Request" optional="show"/>
  <field name="x_studio_tanggal_approval" string="Tanggal Approval" optional="show"/>
  <field name="x_studio_date_confirmed" string="Date Confirmed" optional="show"/>
  <field name="x_studio_pabrik" string="Pabrik" optional="show"/>
  <field name="x_studio_manufacturing_order" string="Manufacturing Order" optional="show"/>
  <field name="x_studio_sales_order" string="Sales Order" optional="show"/>
  <field name="x_studio_jenis_kain" string="Jenis Kain" optional="show"/>
  <field name="x_studio_warna" string="Warna" optional="show"/>
  <field name="x_studio_mo_count" string="Jml MO" optional="show" sum="Total MO"/>
  <field name="x_studio_consumption_grey_yd" string="Consumed Grey (Yd)" optional="show" sum="Total Grey (Yd)"/>
  <field name="x_studio_qty_grade_a" string="Grade A (Yd)" optional="show" sum="Total Grade A (Yd)"/>
  <field name="x_studio_qty_grade_b" string="Grade B (Yd)" optional="show" sum="Total Grade B (Yd)"/>
  <field name="x_studio_qty_grade_c" string="Grade C (Yd)" optional="show" sum="Total Grade C (Yd)"/>
  <field name="x_studio_qty_bs" string="BS (Yd)" optional="show" sum="Total BS (Yd)"/>
  <field name="x_studio_total_finish" string="Total Finish (Yd)" optional="show" sum="Total Finish (Yd)"/>
  <field name="x_studio_susut_approval_display" string="% Susut Total Approval" optional="show"/>
  <field name="x_studio_susut_celup_display" string="% Susut Celup" optional="show"/>
  <field name="x_studio_susut_bc_display" string="% Susut B+C" optional="show"/>
  <field name="x_studio_susut_bs_display" string="% Susut BS" optional="show"/>
  <field name="x_studio_persentase_susut_approval" column_invisible="True"/>
  <field name="x_studio_persentase_susut_celup" column_invisible="True"/>
  <field name="x_studio_persentase_susut_b_c" column_invisible="True"/>
  <field name="x_studio_persentase_susut_bs" column_invisible="True"/>
  <field name="x_studio_status" string="Status" optional="hide"/>
  <field name="write_date" string="Terakhir Update" optional="hide"/>
</list>`;

  const FORM_ARCH = `<form string="Rekap Susut Pabrik">
  <sheet>
    <div class="oe_title">
      <label for="x_name" string="Kode Rekap"/>
      <h1><field name="x_name" readonly="1"/></h1>
    </div>
    <group>
      <group string="Informasi Produksi">
        <field name="x_studio_approval_request" readonly="1"/>
        <field name="x_studio_approval_name" readonly="1"/>
        <field name="x_studio_tanggal_approval" readonly="1"/>
        <field name="x_studio_date_confirmed" readonly="1"/>
        <field name="x_studio_pabrik" readonly="1"/>
        <field name="x_studio_manufacturing_order" readonly="1"/>
        <field name="x_studio_sales_order" readonly="1"/>
        <field name="x_studio_sales_order_name" readonly="1"/>
        <field name="x_studio_jenis_kain" readonly="1"/>
        <field name="x_studio_warna" readonly="1"/>
        <field name="x_studio_mo_count" readonly="1"/>
        <field name="x_studio_status" readonly="1"/>
      </group>
      <group string="Hasil &amp; Persentase Susut">
        <field name="x_studio_consumption_grey_yd" readonly="1"/>
        <field name="x_studio_qty_grade_a" readonly="1"/>
        <field name="x_studio_qty_grade_b" readonly="1"/>
        <field name="x_studio_qty_grade_c" readonly="1"/>
        <field name="x_studio_qty_bs" readonly="1"/>
        <field name="x_studio_total_finish" readonly="1"/>
        <field name="x_studio_susut_approval_display" readonly="1"/>
        <field name="x_studio_susut_celup_display" readonly="1"/>
        <field name="x_studio_susut_bc_display" readonly="1"/>
        <field name="x_studio_susut_bs_display" readonly="1"/>
      </group>
    </group>
    <notebook>
      <page string="Daftar Manufacturing Order (MO)">
        <field name="x_studio_mo_ids" readonly="1">
          <list string="Manufacturing Orders">
            <field name="name" string="No MO"/>
            <field name="product_id" string="Product"/>
            <field name="product_qty" string="Qty Demand"/>
            <field name="qty_producing" string="Qty Finish"/>
            <field name="product_uom_id" string="UoM"/>
            <field name="state" string="State" widget="badge"/>
          </list>
        </field>
      </page>
    </notebook>
  </sheet>
</form>`;

  const SEARCH_ARCH = `<search>
  <field name="x_studio_manufacturing_order" string="Manufacturing Order"/>
  <field name="x_studio_sales_order" string="Sales Order"/>
  <field name="x_studio_approval_request" string="Approval Request"/>
  <field name="x_studio_approval_name" string="No Approval"/>
  <field name="x_studio_warna" string="Warna"/>
  <field name="x_studio_jenis_kain" string="Jenis Kain"/>
  <field name="x_studio_pabrik" string="Pabrik"/>
  <field name="x_studio_daftar_mo" string="Daftar MO"/>
  <field name="x_studio_sales_order_name" string="Nama Sales Order"/>
  <field name="x_studio_tanggal_approval" string="Tanggal Approval"/>
  <field name="x_studio_date_confirmed" string="Date Confirmed"/>
  <separator/>
  <filter string="Susut Celup &gt; 10%" name="high_susut_celup" domain="[('x_studio_persentase_susut_celup', '&gt;', 10)]"/>
  <filter string="Cacat B+C &gt; 2%" name="high_susut_bc" domain="[('x_studio_persentase_susut_b_c', '&gt;', 2)]"/>
  <separator/>
  <group>
    <filter string="Approval Request" name="group_by_approval" domain="[]" context="{'group_by': 'x_studio_approval_request'}"/>
    <filter string="Sales Order" name="group_by_so" domain="[]" context="{'group_by': 'x_studio_sales_order'}"/>
    <filter string="Tanggal Approval" name="group_by_tgl_approval" domain="[]" context="{'group_by': 'x_studio_tanggal_approval:month'}"/>
    <filter string="Date Confirmed" name="group_by_date_confirmed" domain="[]" context="{'group_by': 'x_studio_date_confirmed:month'}"/>
    <filter string="Pabrik" name="group_by_pabrik" domain="[]" context="{'group_by': 'x_studio_pabrik'}"/>
    <filter string="Jenis Kain" name="group_by_kain" domain="[]" context="{'group_by': 'x_studio_jenis_kain'}"/>
    <filter string="Warna" name="group_by_warna" domain="[]" context="{'group_by': 'x_studio_warna'}"/>
  </group>
</search>`;

  // Upsert List View
  let listViews = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['model', '=', MODEL], ['type', '=', 'list']]
  ], { fields: ['id', 'name'] });
  let listViewId;
  if (listViews.length > 0) {
    listViewId = listViews[0].id;
    await adminOdooClient._callObject('ir.ui.view', 'write', [[listViewId], { arch_base: LIST_ARCH }]);
    console.log(`Updated list view ID: ${listViewId}`);
  } else {
    listViewId = await adminOdooClient._callObject('ir.ui.view', 'create', [{
      name: `${MODEL}.list`,
      model: MODEL,
      type: 'list',
      arch_base: LIST_ARCH
    }]);
    console.log(`Created list view ID: ${listViewId}`);
  }

  // Upsert Form View
  let formViews = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['model', '=', MODEL], ['type', '=', 'form']]
  ], { fields: ['id', 'name'] });
  let formViewId;
  if (formViews.length > 0) {
    formViewId = formViews[0].id;
    await adminOdooClient._callObject('ir.ui.view', 'write', [[formViewId], { arch_base: FORM_ARCH }]);
    console.log(`Updated form view ID: ${formViewId}`);
  } else {
    formViewId = await adminOdooClient._callObject('ir.ui.view', 'create', [{
      name: `${MODEL}.form`,
      model: MODEL,
      type: 'form',
      arch_base: FORM_ARCH
    }]);
    console.log(`Created form view ID: ${formViewId}`);
  }

  // Upsert Search View
  let searchViews = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['model', '=', MODEL], ['type', '=', 'search']]
  ], { fields: ['id', 'name'] });
  let searchViewId;
  if (searchViews.length > 0) {
    searchViewId = searchViews[0].id;
    await adminOdooClient._callObject('ir.ui.view', 'write', [[searchViewId], { arch_base: SEARCH_ARCH }]);
    console.log(`Updated search view ID: ${searchViewId}`);
  } else {
    searchViewId = await adminOdooClient._callObject('ir.ui.view', 'create', [{
      name: `${MODEL}.search`,
      model: MODEL,
      type: 'search',
      arch_base: SEARCH_ARCH
    }]);
    console.log(`Created search view ID: ${searchViewId}`);
  }

  // 5. Upsert Action Window
  let actions = await adminOdooClient._callObject('ir.actions.act_window', 'search_read', [
    [['res_model', '=', MODEL]]
  ], { fields: ['id', 'name'] });
  let actionId;
  const actionPayload = {
    name: 'Rekap Susut Pabrik',
    res_model: MODEL,
    view_mode: 'list,form',
    view_ids: [
      [0, 0, { view_mode: 'list', view_id: listViewId }],
      [0, 0, { view_mode: 'form', view_id: formViewId }]
    ],
    search_view_id: searchViewId,
    context: "{'search_default_group_by_approval': 1}"
  };

  if (actions.length > 0) {
    actionId = actions[0].id;
    await adminOdooClient._callObject('ir.actions.act_window', 'write', [[actionId], {
      name: actionPayload.name,
      context: actionPayload.context,
      search_view_id: searchViewId
    }]);
    console.log(`Updated action window ID: ${actionId}`);
  } else {
    actionId = await adminOdooClient._callObject('ir.actions.act_window', 'create', [actionPayload]);
    console.log(`Created action window ID: ${actionId}`);
  }

  // 6. Upsert Menu Item under Vendoran (menu ID 686)
  const PARENT_MENU_ID = 686; // Vendoran
  let menus = await adminOdooClient._callObject('ir.ui.menu', 'search_read', [
    [['name', '=', 'Rekap Susut Pabrik'], ['parent_id', '=', PARENT_MENU_ID]]
  ], { fields: ['id', 'name', 'sequence'] });

  let menuId;
  if (menus.length > 0) {
    menuId = menus[0].id;
    await adminOdooClient._callObject('ir.ui.menu', 'write', [[menuId], {
      action: `ir.actions.act_window,${actionId}`,
      sequence: 5
    }]);
    console.log(`Updated menu ID: ${menuId}`);
  } else {
    menuId = await adminOdooClient._callObject('ir.ui.menu', 'create', [{
      name: 'Rekap Susut Pabrik',
      parent_id: PARENT_MENU_ID,
      action: `ir.actions.act_window,${actionId}`,
      sequence: 5
    }]);
    console.log(`Created menu ID: ${menuId}`);
  }

  console.log('SUCCESS: Rekap Susut Pabrik schema, views, action, and menu initialized in Odoo.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
