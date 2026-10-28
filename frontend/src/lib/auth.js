import jwt from 'jsonwebtoken';
import { supabaseServer } from './supabaseServer.js';

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable belum dikonfigurasi.');
  }
  return secret;
}

export function signToken(user) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
    vendor_id: user.vendor_id,
    token_version: user.token_version || 0
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

export async function authenticateRequest(req) {
  const authHeader = req.headers.get('authorization');
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    return { error: 'Token otentikasi tidak ditemukan. Silakan login kembali.', status: 401 };
  }

  try {
    const decoded = jwt.verify(token, getJwtSecret());
    
    // Check if user is still active in Supabase
    const { data: user, error } = await supabaseServer
      .from('users')
      .select('id, name, email, role, vendor_id, token_version, is_active')
      .eq('id', decoded.id)
      .single();

    if (error || !user || !user.is_active) {
      return { error: 'Akun tidak aktif atau tidak ditemukan.', status: 401 };
    }

    if (user.token_version !== decoded.token_version) {
      return { error: 'Sesi login telah kadaluarsa. Silakan login ulang.', status: 401 };
    }

    return { user };
  } catch (err) {
    return { error: 'Sesi tidak valid: ' + err.message, status: 401 };
  }
}
