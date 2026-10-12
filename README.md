# Webhook Jubelio -> Odoo (Ansania)

Aplikasi Webhook berbasis **Express.js** untuk mengintegrasikan acara faktur (*Invoice*) dari **Jubelio** ke pembuatan **Sales Order** otomatis di **Odoo ERP** berdasarkan kecocokan **SKU** produk khusus untuk Perusahaan **Ansania**.

---

## 🌟 Fitur Utama

1. **Odoo Multi-Company Support**: Otomatis mendeteksi dan mengikat data Sales Order (`sale.order`) serta Customer (`res.partner`) ke Perusahaan **Ansania** (`ODOO_COMPANY_NAME=Ansania`).
2. **Pencarian Produk Berdasarkan SKU**: Mencari produk di Odoo (`product.product`) menggunakan `default_code` (atau `barcode`) yang sesuai dengan SKU dari Jubelio.
3. **Marketplace Channel Customer Mapping (Anti Database Bloat)**:
   - Order dari marketplace (Shopee, Tokopedia, TikTok Shop, Blibli, Lazada, Evermos) otomatis di-map ke **Generic Customer Partner** (misal: `Shopee - Ansania`).
   - Mencegah database partner Odoo membengkak dengan ribuan kontak buyer retail sekali-pakai (*one-time buyers*).
   - Detail pembeli asli (Nama, No. HP, Kurir, No. Resi, Alamat) otomatis dicatat di **Keterangan / Notes** Sales Order Odoo.
   - Order B2B / Internal / Offline tetap mempertahankan nama customer aslinya.
4. **Idempotency Check**: Mencegah duplikasi pembuatan Sales Order jika webhook terkirim lebih dari sekali untuk nomor faktur yang sama.
5. **Verifikasi Keamanan Webhook**: Mendukung verifikasi `x-jubelio-signature` (HMAC SHA-256).
6. **Flexibility API Fetch**: Jika payload webhook dari Jubelio tidak menyertakan rincian item lengkap, aplikasi akan mengambil rincian faktur langsung via API Jubelio.

---

## 📁 Struktur Direktori (Modular Architecture)

```
d:\webhook jubelio odoo\
├── package.json
├── .env.example
├── .env
├── .gitignore
├── app.js                       # Universal launcher untuk cPanel / lsnode
├── README.md
├── src/
│   ├── index.js                 # Entry point Express server
│   ├── routes/
│   │   └── index.js             # Main router aggregator
│   ├── core/                    # Core Infrastructure (DRY & Shared)
│   │   └── odoo/
│   │       └── odooClient.js    # Pure XML-RPC Client, Auth, Multi-company, PDF
│   ├── modules/                 # Domain Modules (Isolated & Maintainable)
│   │   ├── jubelio/             # Integrasi Jubelio -> Sales Order
│   │   │   ├── jubelio.service.js
│   │   │   ├── jubelio.controller.js
│   │   │   └── jubelio.routes.js
│   │   ├── so-bypass/           # Auto Confirm & Delivery/Invoice Bypass
│   │   │   ├── soBypass.service.js
│   │   │   ├── soBypass.controller.js
│   │   │   └── soBypass.routes.js
│   │   ├── transfer/            # Resolusi Transfer MO/SO & Auto-Split
│   │   │   ├── transfer.service.js
│   │   │   ├── transfer.controller.js
│   │   │   └── transfer.routes.js
│   │   ├── landed-cost/         # Duplikasi Landed Cost dengan MO
│   │   │   ├── landedCost.service.js
│   │   │   ├── landedCost.controller.js
│   │   │   └── landedCost.routes.js
│   │   ├── notification-wa/     # Wablas WhatsApp & PDF Streaming
│   │   │   ├── wablas.service.js
│   │   │   ├── wablas.controller.js
│   │   │   └── wablas.routes.js
│   │   └── wip-vendor/          # Monitoring WIP Vendor Makloon (NEW)
│   │       ├── wip.service.js
│   │       ├── wip.controller.js
│   │       └── wip.routes.js
│   ├── config/
│   │   └── env.js               # Environment variables configuration
│   ├── middleware/
│   │   └── jubelioSignature.js  # HMAC signature verification
│   └── utils/
│       ├── channelHelper.js     # Marketplace channel detection & mapping
│       └── logger.js            # Logging utility
└── scripts/                     # Helper test & migration scripts
```

---

## 🚀 Panduan Installasi & Penggunaan

### 1. Install Dependencies

Buka terminal di direktori proyek dan jalankan:

```bash
npm install
```

### 2. Konfigurasi `.env`

Edit file `.env` di root direktori dan sesuaikan kredensial server Anda:

```env
# App Configuration
PORT=3000
NODE_ENV=development

# Kredensial API Jubelio
JUBELIO_API_URL=https://api2.jubelio.com
JUBELIO_EMAIL=admin@ansania.com
JUBELIO_PASSWORD=password_jubelio_anda
JUBELIO_WEBHOOK_SECRET=

# Kredensial Odoo ERP
ODOO_URL=http://localhost:8069
ODOO_DB=nama_database_odoo
ODOO_USERNAME=admin@ansania.com
ODOO_PASSWORD=password_atau_api_key_odoo
ODOO_COMPANY_NAME=Ansania

# Integration Settings
AUTO_CONFIRM_SO=false
FALLBACK_CUSTOMER_NAME=Pelanggan Jubelio
DEFAULT_PRICELIST_ID=1

# Marketplace Channel Mapping
USE_CHANNEL_CUSTOMER=true
CHANNEL_CUSTOMER_SHOPEE="Shopee - Ansania"
CHANNEL_CUSTOMER_TOKOPEDIA="Tokopedia - Ansania"
CHANNEL_CUSTOMER_TIKTOK="TikTok Shop - Ansania"
CHANNEL_CUSTOMER_BLIBLI="Blibli - Ansania"
CHANNEL_CUSTOMER_LAZADA="Lazada - Ansania"
CHANNEL_CUSTOMER_EVERMOS="Evermos - Ansania"
```

### 3. Menjalankan Server Webhook Lokal

```bash
# Mode development (auto-reload saat ada perubahan kode)
npm run dev

# Mode produksi
npm start
```

Server akan berjalan pada URL `http://localhost:3000`.

---

## 🧪 Cara Menguji (Simulation & Testing)

1. **Uji Pemetaan Channel & Customer Resolution**:
```bash
npm run test:channels
```

2. **Uji Simulasi Webhook ke Server Lokal**:
   - Pastikan server sudah berjalan (`npm run dev`).
   - Di terminal lain jalankan:
```bash
npm run test:webhook
```

Script akan mengirimkan dummy payload faktur Jubelio ke `http://localhost:3000/api/webhooks/jubelio/invoice`.

---

## 🔗 Menghubungkan Webhook ke Jubelio Live

1. Di Dashboard Jubelio Anda, masuk ke menu **Pengaturan (Settings)** > **Developer** > **Webhook**.
2. Tambahkan / Buat webhook callback URL untuk event **Invoice Creation** (`postNew Invoice`):
   - **Callback URL**: `https://domain-server-anda.com/api/webhooks/jubelio/invoice`
   - *(Catatan: Untuk pengujian dari lokal ke cloud, Anda dapat menggunakan ngrok atau localtunnel: `npx ngrok http 3000`)*.

---

## 🏭 Duplikasi Landed Cost dengan MO (stock.landed.cost)

Fitur ini memindahkan eksekusi duplikasi Landed Cost dari Odoo ke server cPanel / Node.js agar lebih ringan, stabil, dan tidak membebani worker Odoo.

### Konfigurasi Action di Odoo (Send Webhook Notification):
Sama seperti action `[Custom] Send WA Invoice`:
1. Buat **Server Action** atau **Child Action**:
   - **Action Name**: `[Custom] Duplicate Landed Cost`
   - **Model**: `stock.landed.cost`
   - **Type**: Pilih **`Send Webhook Notification`**
   - **URL**: `https://api.kantiss.com/api/webhooks/odoo/duplicate-landed-cost` (atau `https://api.kantiss.com/api/odoo/landed-cost/duplicate`)
   - **Fields**: Kosongkan saja (Odoo otomatis mengirim `_id`, `_model`, `_action`)
2. Simpan (**Save**).
3. Buat Contextual Action agar tombol muncul di menu **Action** pada form / list view Landed Cost.

> **Catatan Alur Kerja:**
> - Saat diklik di Odoo, webhook langsung merespon **200 OK** secara instan (UI Odoo tidak akan freeze / timeout).
> - Di latar belakang (cPanel), Landed Cost akan diduplikasi lengkap dengan `mrp_production_ids` (MO) dan `target_model: manufacturing`.
> - Server cPanel otomatis mencatat konfirmasi di **Chatter / Log Note** record Odoo asli dan record baru.

### Menjalankan Test CLI:
```bash
node scripts/testDuplicateLandedCost.js
```

---

## 📦 Resolusi Otomatis MO & SO di Transfer (`stock.picking` PC, SFP, INT)

Fitur ini memindahkan logika pencarian & penghubungan **Manufacturing Order** (`x_studio_manufacturing_order`) dan **Sales Order** (`sale_id`) dari Odoo Automation ke server cPanel / Node.js agar tidak membebani database Odoo dan menyelesaikan masalah relasi transfer komponen maupun barang jadi.

### Target Operasi:
- **PC** (*Pick Component* / Pilih Komponen)
- **SFP** (*Store Finished Product* / Penyimpanan Barang Jadi)
- **INT** (*Internal Transfer*)

### Konfigurasi Automation Rule di Odoo:
1. Masuk ke **Settings** > **Technical** > **Automation Rules** (atau via Odoo Studio).
2. Edit / Buat Automation Rule:
   - **Model**: `Transfer` (`stock.picking`)
   - **Trigger**: `On create and edit`
   - **Apply on**:
     - *Sales Order is not set*
     - *Source Document is set*
3. Di tab **Actions To Do**, tambahkan action:
   - **Action Name**: `[Custom] MO & SO Reference Webhook`
   - **Type**: Pilih **`Send Webhook Notification`**
   - **URL**:
     ```
     https://api.kantiss.com/api/webhooks/odoo/transfer-mo-reference
     ```
   - **Fields**: Kosongkan (Odoo otomatis mengirim `_id`, `_model`, `_action`).

### Alur Eksekusi di cPanel:
1. Respon instan `200 OK` ke Odoo (proses transfer di Odoo lancar tanpa loading / timeout).
2. Di background:
   - Mendeteksi apakah transfer bertipe `PC`, `SFP`, atau `INT`.
   - Mencari MO via chain destination moves (`move_dest_ids.raw_material_production_id`), move selesai MO (`production_id`), atau via kecocokan `origin`.
   - Mengisi `x_studio_manufacturing_order` jika belum terisi.
   - Mengisi `sale_id` dari SO asal atau dari `mo.x_studio_sales_order`.

### Menjalankan Test CLI:
```bash
node scripts/testTransferResolution.js
```


