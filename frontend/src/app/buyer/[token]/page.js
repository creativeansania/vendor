'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import BuyerDashboardView from '@/components/buyer/BuyerDashboardView';

function BuyerPageContent() {
  const params = useParams();
  const token = Array.isArray(params?.token) ? params.token[0] : params?.token;
  if (!token) return null;
  return <BuyerDashboardView token={token} />;
}

export default function PublicBuyerDashboardPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: '100vh', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <div className="spinner" style={{ margin: '0 auto 14px', borderColor: '#e2e8f0', borderTopColor: '#2563eb' }} />
            <p style={{ fontSize: '0.9rem', color: '#64748b' }}>Memuat Monitoring WIP Produksi...</p>
          </div>
        </div>
      }
    >
      <BuyerPageContent />
    </Suspense>
  );
}
