'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, setToken, setCurrentUser } from '@/lib/api';
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      if (res.success && res.token) {
        setToken(res.token);
        setCurrentUser(res.user);
        router.push('/');
      } else {
        setError(res.message || 'Login gagal.');
      }
    } catch (err) {
      setError(err.message || 'Koneksi ke server gagal. Cek jaringan Anda.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ padding: '36px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '100vh' }}>
      {/* Brand Header */}
      <div style={{ textAlign: 'center', marginBottom: '36px' }}>
        <div style={{
          width: '68px',
          height: '68px',
          borderRadius: '20px',
          background: 'var(--gradient-brand)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px auto',
          boxShadow: '0 8px 24px rgba(56, 189, 248, 0.35)'
        }}>
          <ShieldCheck size={36} color="#ffffff" />
        </div>
        <h1 style={{ fontSize: '1.75rem', marginBottom: '6px' }}>WIP Vendor</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
          Monitoring Produksi & Timbang Kain Ansania
        </p>
      </div>

      {/* Login Card */}
      <div className="glass-card">
        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '12px 14px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(244, 63, 94, 0.15)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              color: '#fb7185',
              fontSize: '0.85rem',
              marginBottom: '18px'
            }}>
              <AlertCircle size={18} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <div className="input-group">
            <label className="input-label">Email Pengguna</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Mail size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '14px' }} />
              <input
                type="email"
                required
                className="input-field"
                style={{ paddingLeft: '42px', width: '100%' }}
                placeholder="nama@vendor.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="input-group" style={{ marginBottom: '24px' }}>
            <label className="input-label">Kata Sandi</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '14px' }} />
              <input
                type="password"
                required
                className="input-field"
                style={{ paddingLeft: '42px', width: '100%' }}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={loading}
          >
            {loading ? (
              <span>Memproses...</span>
            ) : (
              <>
                <span>Masuk Aplikasi</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>

      <div style={{ textAlign: 'center', marginTop: '28px' }}>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          Belum punya akun? Hubungi <strong>Master Admin Ansania</strong>
        </p>
      </div>
    </div>
  );
}
