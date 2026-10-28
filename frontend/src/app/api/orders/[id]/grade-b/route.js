import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

export const maxDuration = 60;

export async function POST(req, { params }) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const qtyGradeB = body.qtyGradeB !== undefined ? body.qtyGradeB : body.qty_grade_b;
    const noSuratJalanGradeB = body.noSuratJalanGradeB !== undefined ? body.noSuratJalanGradeB : body.no_surat_jalan_grade_b;

    const result = await wipService.submitGradeB({
      user: auth.user,
      orderId: Number(id),
      qtyGradeB,
      noSuratJalanGradeB
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /orders/[id]/grade-b] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
