import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { deriveSpkInduk, computeSpkFamilyRecap } from '../src/lib/services/wip/sync/spkRecapSync.js';

const MODEL = 'x_monitoring_wip_vendo';
const READ_FIELDS = [
  'id',
  'x_name',
  'x_studio_manufacturing_order',
  'x_studio_spk_induk',
  'x_studio_kain_dari_gudang_qty',
  'x_studio_estimasi_dari_spb',
  'x_studio_qty_masuk_sfp',
  'x_studio_estimasi_spb_rekap',
  'x_studio_persentase_susut'
];
const PAGE_SIZE = 500;
const WRITE_CHUNK_SIZE = 50;
const WRITE_CONCURRENCY = 4;

function getRowMoName(row) {
  const rawName = String(row.x_name || '').trim();
  if (rawName) return rawName;
  if (Array.isArray(row.x_studio_manufacturing_order) && row.x_studio_manufacturing_order[1]) {
    return String(row.x_studio_manufacturing_order[1]).trim();
  }
  return String(row.x_studio_spk_induk || '').trim();
}

async function fetchAllWipRows() {
  const totalCount = await adminOdooClient._callObject(MODEL, 'search_count', [[]]);
  const allRows = [];
  let lastId = 0;

  while (true) {
    const batch = await adminOdooClient._callObject(
      MODEL,
      'search_read',
      [[['id', '>', lastId]]],
      { fields: READ_FIELDS, limit: PAGE_SIZE, order: 'id asc' }
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    allRows.push(...batch);
    lastId = batch[batch.length - 1].id;
    if (batch.length < PAGE_SIZE) break;
  }

  return { totalCount, allRows };
}

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

  console.log('1. Fetching all x_monitoring_wip_vendo rows from Odoo...');
  const { totalCount, allRows } = await fetchAllWipRows();
  console.log(`   Fetched ${allRows.length} / ${totalCount} rows.`);

  console.log('2. Grouping rows by SPK Induk and computing deduplicated Estimasi SPB & % Susut...');
  const families = new Map();
  for (const row of allRows) {
    const rawName = getRowMoName(row);
    const spkKey = deriveSpkInduk(rawName) || `__row_${row.id}`;
    if (!families.has(spkKey)) {
      families.set(spkKey, []);
    }
    families.get(spkKey).push(row);
  }
  console.log(`   Total SPK Induk families: ${families.size}`);

  const allUpdates = [];
  let multiRowFamilies = 0;
  let familiesWithSfpSusut = 0;

  for (const familyRows of families.values()) {
    if (familyRows.length > 1) multiRowFamilies++;
    const recap = computeSpkFamilyRecap(familyRows);
    if (!recap) continue;
    if (recap.totalQtySfp > 0 && recap.totalEstimasiSpb > 0) {
      familiesWithSfpSusut++;
    }
    if (recap.rowUpdates.length > 0) {
      allUpdates.push(...recap.rowUpdates);
    }
  }

  console.log(`   Multi-row families: ${multiRowFamilies}, families with SFP>0 & EstSPB>0: ${familiesWithSfpSusut}`);
  console.log(`   Rows needing update: ${allUpdates.length}`);

  if (allUpdates.length > 0) {
    const batchesByPayload = new Map();
    for (const upd of allUpdates) {
      const key = JSON.stringify(upd.vals);
      if (!batchesByPayload.has(key)) {
        batchesByPayload.set(key, { vals: upd.vals, ids: [] });
      }
      batchesByPayload.get(key).ids.push(upd.id);
    }

    const writeTasks = [];
    for (const { vals, ids } of batchesByPayload.values()) {
      for (let i = 0; i < ids.length; i += WRITE_CHUNK_SIZE) {
        const chunkIds = ids.slice(i, i + WRITE_CHUNK_SIZE);
        writeTasks.push(async () => {
          await adminOdooClient._callObject(MODEL, 'write', [chunkIds, vals], {
            context: { tracking_disable: true, no_automation: true }
          });
        });
      }
    }

    console.log(`3. Executing ${writeTasks.length} chunked write RPC calls (max ${WRITE_CHUNK_SIZE} IDs/call, concurrency ${WRITE_CONCURRENCY})...`);
    let completed = 0;
    const wrappedTasks = writeTasks.map((fn) => async () => {
      await fn();
      completed++;
      if (completed % 100 === 0 || completed === writeTasks.length) {
        console.log(`   Progress: ${completed}/${writeTasks.length} batches written`);
      }
    });

    await runWithConcurrency(wrappedTasks, WRITE_CONCURRENCY);
  } else {
    console.log('3. Nothing to update — all rows are already up to date.');
  }

  console.log('4. Verifying backfill completeness...');
  const remainingUnsetCount = await adminOdooClient._callObject(MODEL, 'search_count', [
    [['x_studio_estimasi_spb_rekap', '=', false]]
  ]);
  console.log(`   Remaining rows with x_studio_estimasi_spb_rekap = false: ${remainingUnsetCount}`);

  // Also verify via fresh scan that 0 rows still have pending diffs
  const { allRows: verifiedRows } = await fetchAllWipRows();
  const verifiedFamilies = new Map();
  for (const row of verifiedRows) {
    const spkKey = deriveSpkInduk(getRowMoName(row)) || `__row_${row.id}`;
    if (!verifiedFamilies.has(spkKey)) verifiedFamilies.set(spkKey, []);
    verifiedFamilies.get(spkKey).push(row);
  }
  let remainingDrift = 0;
  for (const fam of verifiedFamilies.values()) {
    const check = computeSpkFamilyRecap(fam);
    if (check && check.rowUpdates.length > 0) remainingDrift += check.rowUpdates.length;
  }
  console.log(`   Verified remaining drift rows across all ${verifiedRows.length} records: ${remainingDrift}`);
  if (remainingDrift > 0) {
    throw new Error(`Backfill verification failed: ${remainingDrift} rows still have pending updates.`);
  }
  console.log('DONE: Backfill completed and verified with 0 remaining drift.');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});

