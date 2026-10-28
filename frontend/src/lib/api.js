const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('pwa_token');
}

export function setToken(token) {
  if (typeof window === 'undefined') return;
  if (token) {
    localStorage.setItem('pwa_token', token);
  } else {
    localStorage.removeItem('pwa_token');
  }
}

export function getCurrentUser() {
  if (typeof window === 'undefined') return null;
  const userJson = localStorage.getItem('pwa_user');
  try {
    return userJson ? JSON.parse(userJson) : null;
  } catch (e) {
    return null;
  }
}

export function setCurrentUser(user) {
  if (typeof window === 'undefined') return;
  if (user) {
    localStorage.setItem('pwa_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('pwa_user');
  }
}

export function logout() {
  setToken(null);
  setCurrentUser(null);
  if (typeof window !== 'undefined') {
    window.location.href = '/login';
  }
}

export async function fetchApi(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  try {
    const res = await fetch(url, {
      ...options,
      headers
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      logout();
      throw new Error(data.message || 'Sesi telah berakhir. Silakan login kembali.');
    }

    if (!res.ok) {
      throw new Error(data.message || `Request failed with status ${res.status}`);
    }

    return data;
  } catch (err) {
    throw err;
  }
}
