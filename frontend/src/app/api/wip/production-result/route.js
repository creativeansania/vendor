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
    const rawWipId = payload.wipId || payload._id || payload.id || searchParams.get('id') || searchParams.get('wipId');
    const qtyGradeA = payload.qtyGradeA !== undefined ? payload.qtyGradeA : payload.x_studio_qty_kirim_a_grade;
    const qtyGradeB = payload.qtyGradeB !== undefined ? payload.qtyGradeB : payload.x_studio_qty_kirim_b_grade;
    const sisaPotongPanjang = payload.sisaPotongPanjang !== undefined ? payload.sisaPotongPanjang : (payload.sisa_potong_panjang !== undefined ? payload.sisa_potong_panjang : payload.x_studio_sisa_potong_panjang);
    const sisaPotongSedang = payload.sisaPotongSedang !== undefined ? payload.sisaPotongSedang : (payload.sisa_potong_sedang !== undefined ? payload.sisa_potong_sedang : payload.x_studio_sisa_potong_sedang);
    const sisaPotongPendek = payload.sisaPotongPendek !== undefined ? payload.sisaPotongPendek : (payload.sisa_potong_pendek !== undefined ? payload.sisa_potong_pendek : payload.x_studio_sisa_potong_pendek);
    const sisaMakloonKg = payload.sisaMakloonKg !== undefined ? payload.sisaMakloonKg : (payload.sisa_makloon_kg !== undefined ? payload.sisa_makloon_kg : payload.x_studio_sisa_makloon_kg);
    const noSuratJalan = payload.noSuratJalan || payload.no_surat_jalan_sfp || payload.x_studio_no_surat_jalan_sfp;

    if (!rawWipId) {
      return NextResponse.json({ success: false, message: 'WIP ID is required' }, { status: 400 });
    }

    // Enforce authentication & role permissions
    const auth = await authenticateRequest(req);
    if (auth.error || !auth.user) {
      return NextResponse.json(
        { success: false, message: auth.error || 'Autentikasi diperlukan.' },
        { status: auth.status || 401 }
      );
    }

    if (!['master_admin', 'master_vendor', 'admin_vendor'].includes(auth.user.role)) {
      return NextResponse.json(
        { success: false, message: 'Anda tidak memiliki izin untuk menginput hasil produksi.' },
        { status: 403 }
      );
    }

    const user = auth.user;

    // Resolve orderId in Supabase
    let orderId = Number(rawWipId);
    const { data: byOdooWip } = await supabaseServer
      .from('wip_orders')
      .select('id')
      .eq('odoo_wip_id', orderId)
      .maybeSingle();

    if (byOdooWip) {
      orderId = byOdooWip.id;
    }

    const result = await wipService.submitProductionResult({
      user,
      orderId,
      qtyGradeA: Number(qtyGradeA || 0),
      qtyGradeB: Number(qtyGradeB || 0),
      sisaPotongPanjang: sisaPotongPanjang !== undefined ? Number(sisaPotongPanjang) : undefined,
      sisaPotongSedang: sisaPotongSedang !== undefined ? Number(sisaPotongSedang) : undefined,
      sisaPotongPendek: sisaPotongPendek !== undefined ? Number(sisaPotongPendek) : undefined,
      sisaMakloonKg: sisaMakloonKg !== undefined ? Number(sisaMakloonKg) : 0,
      noSuratJalan
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error('[WIP API] Error submitting production result:', err.message);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}
