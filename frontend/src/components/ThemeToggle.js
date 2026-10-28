'use client';

import { useSyncExternalStore } from 'react';
import { Sun, Moon } from 'lucide-react';

function subscribeTheme(callback) {
  window.addEventListener('theme-change', callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener('theme-change', callback);
    window.removeEventListener('storage', callback);
  };
}

function getClientTheme() {
  return (
    document.documentElement.getAttribute('data-theme') ||
    localStorage.getItem('theme') ||
    'light'
  );
}

function getServerTheme() {
  return null;
}

export default function ThemeToggle({ showLabel = false, className = '' }) {
  const theme = useSyncExternalStore(subscribeTheme, getClientTheme, getServerTheme);

  const toggleTheme = () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('theme', nextTheme);
      document.documentElement.setAttribute('data-theme', nextTheme);
      if (nextTheme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
      window.dispatchEvent(new CustomEvent('theme-change', { detail: { theme: nextTheme } }));
    } catch (e) {
      console.error('Failed to save theme:', e);
    }
  };

  // Prevent hydration mismatch
  if (theme === null) {
    return (
      <button
        type="button"
        className={`theme-toggle-btn ${className}`}
        aria-label="Ganti Tema"
        style={{
          width: '38px',
          height: '38px',
          borderRadius: '10px',
          border: '1px solid var(--border-default)',
          background: 'var(--bg-card)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          opacity: 0.6
        }}
      >
        <Sun size={17} />
      </button>
    );
  }

  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`theme-toggle-btn ${className}`}
      title={isDark ? 'Beralih ke Mode Terang (Light Mode)' : 'Beralih ke Mode Gelap (Dark Mode)'}
      aria-label={isDark ? 'Mode Terang' : 'Mode Gelap'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '6px',
        height: '38px',
        padding: showLabel ? '0 12px' : '0 10px',
        borderRadius: '10px',
        border: '1px solid var(--border-default)',
        background: 'var(--bg-card)',
        color: isDark ? '#fbbf24' : '#d97706',
        cursor: 'pointer',
        boxShadow: 'var(--shadow-subtle)',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        flexShrink: 0
      }}
    >
      {isDark ? (
        <Moon size={17} style={{ filter: 'drop-shadow(0 0 4px rgba(251, 191, 36, 0.5))' }} />
      ) : (
        <Sun size={17} style={{ filter: 'drop-shadow(0 0 3px rgba(217, 119, 6, 0.4))' }} />
      )}
      {showLabel && (
        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          {isDark ? 'Gelap' : 'Terang'}
        </span>
      )}
    </button>
  );
}
