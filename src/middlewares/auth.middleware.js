import jwt from 'jsonwebtoken';
import { db } from '../core/database/mysql.js';

export async function authenticateJwt(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required. Missing Bearer token.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const secret = process.env.JWT_SECRET || 'kantiss_pwa_vendor_secret_key_2026_super_secure';
    const decoded = jwt.verify(token, secret);

    // Fetch user from DB to verify active status and token_version
    const [rows] = await db.query(
      `SELECT u.id, u.name, u.email, u.role, u.vendor_id, u.token_version, u.is_active, v.name AS vendor_name
       FROM users u
       LEFT JOIN vendors v ON v.id = u.vendor_id
       WHERE u.id = ?`,
      [decoded.id]
    );

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ success: false, message: 'User account is inactive or not found.' });
    }

    const user = rows[0];
    if (decoded.token_version !== undefined && decoded.token_version !== user.token_version) {
      return res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      vendor_id: user.vendor_id,
      vendor_name: user.vendor_name
    };

    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden. Role '${req.user.role}' is not authorized. Required: ${roles.join(', ')}`
      });
    }
    next();
  };
}
