import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

async function runTest() {
  console.log('--- TEST DUPLICATE LANDED COST WITH MO ---');
  try {
    await odooAdminService.authenticate();

    // 1. Find a Landed Cost record with Manufacturing Orders linked
    console.log('\n1. Searching for sample Landed Cost with MO...');
    const records = await odooAdminService._callObject('stock.landed.cost', 'search_read', [
      [['mrp_production_ids', '!=', false]]
    ], {
      fields: ['id', 'name', 'target_model', 'mrp_production_ids', 'cost_lines', 'state'],
      limit: 1
    });

    if (!records || records.length === 0) {
      console.log('No Landed Cost with mrp_production_ids found in Odoo.');
      return;
    }

    const sample = records[0];
    console.log('Found source record:', {
      id: sample.id,
      name: sample.name,
      state: sample.state,
      target_model: sample.target_model,
      mrp_count: sample.mrp_production_ids.length,
      mrp_production_ids: sample.mrp_production_ids
    });

    // 2. Test duplicateLandedCostWithMO
    console.log(`\n2. Executing duplicateLandedCostWithMO for ID: ${sample.id}...`);
    const result = await odooAdminService.duplicateLandedCostWithMO([sample.id]);

    console.log('Duplication result:', JSON.stringify(result, null, 2));

    if (result.success && result.newRecordIds.length > 0) {
      const newId = result.newRecordIds[0];
      console.log(`\n✅ Successfully created new record ID: ${newId}`);

      // 3. Immediately clean up test duplicate
      console.log(`\n3. Cleaning up (deleting) test record ${newId}...`);
      await odooAdminService._callObject('stock.landed.cost', 'unlink', [[newId]]);
      console.log(`✅ Test record ${newId} deleted successfully. Database remains clean!`);
    }

    console.log('\n--- TEST COMPLETED SUCCESSFULLY ---');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
  }
}

runTest();
