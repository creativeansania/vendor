import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { wipService } from '../src/lib/services/wipService.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function syncRemaining13() {
  await adminOdooClient.authenticate();

  // Load all current Supabase wip_orders
  let supaOrders = [];
  let from = 0;
  while (true) {
    const { data } = await supabase.from('wip_orders').select('odoo_mo_id, mo_name').range(from, from + 999);
    if (!data || data.length === 0) break;
    supaOrders.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  const supaMoIdSet = new Set(supaOrders.map(o => o.odoo_mo_id));
  const supaMoNameSet = new Set(supaOrders.map(o => (o.mo_name || '').trim()));

  // 1. Check SO 21/MKT/09/2026
  const so21 = await adminOdooClient._callObject('sale.order', 'search_read', [
    [['name', '=', '21/MKT/09/2026']]
  ], { fields: ['id', 'name', 'mrp_production_ids'] });

  const so21Mos = await adminOdooClient._callObject('mrp.production', 'read', [
    so21[0].mrp_production_ids,
    ['id', 'name', 'state', 'warehouse_id', 'x_studio_sales_order', 'origin']
  ]);

  const targetMos = [];
  for (const m of so21Mos) {
    const baseName = m.name.replace(/-\d+$/, '').trim();
    if (!supaMoIdSet.has(m.id) && !supaMoNameSet.has(m.name) && !supaMoNameSet.has(baseName)) {
      targetMos.push(m);
    }
  }

  // 2. Check VDNB/MO/00444
  const mDraft = await adminOdooClient._callObject('mrp.production', 'search_read', [
    [['name', '=', 'VDNB/MO/00444']]
  ], { fields: ['id', 'name', 'state', 'warehouse_id', 'x_studio_sales_order', 'origin'] });
  if (mDraft.length > 0) {
    const m = mDraft[0];
    const baseName = m.name.replace(/-\d+$/, '').trim();
    if (!supaMoIdSet.has(m.id) && !supaMoNameSet.has(m.name) && !supaMoNameSet.has(baseName)) {
      targetMos.push(m);
    }
  }

  console.log(`Found ${targetMos.length} target MOs to sync:`);
  for (const m of targetMos) {
    console.log(` - ID: ${m.id}, Name: ${m.name}, State: ${m.state}, WH: ${m.warehouse_id ? m.warehouse_id[1] : 'null'}`);
  }

  let successCount = 0;
  for (let idx = 0; idx < targetMos.length; idx++) {
    const m = targetMos[idx];
    try {
      console.log(`\n[${idx + 1}/${targetMos.length}] Processing MO #${m.id} (${m.name})...`);
      const res = await wipService.onMoConfirmed(m.id);
      console.log(`   -> onMoConfirmed result:`, res);

      // If MO is done, ensure state and status_produksi reflect it in Supabase
      if (m.state === 'done') {
        const updatePayload = {
          mo_state: 'done',
          status_produksi: 'Selesai'
        };
        await supabase
          .from('wip_orders')
          .update(updatePayload)
          .eq('odoo_mo_id', m.id);
      }
      successCount++;
    } catch (err) {
      console.error(`   -> Error processing MO #${m.id}:`, err.message);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(`\n=== Finished: ${successCount} of ${targetMos.length} MOs synced successfully ===`);
}

syncRemaining13().catch(console.error);

