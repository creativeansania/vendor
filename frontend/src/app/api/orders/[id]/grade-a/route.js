import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export async function POST(req, { params }) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const qtyGradeA = body.qtyGradeA !== undefined ? body.qtyGradeA : body.qty_grade_a;
    const noSuratJalan = body.noSuratJalan !== undefined ? body.noSuratJalan : (body.no_surat_jalan || body.no_surat_jalan_sfp);

    const result = await wipService.submitGradeA({
      user: auth.user,
      orderId: Number(id),
      qtyGradeA,
      noSuratJalan
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /orders/[id]/grade-a] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
