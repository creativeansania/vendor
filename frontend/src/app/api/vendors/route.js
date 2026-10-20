import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';

const VENDOR_WAREHOUSE_CODES = {
  64: 'VDNB',
  37: 'VDUS',
  54: 'VDAJ',
  35: 'VDKWS',
  39: 'VDYY',
  36: 'VDHR',
  41: 'VDHD',
  40: 'VDAM',
  38: 'VDIP'
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
