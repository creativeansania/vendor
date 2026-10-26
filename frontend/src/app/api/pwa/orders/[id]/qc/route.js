import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth';
import { wipService } from '@/lib/services/wipService';

const ADMIN_ROLES = ['master_admin', 'admin'];

export async function GET(req, { params }) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    if (!ADMIN_ROLES.includes(auth.user.role)) {
      return NextResponse.json({
        success: false,
        message: 'Akses ditolak: Form Quality Control (QC) hanya dapat diakses oleh Master Admin dan Admin Internal.'
      }, { status: 403 });
    }

    const { id } = await params;
    const details = await wipService.getQcDetails({ user: auth.user, orderId: Number(id) });
    return NextResponse.json({
      success: true,
      inspectors: details.inspectors,
      gambarQc: details.gambarQc,
      order: details.order
    });
  } catch (err) {
    console.error('[API /pwa/orders/[id]/qc GET] error:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 400 });
  }
}

export async function POST(req, { params }) {
  try {
    const auth = await authenticateRequest(req);
    if (auth.error) {
      return NextResponse.json({ success: false, message: auth.error }, { status: auth.status || 401 });
    }

    if (!ADMIN_ROLES.includes(auth.user.role)) {
      return NextResponse.json({
        success: false,
        message: 'Akses ditolak: Form Quality Control (QC) hanya dapat diakses oleh Master Admin dan Admin Internal.'
      }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();

    const qcPassId = body.qcPassId !== undefined ? body.qcPassId : body.qc_pass_id;
    const qcPassName = body.qcPassName !== undefined ? body.qcPassName : body.qc_pass_name;
    const qtyQcPass = body.qtyQcPass !== undefined ? body.qtyQcPass : body.qty_qc_pass;
    const qcStatus = body.qcStatus !== undefined ? body.qcStatus : body.qc_status;
    const keteranganQms = body.keteranganQms !== undefined ? body.keteranganQms : body.keterangan_qms;
    const gambarQc = body.gambarQc !== undefined ? body.gambarQc : body.gambar_qc;

    const result = await wipService.submitQcResult({
      user: auth.user,
      orderId: Number(id),
      qcPassId,
      qcPassName,
      qtyQcPass,
      qcStatus,
      keteranganQms,
      gambarQc
    });

    return NextResponse.json({
      success: true,
      message: 'Hasil Quality Control (QC) berhasil disimpan dan disinkronkan ke Odoo.',
      order: result.order || result
    });
  } catch (err) {
    console.error('[API /pwa/orders/[id]/qc POST] error:', err);
    return NextResponse.json({
      success: false,
      message: err.message || 'Gagal menyimpan hasil Quality Control (QC).'
    }, { status: err.statusCode || 400 });
  }
}
