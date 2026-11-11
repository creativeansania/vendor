import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

function computeRow(row) {
  const rawName = (row.x_name || '').trim();
  const moRef = row.x_studio_manufacturing_order && row.x_studio_manufacturing_order[1]
    ? row.x_studio_manufacturing_order[1].trim()
    : '';
  const moName = rawName || moRef;
  const spkInduk = moName.replace(/-\d+$/, '').trim() || moName;

  const target = (parseFloat(row.x_studio_estimasi_dari_spb) || 0) > 0
    ? parseFloat(row.x_studio_estimasi_dari_spb)
    : (parseFloat(row.x_studio_qty_spk) || 0);

  const output = (parseFloat(row.x_studio_qty_kirim_a_grade) || 0) + (parseFloat(row.x_studio_qty_kirim_b_grade) || 0) > 0
    ? (parseFloat(row.x_studio_qty_kirim_a_grade) || 0) + (parseFloat(row.x_studio_qty_kirim_b_grade) || 0)
    : (parseFloat(row.x_studio_qty_masuk_sfp) || 0);

  let susut = 0.0;
  if (output > 0 && target > 0) {
    susut = Math.round(((target - output) / target) * 10000) / 100;
  }

  return {
    x_studio_spk_induk: spkInduk,
    x_studio_persentase_susut: susut
  };
}

async function runBackfillDesc() {
  await adminOdooClient.authenticate();
  console.log(`[DESC] Authenticated Admin UID: ${adminOdooClient.uid}`);

  const BATCH_SIZE = 100;
  const CONCURRENCY = 15;
  let processed = 0;
  const startTime = Date.now();

  while (true) {
    const rows = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
      [['x_studio_spk_induk', '=', false]]
    ], {
      fields: [
        'id', 'x_name', 'x_studio_manufacturing_order',
        'x_studio_estimasi_dari_spb', 'x_studio_qty_spk',
        'x_studio_qty_kirim_a_grade', 'x_studio_qty_kirim_b_grade', 'x_studio_qty_masuk_sfp'
      ],
      limit: BATCH_SIZE,
      order: 'id desc'
    });

    if (!rows || rows.length === 0) {
      console.log('[DESC] All records have been backfilled!');
      break;
    }

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const slice = rows.slice(i, i + CONCURRENCY);
      await Promise.all(slice.map(async (r) => {
        const vals = computeRow(r);
        try {
          await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [[r.id], vals], {
            context: { tracking_disable: true, no_automation: true }
          });
        } catch (err) {
          console.warn(`[DESC] Failed to update WIP #${r.id}: ${err.message}`);
        }
      }));
    }

    processed += rows.length;
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const rate = (processed / (Date.now() - startTime) * 1000).toFixed(1);
    console.log(`[DESC] Progress: ${processed} (${rate} rec/s, elapsed: ${elapsedSec}s)`);
  }
}

runBackfillDesc().catch(err => {
  console.error('[DESC] Error:', err);
  process.exit(1);
});
