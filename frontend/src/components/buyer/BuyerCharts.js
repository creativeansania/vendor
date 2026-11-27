'use client';

import { formatIntId, formatWeekShortId } from '@/lib/buyerDashboardClient';

export default function BuyerCharts({
  stages = [],
  weekly = [],
  unscheduledCount = 0,
  unscheduledQty = 0,
  selectedStage = 'all',
  onToggleStage
}) {
  const maxStageQty = Math.max(1, ...stages.map((s) => Number(s.qty_po || 0)));

  // Show up to 12 weekly buckets cleanly in chart (if more, still horizontally scrollable)
  const maxWeekQty = Math.max(1, ...weekly.map((w) => Number(w.qty_po || 0)));
  const chartHeightPx = 158;

  // Determine if weekly spans multiple calendar years so label stays unambiguous
  const distinctYears = new Set(weekly.map((w) => String(w.week_start || '').slice(0, 4)).filter(Boolean));
  const showYearInWeek = distinctYears.size > 1;

  return (
    <div className="buyer-charts-grid">
      {/* Left Card: Posisi produksi per tahap */}
      <section className="buyer-card">
        <h2 className="buyer-section-title">Posisi produksi per tahap</h2>
        <p className="buyer-section-sub">
          Qty PO menurut tahap WIP saat ini, urut dari awal hingga selesai.
        </p>

        <div className="buyer-stage-list">
          {stages.map((stage) => {
            const qty = Number(stage.qty_po || 0);
            const pctWidth = qty > 0 ? Math.max(3, Math.round((qty / maxStageQty) * 100)) : 0;
            const isSelected = selectedStage === stage.key;
            const isDone = stage.key === 'selesai';

            return (
              <button
                key={stage.key}
                type="button"
                className={`buyer-stage-row ${isSelected ? 'active' : ''}`}
                onClick={() => onToggleStage && onToggleStage(stage.key)}
                title={`Klik untuk filter tahap ${stage.label}`}
              >
                <span className="buyer-stage-label">{stage.label}</span>
                <div className="buyer-stage-track-wrap">
                  <div className="buyer-stage-bar-area">
                    <div
                      className={`buyer-stage-bar ${
                        qty === 0 ? 'empty-stage' : isDone ? 'done-stage' : 'active-stage'
                      }`}
                      style={{ width: qty > 0 ? `${pctWidth}%` : '3px' }}
                    />
                  </div>
                  <span className="buyer-stage-val">
                    {formatIntId(qty)} pcs · {stage.item_count} item
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Right Card: Jadwal kirim per minggu */}
      <section className="buyer-card">
        <h2 className="buyer-section-title">Jadwal kirim per minggu</h2>
        <p className="buyer-section-sub">
          Qty PO menurut minggu Plan Delivery (minggu mulai Senin), dibagi sudah selesai dan sisa.
        </p>

        <div className="buyer-legend">
          <span className="buyer-legend-item">
            <span className="buyer-legend-swatch" style={{ background: '#2563eb' }} />
            Sudah selesai
          </span>
          <span className="buyer-legend-item">
            <span className="buyer-legend-swatch" style={{ background: '#cbd5e1' }} />
            Sisa
          </span>
        </div>

        {weekly.length === 0 ? (
          <div
            style={{
              height: '180px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.82rem',
              color: '#94a3b8'
            }}
          >
            Belum ada jadwal Plan Delivery pada filter yang dipilih.
          </div>
        ) : (
          <div className="buyer-weekly-scroll">
            <div style={{ minWidth: weekly.length > 6 ? `${weekly.length * 72}px` : '100%' }}>
              <div className="buyer-weekly-chart">
                {weekly.map((w) => {
                  const total = Number(w.qty_po || 0);
                  const done = Number(w.qty_selesai_capped || 0);
                  const sisa = Number(w.qty_sisa || 0);
                  const totalBarPx = Math.max(6, Math.round((total / maxWeekQty) * chartHeightPx));
                  const donePx = total > 0 ? Math.round((done / total) * totalBarPx) : 0;
                  const sisaPx = Math.max(0, totalBarPx - donePx);

                  return (
                    <div
                      key={w.week_start}
                      className="buyer-week-col"
                      title={`Minggu ${formatWeekShortId(w.week_start, true)} | Qty PO: ${formatIntId(total)} pcs | Selesai: ${formatIntId(w.qty_selesai_actual)} pcs | Sisa: ${formatIntId(sisa)} pcs (${w.item_count} item)`}
                    >
                      <span className="buyer-week-total">{formatIntId(total)}</span>
                      <div className="buyer-week-stack" style={{ height: `${totalBarPx}px` }}>
                        {sisaPx > 0 && (
                          <div className="buyer-week-sisa" style={{ height: `${sisaPx}px` }} />
                        )}
                        {donePx > 0 && (
                          <div className="buyer-week-done" style={{ height: `${donePx}px` }} />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="buyer-week-labels">
                {weekly.map((w) => (
                  <div key={w.week_start} className="buyer-week-label">
                    {formatWeekShortId(w.week_start, showYearInWeek)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {unscheduledCount > 0 && (
          <p style={{ margin: '12px 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>
            Catatan: {unscheduledCount} item ({formatIntId(unscheduledQty)} pcs) belum memiliki tanggal Plan Delivery.
          </p>
        )}
      </section>
    </div>
  );
}
