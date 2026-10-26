import { supabaseServer } from '../../supabaseServer.js';
import { adminOdooClient } from '../../odoo/odooClient.js';
import { getOrderDetails } from './wipQueryService.js';

/**
 * Service for Quality Control (QC) - Tab 5
 * Strictly restricted to Admin roles: master_admin and admin (internal).
 */

const ADMIN_ROLES = ['master_admin', 'admin'];

export function assertAdminAccess(user) {
  if (!user || !ADMIN_ROLES.includes(user.role)) {
    const error = new Error('Akses ditolak: Form Quality Control (QC) hanya dapat diakses oleh Master Admin dan Admin Internal.');
    error.statusCode = 403;
    throw error;
  }
}

/**
 * Fetch available QC inspectors from Odoo (res.partner / res.users)
 */
export async function getQcInspectors() {
  const fallbackList = [
    { id: 64, name: 'QC (quality@kantiss.com)' },
    { id: 362, name: 'Suci Fitriani (quality@kantiss.com)' },
    { id: 14, name: 'Master Admin' }
  ];

  try {
    await adminOdooClient.authenticate();
    const map = new Map();
    // Default QC partner
    map.set(64, { id: 64, name: 'QC (quality@kantiss.com)' });
    map.set(362, { id: 362, name: 'Suci Fitriani (quality@kantiss.com)' });
    map.set(14, { id: 14, name: 'Master Admin' });

    // 1. Fetch QC partners
    try {
      const partners = await adminOdooClient._callObject('res.partner', 'search_read', [
        ['|', ['name', 'ilike', 'QC'], ['email', 'ilike', 'quality']]
      ], {
        fields: ['id', 'name', 'email'],
        limit: 20
      });
      if (partners && partners.length > 0) {
        partners.forEach(p => {
          map.set(p.id, {
            id: p.id,
            name: p.email ? `${p.name} (${p.email})` : p.name
          });
        });
      }
    } catch (e) {}

    // 2. Fetch internal active users
    try {
      const users = await adminOdooClient._callObject('res.users', 'search_read', [
        [['active', '=', true], ['share', '=', false]]
      ], {
        fields: ['id', 'name', 'partner_id'],
        limit: 30
      });
      if (users && users.length > 0) {
        users.forEach(u => {
          if (u.partner_id && u.partner_id[0]) {
            const pId = u.partner_id[0];
            const pName = u.partner_id[1] || u.name;
            if (!map.has(pId)) {
              map.set(pId, { id: pId, name: `${pName} (Internal)` });
            }
          }
        });
      }
    } catch (e) {}

    return Array.from(map.values());
  } catch (err) {
    console.warn('[WipQcService] getQcInspectors error, using fallback:', err.message);
    return fallbackList;
  }
}

/**
 * Submit / Update QC form results
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

  // 1. Update in Supabase
  const updatePayload = {
    qc_pass_id: passId,
    qc_pass_name: passName,
    qty_qc_pass: numQty,
    qc_status: validStatus,
    qc_checked_at: new Date().toISOString(),
    qc_checked_by: user.id
  };
  if (keterangan !== undefined) updatePayload.keterangan_qms = keterangan;
  if (gambar !== undefined) updatePayload.gambar_qc = gambar;

  const { error: sbErr } = await supabaseServer
    .from('wip_orders')
    .update(updatePayload)
    .eq('id', orderId);

  if (sbErr) {
    console.warn('[WipQcService] Supabase update warning (columns might not exist yet):', sbErr.message);
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
        keterangan_qms: order.keterangan_qms
      },
      after_data: {
        qc_pass_id: passId,
        qc_pass_name: passName,
        qty_qc_pass: numQty,
        qc_status: validStatus,
        keterangan_qms: keterangan
      }
    });
  } catch (auditErr) {
    console.warn('[WipQcService] Audit log failed:', auditErr.message);
  }

  // 3. Sync to Odoo x_monitoring_wip_vendo
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

  // 4. Return fresh details
  return getOrderDetails({ user, orderId, includeRawMoves: false });
}
