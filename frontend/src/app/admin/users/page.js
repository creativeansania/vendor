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
  CheckCircle2,
  X,
  AlertTriangle,
  RefreshCw,
  Search,
  Lock,
  Mail,
  UserCheck
} from 'lucide-react';

export default function AdminUsersPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [filterRole, setFilterRole] = useState('all');
  const [search, setSearch] = useState('');

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

      setFeedback({ text: 'Akun pengguna berhasil diperbarui!', type: 'success' });
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
        return <span className="badge badge-sky">Admin Internal</span>;
      case 'master_vendor':
        return <span className="badge badge-emerald">Master Vendor</span>;
      case 'admin_vendor':
        return <span className="badge badge-amber">Admin Vendor</span>;
      default:
        return <span className="badge">{role}</span>;
    }
  }

  const filteredUsers = users.filter((u) => {
    if (filterRole !== 'all' && u.role !== filterRole) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        u.name?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q) ||
        u.vendor_name?.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', paddingBottom: '60px' }}>
      {/* Top Navbar */}
      <header className="navbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button
            onClick={() => router.push('/')}
            className="btn btn-secondary btn-icon"
            title="Kembali ke Dashboard"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 style={{ fontSize: '1.05rem', margin: 0, fontWeight: 700 }}>
              Kelola Akses Pengguna & Vendor
            </h1>
            <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
              Master Admin Control Panel
            </p>
          </div>
        </div>

        <button
          onClick={() => setCreateModal(true)}
          className="btn btn-primary"
          style={{ fontSize: '0.82rem', padding: '8px 14px' }}
        >
          <UserPlus size={16} />
          <span>+ Buat Akun Baru</span>
        </button>
      </header>

      {/* Main Content */}
      <main style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Alerts */}
        {feedback.text && (
          <div
            style={{
              padding: '12px 16px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.88rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
              border: `1px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
              color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)'
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Toolbar: Search & Role Filter */}
        <div className="card" style={{ padding: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={16} color="var(--text-muted)" style={{ position: 'absolute', left: '12px' }} />
              <input
                type="text"
                placeholder="Cari nama pengguna, email, atau vendor..."
                className="input-field"
                style={{ paddingLeft: '38px', height: '40px' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="filter-bar">
              <button
                className={`filter-chip ${filterRole === 'all' ? 'active' : ''}`}
                onClick={() => setFilterRole('all')}
              >
                Semua Akun ({users.length})
              </button>
              <button
                className={`filter-chip ${filterRole === 'admin_vendor' ? 'active' : ''}`}
                onClick={() => setFilterRole('admin_vendor')}
              >
                Admin Vendor
              </button>
              <button
                className={`filter-chip ${filterRole === 'master_vendor' ? 'active' : ''}`}
                onClick={() => setFilterRole('master_vendor')}
              >
                Master Vendor
              </button>
              <button
                className={`filter-chip ${filterRole === 'admin' ? 'active' : ''}`}
                onClick={() => setFilterRole('admin')}
              >
                Admin Internal
              </button>
              <button
                className={`filter-chip ${filterRole === 'master_admin' ? 'active' : ''}`}
                onClick={() => setFilterRole('master_admin')}
              >
                Master Admin
              </button>
            </div>
          </div>
        </div>

        {/* Users List Grid */}
        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <div className="spinner" style={{ margin: '0 auto 16px' }}></div>
            <p style={{ color: 'var(--text-secondary)' }}>Memuat daftar akun...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Tidak ada pengguna yang cocok dengan kriteria.</p>
          </div>
        ) : (
          <div className="orders-grid">
            {filteredUsers.map((u) => (
              <div
                key={u.id}
                className="card"
                style={{
                  padding: '18px 20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: '12px',
                  opacity: u.is_active ? 1 : 0.6
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>
                        {u.name}
                      </span>
                      {!u.is_active && (
                        <span className="badge badge-rose" style={{ fontSize: '0.68rem' }}>Nonaktif</span>
                      )}
                    </div>
                    {getRoleBadge(u.role)}
                  </div>

                  <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                    {u.email}
                  </div>

                  {u.vendor_name && (
                    <div style={{ fontSize: '0.8rem', color: 'var(--brand-gold)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <Building2 size={14} />
                      <span>{u.vendor_name}</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: '6px', borderTop: '1px solid var(--border-subtle)' }}>
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
                    style={{ fontSize: '0.78rem', padding: '6px 14px' }}
                  >
                    Edit / Kelola Akses
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* CREATE USER MODAL */}
      {createModal && (
        <div className="modal-backdrop">
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                Tambah Akun Pengguna Baru
              </h3>
              <button
                type="button"
                onClick={() => setCreateModal(false)}
                className="btn btn-secondary btn-icon"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label className="form-label">Nama Lengkap / Identitas</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Budi Santoso / Staf Jahit CV Berkah"
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
                  <option value="admin_vendor">Admin Vendor (Staf Timbang - Harga Tersembunyi 0.00)</option>
                  <option value="master_vendor">Master Vendor (Pemilik - Harga Terlihat)</option>
                  <option value="admin">Admin Internal (Staf Kantor Ansania - View Only)</option>
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

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
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
          <div className="modal-content">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                  Edit Akses: {editModal.user.name}
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
                <X size={16} />
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
                  <option value="admin_vendor">Admin Vendor (Staf Timbang - Harga Tersembunyi 0.00)</option>
                  <option value="master_vendor">Master Vendor (Pemilik - Harga Terlihat)</option>
                  <option value="admin">Admin Internal (Staf Kantor Ansania - View Only)</option>
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
                <label className="form-label">Reset Password (Kosongkan jika tetap)</label>
                <input
                  type="password"
                  placeholder="Password baru min 6 digit"
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
                  <option value="1">Aktif (Bisa Login)</option>
                  <option value="0">Nonaktif (Blokir Akses)</option>
                </select>
              </div>

              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
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
