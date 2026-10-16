import bcrypt from 'bcryptjs';
import { supabaseServer } from '../src/lib/supabaseServer.js';

async function seed() {
  const { data: vendors } = await supabaseServer.from('vendors').select('*');
  const defaultPass = 'vendor123';
  const hash = await bcrypt.hash(defaultPass, 10);

  for (const v of vendors) {
    const slug = v.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    // Master Vendor (Price Visible)
    const mvEmail = `${slug}.owner@vendor.com`;
    await supabaseServer.from('users').upsert({
      name: `${v.name} (Owner)`,
      email: mvEmail,
      password_hash: hash,
      role: 'master_vendor',
      vendor_id: v.id,
      is_active: true
    }, { onConflict: 'email' });
    console.log(`✅ Seeded Master Vendor: ${mvEmail} (${v.name})`);

    // Admin Vendor (Price Hidden)
    const avEmail = `${slug}.staff@vendor.com`;
    await supabaseServer.from('users').upsert({
      name: `${v.name} (Staff)`,
      email: avEmail,
      password_hash: hash,
      role: 'admin_vendor',
      vendor_id: v.id,
      is_active: true
    }, { onConflict: 'email' });
    console.log(`✅ Seeded Admin Vendor: ${avEmail} (${v.name})`);
  }

  const { data: allUsers } = await supabaseServer.from('users').select('id, name, email, role, vendor_id');
  console.log('\nTotal Users in Supabase:', allUsers.length);
  console.table(allUsers);
}

seed();
