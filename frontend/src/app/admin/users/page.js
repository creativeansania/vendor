'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';
import {
  ArrowLeft,
  Users,
  UserPlus,
  ShieldCheck,
  ShieldAlert,
  Building2,
  KeyRound,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';

export default function AdminUsersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });

  // Create User Modal
  const [createModal, setCreateModal] = useState(false);
  const [newUserData, setNewUserData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'admin_vendor',
    vendor_id: ''
  });

  // Edit/Reset Password Modal
  const [editModal, setEditModal] = useState({
    open: false,
    user: null,
    newPassword: '',
    role: '',
    vendor_id: '',
    is_active: true
  });

  // Guard: Only master_admin
  useEffect(() => {
    const u = getCurrentUser();
    if (!u) {
      router.push('/login');
      return;
    }
    if (u.role !== 'master_admin') {
      router.push('/');
      return;
    }
    setCurrentUser(u);
    loadData();
  }, [router]);

  async function loadData() {
    setLoading(true);
    try {
      const [usersRes, vendorsRes] = await Promise.all([
        fetchApi('/admin/users'),
        fetchApi('/pwa/vendors')
      ]);
      setUsers(usersRes.data || []);
      setVendors(vendorsRes.data || []);
    } catch (err) {
      setFeedback({ text: 'Gagal memuat data: ' + err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateUser(e) {
    e.preventDefault();
    setActionLoading(true);
    setFeedback({ text: '', type: '' });

    try {
      await fetchApi('/admin/users', {
        method: 'POST',
        body: JSON.stringify(newUserData)
      });
      setFeedback({ text: 'Akun pengguna berhasil dibuat!', type: 'success' });
      setCreateModal(false);
      setNewUserData({
        name: '',
        email: '',
        password: '',
        role: 'admin_vendor',
        vendor_id: ''
      });
      loadData();
    } catch (err) {
      setFeedback({ text: 'Gagal membuat akun: ' + err.message, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUpdateUser(e) {
    e.preventDefault();
    if (!editModal.user) return;
    setActionLoading(true);

    try {
      const payload = {
        role: editModal.role,
        vendor_id: editModal.vendor_id || null,
        is_active: editModal.is_active
      };
      if (editModal.newPassword.trim()) {
        payload.password = editModal.newPassword.trim();
      }

      await fetchApi(`/admin/users/${editModal.user.id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      setFeedback({ text: 'Akun berhasil diperbarui!', type: 'success' });
      setEditModal({ open: false, user: null, newPassword: '', role: '', vendor_id: '', is_active: true });
      loadData();
    } catch (err) {
      setFeedback({ text: 'Gagal update akun: ' + err.message, type: 'error' });
    } finally {
      setActionLoading(false);
    }
  }

  function getRoleBadge(role) {
    switch (role) {
      case 'master_admin':
        return <span className="badge badge-purple">Master Admin</span>;
      case 'admin':
        return <span className="badge badge-info">Internal Admin</span>;
      case 'master_vendor':
        return <span className="badge badge-success">Master Vendor (Owner)</span>;
      case 'admin_vendor':
        return <span className="badge badge-warning">Admin Vendor (Staf)</span>;
      default:
        return <span className="badge">{role}</span>;
    }
  }

  return (
    <div style={{ paddingBottom: '60px' }}>
      {/* Top Navbar */}
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary btn-icon"
            title="Kembali ke Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ fontSize: '1.05rem', margin: 0, fontWeight: 700 }}>
              Kelola Pengguna & Vendor
            </h1>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Master Admin Access Control
            </p>
          </div>
        </div>

        <button
          onClick={() => setCreateModal(true)}
          className="btn btn-primary"
          style={{ fontSize: '0.82rem', padding: '8px 12px' }}
        >
          <UserPlus size={16} />
          <span>+ Tambah Akun</span>
        </button>
      </header>

      {/* Alerts */}
      {feedback.text && (
        <div
          style={{
            margin: '12px',
            padding: '12px 16px',
            borderRadius: 'var(--radius)',
            fontSize: '0.88rem',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: feedback.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: feedback.type === 'success' ? '1px solid var(--accent-success)' : '1px solid var(--accent-danger)',
            color: feedback.type === 'success' ? 'var(--accent-success)' : 'var(--accent-danger)'
          }}
        >
          {feedback.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* User List */}
      <div style={{ padding: '0 12px', marginTop: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ fontSize: '0.92rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Daftar Akun Terdaftar ({users.length})
          </h2>
          <button
            onClick={loadData}
            className="btn btn-secondary btn-icon"
            title="Refresh Data"
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
            <p style={{ color: 'var(--text-muted)' }}>Memuat daftar akun...</p>
          </div>
        ) : users.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ color: 'var(--text-muted)' }}>Belum ada akun pengguna.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {users.map((u) => (
              <div
                key={u.id}
                className="card"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '14px 16px',
                  opacity: u.is_active ? 1 : 0.6
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.96rem', color: 'var(--text-primary)' }}>
                      {u.name}
                    </span>
                    {getRoleBadge(u.role)}
                    {!u.is_active && (
                      <span className="badge badge-danger" style={{ fontSize: '0.68rem' }}>Nonaktif</span>
                    )}
                  </div>

                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {u.email}
                  </div>

                  {u.vendor_name && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--accent-info)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Building2 size={13} />
                      <span>{u.vendor_name}</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={() =>
                    setEditModal({
                      open: true,
                      user: u,
                      newPassword: '',
                      role: u.role,
                      vendor_id: u.vendor_id || '',
                      is_active: Boolean(u.is_active)
                    })
                  }
                  className="btn btn-secondary"
                  style={{ fontSize: '0.78rem', padding: '6px 12px' }}
                >
                  Edit / Akses
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* CREATE USER MODAL */}
      {createModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                Tambah Akun Pengguna
              </h3>
              <button
                type="button"
                onClick={() => setCreateModal(false)}
                className="btn btn-secondary btn-icon"
              >
                <XCircle size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="form-label">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Budi Santoso / CV Berkah"
                  value={newUserData.name}
                  onChange={(e) => setNewUserData((d) => ({ ...d, name: e.target.value }))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="form-label">Email Login</label>
                <input
                  type="email"
                  required
                  placeholder="budi@vendor.com"
                  value={newUserData.email}
                  onChange={(e) => setNewUserData((d) => ({ ...d, email: e.target.value }))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="form-label">Password Sementara</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  placeholder="Minimal 6 karakter"
                  value={newUserData.password}
                  onChange={(e) => setNewUserData((d) => ({ ...d, password: e.target.value }))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="form-label">Peran (Role)</label>
                <select
                  value={newUserData.role}
                  onChange={(e) => setNewUserData((d) => ({ ...d, role: e.target.value }))}
                  className="select-field"
                >
                  <option value="admin_vendor">Admin Vendor (Staf Timbang - Harga Tersembunyi)</option>
                  <option value="master_vendor">Master Vendor (Owner - Harga Terlihat)</option>
                  <option value="admin">Internal Admin (Staf Kantor Ansania - View Only)</option>
                  <option value="master_admin">Master Admin (Full Hak Akses & Unlock)</option>
                </select>
              </div>

              {['admin_vendor', 'master_vendor'].includes(newUserData.role) && (
                <div>
                  <label className="form-label">Vendor Terkait</label>
                  <select
                    required
                    value={newUserData.vendor_id}
                    onChange={(e) => setNewUserData((d) => ({ ...d, vendor_id: e.target.value }))}
                    className="select-field"
                  >
                    <option value="">-- Pilih Vendor Ansania --</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setCreateModal(false)}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  {actionLoading ? 'Menyimpan...' : 'Simpan Akun'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {editModal.open && editModal.user && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
                  Edit Akun: {editModal.user.name}
                </h3>
                <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                  {editModal.user.email}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModal({ open: false, user: null, newPassword: '', role: '', vendor_id: '', is_active: true })}
                className="btn btn-secondary btn-icon"
              >
                <XCircle size={18} />
              </button>
            </div>

            <form onSubmit={handleUpdateUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="form-label">Peran (Role)</label>
                <select
                  value={editModal.role}
                  onChange={(e) => setEditModal((m) => ({ ...m, role: e.target.value }))}
                  className="select-field"
                >
                  <option value="admin_vendor">Admin Vendor (Staf Timbang - Harga Tersembunyi)</option>
                  <option value="master_vendor">Master Vendor (Owner - Harga Terlihat)</option>
                  <option value="admin">Internal Admin (Staf Kantor Ansania - View Only)</option>
                  <option value="master_admin">Master Admin (Full Hak Akses & Unlock)</option>
                </select>
              </div>

              {['admin_vendor', 'master_vendor'].includes(editModal.role) && (
                <div>
                  <label className="form-label">Vendor Terkait</label>
                  <select
                    value={editModal.vendor_id}
                    onChange={(e) => setEditModal((m) => ({ ...m, vendor_id: e.target.value }))}
                    className="select-field"
                  >
                    <option value="">-- Pilih Vendor Ansania --</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="form-label">Reset Password (Kosongkan jika tidak diganti)</label>
                <input
                  type="password"
                  placeholder="Masukkan password baru min 6 digit"
                  minLength={6}
                  value={editModal.newPassword}
                  onChange={(e) => setEditModal((m) => ({ ...m, newPassword: e.target.value }))}
                  className="input-field"
                />
              </div>

              <div>
                <label className="form-label">Status Akun</label>
                <select
                  value={editModal.is_active ? '1' : '0'}
                  onChange={(e) => setEditModal((m) => ({ ...m, is_active: e.target.value === '1' }))}
                  className="select-field"
                >
                  <option value="1">Aktif (Dapat Login)</option>
                  <option value="0">Nonaktif (Blokir Akses)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setEditModal({ open: false, user: null, newPassword: '', role: '', vendor_id: '', is_active: true })}
                  className="btn btn-secondary"
                  style={{ flex: 1 }}
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                >
                  {actionLoading ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
