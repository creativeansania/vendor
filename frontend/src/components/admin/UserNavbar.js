'use client';

import { useRouter } from 'next/navigation';
import ThemeToggle from '@/components/ThemeToggle';
import { ArrowLeft, UserPlus } from 'lucide-react';

export default function UserNavbar({ onOpenCreateModal }) {
  const router = useRouter();

  return (
    <header className="navbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
        <button
          onClick={() => router.push('/')}
          className="btn btn-secondary btn-icon"
          style={{ flexShrink: 0 }}
          title="Kembali ke Dashboard"
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: '0.98rem', margin: 0, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            Kelola Pengguna
          </h1>
          <p style={{ margin: 0, fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
            Master Admin Control
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <ThemeToggle />
        <button
          onClick={onOpenCreateModal}
          className="btn btn-primary"
          style={{ fontSize: '0.8rem', padding: '7px 12px' }}
        >
          <UserPlus size={15} />
          <span>+ Tambah</span>
        </button>
      </div>
    </header>
  );
}
