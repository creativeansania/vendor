import { adminOdooClient } from '../src/lib/odoo/odooClient.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function inspect22Missing() {
  await adminOdooClient.authenticate();

  const missingMoNames = [
    'VDKWS/MO/05336-001',
    'VDIP/MO/00596-001',
    'VDNB/MO/00444',
    'VDKWS/MO/05096-001', 'VDKWS/MO/05096-002',
    'VDUS/MO/00291-001', 'VDUS/MO/00291-002', 'VDUS/MO/00291-003', 'VDUS/MO/00291-004',
    'VDHR/MO/01027-001'
  ];

  // Also find all 12 from 21/MKT/09/2026
  const so21 = await adminOdooClient._callObject('sale.order', 'search_read', [
    [['name', '=', '21/MKT/09/2026']]
  ], { fields: ['id', 'name', 'mrp_production_ids'] });

  const so21Mos = await adminOdooClient._callObject('mrp.production', 'read', [
    so21[0].mrp_production_ids,
    ['id', 'name', 'state', 'warehouse_id', 'x_studio_sales_order', 'origin']
  ]);

  const { data: supaMos } = await supabase.from('wip_orders').select('mo_name');
  const supaMoSet = new Set(supaMos.map(m => m.mo_name));

  const all22Mos = [
    ...so21Mos.filter(m => (m.name.startsWith('VD') || (m.warehouse_id && m.warehouse_id[1].includes('VENDOR'))) && !supaMoSet.has(m.name))
  ];

  for (const name of missingMoNames) {
    if (!all22Mos.some(m => m.name === name)) {
      const readM = await adminOdooClient._callObject('mrp.production', 'search_read', [
        [['name', '=', name]]
      ], { fields: ['id', 'name', 'state', 'warehouse_id', 'x_studio_sales_order', 'origin'] });
      if (readM.length > 0) all22Mos.push(readM[0]);
    }
  }

  console.log('Total identified missing MOs:', all22Mos.length);
  for (const m of all22Mos) {
    const baseName = m.name.replace(/-\d+$/, '');
    const wips = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
      ['|', ['x_studio_manufacturing_order', '=', m.id], ['x_name', 'in', [m.name, baseName]]]
    ], { fields: ['id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_warehouse'] });

    const odooWips = wips.map(w => ({ id: w.id, name: w.x_name, mo: w.x_studio_manufacturing_order }));
    console.log(`MO #${m.id} (${m.name}) [state: ${m.state}, wh: ${m.warehouse_id ? m.warehouse_id[1] : 'null'}] -> Odoo WIP count: ${wips.length}`, odooWips);
  }
}

inspect22Missing().catch(console.error);

