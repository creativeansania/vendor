'use client';

import { useAdminUsers } from '@/lib/hooks/useAdminUsers';
import UserNavbar from '@/components/admin/UserNavbar';
import UserFilters from '@/components/admin/UserFilters';
import UserCard from '@/components/admin/UserCard';
import CreateUserModal from '@/components/admin/CreateUserModal';
import EditUserModal from '@/components/admin/EditUserModal';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

export default function AdminUsersPage() {
  const {
    currentUser,
    users,
    vendors,
    loading,
    actionLoading,
    feedback,
    filterRole,
    setFilterRole,
    search,
    setSearch,
    filteredUsers,
    createModal,
    setCreateModal,
    newUserData,
    setNewUserData,
    editModal,
    setEditModal,
    handleCreateUser,
    handleUpdateUser
  } = useAdminUsers();

  if (!currentUser) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', overflowX: 'clip' }}>
      <UserNavbar onOpenCreateModal={() => setCreateModal(true)} />

      <main className="main-content">
        {feedback.text && (
          <div
            style={{
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: feedback.type === 'success' ? 'var(--status-emerald-bg)' : 'var(--status-rose-bg)',
              border: `1px solid ${feedback.type === 'success' ? 'var(--status-emerald-border)' : 'var(--status-rose-border)'}`,
              color: feedback.type === 'success' ? 'var(--status-emerald)' : 'var(--status-rose)'
            }}
          >
            {feedback.type === 'success' ? <CheckCircle2 size={18} style={{ flexShrink: 0 }} /> : <AlertTriangle size={18} style={{ flexShrink: 0 }} />}
            <span>{feedback.text}</span>
          </div>
        )}

        <UserFilters
          search={search}
          onSearchChange={setSearch}
          filterRole={filterRole}
          onFilterRoleChange={setFilterRole}
          totalUsers={users.length}
        />

        {loading ? (
          <div className="card" style={{ textAlign: 'center', padding: '50px 20px' }}>
            <div className="spinner" style={{ margin: '0 auto 14px' }}></div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Memuat daftar akun...</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '50px 20px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Tidak ada akun yang sesuai kriteria.</p>
          </div>
        ) : (
          <div className="orders-grid">
            {filteredUsers.map((u) => (
              <UserCard
                key={u.id}
                user={u}
                onEdit={(user) =>
                  setEditModal({
                    open: true,
                    user,
                    newPassword: '',
                    role: user.role,
                    vendor_id: user.vendor_id || '',
                    is_active: Boolean(user.is_active)
                  })
                }
              />
            ))}
          </div>
        )}
      </main>

      <CreateUserModal
        isOpen={createModal}
        onClose={() => setCreateModal(false)}
        onSubmit={handleCreateUser}
        userData={newUserData}
        onUserDataChange={setNewUserData}
        vendors={vendors}
        actionLoading={actionLoading}
      />

      <EditUserModal
        modalState={editModal}
        onClose={() => setEditModal({ open: false, user: null, newPassword: '', role: '', vendor_id: '', is_active: true })}
        onSubmit={handleUpdateUser}
        onModalStateChange={setEditModal}
        vendors={vendors}
        actionLoading={actionLoading}
      />
    </div>
  );
}
