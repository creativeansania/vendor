import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { authenticateRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';

const VALID_ROLES = ['master_admin', 'admin', 'master_vendor', 'admin_vendor'];

export async function GET(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (auth.user.role !== 'master_admin') {
      return NextResponse.json(
        { success: false, message: 'Hanya Master Admin yang dapat mengelola akun pengguna.' },
        { status: 403 }
      );
    }

    const { data: rows, error } = await supabaseServer
      .from('users')
      .select('id, name, email, role, vendor_id, is_active, created_at, last_login_at, vendors ( id, name )')
      .order('id', { ascending: false });

    if (error) {
      throw error;
    }

    const users = (rows || []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      vendor_id: u.vendor_id,
      vendor_name: u.vendors?.name || null,
      is_active: u.is_active,
      created_at: u.created_at,
      last_login_at: u.last_login_at
    }));

    return NextResponse.json({ success: true, data: users, users });
  } catch (err) {
    console.error('[API /admin/users GET] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}

export async function POST(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (auth.user.role !== 'master_admin') {
      return NextResponse.json(
        { success: false, message: 'Hanya Master Admin yang dapat membuat akun pengguna.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { name, email, password, role, vendor_id } = body || {};

    if (!name || !email || !password || !role) {
      return NextResponse.json(
        { success: false, message: 'Nama, email, password, dan role wajib diisi.' },
        { status: 400 }
      );
    }

    if (String(password).trim().length < 6) {
      return NextResponse.json(
        { success: false, message: 'Password minimal harus terdiri dari 6 karakter.' },
        { status: 400 }
      );
    }

    const cleanEmail = String(email).toLowerCase().trim();
    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json(
        { success: false, message: `Role tidak valid: ${role}` },
        { status: 400 }
      );
    }

    const isVendor = ['master_vendor', 'admin_vendor'].includes(role);
    if (isVendor && !vendor_id) {
      return NextResponse.json(
        { success: false, message: 'Vendor wajib dipilih untuk role vendor.' },
        { status: 400 }
      );
    }

    const { data: existing } = await supabaseServer
      .from('users')
      .select('id')
      .eq('email', cleanEmail)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { success: false, message: `Email ${cleanEmail} sudah terdaftar.` },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    const { data: created, error: insertErr } = await supabaseServer
      .from('users')
      .insert({
        name: String(name).trim(),
        email: cleanEmail,
        password_hash: passwordHash,
        role,
        vendor_id: isVendor ? Number(vendor_id) : null,
        is_active: true
      })
      .select('id, name, email, role, vendor_id, is_active, created_at')
      .single();

    if (insertErr) {
      throw insertErr;
    }

    return NextResponse.json({ success: true, data: created });
  } catch (err) {
    console.error('[API /admin/users POST] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}

