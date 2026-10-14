import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../../core/database/mysql.js';

export class AuthService {
  async login({ email, password }) {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.vendor_id, u.token_version, u.is_active, v.name AS vendor_name
       FROM users u
       LEFT JOIN vendors v ON v.id = u.vendor_id
       WHERE u.email = ?`,
      [email.toLowerCase().trim()]
    );

    if (rows.length === 0) {
      throw new Error('Email atau password salah');
    }

    const user = rows[0];
    if (!user.is_active) {
      throw new Error('Akun dinonaktifkan. Silakan hubungi Master Admin.');
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      throw new Error('Email atau password salah');
    }

    // Update last_login_at
    await db.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

    const secret = process.env.JWT_SECRET || 'kantiss_pwa_vendor_secret_key_2026_super_secure';
    const payload = {
      id: user.id,
      email: user.email,
      role: user.role,
      vendor_id: user.vendor_id,
      token_version: user.token_version
    };

    const token = jwt.sign(payload, secret, { expiresIn: '7d' });

    return {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        vendor_id: user.vendor_id,
        vendor_name: user.vendor_name
      }
    };
  }

  async getMe(userId) {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.vendor_id, u.created_at, u.last_login_at, v.name AS vendor_name
       FROM users u
       LEFT JOIN vendors v ON v.id = u.vendor_id
       WHERE u.id = ?`,
      [userId]
    );

    if (rows.length === 0) {
      throw new Error('User not found');
    }

    return rows[0];
  }
}

export const authService = new AuthService();
