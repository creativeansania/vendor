import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export async function GET(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search');
    const status = searchParams.get('status');
    const vendorId = searchParams.get('vendorId');
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '20';
    const sort = searchParams.get('sort') || 'latest';
    const period = searchParams.get('period');
    const backorder = searchParams.get('backorder');
    const includeMetrics = searchParams.get('includeMetrics') !== '0';

    const result = await wipService.getOrders({
      user: auth.user,
      search,
      status,
      vendorId,
      page,
      limit,
      sort,
      period,
      backorder,
      includeMetrics
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err.digest === 'NEXT_PRERENDER_INTERRUPTED') throw err;
    console.error('[API /orders] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
