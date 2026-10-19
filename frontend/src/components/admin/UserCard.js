'use client';

import StatusBadge from '@/components/common/StatusBadge';
import { Building2 } from 'lucide-react';

export default function UserCard({ user, onEdit }) {
  return (
    <div
      className="card"
      style={{
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        gap: '12px',
        opacity: user.is_active ? 1 : 0.6
      }}
    >
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minWidth: 0 }}>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.name}
            </span>
            {!user.is_active && (
              <span className="badge badge-rose" style={{ fontSize: '0.65rem' }}>Nonaktif</span>
            )}
          </div>
          <div style={{ flexShrink: 0 }}>
            <StatusBadge type="role" value={user.role} />
          </div>
        </div>

        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {user.email}
        </div>

        {user.vendor_name && (
          <div style={{ fontSize: '0.78rem', color: 'var(--brand-gold)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Building2 size={13} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.vendor_name}</span>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
        <button
          onClick={() => onEdit(user)}
          className="btn btn-secondary"
          style={{ fontSize: '0.76rem', padding: '6px 12px' }}
        >
          Edit / Kelola Akses
        </button>
      </div>
    </div>
  );
}
