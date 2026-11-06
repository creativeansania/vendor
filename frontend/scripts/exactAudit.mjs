import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAllSupabaseWips() {
  const allRows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('wip_orders')
      .select('id, odoo_wip_id, odoo_mo_id, mo_name, sales_order')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

async function exactAudit() {
  await adminOdooClient.authenticate();

  console.log('Fetching all WIP orders from Supabase...');
  const supaOrders = await getAllSupabaseWips();
  console.log(`Total WIP orders loaded from Supabase: ${supaOrders.length}`);

  const supaMoIdSet = new Set(supaOrders.map(o => o.odoo_mo_id));
  const supaMoNameSet = new Set(supaOrders.map(o => (o.mo_name || '').trim()));

  // 1. All September SOs
  console.log('Fetching all September 2026 Sales Orders from Odoo...');
  const septSos = await adminOdooClient._callObject('sale.order', 'search_read', [
    [
      ['create_date', '>=', '2026-09-01 00:00:00'],
      ['create_date', '<=', '2026-09-30 23:59:59']
    ]
  ], {
    fields: ['id', 'name', 'mrp_production_ids']
  });

  const sosWithMo = septSos.filter(so => so.mrp_production_ids && so.mrp_production_ids.length > 0);
  const allMoIds = Array.from(new Set(sosWithMo.flatMap(so => so.mrp_production_ids)));

  const moDetails = [];
  const chunkSize = 200;
  for (let i = 0; i < allMoIds.length; i += chunkSize) {
    const chunk = allMoIds.slice(i, i + chunkSize);
    const mos = await adminOdooClient._callObject('mrp.production', 'read', [
      chunk,
      ['id', 'name', 'state', 'warehouse_id', 'x_studio_sales_order', 'origin']
    ]);
    moDetails.push(...mos);
  }

  const vendorMos = moDetails.filter(m => {
    const whName = m.warehouse_id ? m.warehouse_id[1] : '';
    return m.name.startsWith('VD') || whName.toUpperCase().includes('VENDOR');
  });

  console.log(`Total September SOs with MO: ${sosWithMo.length}`);
  console.log(`Total Vendor MOs linked to September SOs: ${vendorMos.length}`);

  const trulyMissing = [];
  const found = [];

  for (const m of vendorMos) {
    const baseName = m.name.replace(/-\d+$/, '').trim();
    if (supaMoIdSet.has(m.id) || supaMoNameSet.has(m.name) || supaMoNameSet.has(baseName)) {
      found.push(m);
    } else {
      trulyMissing.push(m);
    }
  }

  console.log(`Total Found in Supabase: ${found.length} / ${vendorMos.length} (${((found.length / vendorMos.length) * 100).toFixed(1)}%)`);
  console.log(`TRULY MISSING MOs: ${trulyMissing.length}`);

  if (trulyMissing.length > 0) {
    console.log('\n--- Truly Missing Vendor MOs ---');
    const missingBySo = {};
    for (const m of trulyMissing) {
      const soRef = m.x_studio_sales_order ? m.x_studio_sales_order[1] : (m.origin || 'UNKNOWN');
      if (!missingBySo[soRef]) missingBySo[soRef] = [];
      missingBySo[soRef].push(m);
    }
    for (const [so, mos] of Object.entries(missingBySo)) {
      console.log(`SO: ${so} -> ${mos.length} missing (States: ${[...new Set(mos.map(x => x.state))].join(', ')}) (Sample: ${mos[0].name}, MO ID: ${mos[0].id})`);
    }
  }
}

exactAudit().catch(console.error);
