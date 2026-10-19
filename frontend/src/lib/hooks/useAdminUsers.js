'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fetchApi, getCurrentUser } from '@/lib/api';

export function useAdminUsers() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [vendors, setVendors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedback, setFeedback] = useState({ text: '', type: '' });
  const [filterRole, setFilterRole] = useState('all');
  const [search, setSearch] = useState('');

  // Create User Modal state
  const [createModal, setCreateModal] = useState(false);
  const [newUserData, setNewUserData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'admin_vendor',
    vendor_id: ''
  });

  // Edit/Reset Password Modal state
  const [editModal, setEditModal] = useState({
    open: false,
    user: null,
    newPassword: '',
    role: '',
    vendor_id: '',
    is_active: true
  });

  const loadData = useCallback(async () => {
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
  }, []);

  // Guard: Only master_admin allowed
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
  }, [router, loadData]);

  async function handleCreateUser(e) {
    if (e && e.preventDefault) e.preventDefault();
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
    if (e && e.preventDefault) e.preventDefault();
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

  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
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
  }, [users, filterRole, search]);

  return {
    currentUser,
    users,
    vendors,
    loading,
    actionLoading,
    feedback,
    setFeedback,
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
  };
}
