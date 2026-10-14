import { adminOdooClient } from '../src/core/odoo/odooClient.js';

async function cleanBroken() {
  await adminOdooClient.authenticate();
  
  // 1. Delete 16 empty WIP records (IDs 77 to 92)
  const emptyIds = [77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92];
  console.log('Unlinking empty WIP records:', emptyIds);
  const resEmpty = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'unlink', [emptyIds]);
  console.log('Unlink empty result:', resEmpty);

  // 2. Delete test records from yesterday for non-vendor (PBMSU 65-76, 94 & WHDGP 93)
  const testIds = [65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 93, 94];
  console.log('Unlinking test non-vendor WIP records:', testIds);
  const resTest = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'unlink', [testIds]);
  console.log('Unlink non-vendor test records result:', resTest);

  console.log('✅ Cleanup completed successfully!');
}

cleanBroken().catch(console.error);
