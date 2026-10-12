import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

async function main() {
  await odooAdminService.authenticate();

  // Update action window 1418 domain agar hanya menampilkan transfer internal
  await odooAdminService._callObject('ir.actions.act_window', 'write', [[1418], {
    domain: "[('x_studio_sales_order', '=', active_id), ('picking_type_id.code', '=', 'internal')]"
  }]);

  // Update compute field x_studio_transfer_pc_count (ID: 38168)
  // agar hanya menghitung picking bertipe internal
  await odooAdminService._callObject('ir.model.fields', 'write', [[38168], {
    compute: `for record in self:
    record["x_studio_transfer_pc_count"] = len(record.x_studio_transfer_pc_ids.filtered(lambda p: p.picking_type_id.code == 'internal'))`
  }]);

  console.log('Action 1418 and count field 38168 updated successfully!');
}

main().catch(console.error);
