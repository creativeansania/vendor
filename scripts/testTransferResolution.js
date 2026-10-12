import { odooAdminService } from '../src/services/odooService.js';
import dotenv from 'dotenv';

dotenv.config();

async function runTest() {
  console.log('--- TEST TRANSFER MO & SO REFERENCE RESOLUTION ---');
  try {
    await odooAdminService.authenticate();

    // Test on VDKWS/PC/04090 (ID: 37682)
    console.log('\n1. Testing on VDKWS/PC/04090 (ID: 37682)...');
    const resPC = await odooAdminService.resolveTransferMoAndSo([37682]);
    console.log('Result for 37682 (PC):', JSON.stringify(resPC, null, 2));

    // Test on WHGB/PICK/03573 (ID: 36042)
    console.log('\n2. Testing on WHGB/PICK/03573 (ID: 36042)...');
    const resPick = await odooAdminService.resolveTransferMoAndSo([36042]);
    console.log('Result for 36042 (PICK):', JSON.stringify(resPick, null, 2));

    console.log('\n--- TEST FINISHED SUCCESSFULLY ---');
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
  }
}

runTest();
