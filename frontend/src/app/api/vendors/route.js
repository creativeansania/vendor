import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';

export async function GET(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const { data: vendors, error } = await supabaseServer
      .from('vendors')
      .select('id, odoo_warehouse_id, name')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true, vendors: vendors || [] });
  } catch (err) {
    if (err.digest === 'NEXT_PRERENDER_INTERRUPTED') throw err;
    console.error('[API /vendors] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
