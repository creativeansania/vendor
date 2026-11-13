import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

async function updateViews() {
  await adminOdooClient.authenticate();
  console.log('Authenticated UID:', adminOdooClient.uid);

  // 1. Update List View (ID: 4477)
  const listArch = `<list string="Rekap Susut Pabrik" decoration-danger="x_studio_persentase_susut_celup &gt; 10" decoration-warning="x_studio_persentase_susut_b_c &gt; 2">
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
  <field name="x_studio_persentase_susut_celup" string="% Susut Celup" optional="show" avg="Rata-rata Susut Celup"/>
  <field name="x_studio_persentase_susut_b_c" string="% Susut B+C" optional="show" avg="Rata-rata Susut B+C"/>
  <field name="x_studio_persentase_susut_bs" string="% Susut BS" optional="show" avg="Rata-rata Susut BS"/>
  <field name="x_studio_status" string="Status" optional="hide"/>
  <field name="write_date" string="Terakhir Update" optional="hide"/>
</list>`;

  await adminOdooClient._callObject('ir.ui.view', 'write', [[4477], { arch: listArch }]);
  console.log('Successfully updated View 4477 (List View)');

  // 2. Update Form View (ID: 4478)
  const formArch = `<form string="Rekap Susut Pabrik">
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
        <field name="x_studio_persentase_susut_celup" readonly="1"/>
        <field name="x_studio_persentase_susut_b_c" readonly="1"/>
        <field name="x_studio_persentase_susut_bs" readonly="1"/>
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

  await adminOdooClient._callObject('ir.ui.view', 'write', [[4478], { arch: formArch }]);
  console.log('Successfully updated View 4478 (Form View)');

  // 3. Update Search View (ID: 4480)
  const searchArch = `<search>
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

  await adminOdooClient._callObject('ir.ui.view', 'write', [[4480], { arch: searchArch }]);
  console.log('Successfully updated View 4480 (Search View)');
}

updateViews().catch((err) => {
  console.error('Failed to update views:', err);
  process.exit(1);
});
