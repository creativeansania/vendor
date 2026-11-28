import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import {
  listBuyerDashboards,
  createBuyerDashboard,
  saveBuyerSnapshot
} from '@/lib/services/buyerDashboard/buyerDashboardRepo';
import {
  listOdooExternalBuyers,
  syncBuyerSnapshotFromOdoo
} from '@/lib/services/buyerDashboard/buyerWipSyncService';

function isAuthorizedAdmin(user) {
  return user && ['master_admin', 'admin'].includes(user.role);
}

export async function GET(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (!isAuthorizedAdmin(auth.user)) {
      return NextResponse.json(
        { success: false, message: 'Hanya Admin / Master Admin yang dapat mengelola link dashboard buyer.' },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const includePartners = url.searchParams.get('include_partners') === '1';

    const [dashboards, odooPartners] = await Promise.all([
      listBuyerDashboards(),
      includePartners ? listOdooExternalBuyers() : Promise.resolve(null)
    ]);

    return NextResponse.json({
      success: true,
      dashboards,
      ...(includePartners ? { odoo_partners: odooPartners || [] } : {})
    });
  } catch (err) {
    console.error('[API /admin/buyers GET] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }
    if (!isAuthorizedAdmin(auth.user)) {
      return NextResponse.json(
        { success: false, message: 'Hanya Admin / Master Admin yang dapat membuat link dashboard buyer.' },
        { status: 403 }
      );
    }

    const body = await req.json();
    const created = await createBuyerDashboard({
      buyer_name: body?.buyer_name,
      odoo_partner_ids: body?.odoo_partner_ids,
      odoo_partner_names: body?.odoo_partner_names || [],
      start_date: body?.start_date !== undefined ? body.start_date : '2026-06-01',
      notes: body?.notes || '',
      created_by: auth.user.id
    });

    // Warm up the snapshot immediately so the buyer link opens fast on first visit
    let syncWarning = null;
    let initialSummary = null;
    try {
      const snap = await syncBuyerSnapshotFromOdoo(created);
      await saveBuyerSnapshot(created.token, snap);
      initialSummary = snap.summary;
    } catch (syncErr) {
      console.warn('[API /admin/buyers POST] Initial warm sync failed:', syncErr.message);
      syncWarning = syncErr.message;
    }

    return NextResponse.json({
      success: true,
      data: {
        ...created,
        last_summary: initialSummary,
        last_synced_at: initialSummary ? new Date().toISOString() : null
      },
      share_path: `/buyer/${created.token}`,
      sync_warning: syncWarning
    });
  } catch (err) {
    console.error('[API /admin/buyers POST] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
