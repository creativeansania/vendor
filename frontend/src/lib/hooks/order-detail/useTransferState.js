import { useState, useMemo } from 'react';
import { fetchApi } from '@/lib/api';

export function useTransferState({
  orderId,
  setOrder,
  setRollLines,
  setRawMoves,
  setActualCutting,
  setRollWeights,
  setPenerimaanQtys,
  setFeedback
}) {
  const [transfers, setTransfers] = useState([]);
  const [transferFilter, setTransferFilter] = useState('all');
  const [copiedTransferId, setCopiedTransferId] = useState(null);
  const [syncingOdoo, setSyncingOdoo] = useState(false);

  // Filtered transfers
  const filteredTransfers = useMemo(() => {
    if (!transfers || transfers.length === 0) return [];
    if (transferFilter === 'all') return transfers;
    if (transferFilter === 'retur') return transfers.filter((t) => t.category === 'retur' || t.category === 'lainnya');
    return transfers.filter((t) => t.category === transferFilter);
  }, [transfers, transferFilter]);

  const transferCounts = useMemo(() => {
    const all = transfers.length;
    const komponen = transfers.filter((t) => t.category === 'komponen').length;
    const produkJadi = transfers.filter((t) => t.category === 'produk_jadi').length;
    const retur = transfers.filter((t) => t.category === 'retur' || t.category === 'lainnya').length;
    return { all, komponen, produkJadi, retur };
  }, [transfers]);

  // Copy transfer document number to clipboard
  const handleCopyTransferName = (transferName, transferId) => {
    if (!transferName) return;
    navigator.clipboard?.writeText(transferName);
    setCopiedTransferId(transferId);
    setTimeout(() => {
      setCopiedTransferId(null);
    }, 2000);
  };

  // Live Force-Sync directly from Odoo ERP
  const handleForceSyncOdoo = async () => {
    if (syncingOdoo) return;
    setSyncingOdoo(true);
    setFeedback({ text: '', type: '' });
    try {
      const res = await fetchApi(`/pwa/orders/${orderId}/sync-odoo`, {
        method: 'POST'
      });
      if (res.success && res.order) {
        setOrder(res.order);
        const fetchedRolls = res.rollLines || res.order?.roll_lines || [];
        setRollLines(fetchedRolls);
        setRawMoves(res.rawMoves || res.order?.raw_moves || []);
        setTransfers(res.transfers || res.order?.transfers || []);

        if (res.order.actual_cutting !== null && res.order.actual_cutting !== undefined) {
          setActualCutting(res.order.actual_cutting);
        }

        const weights = {};
        const pQtys = {};
        fetchedRolls.forEach((r) => {
          if (r.qty_berat_kg !== null && r.qty_berat_kg !== undefined) {
            weights[r.id] = r.qty_berat_kg;
          }
          if (r.qty_penerimaan !== null && r.qty_penerimaan !== undefined) {
            pQtys[r.id] = r.qty_penerimaan;
          } else if (r.qty !== undefined && r.qty !== null) {
            pQtys[r.id] = r.qty;
          }
        });
        setRollWeights(weights);
        setPenerimaanQtys(pQtys);

        setFeedback({
          text: 'Data SPK, BOM material, dan dokumen transfer berhasil disinkronkan langsung dari Odoo!',
          type: 'success'
        });
      } else {
        throw new Error(res.message || 'Gagal menyinkronkan data dari Odoo');
      }
    } catch (err) {
      setFeedback({
        text: 'Gagal sinkronisasi Odoo: ' + err.message,
        type: 'error'
      });
    } finally {
      setSyncingOdoo(false);
    }
  };

  return {
    transfers,
    setTransfers,
    transferFilter,
    setTransferFilter,
    copiedTransferId,
    setCopiedTransferId,
    syncingOdoo,
    setSyncingOdoo,
    filteredTransfers,
    transferCounts,
    handleCopyTransferName,
    handleForceSyncOdoo
  };
}
