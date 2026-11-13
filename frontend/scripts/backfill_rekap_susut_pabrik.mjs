import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { syncPabrikRecapForApproval } from '../src/lib/services/wip/sync/pabrikRecapSync.js';

const CONCURRENCY = 4;

async function runWithConcurrency(tasks, concurrency) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const idx = cursor++;
      await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
}

async function main() {
  await adminOdooClient.authenticate();

  console.log('1. Finding all distinct Pabrik Approval Requests in Odoo...');
  const grouped = await adminOdooClient._callObject('mrp.production', 'read_group', [
    [['warehouse_id.name', 'ilike', 'PABRIK'], ['x_studio_approval_request', '!=', false], ['state', '!=', 'cancel']],
    ['x_studio_approval_request'],
    ['x_studio_approval_request']
  ], { lazy: false });

  const approvalList = grouped
    .map((g) => {
      const item = g.x_studio_approval_request;
      if (!item) return null;
      return { id: item[0], name: item[1], moCount: g.__count };
    })
    .filter(Boolean);

  console.log(`   Found ${approvalList.length} distinct Pabrik Approval Requests.`);

  console.log(`2. Syncing rekap susut for all ${approvalList.length} approvals (concurrency: ${CONCURRENCY})...`);
  let completed = 0;
  let totalWarnaRows = 0;
  let totalMos = 0;

  const tasks = approvalList.map((appr) => async () => {
    try {
      const res = await syncPabrikRecapForApproval(appr.id);
      if (res && res.success) {
        totalWarnaRows += res.warnaCount || 0;
        totalMos += res.moCount || 0;
      }
    } catch (err) {
      console.warn(`[Backfill] Warning on Approval #${appr.id} (${appr.name}):`, err.message);
    }
    completed++;
    if (completed % 25 === 0 || completed === approvalList.length) {
      console.log(`   Progress: ${completed}/${approvalList.length} approvals processed...`);
    }
  });

  await runWithConcurrency(tasks, CONCURRENCY);

  console.log('3. Verifying stored records in x_rekap_susut_pabrik...');
  const count = await adminOdooClient._callObject('x_rekap_susut_pabrik', 'search_count', [[]]);
  console.log(`   Total rows stored in x_rekap_susut_pabrik: ${count}`);
  console.log(`   Total MOs represented: ${totalMos}`);
  console.log('SUCCESS: Backfill completed.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
