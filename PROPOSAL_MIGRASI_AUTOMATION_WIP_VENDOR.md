# PROPOSAL ARSITEKTUR & RENCANA MIGRASI AUTOMATION
## Monitoring WIP Vendor (Odoo ERP ke Service Backend Node.js / cPanel)

---

### 1. Ringkasan Eksekutif (Executive Summary)

Modul **Monitoring WIP Vendor** (`x_monitoring_wip_vendo`) adalah sistem pemantauan alur produksi makloon (vendor luar), mulai dari penerbitan SPK/MO, pengiriman bahan baku kain per roll, pencatatan hasil cutting, penerimaan barang jadi (Grade A & Grade B), hingga pengembalian sisa bahan (`BSKL`).

Saat ini terdapat **13 Automation Rules** di Odoo (5 aktif dengan kode Python rumit, dan 8 formula Studio yang di-archive). Sistem lama memiliki kelemahan mendasar:
1. **Chained / Cascading Triggers:** Satu perubahan memicu toggle boolean yang memicu automation lain secara berantai, membebani transaksi database PostgreSQL Odoo.
2. **Kerap Terjadi Lock / Deadlock:** Ketika 20–50 MO dikonfirmasi bersamaan atau banyak transfer divalidasi sekaligus, sistem mengalami lag dan bentrok data.
3. **Formula Tersebar:** 8 automation kalkulasi di-archive karena membuat Odoo lambat jika dijalankan langsung di internal database.

**Solusi yang Diajukan:**
Memindahkan seluruh beban kalkulasi, sinkronisasi transfer, dan pembuatan dokumen turunan ke **Service Backend Node.js (cPanel)**. 
- Odoo hanya bertugas mengirim **sinyal webhook ringan** (berisi ID dokumen).
- Node.js melakukan pemrosesan data secara cepat, aman, dan melakukan update ke Odoo dalam **1 kali transaksi terpadu (Single-Pass Compute)**.

---

### 2. Alur Proses End-to-End (Flow dari Awal Sampai Akhir)

```
[ TAHAP 1: MO CONFIRMED ]
  Odoo: MO dikonfirmasi oleh Admin Produksi
    │
    ▼ (Webhook)
  Node.js: Otomatis membuat record di x_monitoring_wip_vendo
           - Mengisi Header MO, Produk, Target Qty SPK, Work Center
           - Menghitung Qty Kebutuhan Kain = Qty SPK x Konsumsi per pcs
           - Status Awal diset ke "Proses"

[ TAHAP 2: PENGIRIMAN BAHAN BAKU (PC / SPB DONE) ]
  Odoo: Transfer pengiriman kain & aksesoris ke vendor berstatus "Done"
    │
    ▼ (Webhook)
  Node.js: Sinkronisasi Penerimaan Bahan & Roll Kain
           - Pisahkan Qty Kain (mencari nama produk "KAIN") vs Qty Aksesoris
           - Generate baris sub-tabel Roll Kain (x_studio_detail_roll_kain):
             * Nama Produk, Nomor Lot / Kode Roll, Yards awal, UoM
             * Field "Qty Penerimaan / Cutting" disiapkan KOSONG (0) untuk input fisik vendor
           - Hitung Estimasi Output (Faktor konversi 0.9144 jika yard/meter)
           - Tentukan Status Kebutuhan Kain: "Cukup" atau "Kurang"
           - Tautkan seluruh transfer PC/SPB ke tabel "Daftar Transfer"

[ TAHAP 3: PEMOTONGAN (CUTTING) OLEH VENDOR ]
  Vendor: Menimbang/mengukur hasil potong fisik tiap roll di lapangan
    │
    ▼ (Input via Form / Masa Depan: PWA)
  Node.js: Mengisi baris "Qty Penerimaan / Cutting" per roll
           - Hitung Actual Cutting = Total sum seluruh roll
           - Hitung Selisih Hasil Cutting = Actual Cutting - Estimasi dari SPB
           - Menghasilkan data efisiensi pemakaian bahan

[ TAHAP 4: PENERIMAAN BARANG JADI (SFP DONE) ]
  Odoo: Transfer penerimaan hasil jahit dari vendor (/SFP/) berstatus "Done"
    │
    ▼ (Webhook)
  Node.js: Sinkronisasi Barang Masuk & Perhitungan Biaya Makloon
           - FILTER KETAT: Hanya mengambil SFP yang origin == nama MO tersebut
             (menjamin tidak tertukar dengan MO backorder/pecahan lain)
           - Update No Surat Jalan SFP, Tanggal SFP, dan Qty Masuk SFP
           - Ambil tarif makloon dari tabel x_vendor_production (berdasarkan Warehouse, Produk, Work Center)
           - Hitung otomatis Total Harga = Harga Satuan x Qty Masuk SFP
           - Tambahkan transfer SFP ini ke tabel "Daftar Transfer"

[ TAHAP 5: CLOSING PRODUKSI (GRADE A, GRADE B & SISA MAKLOON) ]
  Vendor/Admin: Melaporkan hasil akhir produksi secara bertahap
    │
    ▼ (API / Webhook Form)
  Node.js: Eksekusi Dokumen Turunan:
           1. Qty Grade A  -> Update qty_producing pada MO Utama
           2. Qty Grade B  -> Buat/Update MO Turunan Grade B:
                              * Status: DRAFT (tidak langsung confirm, menunggu review internal)
                              * Tetap dalam SATU Production Group yang sama dengan MO Utama
           3. Sisa Makloon -> Buat/Update Internal Transfer pengembalian kain sisa (BSKL):
                              * Dari: Gudang Vendor -> Ke: WHGB/Stock
                              * Status: DRAFT / WAITING (verifikasi fisik oleh gudang pusat)
```

---

### 3. Analisis Celah & Mitigasi Risiko (Loopholes & Risk Mitigation)

| No | Potensi Celah (Loophole / Edge Case) | Risiko yang Bisa Terjadi | Solusi & Mitigasi di Backend |
|---|---|---|---|
| **1** | **Pecahan MO / Backorder (`-001`, `-002`)** | SFP milik MO pecahan pertama (`-001`) tidak sengaja tertaut ke MO pecahan kedua (`-002`) karena Odoo mewariskan `picking_ids`. | **Filter Ketat Origin:** Transfer `/SFP/` hanya boleh ditautkan jika `picking.origin === mo.name` secara persis. Jika MO berupa pecahan, detail roll kain disalin dari WIP induknya. |
| **2** | **Konfirmasi Massal (Batch 20–50 MO)** | Terjadi lonjakan webhook bersamaan yang menyebabkan Odoo API timeout atau rate limit (HTTP 429). | **Asynchronous In-Memory Queue:** Di backend Node.js, setiap webhook masuk akan dimasukkan ke antrean antrean berurutan (sequential processing per ID), sehingga tidak ada bentrok request ke Odoo. |
| **3** | **Input Bertahap yang Berulang (Idempotensi)** | Vendor mengupdate laporan Grade B atau Sisa Makloon beberapa kali, dikhawatirkan membuat MO Grade B atau transfer BSKL ganda. | **Mekanisme Upsert (Create or Update):** Backend selalu mengecek dokumen yang sudah ada via origin unik (`Turunan Grade B - {wip.x_name}`). Jika sudah ada, sistem hanya mengupdate kuantitasnya, bukan membuat baru. |
| **4** | **Validasi Fisik Pengembalian Bahan Sisa (`BSKL`)** | Stok sisa kain bertambah di gudang pusat sebelum fisik barangnya benar-benar sampai. | **Pemisahan Wewenang Dokumen:** Dokumen transfer transfer dibuat berstatus *Draft / Waiting*. Yang berhak menekan tombol *Validate (Done)* adalah staf gudang fisik `WHGB` saat kain sudah ditimbang di tempat. |
| **5** | **MO Grade B Langsung Jalan Tanpa Kontrol** | Produksi Grade B langsung jalan tanpa persetujuan tim PPIC/Produksi. | **Status Draft + 1 Production Group:** MO Grade B disetel berstatus **Draft** dan wajib mewarisi `production_group_id` MO utama, sehingga tetap terpantau dalam satu grup produksi. |

---

### 4. Fitur yang Ditunda (Postponed Features)

Untuk memastikan fase pertama berjalan stabil dan fokus pada pipeline operasional utama, beberapa fitur berikut disepakati untuk **ditunda ke fase berikutnya**:

1. **Frontend PWA Khusus Vendor (Dipisah ke Repositori Berbeda):**
   - **Status:** *Postponed (Fase 2)*.
   - **Catatan:** PWA Vendor akan dibuat pada repositori dan hosting terpisah. Pada fase ini, backend cPanel hanya menyiapkan arsitektur REST API-nya agar di masa depan PWA bisa langsung terhubung tanpa perlu mengubah database Odoo.
2. **Keseimbangan Otomatis QC & Sisa Reject (Quality Management System):**
   - **Status:** *Postponed*.
   - **Catatan:** Field QC (`x_studio_qc_status`, `x_studio_qc_pass_1`, `x_studio_sisa_reject`) tetap dipertahankan seperti sekarang. Rumus keseimbangan produksi ($\text{Grade A} + \text{Grade B} + \text{Reject} = \text{Target}$) dan alur approval QC akan dimatangkan pada iterasi berikutnya setelah alur fisik kain dan Grade B berjalan lancar.

---

### 5. Keuntungan Bagi Perusahaan

1. **Performa Odoo Cepat & Ringan:** Menghilangkan seluruh automation toggle dan komputasi berat dari database Odoo.
2. **Data Akurat & Otomatis:** Perhitungan kebutuhan kain, estimasi output, tarif vendor, dan total biaya terhitung dalam satu detik tanpa intervensi manual.
3. **Traceability Penuh:** Riwayat per roll kain tercatat rapi, memudahkan audit jika terjadi pemborosan kain atau ketidaksesuaian hasil potong.
4. **Siap Skalabilitas:** Siap diintegrasikan dengan aplikasi mobile/PWA vendor kapan saja di masa depan.
