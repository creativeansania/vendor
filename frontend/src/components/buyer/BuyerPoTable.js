'use client';

import { useState } from 'react';
import {
  formatDateId,
  formatIntId,
  formatPctId,
  STATUS_LABELS
} from '@/lib/buyerDashboardClient';

const INITIAL_LIMIT = 50;

export default function BuyerPoTable({ items = [] }) {
  const [showAll, setShowAll] = useState(false);

  const visibleItems = showAll ? items : items.slice(0, INITIAL_LIMIT);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <section className="buyer-section">
      <h2 className="buyer-section-title">Daftar PO ({formatIntId(items.length)})</h2>
      <p className="buyer-section-sub">
        Urut berdasarkan Plan Delivery terdekat. Geser ke samping untuk melihat semua kolom.
      </p>

      <div className="buyer-table-wrap">
        <table className="buyer-table">
          <thead>
            <tr>
              <th>Tgl PO</th>
              <th>Plan Delivery</th>
              <th>No PO KSS</th>
              <th>No PO Buyer</th>
              <th>SKU</th>
              <th>Nama Artikel</th>
              <th>Warna</th>
              <th className="num">Qty PO (pcs)</th>
              <th className="num" title="Qty lulus QC & siap kirim (SFP)">Siap Kirim (SFP)</th>
              <th className="num" title="Qty sudah dikirim ke buyer (Delivered)">Terkirim</th>
              <th className="num">Sisa</th>
              <th>Tahap WIP</th>
              <th>Status</th>
              <th className="num">% Finish</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.length === 0 ? (
              <tr>
                <td colSpan={14} style={{ textAlign: 'center', padding: '28px 16px', color: '#64748b' }}>
                  Tidak ada item PO yang cocok dengan filter saat ini.
                </td>
              </tr>
            ) : (
              visibleItems.map((item) => {
                const barWidth = Math.min(100, Math.max(0, Number(item.pct_finish || 0)));
                const isComplete = Number(item.pct_finish || 0) >= 100;
                const badgeClass = `buyer-badge buyer-badge-${item.health_status || 'on_track'}`;

                return (
                  <tr key={item.id}>
                    <td className="buyer-nowrap">{formatDateId(item.tgl_po)}</td>
                    <td className="buyer-nowrap">
                      <span
                        style={{
                          fontWeight:
                            item.health_status === 'terlambat' || item.health_status === 'perlu_perhatian'
                              ? 600
                              : 400,
                          color:
                            item.health_status === 'terlambat'
                              ? '#b91c1c'
                              : item.health_status === 'perlu_perhatian'
                              ? '#b45309'
                              : '#1e293b'
                        }}
                      >
                        {formatDateId(item.plan_delivery)}
                      </span>
                    </td>
                    <td className="buyer-nowrap" style={{ fontWeight: 500 }}>
                      {item.no_po_kss}
                    </td>
                    <td className="buyer-nowrap" style={{ color: '#475569' }}>
                      {item.no_po_buyer || '—'}
                    </td>
                    <td className="buyer-sku-cell">{item.sku || '—'}</td>
                    <td style={{ minWidth: '180px', maxWidth: '280px' }}>{item.nama_artikel}</td>
                    <td style={{ minWidth: '110px', color: '#334155' }}>{item.warna}</td>
                    <td className="num buyer-nowrap" style={{ fontWeight: 600 }}>
                      {formatIntId(item.qty_po)}
                    </td>
                    <td className="num buyer-nowrap">{formatIntId(item.qty_sfp)}</td>
                    <td className="num buyer-nowrap">{formatIntId(item.qty_delivered)}</td>
                    <td className="num buyer-nowrap" style={{ color: item.qty_sisa > 0 ? '#334155' : '#94a3b8' }}>
                      {formatIntId(item.qty_sisa)}
                    </td>
                    <td className="buyer-nowrap">
                      <span className="buyer-badge buyer-badge-stage">{item.stage_label}</span>
                    </td>
                    <td className="buyer-nowrap">
                      <span className={badgeClass}>
                        {STATUS_LABELS[item.health_status] || item.health_status}
                      </span>
                    </td>
                    <td className="num buyer-nowrap">
                      <div className="buyer-progress-cell">
                        <span className="buyer-progress-pct">{formatPctId(item.pct_finish)}</span>
                        <div className="buyer-progress-track">
                          <div
                            className={`buyer-progress-fill ${isComplete ? 'complete' : ''}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {hiddenCount > 0 && (
        <div style={{ marginTop: '12px', textAlign: 'center' }}>
          <button
            type="button"
            className="buyer-chip-btn"
            onClick={() => setShowAll(true)}
          >
            Tampilkan semua ({formatIntId(items.length)} item · +{formatIntId(hiddenCount)} lainnya)
          </button>
        </div>
      )}
    </section>
  );
}
