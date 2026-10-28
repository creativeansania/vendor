# Ansania Vendor Portal & Odoo 19 Webhook Hub

Aplikasi **Progressive Web App (PWA) Monitoring Produksi Makloon (WIP Vendor)** sekaligus **Webhook Hub Odoo 19 & Jubelio** berbasis **Next.js 16 (App Router)** dan **Supabase PostgreSQL**.

Seluruh arsitektur berjalan *full-stack serverless* di dalam direktori `frontend/` (tanpa server Express terpisah), menggunakan **100% Native `fetch` JSON-RPC 2.0** untuk komunikasi berkecepatan tinggi dengan **Odoo 19 Enterprise**.

---

## 🌟 Fitur Utama

1. **Portal Produksi Vendor (Native Installable PWA)**:
   - Input bertahap untuk vendor makloon: **Penerimaan & Potong Kain (`FabricTab`)**, **Aksesoris (`AccessoryTab`)**, **Hasil Jahit Grade A & Grade B (`SewingTab`)**, **Sisa Potong / BSKL (`BsklTab`)**, **Quality Control Admin (`QcTab`)**, dan **Pelacakan Dokumen Transfer (`TransferTab`)**.
   - Mendukung instalasi aplikasi ke layar utama ponsel Android/iOS (`manifest.json`, Service Worker `sw.js`, *Dark/Light Theme*).
   - Keamanan autentikasi berbasis **`HttpOnly` Cookie JWT (`pwa_token`)** dan proteksi rute tingkat server (`src/proxy.js`).

2. **Sinkronisasi Dua Arah Odoo 19 Berkecepatan Tinggi**:
   - **JSON-RPC 2.0 Native `fetch`**: Koneksi ringan ke `/jsonrpc` Odoo 19 dengan *concurrency limiter* (`MAX_CONCURRENT_RPC = 6`), *jittered exponential backoff* untuk auto-retry (`429`/`502`/`503`/`504`), dan *warm session caching*.
   - **Batch One2many Commands**: Pembaruan belasan baris roll kain dan *stock move* dilakukan dalam 1 panggilan RPC terpadu (bebas *N+1 query*).
   - **Durable Non-Blocking Outbox (`sync_outbox`)**: Setiap submit dari vendor langsung tersimpan ke Supabase (~200ms respon UI) dan dikirim ke Odoo di latar belakang menggunakan Next.js `after()`, dilengkapi **Panel Monitoring & Tombol Retry Admin** serta pembersihan terjadwal via **Vercel Cron (`vercel.json`)**.

3. **Odoo & Jubelio Webhook Automation Hub**:
   - **Distributed Webhook Lock**: Deduplikasi *2-tier* (L1 *in-memory* + L2 Supabase `audit_logs`) mencegah *race condition* atau pemrosesan ganda lintas *serverless instance*.
   - **Odoo Webhooks**: Sinkronisasi otomatis MO terkonfirmasi (`mo-confirmed`), validasi Surat Jalan (`transfer-done`), resolusi otomatis referensi MO & SO pada Transfer PC/SFP/INT (`transfer-mo-reference`), sinkronisasi tarif makloon (`vendor-price-updated`), auto-confirm SO (`so-confirm`), duplikasi Landed Cost (`duplicate-landed-cost`), dan pengiriman PDF Invoice/SO via WhatsApp Wablas.
   - **Jubelio → Odoo Sales Order**: Konversi faktur Jubelio ke `sale.order` Odoo lengkap dengan pemetaan *Generic Marketplace Channel Customer* (anti *partner bloat*) dan verifikasi HMAC signature.

---

## 📁 Struktur Proyek

```text
d:\webhook jubelio odoo\
├── README.md                                  # Dokumentasi Utama Proyek
├── PROPOSAL_MIGRASI_AUTOMATION_WIP_VENDOR.md  # Catatan Teknis Otomasi Odoo
└── frontend/                                  # Full-Stack Next.js 16.4+ App (Root Deploy Vercel)
    ├── vercel.json                            # Jadwal Vercel Cron (/api/admin/sync-outbox)
    ├── next.config.mjs                        # Security Headers & Next.js Config
    ├── public/                                # PWA Icons, manifest.json, sw.js
    ├── scripts/                               # Utilitas CLI Backfill & Konfigurasi Odoo
    └── src/
        ├── proxy.js                           # Server Route Guard (Next.js 16 Proxy)
        ├── app/
        │   ├── page.js                        # Dashboard SPK, KPI Metrics & Admin Outbox Monitor
        │   ├── login/page.js                  # Login Multi-Role (Master Admin, Admin, Vendor)
        │   ├── orders/[id]/page.js            # Halaman Detail & Input Operasional SPK
        │   ├── admin/users/page.js            # Manajemen Akun Pengguna & Vendor
        │   └── api/
        │       ├── auth/                      # Login, Logout, Me (HttpOnly JWT Cookie)
        │       ├── orders/ & pwa/             # REST Endpoints SPK, Cutting, Produksi, QC, Sync
        │       ├── admin/                     # Manajemen User & Endpoint Retry sync_outbox
        │       ├── reports/                   # Streaming PDF Invoice Odoo Terproteksi HMAC/JWT
        │       └── webhooks/                  # Endpoint Webhook Odoo 19 & Jubelio
        ├── components/
        │   ├── common/                        # Komponen UI DRY (StatusBadge, dsb.)
        │   ├── dashboard/                     # Komponen Modular Dashboard & AdminOutboxBanner
        │   ├── orders/                        # Komponen Modular Detail SPK & Tab Produksi
        │   └── admin/                         # Komponen Modular Manajemen Pengguna
        └── lib/
            ├── odoo/                          # JSON-RPC 2.0 Client, Static Cache & PDF Helper
            ├── hooks/                         # Custom React Hooks Terpisah per Domain
            └── services/
                ├── wip/                       # Domain, Query, Outbox, Lock, Cutting, Produksi & Sync
                ├── jubelioService.js          # Integrasi Faktur Jubelio -> Sales Order Odoo
                └── wablasService.js           # Pengiriman Pesan & Dokumen WhatsApp (Native fetch)
```

---

## ⚙️ Konfigurasi Environment Variables (`.env`)

Buat file `frontend/.env.local` (atau set pada **Vercel Project Environment Variables** dengan Root Directory `frontend`):

```env
# Keamanan Autentikasi & Cron
JWT_SECRET=rahasia_jwt_minimal_32_karakter
CRON_SECRET=rahasia_cron_vercel_anda

# Supabase PostgreSQL (Server-Only)
SUPABASE_URL=https://project-id-anda.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key_supabase_anda

# Odoo 19 Enterprise JSON-RPC
ODOO_URL=https://odoo-instance-anda.odoo.com
ODOO_DB=nama_database_odoo
ODOO_USERNAME=email_bot_atau_admin_odoo
ODOO_PASSWORD=api_key_atau_password_odoo
ODOO_UID=                                      # Opsional: isi UID numerik user Odoo untuk 0ms cold-start auth
ODOO_COMPANY_NAME=Ansania
ODOO_WEBHOOK_SECRET=                           # Opsional: token rahasia verifikasi webhook Odoo

# Integrasi Jubelio -> Odoo
JUBELIO_API_URL=https://api2.jubelio.com
JUBELIO_EMAIL=email_jubelio
JUBELIO_PASSWORD=password_jubelio
JUBELIO_WEBHOOK_SECRET=secret_hmac_jubelio
USE_CHANNEL_CUSTOMER=true

# WhatsApp Gateway (Wablas)
WABLAS_BASE_URL=https://bdg.wablas.com
WABLAS_TOKEN=token_wablas
WABLAS_SECRET_KEY=secret_key_wablas
```

---

## 🚀 Menjalankan Secara Lokal

```bash
cd frontend
npm install
npm run dev
```

Aplikasi berjalan di `http://localhost:3000`.

Untuk memverifikasi kualitas kode dan *production build*:

```bash
cd frontend
npm run lint
npm run build
```

---

## 🔗 Daftar Endpoint Webhook Utama

| Sumber | Endpoint | Fungsi |
| :--- | :--- | :--- |
| **Odoo** | `POST /api/webhooks/odoo/mo-confirmed` | Sinkronisasi MO baru / perubahan status MO ke daftar SPK |
| **Odoo** | `POST /api/webhooks/odoo/transfer-done` | Update real-time pengiriman kain, aksesoris, SFP, & validasi BSKL |
| **Odoo** | `POST /api/webhooks/odoo/transfer-mo-reference` | Pengisian otomatis field MO & Sales Order pada Transfer (`PC`, `SFP`, `INT`) |
| **Odoo** | `POST /api/webhooks/odoo/vendor-price-updated` | Pembaruan otomatis tarif makloon vendor (`x_daftar_harga_vendor`) |
| **Odoo** | `POST /api/webhooks/odoo/duplicate-landed-cost` | Duplikasi dokumen Landed Cost beserta relasi `mrp_production_ids` |
| **Odoo** | `POST /api/webhooks/odoo/invoice-wa` | Kirim PDF Faktur Odoo ke WhatsApp pelanggan via Wablas |
| **Jubelio** | `POST /api/webhooks/jubelio/invoice` | Pembuatan otomatis Sales Order Odoo dari faktur Jubelio |
| **Cron / Admin** | `GET/POST /api/admin/sync-outbox` | Sapu bersih & retry antrean sinkronisasi latar belakang `sync_outbox` |
