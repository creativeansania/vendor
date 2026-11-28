import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');

if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[k]) process.env[k] = v;
  }
}

const { adminOdooClient } = await import('../src/lib/odoo/odooClient.js');
const {
  listBuyerDashboards,
  createBuyerDashboard,
  updateBuyerDashboard,
  saveBuyerSnapshot
} = await import('../src/lib/services/buyerDashboard/buyerDashboardRepo.js');
const { syncBuyerSnapshotFromOdoo } = await import(
  '../src/lib/services/buyerDashboard/buyerWipSyncService.js'
);

const BASE_URL = process.env.PUBLIC_PORTAL_URL || 'https://vendor-sandy-eight.vercel.app';
const START_DATE = '2026-06-01';
const CONCURRENCY = 3;

function normName(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .trim();
}

function cleanDisplayName(name) {
  return String(name || '')
    .replace(/^EXT\s*,\s*/i, '')
    .replace(/\.\s*$/, '')
    .trim();
}

console.log('1) Fetching all External non-SAMPLE Sale Orders (POLOS / DIGITAL PRINT) from Odoo...');
const sos = await adminOdooClient.executeKw(
  'sale.order',
  'search_read',
  [
    [
      ['state', '=', 'sale'],
      ['x_studio_jenis_so', '=', 'Eksternal'],
      ['name', 'not ilike', 'SAMPLE'],
      ['x_studio_category', 'in', ['POLOS', 'DIGITAL PRINT']]
    ]
  ],
  {
    fields: ['id', 'partner_id', 'date_order', 'commitment_date', 'order_line'],
    limit: 3000
  }
);

const partnerIdsSet = new Set();
const soCountByPid = new Map();
for (const so of sos || []) {
  const pid = so.partner_id?.[0];
  if (!pid) continue;
  partnerIdsSet.add(pid);
  soCountByPid.set(pid, (soCountByPid.get(pid) || 0) + 1);
}

const partners = await adminOdooClient.executeKw(
  'res.partner',
  'read',
  [Array.from(partnerIdsSet)],
  {
    fields: ['id', 'name', 'display_name', 'parent_id', 'commercial_partner_id']
  }
);

const groupsByKey = new Map();
for (const p of partners || []) {
  const commName = p.commercial_partner_id?.[1] || p.name;
  const isGenericParent = /^EXT$/i.test(String(commName).trim());
  const rawDisplay = isGenericParent ? p.name : commName;
  const key = isGenericParent ? `single:${p.id}` : `comm:${normName(commName)}`;

  if (!groupsByKey.has(key)) {
    groupsByKey.set(key, {
      buyer_name: cleanDisplayName(rawDisplay),
      partner_ids: [],
      partner_names: [],
      so_count: 0
    });
  }
  const g = groupsByKey.get(key);
  g.partner_ids.push(p.id);
  g.partner_names.push(p.display_name || p.name);
  g.so_count += soCountByPid.get(p.id) || 0;
}

const groups = Array.from(groupsByKey.values()).sort((a, b) => b.so_count - a.so_count);
console.log(`Found ${groups.length} grouped external buyers (from ${partnerIdsSet.size} raw partners).`);

const existingDashboards = await listBuyerDashboards();

function findExistingForGroup(group) {
  const pidSet = new Set(group.partner_ids);
  return existingDashboards.find((d) =>
    (d.odoo_partner_ids || []).some((id) => pidSet.has(id))
  );
}

let createdCount = 0;
let updatedCount = 0;
let syncedCount = 0;
let failedCount = 0;
const results = [];

async function processGroup(group, idx) {
  const label = `[${idx + 1}/${groups.length}] ${group.buyer_name}`;
  try {
    let cfg = findExistingForGroup(group);
    if (!cfg) {
      cfg = await createBuyerDashboard({
        buyer_name: group.buyer_name,
        odoo_partner_ids: group.partner_ids,
        odoo_partner_names: group.partner_names,
        start_date: START_DATE,
        notes: 'Auto-generated dari data buyer external Odoo'
      });
      createdCount++;
    } else {
      // Merge any newly discovered sub-partner IDs & align start_date if needed while preserving token & custom name
      const mergedIds = Array.from(new Set([...(cfg.odoo_partner_ids || []), ...group.partner_ids]));
      const needsPartnerUpdate = mergedIds.length !== (cfg.odoo_partner_ids || []).length;
      const needsDateUpdate = cfg.start_date !== START_DATE;
      if (needsPartnerUpdate || needsDateUpdate) {
        cfg = await updateBuyerDashboard(cfg.token, {
          odoo_partner_ids: mergedIds,
          odoo_partner_names: Array.from(new Set([...(cfg.odoo_partner_names || []), ...group.partner_names])),
          start_date: START_DATE
        });
        updatedCount++;
      }
    }

    const snap = await syncBuyerSnapshotFromOdoo(cfg);
    await saveBuyerSnapshot(cfg.token, snap);
    syncedCount++;

    results.push({
      buyer_name: cfg.buyer_name,
      token: cfg.token,
      url: `${BASE_URL}/buyer/${cfg.token}`,
      partner_count: cfg.odoo_partner_ids.length,
      items: snap.summary.total_items,
      po_docs: snap.summary.total_po_docs,
      qty_po: snap.summary.total_qty_po,
      pct_finish: snap.summary.pct_finish,
      duration_ms: snap.sync_duration_ms
    });

    console.log(
      `  OK ${label} -> ${snap.summary.total_items} items, ${snap.summary.total_qty_po} pcs (${snap.summary.pct_finish}%) [${snap.sync_duration_ms}ms]`
    );
  } catch (err) {
    failedCount++;
    console.error(`  FAIL ${label}: ${err.message}`);
  }
}

// Run with controlled concurrency across discovered groups
let cursor = 0;
const workers = Array.from({ length: CONCURRENCY }, async () => {
  while (cursor < groups.length) {
    const currentIdx = cursor++;
    await processGroup(groups[currentIdx], currentIdx);
  }
});
await Promise.all(workers);

// Also refresh any pre-existing buyer dashboards whose SOs all had empty category so stale cache is cleared
const syncedTokens = new Set(results.map((r) => r.token));
const remainingExisting = existingDashboards.filter((d) => !syncedTokens.has(d.token));
if (remainingExisting.length > 0) {
  console.log(`\nRefreshing ${remainingExisting.length} existing dashboards with no POLOS/DIGITAL PRINT SOs yet...`);
  let rCursor = 0;
  const rWorkers = Array.from({ length: CONCURRENCY }, async () => {
    while (rCursor < remainingExisting.length) {
      let d = remainingExisting[rCursor++];
      try {
        if (d.start_date !== START_DATE) {
          d = await updateBuyerDashboard(d.token, { start_date: START_DATE });
          updatedCount++;
        }
        const snap = await syncBuyerSnapshotFromOdoo(d);
        await saveBuyerSnapshot(d.token, snap);
        syncedCount++;
        console.log(`  CLEARED/SYNCED ${d.buyer_name} -> ${snap.summary.total_items} items`);
      } catch (err) {
        failedCount++;
        console.error(`  FAIL ${d.buyer_name}: ${err.message}`);
      }
    }
  });
  await Promise.all(rWorkers);
}

results.sort((a, b) => b.qty_po - a.qty_po);
console.log('\n=== SUMMARY ===');
console.log(
  JSON.stringify(
    {
      total_groups: groups.length,
      created: createdCount,
      updated_existing: updatedCount,
      synced_ok: syncedCount,
      failed: failedCount,
      top_15_by_qty: results.slice(0, 15)
    },
    null,
    2
  )
);
