import crypto from 'crypto';
import { supabaseServer } from '../../supabaseServer.js';

const CONFIG_ACTION = 'buyer_dashboard_config';
const SNAPSHOT_ACTION = 'buyer_dashboard_snapshot';
const SYSTEM_USER_ID = 0;

export const SNAPSHOT_TTL_MS = 15 * 60 * 1000; // 15 minutes

export function generateBuyerToken() {
  return crypto.randomBytes(18).toString('base64url');
}

function normalizePartnerIds(ids) {
  if (!Array.isArray(ids)) return [];
  const unique = new Set();
  for (const id of ids) {
    const n = Number(id);
    if (Number.isInteger(n) && n > 0) unique.add(n);
  }
  return Array.from(unique);
}

function normalizeConfigRow(row) {
  if (!row || !row.after_data) return null;
  const cfg = row.after_data;
  return {
    id: cfg.id || row.id,
    row_id: row.id,
    token: cfg.token || row.reason,
    buyer_name: cfg.buyer_name || 'Buyer',
    odoo_partner_ids: normalizePartnerIds(cfg.odoo_partner_ids),
    odoo_partner_names: Array.isArray(cfg.odoo_partner_names) ? cfg.odoo_partner_names : [],
    start_date: cfg.start_date || '2026-01-01',
    notes: cfg.notes || '',
    is_active: cfg.is_active !== false,
    created_by: cfg.created_by || null,
    created_at: cfg.created_at || row.created_at,
    updated_at: cfg.updated_at || row.created_at
  };
}

/**
 * List all configured buyer dashboard links (newest first), enriched with latest snapshot metadata.
 */
export async function listBuyerDashboards() {
  const { data: configRows, error } = await supabaseServer
    .from('audit_logs')
    .select('id, reason, after_data, created_at')
    .eq('user_id', SYSTEM_USER_ID)
    .eq('action', CONFIG_ACTION)
    .order('id', { ascending: false });

  if (error) {
    throw new Error(`Gagal membaca daftar dashboard buyer: ${error.message}`);
  }

  const configs = (configRows || [])
    .map(normalizeConfigRow)
    .filter((c) => c && c.token);

  if (configs.length === 0) {
    return [];
  }

  const tokens = configs.map((c) => c.token);
  const { data: snapRows } = await supabaseServer
    .from('audit_logs')
    .select('id, reason, before_data, created_at')
    .eq('user_id', SYSTEM_USER_ID)
    .eq('action', SNAPSHOT_ACTION)
    .in('reason', tokens)
    .order('id', { ascending: false });

  const latestMetaByToken = new Map();
  for (const row of snapRows || []) {
    if (!latestMetaByToken.has(row.reason)) {
      latestMetaByToken.set(row.reason, {
        synced_at: row.before_data?.synced_at || row.created_at,
        summary: row.before_data?.summary || null,
        sync_duration_ms: row.before_data?.sync_duration_ms || null
      });
    }
  }

  return configs.map((cfg) => {
    const snapMeta = latestMetaByToken.get(cfg.token) || null;
    return {
      ...cfg,
      last_synced_at: snapMeta?.synced_at || null,
      last_summary: snapMeta?.summary || null,
      last_sync_duration_ms: snapMeta?.sync_duration_ms || null
    };
  });
}

/**
 * Fetch a single buyer dashboard config by its secret token.
 */
export async function getBuyerDashboardByToken(token) {
  if (!token || typeof token !== 'string') return null;

  const { data: rows, error } = await supabaseServer
    .from('audit_logs')
    .select('id, reason, after_data, created_at')
    .eq('user_id', SYSTEM_USER_ID)
    .eq('action', CONFIG_ACTION)
    .eq('reason', token.trim())
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    throw new Error(`Gagal mencari konfigurasi buyer: ${error.message}`);
  }

  return rows && rows.length > 0 ? normalizeConfigRow(rows[0]) : null;
}

/**
 * Create a new buyer dashboard link configuration.
 */
export async function createBuyerDashboard({
  buyer_name,
  odoo_partner_ids,
  odoo_partner_names = [],
  start_date = '2026-01-01',
  notes = '',
  created_by = null
}) {
  const cleanName = String(buyer_name || '').trim();
  const partnerIds = normalizePartnerIds(odoo_partner_ids);

  if (!cleanName) {
    throw new Error('Nama buyer wajib diisi.');
  }
  if (partnerIds.length === 0) {
    throw new Error('Minimal satu Customer Odoo (partner) wajib dipilih.');
  }

  const token = generateBuyerToken();
  const nowIso = new Date().toISOString();
  const payload = {
    token,
    buyer_name: cleanName,
    odoo_partner_ids: partnerIds,
    odoo_partner_names: Array.isArray(odoo_partner_names) ? odoo_partner_names : [],
    start_date: start_date ? String(start_date).trim() : '',
    notes: String(notes || '').trim(),
    is_active: true,
    created_by,
    created_at: nowIso,
    updated_at: nowIso
  };

  const { data: inserted, error } = await supabaseServer
    .from('audit_logs')
    .insert({
      user_id: SYSTEM_USER_ID,
      action: CONFIG_ACTION,
      reason: token,
      after_data: payload
    })
    .select('id, reason, after_data, created_at')
    .single();

  if (error) {
    throw new Error(`Gagal membuat link dashboard buyer: ${error.message}`);
  }

  return normalizeConfigRow(inserted);
}

/**
 * Update an existing buyer dashboard config (name, partner IDs, start_date, is_active, or rotate token).
 */
export async function updateBuyerDashboard(token, updates = {}) {
  const existing = await getBuyerDashboardByToken(token);
  if (!existing) {
    throw new Error('Dashboard buyer tidak ditemukan.');
  }

  const nextToken = updates.rotate_token ? generateBuyerToken() : existing.token;
  const nextPartnerIds =
    updates.odoo_partner_ids !== undefined
      ? normalizePartnerIds(updates.odoo_partner_ids)
      : existing.odoo_partner_ids;

  if (nextPartnerIds.length === 0) {
    throw new Error('Minimal satu Customer Odoo (partner) wajib dipilih.');
  }

  const nextName =
    updates.buyer_name !== undefined ? String(updates.buyer_name).trim() : existing.buyer_name;
  if (!nextName) {
    throw new Error('Nama buyer tidak boleh kosong.');
  }

  const nowIso = new Date().toISOString();
  const nextPayload = {
    token: nextToken,
    buyer_name: nextName,
    odoo_partner_ids: nextPartnerIds,
    odoo_partner_names:
      updates.odoo_partner_names !== undefined
        ? updates.odoo_partner_names
        : existing.odoo_partner_names,
    start_date:
      updates.start_date !== undefined
        ? String(updates.start_date || '').trim()
        : existing.start_date,
    notes: updates.notes !== undefined ? String(updates.notes || '').trim() : existing.notes,
    is_active: updates.is_active !== undefined ? Boolean(updates.is_active) : existing.is_active,
    created_by: existing.created_by,
    created_at: existing.created_at,
    updated_at: nowIso
  };

  const { data: updated, error } = await supabaseServer
    .from('audit_logs')
    .update({
      reason: nextToken,
      after_data: nextPayload
    })
    .eq('id', existing.row_id)
    .select('id, reason, after_data, created_at')
    .single();

  if (error) {
    throw new Error(`Gagal memperbarui dashboard buyer: ${error.message}`);
  }

  // If token rotated, migrate cached snapshot token too so buyer link works immediately
  if (updates.rotate_token && nextToken !== existing.token) {
    await supabaseServer
      .from('audit_logs')
      .update({ reason: nextToken })
      .eq('user_id', SYSTEM_USER_ID)
      .eq('action', SNAPSHOT_ACTION)
      .eq('reason', existing.token);
  }

  return normalizeConfigRow(updated);
}

/**
 * Permanently delete a buyer dashboard config and its cached snapshot(s).
 */
export async function deleteBuyerDashboard(token) {
  const existing = await getBuyerDashboardByToken(token);
  if (!existing) {
    throw new Error('Dashboard buyer tidak ditemukan.');
  }

  await supabaseServer
    .from('audit_logs')
    .delete()
    .eq('user_id', SYSTEM_USER_ID)
    .eq('action', SNAPSHOT_ACTION)
    .eq('reason', existing.token);

  const { error } = await supabaseServer
    .from('audit_logs')
    .delete()
    .eq('id', existing.row_id);

  if (error) {
    throw new Error(`Gagal menghapus dashboard buyer: ${error.message}`);
  }

  return { deleted: true, token: existing.token };
}

/**
 * Read the cached JSONB snapshot for a buyer token.
 */
export async function getBuyerSnapshot(token) {
  if (!token) return null;

  const { data: rows, error } = await supabaseServer
    .from('audit_logs')
    .select('id, reason, before_data, after_data, created_at')
    .eq('user_id', SYSTEM_USER_ID)
    .eq('action', SNAPSHOT_ACTION)
    .eq('reason', token)
    .order('id', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[BuyerRepo] Failed reading snapshot:', error.message);
    return null;
  }

  if (!rows || rows.length === 0 || !rows[0].after_data) {
    return null;
  }

  return {
    row_id: rows[0].id,
    snapshot: rows[0].after_data,
    synced_at: rows[0].before_data?.synced_at || rows[0].after_data?.synced_at || rows[0].created_at
  };
}

/**
 * Upsert cached snapshot (stores compact summary in before_data for fast Admin listing, full payload in after_data).
 */
export async function saveBuyerSnapshot(token, snapshot) {
  const compactMeta = {
    synced_at: snapshot.synced_at,
    sync_duration_ms: snapshot.sync_duration_ms || null,
    summary: snapshot.summary || null
  };

  const { data: existingRows } = await supabaseServer
    .from('audit_logs')
    .select('id')
    .eq('user_id', SYSTEM_USER_ID)
    .eq('action', SNAPSHOT_ACTION)
    .eq('reason', token)
    .order('id', { ascending: false });

  if (existingRows && existingRows.length > 0) {
    const primaryId = existingRows[0].id;
    const { error: updErr } = await supabaseServer
      .from('audit_logs')
      .update({
        before_data: compactMeta,
        after_data: snapshot,
        created_at: new Date().toISOString()
      })
      .eq('id', primaryId);

    if (updErr) {
      throw new Error(`Gagal menyimpan snapshot buyer: ${updErr.message}`);
    }

    // Clean any duplicate older rows for this token
    if (existingRows.length > 1) {
      const staleIds = existingRows.slice(1).map((r) => r.id);
      await supabaseServer.from('audit_logs').delete().in('id', staleIds);
    }
    return;
  }

  const { error: insErr } = await supabaseServer.from('audit_logs').insert({
    user_id: SYSTEM_USER_ID,
    action: SNAPSHOT_ACTION,
    reason: token,
    before_data: compactMeta,
    after_data: snapshot
  });

  if (insErr) {
    throw new Error(`Gagal membuat snapshot buyer: ${insErr.message}`);
  }
}

export function isSnapshotStale(syncedAtIso, ttlMs = SNAPSHOT_TTL_MS) {
  if (!syncedAtIso) return true;
  const ts = new Date(syncedAtIso).getTime();
  if (!Number.isFinite(ts)) return true;
  return Date.now() - ts > ttlMs;
}
