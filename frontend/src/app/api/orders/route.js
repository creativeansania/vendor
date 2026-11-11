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
    const soList = searchParams.get('soList') === '1' || searchParams.get('type') === 'sales_orders';
    const status = searchParams.get('status');
    const vendorId = searchParams.get('vendorId');

    if (soList) {
      const salesOrders = await wipService.getUniqueSalesOrders({
        user: auth.user,
        vendorId,
        status
      });
      return NextResponse.json({ success: true, salesOrders });
    }

    const search = searchParams.get('search');
    const searchMo = searchParams.get('searchMo') || searchParams.get('search_mo');
    const searchProduct = searchParams.get('searchProduct') || searchParams.get('search_product');
    const salesOrder = searchParams.get('salesOrder') || searchParams.get('sales_order');
    const page = searchParams.get('page') || '1';
    const limit = searchParams.get('limit') || '20';
    const sort = searchParams.get('sort') || 'latest';
    const period = searchParams.get('period');
    const backorder = searchParams.get('backorder');
    const includeMetrics = searchParams.get('includeMetrics') !== '0';

    const result = await wipService.getOrders({
      user: auth.user,
      search,
      searchMo,
      searchProduct,
      status,
      vendorId,
      salesOrder,
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
