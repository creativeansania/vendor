import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

function formatPct(num) {
  const val = Number(num) || 0.0;
  return `${val.toFixed(2)}%`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  await adminOdooClient.authenticate();
  console.log('Authenticated UID:', adminOdooClient.uid);

  console.log('1. Reading all records from x_rekap_susut_pabrik...');
  const records = await adminOdooClient._callObject('x_rekap_susut_pabrik', 'search_read', [
    []
  ], {
    fields: [
      'id',
      'x_studio_persentase_susut_approval',
      'x_studio_persentase_susut_celup',
      'x_studio_persentase_susut_b_c',
      'x_studio_persentase_susut_bs'
    ]
  });

  console.log(`   Found ${records.length} records. Updating display fields...`);

  // Group IDs by exact payload to minimize write calls
  const mapPayloadToIds = new Map();
  for (const r of records) {
    const payload = JSON.stringify({
      x_studio_susut_approval_display: formatPct(r.x_studio_persentase_susut_approval),
      x_studio_susut_celup_display: formatPct(r.x_studio_persentase_susut_celup),
      x_studio_susut_bc_display: formatPct(r.x_studio_persentase_susut_b_c),
      x_studio_susut_bs_display: formatPct(r.x_studio_persentase_susut_bs)
    });
    if (!mapPayloadToIds.has(payload)) {
      mapPayloadToIds.set(payload, []);
    }
    mapPayloadToIds.get(payload).push(r.id);
  }

  console.log(`   Grouped into ${mapPayloadToIds.size} unique payloads! Updating in batches...`);

  let count = 0;
  for (const [payloadStr, ids] of mapPayloadToIds.entries()) {
    const vals = JSON.parse(payloadStr);
    await adminOdooClient._callObject('x_rekap_susut_pabrik', 'write', [
      ids,
      vals
    ], { context: { tracking_disable: true, no_automation: true } });
    count += ids.length;
    await sleep(25);
  }

  console.log(`SUCCESS: All ${count} records updated with Char display fields.`);
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
