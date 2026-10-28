'use client';

import { useState, useEffect, useSyncExternalStore } from 'react';
import { Smartphone, Download, Share2, PlusSquare, X } from 'lucide-react';

const emptySubscribe = () => () => {};
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export default function InstallPwaPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [dismissedSession, setDismissedSession] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  const isStandalone = useSyncExternalStore(
    emptySubscribe,
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true,
    () => true
  );

  const isIos = useSyncExternalStore(
    emptySubscribe,
    () => /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()),
    () => false
  );

  const isDismissedRecently = useSyncExternalStore(
    emptySubscribe,
    () => {
      const dismissedTime = localStorage.getItem('pwa_prompt_dismissed_time');
      return Boolean(dismissedTime && Date.now() - Number(dismissedTime) < THREE_DAYS_MS);
    },
    () => true
  );

  useEffect(() => {
    if (isStandalone) return;

    // Capture native beforeinstallprompt (Chrome / Android / Edge)
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    const handleCustomOpen = () => {
      setShowGuideModal(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('open-pwa-install', handleCustomOpen);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('open-pwa-install', handleCustomOpen);
    };
  }, [isStandalone]);

  const showBanner =
    !dismissedSession && !isDismissedRecently && (isIos || Boolean(deferredPrompt));

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setIsInstalled(true);
        }
        setDeferredPrompt(null);
      } catch {
        setShowGuideModal(true);
      }
    } else {
      // Show visual step-by-step guide (iOS or unsupported browsers)
      setShowGuideModal(true);
    }
  };

  const handleDismiss = () => {
    setDismissedSession(true);
    localStorage.setItem('pwa_prompt_dismissed_time', String(Date.now()));
  };

  // If already running inside installed PWA, do not show anything
  if (isStandalone || isInstalled) {
    return null;
  }

  return (
    <>
      {/* 1. Friendly Banner at Top of Dashboard */}
      {showBanner && (
        <div
          className="card"
          style={{
            padding: '14px 18px',
            background: 'var(--brand-gold-light)',
            border: '1.5px solid var(--brand-gold-border)',
            borderRadius: '16px',
            boxShadow: 'var(--shadow-card)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'var(--brand-gold)',
                color: 'var(--text-inverted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: 'var(--shadow-gold)'
              }}
            >
              <Smartphone size={22} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '0.96rem', color: 'var(--text-primary)' }}>
                Pasang Aplikasi di Layar Utama HP
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                Buka lebih cepat tiap hari seperti aplikasi biasa tanpa cari link di WhatsApp lagi.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={handleInstallClick}
              className="btn btn-primary"
              style={{ height: '38px', padding: '0 16px', fontSize: '0.86rem', borderRadius: '10px', fontWeight: 800 }}
            >
              <Download size={15} />
              <span>Pasang Sekarang</span>
            </button>
            <button
              type="button"
              onClick={() => setShowGuideModal(true)}
              className="quick-action-pill"
              style={{ height: '36px', fontSize: '0.78rem', background: 'var(--bg-card)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}
              title="Lihat petunjuk langkah demi langkah"
            >
              <span>Cara Pasang</span>
            </button>
            <button
              type="button"
              onClick={handleDismiss}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                padding: '6px 10px',
                fontSize: '0.8rem',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Nanti Saja
            </button>
          </div>
        </div>
      )}

      {/* 2. Step-by-Step Visual Guide Modal (For iPhone/iPad or Manual Android) */}
      {showGuideModal && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '440px', padding: '22px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: 'var(--brand-gold-light)',
                    color: 'var(--brand-gold)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <Smartphone size={20} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
                    {isIos ? 'Cara Pasang di HP iPhone' : 'Cara Pasang di HP Android'}
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    Hanya perlu 3 langkah mudah
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            {isIos ? (
              /* iOS Safari Instructions */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '14px 0' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: 'var(--text-inverted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Ketuk tombol <strong>Bagikan / Share</strong> (ikon <Share2 size={13} style={{ display: 'inline', verticalAlign: 'middle' }} /> kotak dengan panah ke atas) di bilah bawah Safari.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: 'var(--text-inverted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Gulir sedikit ke bawah, lalu pilih menu <strong>&quot;Tambahkan ke Layar Utama&quot; (Add to Home Screen)</strong> (ikon <PlusSquare size={13} style={{ display: 'inline', verticalAlign: 'middle' }} />).
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: 'var(--text-inverted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    3
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Ketuk <strong>Tambah (Add)</strong> di pojok kanan atas. Ikon aplikasi langsung muncul di layar HP Anda!
                  </div>
                </div>
              </div>
            ) : (
              /* Android Chrome Instructions */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', margin: '14px 0' }}>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: 'var(--text-inverted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Ketuk ikon <strong>Titik Tiga (⋮)</strong> di pojok kanan atas browser Google Chrome.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: 'var(--text-inverted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Pilih menu <strong>&quot;Pasang Aplikasi&quot;</strong> atau <strong>&quot;Tambahkan ke Layar Utama&quot;</strong>.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: 'var(--text-inverted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    3
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Ketuk <strong>Pasang (Install)</strong>. Selesai, ikon aplikasi langsung aktif di layar HP!
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowGuideModal(false)}
              className="btn btn-primary"
              style={{ width: '100%', height: '42px', borderRadius: '12px', fontWeight: 800 }}
            >
              Saya Mengerti
            </button>
          </div>
        </div>
      )}
    </>
  );
}
