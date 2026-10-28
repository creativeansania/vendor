import { NextResponse } from 'next/server';
import { wipService } from '@/lib/services/wipService';
import { supabaseServer } from '@/lib/supabaseServer';
import { authenticateRequest } from '@/lib/auth';

export async function POST(req) {
  try {
    let payload = {};
    try {
      payload = await req.json();
    } catch (e) {
      payload = {};
    }

    const { searchParams } = new URL(req.url);
    const rawWipId = payload.wipId || payload.id || searchParams.get('id') || searchParams.get('wipId');
    const rollUpdates = payload.rollUpdates || payload.lines || [];
    const actualCutting = payload.actualCutting !== undefined ? payload.actualCutting : payload.effectiveActual;

    if (!rawWipId || !Array.isArray(rollUpdates)) {
      return NextResponse.json({
        success: false,
        message: 'WIP ID and rollUpdates array are required'
      }, { status: 400 });
    }

    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user) {
      return NextResponse.json(
        { success: false, message: auth.error || 'Autentikasi diperlukan.' },
        { status: auth.status || 401 }
      );
    }

    if (!['master_admin', 'master_vendor', 'admin_vendor'].includes(auth.user.role)) {
      return NextResponse.json(
        { success: false, message: 'Anda tidak memiliki izin untuk menginput hasil potong.' },
        { status: 403 }
      );
    }

    const user = auth.user;

    let orderId = Number(rawWipId);
    const { data: byOdooWip } = await supabaseServer
      .from('wip_orders')
      .select('id')
      .eq('odoo_wip_id', orderId)
      .maybeSingle();

    if (byOdooWip) {
      orderId = byOdooWip.id;
    }

    const result = await wipService.submitCuttingRolls({
      user,
      orderId,
      rollUpdates,
      actualCutting: actualCutting !== undefined ? Number(actualCutting) : undefined
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[WIP API] Error updating roll cuttings:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
