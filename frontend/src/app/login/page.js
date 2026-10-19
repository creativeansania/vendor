'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, setToken, setCurrentUser } from '@/lib/api';
import ThemeToggle from '@/components/ThemeToggle';
import { Lock, Mail, ArrowRight, ShieldCheck, AlertCircle, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetchApi('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password })
      });

      if (res.success && res.token) {
        setToken(res.token);
        setCurrentUser(res.user);
        router.push('/');
      } else {
        setError(res.message || 'Email atau password tidak sesuai.');
      }
    } catch (err) {
      setError(err.message || 'Koneksi ke backend gagal. Pastikan jaringan stabil.');
    } finally {
      setLoading(false);
    }
  };

  const setQuickAccount = (quickEmail, quickPass) => {
    setEmail(quickEmail);
    setPassword(quickPass);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', position: 'relative' }}>
      <div style={{ position: 'absolute', top: '18px', right: '18px' }}>
        <ThemeToggle />
      </div>
      <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Brand Header */}
        <div style={{ textAlign: 'center' }}>
          <div className="brand-icon" style={{ width: '54px', height: '54px', margin: '0 auto 16px auto', fontSize: '1.5rem', borderRadius: 'var(--radius-md)' }}>
            AN
          </div>
          <h1 style={{ fontSize: '1.65rem', marginBottom: '6px', fontWeight: 800 }}>ANSANIA</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            WIP Vendor & CMT Operations Portal
          </p>
        </div>

        {/* Login Card */}
        <div className="card" style={{ padding: '32px 28px' }}>
          <h2 style={{ fontSize: '1.15rem', marginBottom: '6px', fontWeight: 700 }}>Masuk ke Sistem</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: '20px' }}>
            Masukkan kredensial akun vendor atau internal Anda
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {error && (
              <div
                style={{
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--status-rose-bg)',
                  border: '1px solid var(--status-rose-border)',
                  color: 'var(--status-rose)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '0.82rem'
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="form-label">Email Pengguna</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Mail size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px' }} />
                <input
                  type="email"
                  required
                  placeholder="nama@vendor.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  style={{ paddingLeft: '40px', height: '44px' }}
                />
              </div>
            </div>

            <div>
              <label className="form-label">Kata Sandi</label>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <Lock size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '14px' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field"
                  style={{ paddingLeft: '40px', paddingRight: '40px', height: '44px' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: '12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="btn btn-primary"
              style={{ width: '100%', height: '44px', marginTop: '6px', fontSize: '0.92rem' }}
            >
              {loading ? (
                <>
                  <div className="spinner" style={{ width: '16px', height: '16px', borderWidth: '2px', borderColor: 'currentColor', borderTopColor: 'transparent' }}></div>
                  <span>Memverifikasi...</span>
                </>
              ) : (
                <>
                  <span>Masuk ke Aplikasi</span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Login Fillers */}
          <div style={{ marginTop: '24px', paddingTop: '18px', borderTop: '1px solid var(--border-subtle)' }}>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.04em' }}>
              Akses Cepat Pengujian:
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <button
                type="button"
                onClick={() => setQuickAccount('admin@kantiss.com', '@Bagusbemo1998')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '6px 10px', justifyContent: 'flex-start' }}
              >
                <span className="badge badge-purple" style={{ fontSize: '0.65rem' }}>Master Admin</span>
                <span style={{ color: 'var(--text-secondary)' }}>admin@kantiss.com</span>
              </button>

              <button
                type="button"
                onClick={() => setQuickAccount('kws.owner@vendor.com', 'vendor123')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '6px 10px', justifyContent: 'flex-start' }}
              >
                <span className="badge badge-emerald" style={{ fontSize: '0.65rem' }}>Master Vendor</span>
                <span style={{ color: 'var(--text-secondary)' }}>kws.owner@vendor.com</span>
              </button>

              <button
                type="button"
                onClick={() => setQuickAccount('kws.staff@vendor.com', 'vendor123')}
                className="btn btn-secondary"
                style={{ fontSize: '0.75rem', padding: '6px 10px', justifyContent: 'flex-start' }}
              >
                <span className="badge badge-amber" style={{ fontSize: '0.65rem' }}>Admin Vendor</span>
                <span style={{ color: 'var(--text-secondary)' }}>kws.staff@vendor.com</span>
              </button>
            </div>
          </div>
        </div>

        {/* Security Footer */}
        <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          Terhubung aman ke Odoo ERP & MariaDB cPanel Server
        </div>
      </div>
    </div>
  );
}
