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

    const sisaPotongPanjang = body.sisaPotongPanjang !== undefined ? body.sisaPotongPanjang : body.sisa_potong_panjang;
    const sisaPotongSedang = body.sisaPotongSedang !== undefined ? body.sisaPotongSedang : body.sisa_potong_sedang;
    const sisaPotongPendek = body.sisaPotongPendek !== undefined ? body.sisaPotongPendek : body.sisa_potong_pendek;
    const sisaMakloonKg = body.sisaMakloonKg !== undefined ? body.sisaMakloonKg : body.sisa_makloon_kg;
    const noSuratJalanBskl = body.noSuratJalanBskl !== undefined ? body.noSuratJalanBskl : (body.no_surat_jalan_bskl || body.delivery_slip);

    const result = await wipService.submitBskl({
      user: auth.user,
      orderId: Number(id),
      sisaPotongPanjang,
      sisaPotongSedang,
      sisaPotongPendek,
      sisaMakloonKg,
      noSuratJalanBskl
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[API /orders/[id]/bskl] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
