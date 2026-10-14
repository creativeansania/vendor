import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Shared MySQL connection pool for the Vendor PWA (cPanel MySQL).
 * Small pool on purpose: cPanel shared hosting limits concurrent connections.
 */
export const db = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 5),
  queueLimit: 0,
  timezone: 'Z',
  dateStrings: false,
  connectTimeout: 15000
});

export async function pingDb() {
  const [rows] = await db.query('SELECT 1 AS ok, VERSION() AS version, DATABASE() AS db');
  return rows[0];
}
