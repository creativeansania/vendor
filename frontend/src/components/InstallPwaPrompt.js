'use client';

import { useState, useEffect } from 'react';
import { Smartphone, Download, Share2, PlusSquare, CheckCircle2, X, MoreVertical } from 'lucide-react';

export default function InstallPwaPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // 1. Check if already running as installed PWA (Standalone mode)
    const checkStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;

    setIsStandalone(checkStandalone);
    if (checkStandalone) return;

    // 2. Check if user dismissed banner recently (within 3 days)
    const dismissedTime = localStorage.getItem('pwa_prompt_dismissed_time');
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    const isDismissedRecently = dismissedTime && Date.now() - Number(dismissedTime) < threeDaysMs;

    // 3. Detect iOS
    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua);
    setIsIos(isIosDevice);

    // If on iOS and not dismissed, show banner
    if (isIosDevice && !isDismissedRecently) {
      setShowBanner(true);
    }

    // 4. Capture native beforeinstallprompt (Chrome / Android / Edge)
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!isDismissedRecently) {
        setShowBanner(true);
      }
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowBanner(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          setIsInstalled(true);
          setShowBanner(false);
        }
        setDeferredPrompt(null);
      } catch (err) {
        setShowGuideModal(true);
      }
    } else {
      // Show visual step-by-step guide (iOS or unsupported browsers)
      setShowGuideModal(true);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
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
            background: 'linear-gradient(135deg, #fffdf5 0%, #fefce8 100%)',
            border: '1.5px solid #fde68a',
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
                color: '#ffffff',
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

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
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
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Ketuk tombol <strong>Bagikan / Share</strong> (ikon <Share2 size={13} style={{ display: 'inline', verticalAlign: 'middle' }} /> kotak dengan panah ke atas) di bilah bawah Safari.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Gulir sedikit ke bawah, lalu pilih menu <strong>"Tambahkan ke Layar Utama" (Add to Home Screen)</strong> (ikon <PlusSquare size={13} style={{ display: 'inline', verticalAlign: 'middle' }} />).
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
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
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    1
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Ketuk ikon <strong>Titik Tiga (⋮)</strong> di pojok kanan atas browser Google Chrome.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
                    2
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                    Pilih menu <strong>"Pasang Aplikasi"</strong> atau <strong>"Tambahkan ke Layar Utama"</strong>.
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '10px', background: 'var(--bg-card-subtle)', borderRadius: '10px' }}>
                  <div style={{ width: '26px', height: '26px', borderRadius: '50%', background: 'var(--brand-gold)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, flexShrink: 0 }}>
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
