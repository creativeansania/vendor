import { adminOdooClient } from '../../../odoo/odooClient.js';
import { withWipLock } from '../wipLock.js';

const RECAP_READ_FIELDS = [
  'id',
  'x_name',
  'x_studio_manufacturing_order',
  'x_studio_spk_induk',
  'x_studio_kain_dari_gudang_qty',
  'x_studio_estimasi_dari_spb',
  'x_studio_qty_masuk_sfp',
  'x_studio_estimasi_spb_rekap',
  'x_studio_persentase_susut'
];

/**
 * Derive base SPK Induk from an MO / WIP name by stripping backorder suffixes like `-001`, `-002`.
 */
export function deriveSpkInduk(moName) {
  const raw = String(moName || '').trim();
  if (!raw) return '';
  return raw.replace(/-\d+$/, '').trim() || raw;
}

/**
 * Return numeric backorder sequence (`0` for no suffix, `1` for `-001`, `2` for `-002`, etc.).
 */
export function getBackorderSeq(moName) {
  const raw = String(moName || '').trim();
  const match = raw.match(/-(\d+)$/);
  if (!match) return 0;
  return parseInt(match[1], 10) || 0;
}

function getRowMoName(row) {
  const rawName = String(row.x_name || '').trim();
  if (rawName) return rawName;
  if (Array.isArray(row.x_studio_manufacturing_order) && row.x_studio_manufacturing_order[1]) {
    return String(row.x_studio_manufacturing_order[1]).trim();
  }
  return String(row.x_studio_spk_induk || '').trim();
}

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}

function floatChanged(a, b) {
  return Math.abs((parseFloat(a) || 0) - (parseFloat(b) || 0)) > 0.005;
}

/**
 * Compute deduplicated Total Estimasi SPB, Total Qty Masuk SFP, and `% Susut` for one SPK Induk family.
 * Formula: % Susut = ((Total Estimasi SPB - Qty Masuk SFP) / Total Estimasi SPB) * 100%
 * Only computed live when Total Qty Masuk SFP > 0 and Total Estimasi SPB > 0; otherwise 0%.
 * To ensure Odoo List View `sum` on Total Estimasi SPB doesn't duplicate across backorders while
 * preserving `x_studio_estimasi_dari_spb` for PWA cutting, only the lead row carries `x_studio_estimasi_spb_rekap`.
 */
export function computeSpkFamilyRecap(familyRows) {
  if (!Array.isArray(familyRows) || familyRows.length === 0) {
    return null;
  }

  const normalized = familyRows.map((row) => {
    const moName = getRowMoName(row);
    const spkInduk = deriveSpkInduk(moName) || String(row.x_studio_spk_induk || '').trim();
    const seq = getBackorderSeq(moName);
    return {
      row,
      moName,
      spkInduk,
      seq,
      kainQty: parseFloat(row.x_studio_kain_dari_gudang_qty) || 0.0,
      estSpb: parseFloat(row.x_studio_estimasi_dari_spb) || 0.0,
      qtySfp: parseFloat(row.x_studio_qty_masuk_sfp) || 0.0
    };
  });

  // Lead row carries `x_studio_estimasi_spb_rekap = totalEstimasiSpb`; child rows get 0.
  const sortedForLead = [...normalized].sort((a, b) => (a.seq - b.seq) || (a.row.id - b.row.id));
  const leadItem = sortedForLead[0];
  const spkInduk = leadItem.spkInduk;

  // Deduplicate SPK Estimasi SPB: pick row with highest kain qty (most complete SPB transfer),
  // tie-breaking toward canonical lead row (-001 / no suffix) and earliest seq/id.
  const estCandidates = normalized.filter((item) => item.estSpb > 0);
  let totalEstimasiSpb = 0.0;
  if (estCandidates.length > 0) {
    estCandidates.sort((a, b) => {
      if (Math.abs(b.kainQty - a.kainQty) > 0.01) return b.kainQty - a.kainQty;
      const aIsMain = a.seq <= 1 ? 0 : 1;
      const bIsMain = b.seq <= 1 ? 0 : 1;
      if (aIsMain !== bIsMain) return aIsMain - bIsMain;
      if (a.seq !== b.seq) return a.seq - b.seq;
      return a.row.id - b.row.id;
    });
    totalEstimasiSpb = round2(estCandidates[0].estSpb);
  }

  const totalQtySfp = round2(normalized.reduce((sum, item) => sum + item.qtySfp, 0.0));

  let persentaseSusut = 0.0;
  if (totalEstimasiSpb > 0 && totalQtySfp > 0) {
    persentaseSusut = round2(((totalEstimasiSpb - totalQtySfp) / totalEstimasiSpb) * 100);
  }

  const rowUpdates = [];
  for (const item of normalized) {
    const r = item.row;
    const targetRekapEst = r.id === leadItem.row.id ? totalEstimasiSpb : 0.0;
    const vals = {};

    if (r.x_studio_spk_induk !== spkInduk) {
      vals.x_studio_spk_induk = spkInduk;
    }
    if (r.x_studio_estimasi_spb_rekap === false || r.x_studio_estimasi_spb_rekap === undefined || floatChanged(r.x_studio_estimasi_spb_rekap, targetRekapEst)) {
      vals.x_studio_estimasi_spb_rekap = targetRekapEst;
    }
    if (r.x_studio_persentase_susut === false || r.x_studio_persentase_susut === undefined || floatChanged(r.x_studio_persentase_susut, persentaseSusut)) {
      vals.x_studio_persentase_susut = persentaseSusut;
    }

    if (Object.keys(vals).length > 0) {
      rowUpdates.push({ id: r.id, vals });
    }
  }

  return {
    spkInduk,
    leadRowId: leadItem.row.id,
    totalEstimasiSpb,
    totalQtySfp,
    persentaseSusut,
    rowCount: normalized.length,
    rowUpdates
  };
}

/**
 * Recompute deduplicated Estimasi SPB & `% Susut` across all WIP rows belonging to an SPK Induk in Odoo.
 * Serialized per SPK Induk to prevent races during concurrent backorder webhooks.
 */
export async function syncSpkIndukRecap(spkIndukInput) {
  const cleanInduk = deriveSpkInduk(spkIndukInput);
  if (!cleanInduk) return null;

  return withWipLock(`spk_recap_${cleanInduk}`, async () => {
    await adminOdooClient.authenticate();

    const candidates = await adminOdooClient._callObject('x_monitoring_wip_vendo', 'search_read', [
      ['|', '|', ['x_studio_spk_induk', '=', cleanInduk], ['x_name', '=', cleanInduk], ['x_name', '=like', `${cleanInduk}-%`]]
    ], { fields: RECAP_READ_FIELDS });

    // Strict in-memory match prevents prefix collisions on numeric boundaries
    const familyRows = (candidates || []).filter((r) => deriveSpkInduk(getRowMoName(r)) === cleanInduk);
    if (familyRows.length === 0) return null;

    const recap = computeSpkFamilyRecap(familyRows);
    if (!recap || recap.rowUpdates.length === 0) return recap;

    // Group identical write payloads to minimize Odoo RPC calls
    const batchesByPayload = new Map();
    for (const upd of recap.rowUpdates) {
      const key = JSON.stringify(upd.vals);
      if (!batchesByPayload.has(key)) {
        batchesByPayload.set(key, { vals: upd.vals, ids: [] });
      }
      batchesByPayload.get(key).ids.push(upd.id);
    }

    for (const { vals, ids } of batchesByPayload.values()) {
      await adminOdooClient._callObject('x_monitoring_wip_vendo', 'write', [ids, vals], {
        context: { tracking_disable: true, no_automation: true }
      });
    }

    return recap;
  });
}

