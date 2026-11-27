import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';

const VENDOR_WAREHOUSE_CODES = {
  35: 'VDKWS',
  36: 'VDHR',
  37: 'VDUS',
  38: 'VDIP',
  39: 'VDYY',
  40: 'VDAM',
  41: 'VDHD',
  54: 'VDAJ',
  55: 'VDEV',
  56: 'VDRZ',
  64: 'VDNB',
  76: 'VDJM',
  84: 'VDBUM',
  86: 'VDBGA',
  87: 'VDJBI'
};

export async function GET(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const { data: rawVendors, error } = await supabaseServer
      .from('vendors')
      .select('id, odoo_warehouse_id, name')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    const vendors = (rawVendors || []).map((v) => ({
      ...v,
      code: VENDOR_WAREHOUSE_CODES[v.odoo_warehouse_id] || ''
    }));

    return NextResponse.json({ success: true, vendors });
  } catch (err) {
    if (err.digest === 'NEXT_PRERENDER_INTERRUPTED') throw err;
    console.error('[API /vendors] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
