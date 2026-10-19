'use client';

import { Search } from 'lucide-react';

export default function UserFilters({ search, onSearchChange, filterRole, onFilterRoleChange, totalUsers }) {
  return (
    <div className="card" style={{ padding: '14px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', width: '100%' }}>
          <Search size={15} color="var(--text-muted)" style={{ position: 'absolute', left: '10px' }} />
          <input
            type="text"
            placeholder="Cari nama, email, vendor..."
            className="input-field"
            style={{ paddingLeft: '34px', height: '38px', fontSize: '0.84rem' }}
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>

        <div className="filter-bar">
          <button
            className={`filter-chip ${filterRole === 'all' ? 'active' : ''}`}
            onClick={() => onFilterRoleChange('all')}
          >
            Semua ({totalUsers})
          </button>
          <button
            className={`filter-chip ${filterRole === 'admin_vendor' ? 'active' : ''}`}
            onClick={() => onFilterRoleChange('admin_vendor')}
          >
            Admin Vendor
          </button>
          <button
            className={`filter-chip ${filterRole === 'master_vendor' ? 'active' : ''}`}
            onClick={() => onFilterRoleChange('master_vendor')}
          >
            Master Vendor
          </button>
          <button
            className={`filter-chip ${filterRole === 'admin' ? 'active' : ''}`}
            onClick={() => onFilterRoleChange('admin')}
          >
            Admin Internal
          </button>
          <button
            className={`filter-chip ${filterRole === 'master_admin' ? 'active' : ''}`}
            onClick={() => onFilterRoleChange('master_admin')}
          >
            Master Admin
          </button>
        </div>
      </div>
    </div>
  );
}
