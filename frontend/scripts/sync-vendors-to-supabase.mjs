import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { supabaseServer } from '../src/lib/supabaseServer.js';

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log(`=== Sync Odoo Vendor Warehouses -> Supabase vendors (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  await adminOdooClient.authenticate();

  const odooWarehouses = await adminOdooClient._callObject('stock.warehouse', 'search_read', [
    ['|', ['name', 'ilike', 'vendor'], ['code', '=like', 'VD%']],
  ], { fields: ['id', 'name', 'code', 'active'], order: 'id asc' });

  const { data: existingVendors, error: fetchErr } = await supabaseServer
    .from('vendors')
    .select('id, odoo_warehouse_id, name, is_active')
    .order('id', { ascending: true });

  if (fetchErr) throw fetchErr;

  const existingByWhId = new Map((existingVendors || []).map((v) => [Number(v.odoo_warehouse_id), v]));

  const created = [];
  const updated = [];
  const unchanged = [];

  for (const wh of odooWarehouses || []) {
    const whId = Number(wh.id);
    const whName = String(wh.name || '').trim();
    const isActive = wh.active !== false;
    const existing = existingByWhId.get(whId);

    if (!existing) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would insert vendor wh=${whId} (${wh.code}) "${whName}"`);
      } else {
        const { data: ins, error: insErr } = await supabaseServer
          .from('vendors')
          .insert({
            odoo_warehouse_id: whId,
            name: whName,
            is_active: isActive,
          })
          .select('id, odoo_warehouse_id, name, is_active')
          .single();
        if (insErr) throw insErr;
        console.log(`Inserted vendor #${ins.id}: wh=${whId} (${wh.code}) "${whName}"`);
        created.push({ ...ins, code: wh.code });
      }
    } else if (existing.name !== whName || existing.is_active !== isActive) {
      if (DRY_RUN) {
        console.log(`[DRY-RUN] Would update vendor #${existing.id}: "${existing.name}" -> "${whName}", active=${isActive}`);
      } else {
        const { error: updErr } = await supabaseServer
          .from('vendors')
          .update({ name: whName, is_active: isActive })
          .eq('id', existing.id);
        if (updErr) throw updErr;
        console.log(`Updated vendor #${existing.id}: wh=${whId} "${whName}" (active=${isActive})`);
        updated.push({ id: existing.id, odoo_warehouse_id: whId, name: whName, code: wh.code });
      }
    } else {
      unchanged.push({ id: existing.id, odoo_warehouse_id: whId, name: whName, code: wh.code });
    }
  }

  const { data: finalVendors, error: finalErr } = await supabaseServer
    .from('vendors')
    .select('id, odoo_warehouse_id, name, is_active')
    .order('id', { ascending: true });
  if (finalErr) throw finalErr;

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    odooVendorWarehouses: (odooWarehouses || []).length,
    created: created.length,
    updated: updated.length,
    unchanged: unchanged.length,
    totalSupabaseVendors: (finalVendors || []).length,
    createdList: created,
  }, null, 2));
}

main().catch((err) => {
  console.error('Sync vendors to Supabase failed:', err);
  process.exit(1);
});
