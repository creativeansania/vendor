import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { getOrderDetails } from './wipQueryService.js';

/**
 * Service for Quality Control (QC) - Tab 5
 * Strictly restricted to Admin roles: master_admin and admin (internal).
 */

const ADMIN_ROLES = ['master_admin', 'admin'];

/**
 * Pre-defined QC Inspectors list:
 * Strictly limited to 2 designated QC officers:
 * 1. Yana Suryana (Odoo partner_id: 14299)
 * 2. Dindin (Odoo partner_id: 318, Dindin Saepul Mutaqin)
 */
export const QC_INSPECTORS = [
  { id: 14299, name: 'Yana Suryana' },
  { id: 318, name: 'Dindin' }
];

export function assertAdminAccess(user) {
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    const error = new Error('Akses ditolak: Form Quality Control (QC) hanya dapat diakses oleh Master Admin dan Admin Internal.');
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Fetch available QC inspectors
 * Restricted strictly to Yana Suryana and Dindin as per operational requirements.
 */
export async function getQcInspectors() {
  return QC_INSPECTORS;
}

/**
 * Fetch QC details and live QC image directly from Odoo
 * This avoids storing heavy base64 images in Supabase to conserve storage quota.
 */
export async function getQcDetails({ user, orderId }) {
  assertAdminAccess(user);

  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });
  let liveGambarQc = null;

  if (order.odoo_wip_id) {
    try {
      await adminOdooClient.authenticate();
      const rows = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'read', [
        [order.odoo_wip_id],
        ['x_studio_gambar_qc', 'x_studio_qc_pass_1', 'x_studio_qty_qc_pass_1', 'x_studio_qc_status', 'x_studio_keterangan_qms']
      ]);

      if (rows && rows[0]) {
        const r = rows[0];
        liveGambarQc = r.x_studio_gambar_qc || null;
      }
    } catch (err) {
      console.warn(`[WipQcService] Failed reading live QC image from Odoo WIP #${order.odoo_wip_id}:`, err.message);
    }
  }

  return {
    inspectors: QC_INSPECTORS,
    gambarQc: liveGambarQc,
    order
  };
}

/**
 * Submit / Update QC form results
 * NOTE: Base64 image is stored EXCLUSIVELY in Odoo (x_studio_gambar_qc)
 * and NOT stored in Supabase to keep Supabase database storage light.
 */
export async function submitQcResult({
  user,
  orderId,
  qcPassId,
  qcPassName,
  qtyQcPass,
  qcStatus,
  keteranganQms,
  gambarQc
}) {
  assertAdminAccess(user);

  const { order } = await getOrderDetails({ user, orderId, includeRawMoves: false });

  const numQty = Math.max(0, Number(qtyQcPass || 0));
  const validStatus = ['Passed', 'Reject', 'Cancel'].includes(qcStatus) ? qcStatus : (qcStatus ? String(qcStatus) : null);
  const passId = qcPassId ? Number(qcPassId) : null;
  const passName = qcPassName ? String(qcPassName).trim() : null;
  const keterangan = keteranganQms !== undefined ? (keteranganQms ? String(keteranganQms).trim() : null) : undefined;
  const gambar = gambarQc !== undefined ? (gambarQc || null) : undefined;

  // 1. Update in Supabase - ONLY store lightweight metadata & boolean flag (NO base64 image)
  const updatePayload = {
    qc_pass_id: passId,
    qc_pass_name: passName,
    qty_qc_pass: numQty,
    qc_status: validStatus,
    qc_checked_at: new Date().toISOString(),
    qc_checked_by: user.id
  };
  if (keterangan !== undefined) updatePayload.keterangan_qms = keterangan;
  if (gambar !== undefined) {
    updatePayload.has_gambar_qc = Boolean(gambar);
  }

  const { error: sbErr } = await supabaseServer
    .from('wip_orders')
    .update(updatePayload)
    .eq('id', orderId);

  if (sbErr) {
    console.warn('[WipQcService] Supabase update warning:', sbErr.message);
  }

  // 2. Audit log
  try {
    await supabaseServer.from('audit_logs').insert({
      user_id: user.id,
      wip_order_id: orderId,
      action: 'submit_qc',
      before_data: {
        qc_pass_id: order.qc_pass_id,
        qc_pass_name: order.qc_pass_name,
        qty_qc_pass: order.qty_qc_pass,
        qc_status: order.qc_status,
        keterangan_qms: order.keterangan_qms,
        has_gambar_qc: order.has_gambar_qc
      },
      after_data: {
        qc_pass_id: passId,
        qc_pass_name: passName,
        qty_qc_pass: numQty,
        qc_status: validStatus,
        keterangan_qms: keterangan,
        has_gambar_qc: Boolean(gambar)
      }
    });
  } catch (auditErr) {
    console.warn('[WipQcService] Audit log failed:', auditErr.message);
  }

  // 3. Sync to Odoo x_monitoring_wip_vendo (Images stored exclusively in Odoo)
  if (order.odoo_wip_id) {
    try {
      await adminOdooClient.authenticate();
      const odooVals = {};

      if (passId) {
        odooVals.x_studio_qc_pass_1 = passId;
      } else if (qcPassId === null) {
        odooVals.x_studio_qc_pass_1 = false;
      }

      odooVals.x_studio_qty_qc_pass_1 = numQty;

      if (validStatus) {
        odooVals.x_studio_qc_status = validStatus;
      } else if (qcStatus === null || qcStatus === '') {
        odooVals.x_studio_qc_status = false;
      }

      if (keterangan !== undefined) {
        odooVals.x_studio_keterangan_qms = keterangan || false;
      }

      if (gambar !== undefined) {
        let rawBase64 = gambar;
        if (rawBase64 && typeof rawBase64 === 'string' && rawBase64.includes(',')) {
          rawBase64 = rawBase64.split(',')[1];
        }
        odooVals.x_studio_gambar_qc = rawBase64 || false;
      }

      if (Object.keys(odooVals).length > 0) {
        await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [
          [order.odoo_wip_id],
          odooVals
        ], { context: { tracking_disable: false } });
        console.log(`[WipQcService] Successfully synced QC data to Odoo WIP #${order.odoo_wip_id}`);
      }
    } catch (odooErr) {
      console.error(`[WipQcService] Error syncing QC to Odoo WIP #${order.odoo_wip_id}:`, odooErr.message);
      throw new Error(`Gagal menyimpan ke Odoo: ${odooErr.message}`);
    }
  }

  // 4. Return fresh details with current image in memory for UI
  const fresh = await getOrderDetails({ user, orderId, includeRawMoves: false });
  if (fresh.order) {
    fresh.order.has_gambar_qc = Boolean(gambar);
    fresh.order.gambar_qc = gambar;
  }
  return fresh;
}
