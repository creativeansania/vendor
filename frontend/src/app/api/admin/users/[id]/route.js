import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { authenticateRequest } from '@/lib/auth';
import { supabaseServer } from '@/lib/supabaseServer';

const VALID_ROLES = ['master_admin', 'admin', 'master_vendor', 'admin_vendor'];

export async function PUT(req, { params }) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (auth.user.role !== 'master_admin') {
      return NextResponse.json(
        { success: false, message: 'Hanya Master Admin yang dapat mengubah akun pengguna.' },
        { status: 403 }
      );
    }

    const { id } = await params;
    const userId = Number(id);
    if (!userId || Number.isNaN(userId)) {
      return NextResponse.json({ success: false, message: 'ID pengguna tidak valid.' }, { status: 400 });
    }

    const { data: existing, error: fetchErr } = await supabaseServer
      .from('users')
      .select('id, role, is_active, token_version')
      .eq('id', userId)
      .maybeSingle();

    if (fetchErr) {
      throw fetchErr;
    }
    if (!existing) {
      return NextResponse.json({ success: false, message: 'Pengguna tidak ditemukan.' }, { status: 404 });
    }

    const data = await req.json();
    const updates = {};
    let shouldBumpTokenVersion = false;

    if (data.name && String(data.name).trim()) {
      updates.name = String(data.name).trim();
    }

    const targetRole = data.role || existing.role;
    if (data.role) {
      if (!VALID_ROLES.includes(data.role)) {
        return NextResponse.json({ success: false, message: 'Role tidak valid.' }, { status: 400 });
      }
      updates.role = data.role;
      if (data.role !== existing.role) {
        shouldBumpTokenVersion = true;
      }
    }

    const isVendor = ['master_vendor', 'admin_vendor'].includes(targetRole);
    if (data.vendor_id !== undefined || data.role) {
      if (isVendor) {
        const nextVendorId = data.vendor_id ? Number(data.vendor_id) : null;
        if (!nextVendorId) {
          return NextResponse.json(
            { success: false, message: 'Vendor wajib dipilih untuk role vendor.' },
            { status: 400 }
          );
        }
        updates.vendor_id = nextVendorId;
      } else {
        updates.vendor_id = null;
      }
    }

    if (data.is_active !== undefined) {
      const nextActive = Boolean(data.is_active);
      updates.is_active = nextActive;
      if (nextActive !== existing.is_active) {
        shouldBumpTokenVersion = true;
      }
    }

    if (data.password !== undefined && String(data.password).trim() !== '') {
      const cleanPwd = String(data.password).trim();
      if (cleanPwd.length < 6) {
        return NextResponse.json(
          { success: false, message: 'Password baru minimal harus terdiri dari 6 karakter.' },
          { status: 400 }
        );
      }
      updates.password_hash = await bcrypt.hash(cleanPwd, 10);
      shouldBumpTokenVersion = true;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ success: true, message: 'Tidak ada perubahan untuk disimpan.' });
    }

    if (shouldBumpTokenVersion) {
      updates.token_version = Number(existing.token_version || 0) + 1;
    }
    updates.updated_at = new Date().toISOString();

    const { error: updateErr } = await supabaseServer
      .from('users')
      .update(updates)
      .eq('id', userId);

    if (updateErr) {
      throw updateErr;
    }

    return NextResponse.json({ success: true, message: 'Akun pengguna berhasil diperbarui.' });
  } catch (err) {
    console.error('[API /admin/users/[id] PUT] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}

