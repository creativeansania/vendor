const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

let inflightMePromise = null;
let isLoggingOut = false;

export function clearLegacyToken() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem('pwa_token');
  } catch {}
}

export function getToken() {
  // Session JWT is stored in HttpOnly cookie (`pwa_token`), never in localStorage
  clearLegacyToken();
  return null;
}

export function setToken() {
  // Deprecated no-op kept for backward import safety; purges any legacy localStorage token
  clearLegacyToken();
}

export function getCurrentUser() {
  if (typeof window === 'undefined') return null;
  clearLegacyToken();
  const userJson = localStorage.getItem('pwa_user');
  try {
    return userJson ? JSON.parse(userJson) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user) {
  if (typeof window === 'undefined') return;
  clearLegacyToken();
  if (user) {
    localStorage.setItem('pwa_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('pwa_user');
  }
}

export async function logout() {
  if (isLoggingOut) return;
  isLoggingOut = true;
  clearLegacyToken();
  setCurrentUser(null);

  if (typeof window !== 'undefined') {
    try {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        credentials: 'same-origin',
        keepalive: true
      });
    } catch {}
    window.location.replace('/login');
  }
}

export async function ensureCurrentUser() {
  const cached = getCurrentUser();
  if (cached) return cached;

  if (!inflightMePromise) {
    inflightMePromise = fetchApi('/auth/me')
      .then((res) => {
        if (res?.success && res.user) {
          setCurrentUser(res.user);
          return res.user;
        }
        return null;
      })
      .catch(() => null)
      .finally(() => {
        inflightMePromise = null;
      });
  }

  return inflightMePromise;
}

export async function fetchApi(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const res = await fetch(url, {
    ...options,
    credentials: options.credentials || 'same-origin',
    headers
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 401 && !endpoint.includes('/auth/login')) {
    await logout();
    throw new Error(data.message || 'Sesi telah berakhir. Silakan login kembali.');
  }

  if (!res.ok) {
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }

  return data;
}
