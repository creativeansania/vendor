import bcrypt from 'bcryptjs';
import { db } from '../src/core/database/mysql.js';

async function seedInitialUsers() {
  console.log('Seeding initial users...');

  // 1. Master Admin
  const adminEmail = 'admin@kantiss.com';
  const adminPass = '@Bagusbemo1998';
  const adminHash = await bcrypt.hash(adminPass, 10);

  await db.query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES (?, ?, ?, 'master_admin')
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'master_admin', is_active = 1`,
    ['Master Admin', adminEmail, adminHash]
  );
  console.log(`✅ Master Admin seeded: ${adminEmail} (password: ${adminPass})`);

  // 2. Sample Master Vendor (VENDOR KWS)
  const [kwsRows] = await db.query('SELECT id FROM vendors WHERE name LIKE "%KWS%" LIMIT 1');
  if (kwsRows.length > 0) {
    const kwsId = kwsRows[0].id;

    // Master Vendor KWS (Price Visible)
    const mvEmail = 'kws.owner@vendor.com';
    const mvPass = 'vendor123';
    const mvHash = await bcrypt.hash(mvPass, 10);
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, vendor_id)
       VALUES (?, ?, ?, 'master_vendor', ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'master_vendor', vendor_id = VALUES(vendor_id), is_active = 1`,
      ['Vendor KWS Owner', mvEmail, mvHash, kwsId]
    );
    console.log(`✅ Master Vendor seeded: ${mvEmail} (password: ${mvPass})`);

    // Admin Vendor KWS (Price Hidden)
    const avEmail = 'kws.staff@vendor.com';
    const avPass = 'vendor123';
    const avHash = await bcrypt.hash(avPass, 10);
    await db.query(
      `INSERT INTO users (name, email, password_hash, role, vendor_id)
       VALUES (?, ?, ?, 'admin_vendor', ?)
       ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = 'admin_vendor', vendor_id = VALUES(vendor_id), is_active = 1`,
      ['Vendor KWS Staff', avEmail, avHash, kwsId]
    );
    console.log(`✅ Admin Vendor seeded: ${avEmail} (password: ${avPass})`);
  }

  const [users] = await db.query(
    `SELECT u.id, u.name, u.email, u.role, v.name AS vendor_name
     FROM users u
     LEFT JOIN vendors v ON v.id = u.vendor_id`
  );
  console.log('\nUsers table:');
  console.table(users);
}

seedInitialUsers()
  .catch(console.error)
  .finally(() => db.end());
