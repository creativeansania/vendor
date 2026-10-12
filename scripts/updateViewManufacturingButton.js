import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('='.repeat(70));
  console.log(' UPDATE VIEW 2522 WITH ROBUST MANUFACTURING BUTTON');
  console.log('='.repeat(70));

  await odooAdminService.authenticate();

  const [view] = await odooAdminService._callObject('ir.ui.view', 'search_read', [
    [['id', '=', 2522]]
  ], { fields: ['id', 'arch_db'] });

  let arch = view.arch_db;

  // Hapus blok Transfer MO lama jika ada
  const targetOld = `<xpath expr="//div[@name='button_box']" position="inside">
    <button class="oe_stat_button" type="action" name="studio_customization.action_sale_order_transfer_pc" icon="fa-bus">
      <field name="x_studio_transfer_pc_count" widget="statinfo" string="Transfer MO"/>
    </button>
  </xpath>`;

  // Blok baru: sembunyikan native mrp button yang rapuh, dan tampilkan robust Manufacturing & Transfer MO
  const targetNew = `  <xpath expr="//button[@name='action_view_mrp_production']" position="attributes">
    <attribute name="invisible">True</attribute>
  </xpath>
  <xpath expr="//div[@name='button_box']" position="inside">
    <button class="oe_stat_button" type="action" name="studio_customization.action_sale_order_mrp_production_all" icon="fa-wrench" invisible="x_studio_manufacturing_order_count == 0">
      <field name="x_studio_manufacturing_order_count" widget="statinfo" string="Manufacturing"/>
    </button>
    <button class="oe_stat_button" type="action" name="studio_customization.action_sale_order_transfer_pc" icon="fa-bus">
      <field name="x_studio_transfer_pc_count" widget="statinfo" string="Transfer MO"/>
    </button>
  </xpath>`;

  if (arch.includes(targetOld)) {
    arch = arch.replace(targetOld, targetNew);
  } else if (!arch.includes('action_sale_order_mrp_production_all')) {
    arch = arch.replace('</data>', targetNew + '\n</data>');
  }

  await odooAdminService._callObject('ir.ui.view', 'write', [[2522], {
    arch_db: arch
  }]);

  console.log('View 2522 successfully updated!');
}

main().catch(err => {
  console.error('[ERROR]:', err);
});
