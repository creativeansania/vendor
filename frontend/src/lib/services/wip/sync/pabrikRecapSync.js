import { adminOdooClient } from '../../../odoo/odooClient.js';
import { withWipLock } from '../wipLock.js';

const REKAP_MODEL = 'x_rekap_susut_pabrik';

// Odoo 19 yard-to-meter relative factor: 1 yd = 0.914402757838718 m
const METER_TO_YARD_FACTOR = 1 / 0.914402757838718;

function round2(num) {
  return Math.round((Number(num) || 0) * 100) / 100;
}

/**
 * Robust parser for Pabrik product display names.
 * Example: '[KNA1C059165A] KAIN BSY KS 7162 (PACKING ROLL, BIRU TOSCA MUDA, A (GRADE A))'
 */
export function parsePabrikProduct(rawName) {
  const str = String(rawName || '').trim();
  const clean = str.replace(/^\[[^\]]+\]\s*/, '').trim();
  const parenMatch = clean.match(/^([^(]+)\((.+)\)$/);

  if (!parenMatch) {
    return {
      kain: clean || 'KAIN',
      warna: 'POLOS',
      gradeCategory: 'GRADE_A',
      policy: 'A (GRADE A)'
    };
  }

  const kain = parenMatch[1].trim();
  const parts = parenMatch[2].split(',').map((s) => s.trim());

  let policyIdx = parts.findIndex((p) => {
    const up = p.toUpperCase();
    return up.includes('GRADE') || up.includes('BAHAN SISA') || up.includes('SAMPLE') || up.includes('CACAT') || up.includes('BS');
  });

  let policy = '';
  if (policyIdx >= 0) {
    policy = parts[policyIdx];
  } else {
    policy = parts[parts.length - 1];
    policyIdx = parts.length - 1;
  }

  // Filter out packing & width numbers to isolate color
  const colorParts = parts.filter((p, idx) => {
    if (idx === policyIdx) return false;
    const up = p.toUpperCase();
    if (['FOLDING', 'PACKING ROLL', 'ROLL', 'PACKING'].includes(up)) return false;
    if (/^\d{2,4}$/.test(p)) return false; // width: 045, 094, 063
    return true;
  });

  const warna = colorParts.join(' ').trim() || 'POLOS';

  // Map to Grade Category per agreed rules:
  // - Grade A: GRADE A, SP (SAMPLE)
  // - Grade B: GRADE B, BW (CACAT KAIN)
  // - Grade C: GRADE C
  // - BS: BS (BAHAN SISA), BS KG
  const policyUpper = policy.toUpperCase();
  let gradeCategory = 'GRADE_A';

  if (policyUpper.includes('GRADE C') || policyUpper === 'C') {
    gradeCategory = 'GRADE_C';
  } else if (policyUpper.includes('BAHAN SISA') || policyUpper.includes('BS')) {
    gradeCategory = 'BS';
  } else if (policyUpper.includes('GRADE B') || policyUpper.includes('CACAT') || policyUpper.includes('BW') || policyUpper === 'B') {
    gradeCategory = 'GRADE_B';
  } else if (policyUpper.includes('GRADE A') || policyUpper.includes('SAMPLE') || policyUpper.includes('SP') || policyUpper === 'A') {
    gradeCategory = 'GRADE_A';
  }

  return { kain, warna, gradeCategory, policy };
}

/**
 * Formats a clean summary of MO names for list views.
 * Combines roll MOs (-001, -002) into their base MO,
 * and collapses consecutive numbered MOs into clean ranges (e.g. 'PBSS/MO/00013 s/d 00019').
 */
export function formatMoSummary(moNames) {
  if (!moNames || moNames.length === 0) return '';
  const baseNames = [...new Set(moNames.map((n) => String(n || '').replace(/-\d+$/, '').trim()))].filter(Boolean).sort();
  if (baseNames.length === 0) return '';
  if (baseNames.length === 1) return baseNames[0];

  const parsed = baseNames.map((name) => {
    const m = name.match(/^(.*\/MO\/)(\d+)$/);
    if (m) {
      return { prefix: m[1], num: parseInt(m[2], 10), pad: m[2].length, raw: name };
    }
    return { prefix: '', num: null, pad: 0, raw: name };
  });

  const ranges = [];
  let currentRange = null;

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];
    if (!currentRange) {
      currentRange = [item];
    } else {
      const prev = currentRange[currentRange.length - 1];
      if (item.num !== null && prev.num !== null && item.prefix === prev.prefix && item.num === prev.num + 1) {
        currentRange.push(item);
      } else {
        ranges.push(currentRange);
        currentRange = [item];
      }
    }
  }
  if (currentRange) ranges.push(currentRange);

  const formattedParts = ranges.map((r) => {
    if (r.length === 1) return r[0].raw;
    if (r.length === 2) return `${r[0].raw}, ${r[1].raw}`;
    const start = r[0];
    const end = r[r.length - 1];
    const endStr = String(end.num).padStart(end.pad, '0');
    return `${start.raw} s/d ${endStr}`;
  });

  return formattedParts.join(', ');
}

/**
 * Normalizes Greige quantity to yards if it was recorded in meters.
 */
export function normalizeGreigeToYard(qty, uomName) {
  const val = parseFloat(qty) || 0.0;
  if (!uomName) return val;
  const uom = String(uomName).toLowerCase().trim();
  if (uom === 'meter' || uom === 'm') {
    return val * METER_TO_YARD_FACTOR;
  }
  return val;
}

/**
 * Computes and synchronizes Rekap Susut Pabrik for a single Approval Request.
 * Groups by color (warna), aggregates grey consumed (normalized to Yd),
 * sums Grade A (inc. SP), Grade B (inc. BW), Grade C, and BS,
 * then writes to Odoo `x_rekap_susut_pabrik`.
 */
export async function syncPabrikRecapForApproval(approvalId) {
  const apprId = Number(approvalId);
  if (!apprId || isNaN(apprId)) return null;

  return withWipLock(`pabrik_approval_${apprId}`, async () => {
    await adminOdooClient.authenticate();

    // 1. Fetch all MOs with this approval request
    const mos = await adminOdooClient._callObject('mrp.production', 'search_read', [
      [['x_studio_approval_request', '=', apprId], ['state', '!=', 'cancel']]
    ], {
      fields: [
        'id', 'name', 'product_id', 'product_qty', 'qty_producing',
        'product_uom_id', 'warehouse_id', 'state', 'x_studio_approval_request',
        'move_raw_ids', 'x_studio_sales_order'
      ]
    });

    if (!Array.isArray(mos) || mos.length === 0) {
      return { success: true, approvalId: apprId, rowCount: 0, rows: [] };
    }

    const firstMo = mos[0];
    const approvalRecord = firstMo.x_studio_approval_request;
    const approvalName = Array.isArray(approvalRecord) ? approvalRecord[1] : `APP#${apprId}`;
    const warehouseRecord = firstMo.warehouse_id;
    const warehouseId = Array.isArray(warehouseRecord) ? warehouseRecord[0] : null;
    const warehouseName = Array.isArray(warehouseRecord) ? warehouseRecord[1] : '';

    let approvalSo = null;
    let dateConfirmed = null;
    let tanggalApproval = null;

    try {
      const apprDocs = await adminOdooClient._callObject('approval.request', 'read', [
        [apprId],
        ['id', 'name', 'x_studio_sales_order', 'date_confirmed', 'create_date', 'request_status', 'approver_ids', 'write_date']
      ]);
      if (apprDocs && apprDocs.length > 0) {
        const apprDoc = apprDocs[0];
        if (apprDoc.x_studio_sales_order) {
          approvalSo = apprDoc.x_studio_sales_order;
        }
        dateConfirmed = apprDoc.date_confirmed || apprDoc.create_date || null;

        if (Array.isArray(apprDoc.approver_ids) && apprDoc.approver_ids.length > 0) {
          const approvers = await adminOdooClient._callObject('approval.approver', 'read', [
            apprDoc.approver_ids,
            ['id', 'status', 'write_date']
          ]);
          const approved = approvers.find((ap) => ap.status === 'approved');
          if (approved && approved.write_date) {
            tanggalApproval = approved.write_date;
          }
        }
        if (!tanggalApproval && apprDoc.request_status === 'approved') {
          tanggalApproval = apprDoc.write_date;
        }
      }
    } catch {
      // ignore
    }

    // 2. Fetch all raw moves (greige components)
    const rawMoveIds = [...new Set(mos.flatMap((m) => m.move_raw_ids || []))];
    const rawMovesByMoId = new Map();

    if (rawMoveIds.length > 0) {
      // Chunked read if moves exceed 500
      const CHUNK = 500;
      for (let i = 0; i < rawMoveIds.length; i += CHUNK) {
        const slice = rawMoveIds.slice(i, i + CHUNK);
        const moves = await adminOdooClient._callObject('stock.move', 'read', [
          slice,
          ['id', 'product_id', 'product_uom', 'quantity', 'raw_material_production_id']
        ]);
        for (const rm of moves || []) {
          const mId = rm.raw_material_production_id ? rm.raw_material_production_id[0] : null;
          if (mId) {
            if (!rawMovesByMoId.has(mId)) rawMovesByMoId.set(mId, []);
            rawMovesByMoId.get(mId).push(rm);
          }
        }
      }
    }

    // 3. Group MOs by color (warna)
    const byColor = new Map();

    for (const mo of mos) {
      const prodName = mo.product_id ? mo.product_id[1] : '';
      const parsed = parsePabrikProduct(prodName);
      const warnaKey = parsed.warna;

      if (!byColor.has(warnaKey)) {
        byColor.set(warnaKey, {
          warna: warnaKey,
          jenisKain: parsed.kain,
          mos: []
        });
      }
      byColor.get(warnaKey).mos.push({ mo, parsed });
    }

    // 4. Compute metrics per color
    const computedRows = [];

    for (const [warnaKey, group] of byColor.entries()) {
      let greyYd = 0.0;
      let gradeA = 0.0;
      let gradeB = 0.0;
      let gradeC = 0.0;
      let bs = 0.0;
      let allDone = true;

      for (const item of group.mos) {
        const { mo, parsed } = item;
        if (mo.state !== 'done') allDone = false;

        const produced = parseFloat(mo.qty_producing || 0.0);
        if (parsed.gradeCategory === 'GRADE_A') gradeA += produced;
        else if (parsed.gradeCategory === 'GRADE_B') gradeB += produced;
        else if (parsed.gradeCategory === 'GRADE_C') gradeC += produced;
        else if (parsed.gradeCategory === 'BS') bs += produced;

        const rawList = rawMovesByMoId.get(mo.id) || [];
        for (const rm of rawList) {
          const uomName = rm.product_uom ? rm.product_uom[1] : '';
          greyYd += normalizeGreigeToYard(rm.quantity, uomName);
        }
      }

      greyYd = round2(greyYd);
      gradeA = round2(gradeA);
      gradeB = round2(gradeB);
      gradeC = round2(gradeC);
      bs = round2(bs);
      const totalFinish = round2(gradeA + gradeB + gradeC + bs);

      const susutCelup = greyYd > 0 ? round2(((greyYd - totalFinish) / greyYd) * 100) : 0.0;
      const susutBC = totalFinish > 0 ? round2(((gradeB + gradeC) / totalFinish) * 100) : 0.0;
      const susutBS = totalFinish > 0 ? round2((bs / totalFinish) * 100) : 0.0;

      const codeName = `${approvalName} / ${warnaKey}`;
      const moNames = group.mos.map((item) => item.mo.name);
      const moIds = group.mos.map((item) => item.mo.id);
      const moSummary = formatMoSummary(moNames);
      const uniqueBaseMos = [...new Set(moNames.map((n) => String(n || '').replace(/-\d+$/, '').trim()))].filter(Boolean).sort();
      const daftarMo = uniqueBaseMos.join(', ');

      // Resolve Sales Orders for this group
      const soMap = new Map();
      for (const item of group.mos) {
        const so = item.mo.x_studio_sales_order;
        if (so && Array.isArray(so)) {
          soMap.set(so[0], so[1]);
        }
      }

      // Fallback: if not set on this color's MOs, check any MO in the approval
      if (soMap.size === 0) {
        for (const m of mos) {
          const so = m.x_studio_sales_order;
          if (so && Array.isArray(so)) {
            soMap.set(so[0], so[1]);
          }
        }
      }

      // Fallback: check approval request's sales order
      if (soMap.size === 0 && approvalSo && Array.isArray(approvalSo)) {
        soMap.set(approvalSo[0], approvalSo[1]);
      }

      const soIds = Array.from(soMap.keys());
      const soNames = Array.from(soMap.values());
      const primarySoId = soIds.length > 0 ? soIds[0] : false;
      const soNameStr = soNames.join(', ');

      computedRows.push({
        x_name: codeName,
        x_studio_approval_request: apprId,
        x_studio_approval_name: approvalName,
        x_studio_pabrik: warehouseId,
        x_studio_pabrik_name: warehouseName,
        x_studio_manufacturing_order: moSummary,
        x_studio_sales_order: primarySoId,
        x_studio_sales_order_name: soNameStr,
        x_studio_so_ids: [[6, 0, soIds]],
        x_studio_tanggal_approval: tanggalApproval,
        x_studio_date_confirmed: dateConfirmed,
        x_studio_daftar_mo: daftarMo,
        x_studio_mo_ids: [[6, 0, moIds]],
        x_studio_jenis_kain: group.jenisKain,
        x_studio_warna: warnaKey,
        x_studio_consumption_grey_yd: greyYd,
        x_studio_qty_grade_a: gradeA,
        x_studio_qty_grade_b: gradeB,
        x_studio_qty_grade_c: gradeC,
        x_studio_qty_bs: bs,
        x_studio_total_finish: totalFinish,
        x_studio_persentase_susut_celup: susutCelup,
        x_studio_persentase_susut_b_c: susutBC,
        x_studio_persentase_susut_bs: susutBS,
        x_studio_mo_count: group.mos.length,
        x_studio_status: allDone ? 'Done' : 'Proses'
      });
    }

    // 4b. Calculate weighted % Susut Total Approval for the entire batch
    let totalApprovalGreyYd = 0.0;
    let totalApprovalFinishYd = 0.0;
    for (const row of computedRows) {
      totalApprovalGreyYd += row.x_studio_consumption_grey_yd || 0;
      totalApprovalFinishYd += row.x_studio_total_finish || 0;
    }
    const susutTotalApproval = totalApprovalGreyYd > 0
      ? round2(((totalApprovalGreyYd - totalApprovalFinishYd) / totalApprovalGreyYd) * 100)
      : 0.0;
    for (const row of computedRows) {
      row.x_studio_persentase_susut_approval = susutTotalApproval;
    }

    // 5. Upsert into x_rekap_susut_pabrik in Odoo
    const existingRekaps = await adminOdooClient._callObject(REKAP_MODEL, 'search_read', [
      [['x_studio_approval_request', '=', apprId]]
    ], { fields: ['id', 'x_name', 'x_studio_warna'] });

    const existingByWarna = new Map();
    for (const r of existingRekaps || []) {
      const w = String(r.x_studio_warna || '').trim();
      if (w) existingByWarna.set(w, r.id);
      if (r.x_name) existingByWarna.set(r.x_name, r.id);
    }

    for (const rowVals of computedRows) {
      const matchId = existingByWarna.get(rowVals.x_studio_warna) || existingByWarna.get(rowVals.x_name);
      if (matchId) {
        await adminOdooClient._callObject(REKAP_MODEL, 'write', [[matchId], rowVals], {
          context: { tracking_disable: true, no_automation: true }
        });
      } else {
        const createdId = await adminOdooClient._callObject(REKAP_MODEL, 'create', [rowVals], {
          context: { tracking_disable: true, no_automation: true }
        });
        existingByWarna.set(rowVals.x_studio_warna, createdId);
      }
    }

    return {
      success: true,
      approvalId: apprId,
      approvalName,
      warnaCount: computedRows.length,
      moCount: mos.length,
      rows: computedRows
    };
  });
}

/**
 * Given an MO ID, finds its Approval Request and triggers sync.
 */
export async function syncPabrikRecapForMo(moId, { preloadedMo = null } = {}) {
  const id = Number(moId);
  if (!id || isNaN(id)) return null;

  await adminOdooClient.authenticate();
  let mo = preloadedMo;
  if (!mo || mo.x_studio_approval_request === undefined) {
    const mos = await adminOdooClient._callObject('mrp.production', 'read', [
      [id],
      ['id', 'name', 'x_studio_approval_request', 'warehouse_id', 'picking_type_id']
    ]);
    if (!mos || mos.length === 0) return null;
    mo = mos[0];
  }

  const appr = mo.x_studio_approval_request;
  const apprId = Array.isArray(appr) ? appr[0] : Number(appr);
  if (!apprId) {
    return { success: true, skipped: true, reason: `MO #${id} has no Approval Request` };
  }

  return syncPabrikRecapForApproval(apprId);
}
