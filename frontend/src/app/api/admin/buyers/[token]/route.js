import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import {
  updateBuyerDashboard,
  deleteBuyerDashboard,
  saveBuyerSnapshot
} from '@/lib/services/buyerDashboard/buyerDashboardRepo';
import { syncBuyerSnapshotFromOdoo } from '@/lib/services/buyerDashboard/buyerWipSyncService';

function isAuthorizedAdmin(user) {
  return user && ['master_admin', 'admin'].includes(user.role);
}

export async function PATCH(req, context) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (!isAuthorizedAdmin(auth.user)) {
      return NextResponse.json(
        { success: false, message: 'Hanya Admin / Master Admin yang dapat mengubah link dashboard buyer.' },
        { status: 403 }
      );
    }

    const params = await context.params;
    const token = String(params?.token || '').trim();
    const body = await req.json();

    const updated = await updateBuyerDashboard(token, {
      buyer_name: body?.buyer_name,
      odoo_partner_ids: body?.odoo_partner_ids,
      odoo_partner_names: body?.odoo_partner_names,
      start_date: body?.start_date,
      notes: body?.notes,
      is_active: body?.is_active,
      rotate_token: Boolean(body?.rotate_token)
    });

    // If partner mapping or start_date changed, immediately re-sync snapshot
    let lastSummary = null;
    if (body?.odoo_partner_ids !== undefined || body?.start_date !== undefined) {
      try {
        const snap = await syncBuyerSnapshotFromOdoo(updated);
        await saveBuyerSnapshot(updated.token, snap);
        lastSummary = snap.summary;
      } catch (syncErr) {
        console.warn('[API /admin/buyers PATCH] Re-sync warning:', syncErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        ...updated,
        ...(lastSummary ? { last_summary: lastSummary, last_synced_at: new Date().toISOString() } : {})
      },
      share_path: `/buyer/${updated.token}`
    });
  } catch (err) {
    console.error('[API /admin/buyers/[token] PATCH] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}

export async function DELETE(req, context) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (!isAuthorizedAdmin(auth.user)) {
      return NextResponse.json(
        { success: false, message: 'Hanya Admin / Master Admin yang dapat menghapus link dashboard buyer.' },
        { status: 403 }
      );
    }

    const params = await context.params;
    const token = String(params?.token || '').trim();
    const result = await deleteBuyerDashboard(token);

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error('[API /admin/buyers/[token] DELETE] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
