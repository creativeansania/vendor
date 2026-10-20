'use client';

import { Scissors, Tag, Package, Truck } from 'lucide-react';

export default function OrderTabsNav({
  activeTab,
  setActiveTab,
  fabricLinesCount = 0,
  accessoryLinesCount = 0,
  rollLinesCount = 0,
  transfersCount = 0
}) {
  const fCount = fabricLinesCount > 0 ? fabricLinesCount : rollLinesCount;

  return (
    <div className="segmented-tabs-wrapper">
      {/* 1. KAIN */}
      <button
        id="tab-btn-kain"
        type="button"
        onClick={() => setActiveTab('kain')}
        className={`segmented-tab-btn ${activeTab === 'kain' || activeTab === 'timbang' ? 'active' : ''}`}
      >
        <Scissors size={15} className="tab-icon" />
        <span>1. Kain {fCount > 0 ? `(${fCount})` : ''}</span>
      </button>

      {/* 2. AKSESORIS */}
      <button
        id="tab-btn-aksesoris"
        type="button"
        onClick={() => setActiveTab('aksesoris')}
        className={`segmented-tab-btn ${activeTab === 'aksesoris' ? 'active' : ''}`}
      >
        <Tag size={15} className="tab-icon" />
        <span>2. Aksesoris {accessoryLinesCount > 0 ? `(${accessoryLinesCount})` : ''}</span>
      </button>

      {/* 3. JAHIT */}
      <button
        id="tab-btn-jahit"
        type="button"
        onClick={() => setActiveTab('jahit')}
        className={`segmented-tab-btn ${activeTab === 'jahit' || activeTab === 'hasil' ? 'active' : ''}`}
      >
        <Package size={15} className="tab-icon" />
        <span>3. Jahit</span>
      </button>

      {/* 4. DOKUMEN TRANSFER */}
      <button
        id="tab-btn-transfer"
        type="button"
        onClick={() => setActiveTab('transfer')}
        className={`segmented-tab-btn ${activeTab === 'transfer' ? 'active' : ''}`}
      >
        <Truck size={15} className="tab-icon" />
        <span>4. Dokumen Transfer {transfersCount > 0 ? `(${transfersCount})` : ''}</span>
      </button>
    </div>
  );
}
