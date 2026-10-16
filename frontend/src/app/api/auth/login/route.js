import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { supabaseServer } from '@/lib/supabaseServer';
import { signToken } from '@/lib/auth';

export async function POST(req) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ success: false, message: 'Email dan password wajib diisi.' }, { status: 400 });
    }

    const cleanEmail = email.toLowerCase().trim();

    const { data: user, error } = await supabaseServer
      .from('users')
      .select('id, name, email, password_hash, role, vendor_id, token_version, is_active, vendors(name)')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (error || !user) {
      return NextResponse.json({ success: false, message: 'Email atau password salah.' }, { status: 401 });
    }

    if (!user.is_active) {
      return NextResponse.json({ success: false, message: 'Akun Anda dinonaktifkan. Hubungi Master Admin.' }, { status: 403 });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return NextResponse.json({ success: false, message: 'Email atau password salah.' }, { status: 401 });
    }

    // Update last_login_at
    await supabaseServer
      .from('users')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', user.id);

    const token = signToken(user);
    const vendorName = user.vendors ? user.vendors.name : null;

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        vendor_id: user.vendor_id,
        vendor_name: vendorName
      }
    });
  } catch (err) {
    console.error('[API /auth/login] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
