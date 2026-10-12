import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  console.log('='.repeat(70));
  console.log(' SETUP MANUFACTURING SMART BUTTON ON SALE.ORDER');
  console.log('='.repeat(70));

  await odooAdminService.authenticate();

  // 1. Cek / buat field x_studio_manufacturing_order_ids (One2many)
  let [fieldO2M] = await odooAdminService._callObject('ir.model.fields', 'search_read', [
    [['model', '=', 'sale.order'], ['name', '=', 'x_studio_manufacturing_order_ids']]
  ], { fields: ['id', 'name'] });

  if (!fieldO2M) {
    console.log('Membuat field x_studio_manufacturing_order_ids...');
    const o2mId = await odooAdminService._callObject('ir.model.fields', 'create', [{
      name: 'x_studio_manufacturing_order_ids',
      model_id: 805,
      field_description: 'Manufacturing Orders',
      ttype: 'one2many',
      relation: 'mrp.production',
      relation_field: 'x_studio_sales_order',
      state: 'manual'
    }]);
    console.log(' -> Field One2many berhasil dibuat, ID:', o2mId);
  } else {
    console.log(' -> Field One2many sudah ada, ID:', fieldO2M.id);
  }

  // 2. Cek / buat field x_studio_manufacturing_order_count (Integer Compute)
  let [fieldCount] = await odooAdminService._callObject('ir.model.fields', 'search_read', [
    [['model', '=', 'sale.order'], ['name', '=', 'x_studio_manufacturing_order_count']]
  ], { fields: ['id', 'name'] });

  if (!fieldCount) {
    console.log('Membuat field x_studio_manufacturing_order_count...');
    const countId = await odooAdminService._callObject('ir.model.fields', 'create', [{
      name: 'x_studio_manufacturing_order_count',
      model_id: 805,
      field_description: 'Manufacturing Orders Count',
      ttype: 'integer',
      compute: 'for record in self:\n    record["x_studio_manufacturing_order_count"] = len(record.x_studio_manufacturing_order_ids)',
      depends: 'x_studio_manufacturing_order_ids',
      store: false,
      state: 'manual'
    }]);
    console.log(' -> Field Count berhasil dibuat, ID:', countId);
  } else {
    console.log(' -> Field Count sudah ada, ID:', fieldCount.id);
  }

  // 3. Cek / buat Action Window
  let [xmlData] = await odooAdminService._callObject('ir.model.data', 'search_read', [
    [['module', '=', 'studio_customization'], ['name', '=', 'action_sale_order_mrp_production_all']]
  ], { fields: ['id', 'res_id'] });

  if (!xmlData) {
    console.log('Membuat dedicated action window Manufacturing...');
    const actionId = await odooAdminService._callObject('ir.actions.act_window', 'create', [{
      name: 'Manufacturing',
      res_model: 'mrp.production',
      view_mode: 'list,form',
      domain: "[('x_studio_sales_order', '=', active_id)]",
      context: "{'default_x_studio_sales_order': active_id}"
    }]);
    console.log(' -> Action window berhasil dibuat, ID:', actionId);

    // Register ir.model.data
    const dataId = await odooAdminService._callObject('ir.model.data', 'create', [{
      name: 'action_sale_order_mrp_production_all',
      module: 'studio_customization',
      model: 'ir.actions.act_window',
      res_id: actionId,
      noupdate: true
    }]);
    console.log(' -> XML ID studio_customization.action_sale_order_mrp_production_all terdaftar, ID:', dataId);
  } else {
    console.log(' -> Action window studio_customization.action_sale_order_mrp_production_all sudah ada, ID:', xmlData.res_id);
  }

  // 4. Test pembacaan pada SO 01/MKT/01/2026 dan 02/MKT/09/2026
  console.log('\n[4/4] Menguji pembacaan count...');
  const testSos = await odooAdminService._callObject('sale.order', 'search_read', [
    [['name', 'in', ['01/MKT/01/2026', '02/MKT/09/2026', '28/MKT/09/2026']]]
  ], { fields: ['id', 'name', 'x_studio_manufacturing_order_count'] });

  for (const s of testSos) {
    console.log(`- SO ${s.name}: x_studio_manufacturing_order_count = ${s.x_studio_manufacturing_order_count}`);
  }

  console.log('\nSetup fields & action selesai!');
}

main().catch(err => {
  console.error('[ERROR]:', err);
});
