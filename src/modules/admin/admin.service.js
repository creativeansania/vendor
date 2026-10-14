import bcrypt from 'bcryptjs';
import { db } from '../../core/database/mysql.js';

export class AdminService {
  async getUsers() {
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.vendor_id, u.is_active, u.created_at, u.last_login_at, v.name AS vendor_name
       FROM users u
       LEFT JOIN vendors v ON v.id = u.vendor_id
       ORDER BY u.id DESC`
    );
    return rows;
  }

  async createUser({ name, email, password, role, vendor_id }) {
    if (!name || !email || !password || !role) {
      throw new Error('Name, email, password, and role are required');
    }

    const cleanEmail = email.toLowerCase().trim();
    const validRoles = ['master_admin', 'admin', 'master_vendor', 'admin_vendor'];
    if (!validRoles.includes(role)) {
      throw new Error(`Invalid role: ${role}. Valid roles: ${validRoles.join(', ')}`);
    }

    const isVendor = ['master_vendor', 'admin_vendor'].includes(role);
    if (isVendor && !vendor_id) {
      throw new Error('vendor_id is required for vendor roles');
    }

    // Check duplicate email
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [cleanEmail]);
    if (existing.length > 0) {
      throw new Error(`Email ${cleanEmail} is already registered`);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [res] = await db.query(
      `INSERT INTO users (name, email, password_hash, role, vendor_id)
       VALUES (?, ?, ?, ?, ?)`,
      [name.trim(), cleanEmail, passwordHash, role, isVendor ? Number(vendor_id) : null]
    );

    return {
      id: res.insertId,
      name,
      email: cleanEmail,
      role,
      vendor_id: isVendor ? Number(vendor_id) : null
    };
  }

  async updateUser(id, data) {
    const [rows] = await db.query('SELECT id, token_version FROM users WHERE id = ?', [id]);
    if (rows.length === 0) {
      throw new Error('User not found');
    }

    const updates = [];
    const params = [];

    if (data.name) {
      updates.push('name = ?');
      params.push(data.name.trim());
    }

    if (data.role) {
      const validRoles = ['master_admin', 'admin', 'master_vendor', 'admin_vendor'];
      if (!validRoles.includes(data.role)) {
        throw new Error('Invalid role');
      }
      updates.push('role = ?');
      params.push(data.role);
    }

    if (data.vendor_id !== undefined) {
      updates.push('vendor_id = ?');
      params.push(data.vendor_id ? Number(data.vendor_id) : null);
    }

    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(data.is_active ? 1 : 0);
      // Invalidate session on deactivation
      updates.push('token_version = token_version + 1');
    }

    if (data.password && data.password.trim().length >= 6) {
      const passwordHash = await bcrypt.hash(data.password, 10);
      updates.push('password_hash = ?');
      params.push(passwordHash);
      // Invalidate existing sessions on password change
      updates.push('token_version = token_version + 1');
    }

    if (updates.length === 0) {
      return { success: true, message: 'Nothing to update' };
    }

    const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
    params.push(id);
    await db.query(sql, params);

    return { success: true, message: 'User updated successfully' };
  }
}

export const adminService = new AdminService();
