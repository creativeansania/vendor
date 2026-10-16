import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';

export async function GET(req) {
  const auth = await authenticateRequest(req);
  if (auth.error) {
    return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
  }

  const { data: userWithVendor } = await supabaseServer
    .from('users')
    .select('id, name, email, role, vendor_id, vendors(name)')
    .eq('id', auth.user.id)
    .single();

  const vendorName = userWithVendor?.vendors?.name || null;

  return NextResponse.json({
    success: true,
    user: {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
      role: auth.user.role,
      vendor_id: auth.user.vendor_id,
      vendor_name: vendorName
    }
  });
}
