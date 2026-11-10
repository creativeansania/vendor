import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export const maxDuration = 60;

export async function POST(req) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const body = await req.json();
    const globalSj = (body.noSuratJalan || '').trim();
    const items = Array.isArray(body.items) ? body.items : [];

    if (items.length === 0) {
      return NextResponse.json({ success: false, message: 'Tidak ada item yang dipilih untuk dikirim.' }, { status: 400 });
    }

    const results = [];
    const errors = [];

    for (const item of items) {
      const orderId = Number(item.orderId);
      if (!orderId || isNaN(orderId)) continue;

      const qtyA = Math.max(0, Number(item.qtyGradeA || 0));
      const qtyB = Math.max(0, Number(item.qtyGradeB || 0));
      const suratJalan = (item.noSuratJalan || globalSj || '').trim();
      const sjB = (item.noSuratJalanGradeB || suratJalan || '').trim();

      try {
        let resA = null;
        let resB = null;

        // Submit Grade A
        if (qtyA > 0 || suratJalan) {
          resA = await wipService.submitGradeA({
            user: auth.user,
            orderId,
            qtyGradeA: qtyA,
            noSuratJalan: suratJalan
          });
        }

        // Submit Grade B if specified
        if (qtyB > 0) {
          resB = await wipService.submitGradeB({
            user: auth.user,
            orderId,
            qtyGradeB: qtyB,
            noSuratJalanGradeB: sjB
          });
        }

        results.push({
          orderId,
          success: true,
          gradeA: resA,
          gradeB: resB
        });
      } catch (errItem) {
        console.error(`[Batch Shipments] Error order #${orderId}:`, errItem.message);
        errors.push({ orderId, error: errItem.message });
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      totalRequested: items.length,
      successCount: results.length,
      errorCount: errors.length,
      results,
      errors
    });
  } catch (err) {
    console.error('[Batch Shipments] Server error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}

