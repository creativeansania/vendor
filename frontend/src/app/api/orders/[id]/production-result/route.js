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
    const qtyGradeB = body.qtyGradeB !== undefined ? body.qtyGradeB : body.qty_grade_b;
    const sisaMakloonKg = body.sisaMakloonKg !== undefined ? body.sisaMakloonKg : body.sisa_makloon_kg;
    const noSuratJalan = body.noSuratJalan !== undefined ? body.noSuratJalan : (body.no_surat_jalan || body.no_surat_jalan_sfp);

    const result = await wipService.submitProductionResult({
      user: auth.user,
      orderId: Number(id),
      qtyGradeA,
      qtyGradeB,
      sisaMakloonKg,
      noSuratJalan
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /orders/[id]/production-result] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
