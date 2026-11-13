import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}

async function main() {
  await adminOdooClient.authenticate();
  console.log('Authenticated UID:', adminOdooClient.uid);

  console.log('1. Reading all records from x_rekap_susut_pabrik...');
  const records = await adminOdooClient._callObject('x_rekap_susut_pabrik', 'search_read', [
    []
  ], {
    fields: ['id', 'x_name', 'x_studio_approval_request', 'x_studio_consumption_grey_yd', 'x_studio_total_finish']
  });

  console.log(`   Found ${records.length} records.`);

  // Group by approval request
  const byApproval = new Map();
  for (const r of records) {
    const appr = r.x_studio_approval_request;
    const apprId = appr ? (Array.isArray(appr) ? appr[0] : appr) : null;
    if (!apprId) continue;
    if (!byApproval.has(apprId)) {
      byApproval.set(apprId, []);
    }
    byApproval.get(apprId).push(r);
  }

  console.log(`   Grouped into ${byApproval.size} distinct Approval Requests.`);

  // Calculate susut total approval and prepare updates
  let updatedCount = 0;
  for (const [apprId, rows] of byApproval.entries()) {
    let totalGrey = 0.0;
    let totalFinish = 0.0;
    for (const r of rows) {
      totalGrey += parseFloat(r.x_studio_consumption_grey_yd || 0.0);
      totalFinish += parseFloat(r.x_studio_total_finish || 0.0);
    }
    totalGrey = round2(totalGrey);
    totalFinish = round2(totalFinish);
    const susutApproval = totalGrey > 0 ? round2(((totalGrey - totalFinish) / totalGrey) * 100) : 0.0;

    const rowIds = rows.map((r) => r.id);
    await adminOdooClient._callObject('x_rekap_susut_pabrik', 'write', [
      rowIds,
      { x_studio_persentase_susut_approval: susutApproval }
    ], { context: { tracking_disable: true, no_automation: true } });

    updatedCount += rowIds.length;
  }

  console.log(`2. Successfully updated ${updatedCount} records with % Susut Total Approval.`);
}

main().catch((err) => {
  console.error('Failed to backfill susut total approval:', err);
  process.exit(1);
});
