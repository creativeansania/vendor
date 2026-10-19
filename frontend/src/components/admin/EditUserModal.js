'use client';

import { X } from 'lucide-react';

export default function EditUserModal({
  modalState,
  onClose,
  onSubmit,
  onModalStateChange,
  vendors = [],
  actionLoading
}) {
  if (!modalState.open || !modalState.user) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Edit: {modalState.user.name}
            </h3>
            <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-muted)' }}>
              {modalState.user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-secondary btn-icon"
            style={{ flexShrink: 0 }}
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label className="form-label">Peran (Role)</label>
            <select
              value={modalState.role}
              onChange={(e) => onModalStateChange((m) => ({ ...m, role: e.target.value }))}
              className="select-field"
            >
              <option value="admin_vendor">Admin Vendor (Staf - Harga 0.00)</option>
              <option value="master_vendor">Master Vendor (Owner - Harga Muncul)</option>
              <option value="admin">Admin Internal (Staf Kantor - View Only)</option>
              <option value="master_admin">Master Admin (Full Hak Akses & Unlock)</option>
            </select>
          </div>

          {['admin_vendor', 'master_vendor'].includes(modalState.role) && (
            <div>
              <label className="form-label">Vendor Terkait</label>
              <select
                value={modalState.vendor_id}
                onChange={(e) => onModalStateChange((m) => ({ ...m, vendor_id: e.target.value }))}
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
              value={modalState.newPassword}
              onChange={(e) => onModalStateChange((m) => ({ ...m, newPassword: e.target.value }))}
              className="input-field"
            />
          </div>

          <div>
            <label className="form-label">Status Akun</label>
            <select
              value={modalState.is_active ? '1' : '0'}
              onChange={(e) => onModalStateChange((m) => ({ ...m, is_active: e.target.value === '1' }))}
              className="select-field"
            >
              <option value="1">Aktif (Bisa Login)</option>
              <option value="0">Nonaktif (Blokir Akses)</option>
            </select>
          </div>

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
              {actionLoading ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
