'use client';

import { useRouter } from 'next/navigation';
import { logout } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import StatusBadge from '@/components/common/StatusBadge';
import { Users, Smartphone, LogOut } from 'lucide-react';

export default function DashboardNavbar({ user }) {
  const router = useRouter();

  if (!user) return null;

  const handleInstallPwa = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('open-pwa-install'));
    }
  };

  return (
    <header className="navbar">
      <div className="brand-badge" style={{ minWidth: 0, flex: 1 }}>
        <div className="brand-icon" style={{ width: '36px', height: '36px', fontSize: '1rem', borderRadius: '10px' }}>
          AN
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '0.98rem', margin: 0, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {user.vendor_name || 'Ansania Operations'}
            </h1>
            <StatusBadge type="role" value={user.role} />
          </div>
          <p style={{ margin: '1px 0 0', fontSize: '0.75rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user.name}
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {user.role === 'master_admin' && (
          <button
            onClick={() => router.push('/admin/users')}
            className="btn btn-secondary"
            style={{ fontSize: '0.78rem', padding: '7px 12px', borderRadius: '10px' }}
            title="Kelola Pengguna"
          >
            <Users size={15} />
            <span className="hide-on-mobile">Akun</span>
          </button>
        )}

        <button
          type="button"
          onClick={handleInstallPwa}
          className="btn btn-secondary"
          style={{ fontSize: '0.78rem', padding: '7px 12px', borderRadius: '10px' }}
          title="Pasang di Layar Utama HP"
        >
          <Smartphone size={15} color="var(--brand-gold)" />
          <span className="hide-on-mobile">Pasang di HP</span>
        </button>

        <ThemeToggle />

        <button
          onClick={logout}
          className="btn btn-secondary btn-icon"
          style={{ width: '36px', height: '36px', borderRadius: '10px' }}
          title="Keluar"
        >
          <LogOut size={16} color="var(--status-rose)" />
        </button>
      </div>
    </header>
  );
}
