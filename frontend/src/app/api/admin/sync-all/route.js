import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export async function POST(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    if (auth.user.role !== 'master_admin') {
      return NextResponse.json({ success: false, message: 'Hanya Master Admin yang dapat melakukan full sync Odoo.' }, { status: 403 });
    }

    console.log(`[API /admin/sync-all] Started initial full sync triggered by ${auth.user.email}...`);
    const result = await wipService.syncAllFromOdoo();

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /admin/sync-all] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}
