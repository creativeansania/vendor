import jwt from 'jsonwebtoken';
import { supabaseServer } from './supabaseServer.js';

export const AUTH_COOKIE_NAME = 'pwa_token';
export const AUTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days in seconds

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

export function verifyJwtToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

function extractTokenFromRequest(req) {
  // 1. Prefer HttpOnly session cookie
  const cookieToken = req.cookies?.get?.(AUTH_COOKIE_NAME)?.value;
  if (cookieToken) {
    return cookieToken;
  }

  // Fallback raw Cookie header parser (for plain Request objects without NextRequest.cookies)
  const rawCookie = req.headers?.get?.('cookie');
  if (rawCookie) {
    const match = rawCookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${AUTH_COOKIE_NAME}=`));
    if (match) {
      const val = decodeURIComponent(match.substring(AUTH_COOKIE_NAME.length + 1));
      if (val) return val;
    }
  }

  // 2. Fallback Authorization: Bearer header (API / integration compatibility)
  const authHeader = req.headers?.get?.('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  return null;
}

export async function authenticateRequest(req) {
  const token = extractTokenFromRequest(req);

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
