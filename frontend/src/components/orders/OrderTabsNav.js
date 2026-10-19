'use client';

import { Scissors, Package, Truck } from 'lucide-react';

export default function OrderTabsNav({
  activeTab,
  setActiveTab,
  rollLinesCount = 0,
  transfersCount = 0
}) {
  return (
    <div className="segmented-tabs-wrapper">
      <button
        id="tab-btn-timbang"
        onClick={() => setActiveTab('timbang')}
        className={`segmented-tab-btn ${activeTab === 'timbang' ? 'active' : ''}`}
      >
        <Scissors size={15} className="tab-icon" />
        <span>1. Hasil Potong {rollLinesCount > 0 ? `(${rollLinesCount})` : ''}</span>
      </button>

      <button
        id="tab-btn-hasil"
        onClick={() => setActiveTab('hasil')}
        className={`segmented-tab-btn ${activeTab === 'hasil' ? 'active' : ''}`}
      >
        <Package size={15} className="tab-icon" />
        <span>2. Hasil Jahit</span>
      </button>

      <button
        id="tab-btn-transfer"
        onClick={() => setActiveTab('transfer')}
        className={`segmented-tab-btn ${activeTab === 'transfer' ? 'active' : ''}`}
      >
        <Truck size={15} className="tab-icon" />
        <span>
          3. Dokumen Transfer {transfersCount > 0 ? `(${transfersCount})` : ''}
        </span>
      </button>
    </div>
  );
}
