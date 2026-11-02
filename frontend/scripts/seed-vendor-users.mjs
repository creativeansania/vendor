import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env.local
const envPath = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      process.env[key] = val;
    }
  }
}

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const VENDOR_ACCOUNTS = [
  { slug: 'aji', name: 'VENDOR AJI', vendor_id: 3, password: 'aji2934' },
  { slug: 'heri', name: 'VENDOR HERI', vendor_id: 6, password: 'heri2934' },
  { slug: 'hudallah', name: 'VENDOR HUDALLAH', vendor_id: 7, password: 'hudallah2934' },
  { slug: 'kws', name: 'VENDOR KWS', vendor_id: 4, password: 'kws2934' },
  { slug: 'nabila', name: 'VENDOR NABILA', vendor_id: 1, password: 'nabila2934' },
  { slug: 'ustadsilmi', name: 'VENDOR USTAD SILMI', vendor_id: 2, password: 'ustadsilmi2934' },
  { slug: 'yayan', name: 'VENDOR YAYAN', vendor_id: 5, password: 'yayan2934' },
  { slug: 'ahmad', name: 'VENDOR AHMAD', vendor_id: 8, password: 'ahmad2934' }
];

async function seed() {
  console.log('Seeding vendor admin and staff accounts into Supabase...\n');

  for (const v of VENDOR_ACCOUNTS) {
    const hash = await bcrypt.hash(v.password, 10);

    // Admin (master_vendor - harga terlihat)
    const adminEmail = `admin.${v.slug}@kantiss.com`;
    const { error: adminErr } = await supabase.from('users').upsert({
      name: `${v.name} (Admin)`,
      email: adminEmail,
      password_hash: hash,
      role: 'master_vendor',
      vendor_id: v.vendor_id,
      is_active: true
    }, { onConflict: 'email' });

    if (adminErr) {
      console.error(`❌ Gagal seed Admin ${adminEmail}:`, adminErr);
    } else {
      console.log(`✅ Admin : ${adminEmail.padEnd(32)} | Role: master_vendor | Password: ${v.password}`);
    }

    // Staff (admin_vendor - harga tersembunyi)
    const staffEmail = `staff.${v.slug}@kantiss.com`;
    const { error: staffErr } = await supabase.from('users').upsert({
      name: `${v.name} (Staff)`,
      email: staffEmail,
      password_hash: hash,
      role: 'admin_vendor',
      vendor_id: v.vendor_id,
      is_active: true
    }, { onConflict: 'email' });

    if (staffErr) {
      console.error(`❌ Gagal seed Staff ${staffEmail}:`, staffErr);
    } else {
      console.log(`✅ Staff : ${staffEmail.padEnd(32)} | Role: admin_vendor  | Password: ${v.password}`);
    }
  }

  const { data: allUsers, error: fetchErr } = await supabase
    .from('users')
    .select('id, name, email, role, vendor_id, is_active')
    .order('id');

  if (fetchErr) {
    console.error('Error fetching users:', fetchErr);
    return;
  }

  console.log('\nTotal Users in Supabase:', allUsers.length);
  console.table(allUsers);
}

seed();
