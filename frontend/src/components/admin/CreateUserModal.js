'use client';

import { X } from 'lucide-react';

export default function CreateUserModal({
  isOpen,
  onClose,
  onSubmit,
  userData,
  onUserDataChange,
  vendors = [],
  actionLoading
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>
            Tambah Akun Pengguna
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-icon"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="form-label">Nama Lengkap</label>
            <input
              type="text"
              required
              placeholder="Contoh: Budi Santoso"
              value={userData.name}
              onChange={(e) => onUserDataChange((d) => ({ ...d, name: e.target.value }))}
              className="input-field"
            />
          </div>

          <div>
            <label className="form-label">Email Login</label>
            <input
              type="email"
              required
              placeholder="budi@vendor.com"
              value={userData.email}
              onChange={(e) => onUserDataChange((d) => ({ ...d, email: e.target.value }))}
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
              value={userData.password}
              onChange={(e) => onUserDataChange((d) => ({ ...d, password: e.target.value }))}
              className="input-field"
            />
          </div>

          <div>
            <label className="form-label">Peran (Role)</label>
            <select
              value={userData.role}
              onChange={(e) => onUserDataChange((d) => ({ ...d, role: e.target.value }))}
              className="select-field"
            >
              <option value="admin_vendor">Admin Vendor (Staf - Harga 0.00)</option>
              <option value="master_vendor">Master Vendor (Owner - Harga Muncul)</option>
              <option value="admin">Admin Internal (Staf Kantor - View Only)</option>
              <option value="master_admin">Master Admin (Full Hak Akses & Unlock)</option>
            </select>
          </div>

          {['admin_vendor', 'master_vendor'].includes(userData.role) && (
            <div>
              <label className="form-label">Vendor Terkait</label>
              <select
                required
                value={userData.vendor_id}
                onChange={(e) => onUserDataChange((d) => ({ ...d, vendor_id: e.target.value }))}
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

          <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
            <button
              type="button"
              onClick={onClose}
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
  );
}
