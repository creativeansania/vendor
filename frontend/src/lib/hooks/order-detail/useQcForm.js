'use client';

import { useState, useEffect } from 'react';
import { fetchApi } from '@/lib/api';
import { compressImage, formatImagePreviewSrc } from '@/lib/utils/imageCompressor';

// Strictly limited to the 2 designated QC inspectors: Yana Suryana & Dindin
const DEFAULT_INSPECTORS = [
  { id: 14299, name: 'Yana Suryana' },
  { id: 318, name: 'Dindin' }
];

function deriveInitialInspectorId(order) {
  if (order?.qc_pass_id && (Number(order.qc_pass_id) === 14299 || Number(order.qc_pass_id) === 318)) {
    return String(order.qc_pass_id);
  }
  return '14299';
}

function deriveInitialInspectorName(order) {
  if (order?.qc_pass_id && Number(order.qc_pass_id) === 318) return 'Dindin';
  return order?.qc_pass_name || 'Yana Suryana';
}

export function useQcForm({ order, targetSpkQty = 0, onSaveQc }) {
  const [inspectors, setInspectors] = useState(DEFAULT_INSPECTORS);
  const [localFeedback, setLocalFeedback] = useState(null);

  const [qcPassId, setQcPassId] = useState(() => deriveInitialInspectorId(order));
  const [qcPassName, setQcPassName] = useState(() => deriveInitialInspectorName(order));
  const [qtyQcPass, setQtyQcPass] = useState(() =>
    order?.qty_qc_pass !== undefined && order?.qty_qc_pass !== null
      ? String(order.qty_qc_pass)
      : order?.qty_grade_a !== undefined && order?.qty_grade_a !== null
      ? String(order.qty_grade_a)
      : '0'
  );
  const [qcStatus, setQcStatus] = useState(() => order?.qc_status || 'Passed');
  const [keteranganQms, setKeteranganQms] = useState(() => order?.keterangan_qms || '');
  const [gambarQc, setGambarQc] = useState(() => order?.gambar_qc || null);

  // Sync when order refreshes after save
  const syncKey = `${order?.id || ''}:${order?.qc_checked_at || ''}:${order?.qty_qc_pass ?? ''}:${order?.qc_status || ''}`;
  const [prevSyncKey, setPrevSyncKey] = useState(syncKey);
  if (syncKey !== prevSyncKey) {
    setPrevSyncKey(syncKey);
    if (order) {
      if (order.qc_pass_id && (Number(order.qc_pass_id) === 14299 || Number(order.qc_pass_id) === 318)) {
        setQcPassId(String(order.qc_pass_id));
        setQcPassName(Number(order.qc_pass_id) === 318 ? 'Dindin' : (order.qc_pass_name || 'Yana Suryana'));
      }
      if (order.qty_qc_pass !== undefined && order.qty_qc_pass !== null) {
        setQtyQcPass(String(order.qty_qc_pass));
      }
      if (order.qc_status) {
        setQcStatus(order.qc_status);
      }
      if (order.keterangan_qms) {
        setKeteranganQms(order.keterangan_qms);
      }
      if (order.gambar_qc) {
        setGambarQc(order.gambar_qc);
      }
    }
  }

  // Load QC details & live image from Odoo via fetchApi
  useEffect(() => {
    let isMounted = true;
    async function loadInspectorsAndQcData() {
      if (!order?.id) return;
      try {
        const res = await fetchApi(`/orders/${order.id}/qc`);
        if (isMounted && res?.success) {
          if (Array.isArray(res.inspectors) && res.inspectors.length > 0) {
            setInspectors(res.inspectors);
          }
          if (res.gambarQc) {
            setGambarQc((prev) => prev || res.gambarQc);
          }
        }
      } catch (err) {
        console.warn('Failed to load QC data via fetchApi:', err);
      }
    }
    loadInspectorsAndQcData();
    return () => {
      isMounted = false;
    };
  }, [order?.id]);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setLocalFeedback({ type: 'error', text: 'File harus berupa gambar (JPG, PNG, atau WEBP).' });
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      setLocalFeedback({ type: 'error', text: 'Ukuran foto maksimal 15MB.' });
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const compressed = await compressImage(reader.result, 1280, 0.78);
        setGambarQc(compressed);
        setLocalFeedback({
          type: 'success',
          text: 'Foto berhasil dimuat & dioptimasi. Foto akan disimpan ke Odoo saat Anda klik "Simpan & Sinkronkan".'
        });
      } catch {
        setGambarQc(reader.result);
        setLocalFeedback({
          type: 'success',
          text: 'Foto berhasil dimuat. Klik "Simpan & Sinkronkan" untuk mengirim ke Odoo.'
        });
      }
    };
    reader.onerror = () => {
      setLocalFeedback({ type: 'error', text: 'Gagal membaca file gambar.' });
    };
    reader.readAsDataURL(file);
  };

  const handlePresetGradeA = () => {
    const preset =
      order?.qty_grade_a !== undefined && Number(order?.qty_grade_a) > 0
        ? order.qty_grade_a
        : targetSpkQty || 0;
    setQtyQcPass(String(preset));
  };

  const handleInspectorChange = (val) => {
    setQcPassId(val);
    const found = inspectors.find((i) => String(i.id) === val);
    if (found) setQcPassName(found.name);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLocalFeedback(null);

    const selectedInspector = inspectors.find((i) => String(i.id) === String(qcPassId));
    const passName = selectedInspector ? selectedInspector.name : qcPassName;

    const payload = {
      qcPassId: qcPassId ? Number(qcPassId) : null,
      qcPassName: passName || null,
      qtyQcPass: parseFloat(qtyQcPass) || 0,
      qcStatus: qcStatus || 'Passed',
      keteranganQms: (keteranganQms || '').trim(),
      gambarQc: gambarQc || null
    };

    if (onSaveQc) {
      await onSaveQc(payload);
    }
  };

  return {
    inspectors,
    localFeedback,
    qcPassId,
    qcPassName,
    qtyQcPass,
    setQtyQcPass,
    qcStatus,
    setQcStatus,
    keteranganQms,
    setKeteranganQms,
    gambarQc,
    setGambarQc,
    imagePreviewSrc: formatImagePreviewSrc(gambarQc),
    handleInspectorChange,
    handleFileChange,
    handlePresetGradeA,
    handleSubmit
  };
}

