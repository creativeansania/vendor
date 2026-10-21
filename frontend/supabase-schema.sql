-- ========================================================
-- ANSANIA VENDOR PWA - SUPABASE POSTGRESQL SCHEMA
-- Eksekusi skrip ini di: Supabase Dashboard > SQL Editor > New query > Run
-- ========================================================

-- 1. TABEL VENDORS
CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  odoo_warehouse_id INT NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. TABEL USERS (Master Admin & Vendor Accounts)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('master_admin', 'admin', 'master_vendor', 'admin_vendor')),
  vendor_id INT REFERENCES vendors(id) ON DELETE SET NULL,
  token_version INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- 3. TABEL WIP ORDERS (Surat Perintah Kerja / MO)
CREATE TABLE IF NOT EXISTS wip_orders (
  id SERIAL PRIMARY KEY,
  odoo_wip_id INT NOT NULL UNIQUE,
  odoo_mo_id INT NOT NULL,
  vendor_id INT REFERENCES vendors(id) ON DELETE RESTRICT,
  parent_wip_order_id INT REFERENCES wip_orders(id) ON DELETE SET NULL,
  mo_name VARCHAR(100) NOT NULL,
  mo_state VARCHAR(50) NOT NULL,
  sales_order VARCHAR(100) NULL,
  product_name VARCHAR(255) NULL,
  qty_spk NUMERIC(12,2) DEFAULT 0,
  start_spk DATE NULL,
  deadline_spk DATE NULL,
  qty_kebutuhan_kain NUMERIC(12,2) DEFAULT 0,
  kain_dari_gudang NUMERIC(12,2) DEFAULT 0,
  unit_kain VARCHAR(50) NULL,
  consumption_per_pcs NUMERIC(10,4) DEFAULT NULL,
  consumption_uom VARCHAR(50) DEFAULT NULL,
  accessories_dari_gudang NUMERIC(12,2) DEFAULT 0,
  estimasi_dari_spb NUMERIC(12,2) DEFAULT 0,
  status_kebutuhan_kain VARCHAR(50) NULL,
  actual_cutting NUMERIC(12,2) DEFAULT 0,
  selisih_hasil_cutting NUMERIC(12,2) DEFAULT 0,
  qty_grade_a NUMERIC(12,2) DEFAULT 0,
  qty_grade_b NUMERIC(12,2) DEFAULT 0,
  sisa_makloon_kg NUMERIC(12,2) DEFAULT 0,
  sisa_potong_panjang NUMERIC(12,2) DEFAULT 0,
  sisa_potong_sedang NUMERIC(12,2) DEFAULT 0,
  sisa_potong_pendek NUMERIC(12,2) DEFAULT 0,
  no_surat_jalan_sfp VARCHAR(100) NULL,
  tanggal_sfp TIMESTAMPTZ NULL,
  qty_masuk_sfp NUMERIC(12,2) DEFAULT 0,
  harga_vendor NUMERIC(14,2) DEFAULT 0,
  total_harga NUMERIC(16,2) DEFAULT 0,
  status_produksi VARCHAR(50) DEFAULT 'Proses',
  cutting_locked_at TIMESTAMPTZ NULL,
  cutting_locked_by INT NULL,
  result_locked_at TIMESTAMPTZ NULL,
  result_locked_by INT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  odoo_write_date TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wip_vendor_active ON wip_orders(vendor_id, is_active);
CREATE INDEX IF NOT EXISTS idx_wip_mo_name ON wip_orders(mo_name);
CREATE INDEX IF NOT EXISTS idx_wip_odoo_mo ON wip_orders(odoo_mo_id);

-- 4. TABEL WIP ROLL LINES (Timbangan Fisik Roll Kain & Lot)
CREATE TABLE IF NOT EXISTS wip_roll_lines (
  id SERIAL PRIMARY KEY,
  wip_order_id INT NOT NULL REFERENCES wip_orders(id) ON DELETE CASCADE,
  odoo_line_id INT NULL UNIQUE,
  line_type VARCHAR(50) NOT NULL CHECK (line_type IN ('kain', 'aksesoris')),
  nama_item VARCHAR(255) NOT NULL,
  kode_lot VARCHAR(100) NOT NULL DEFAULT 'Tanpa Lot',
  qty NUMERIC(12,2) DEFAULT 0,
  uom VARCHAR(50) NULL,
  qty_penerimaan NUMERIC(12,2) DEFAULT 0,
  qty_berat_kg NUMERIC(10,2) NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_roll UNIQUE (wip_order_id, nama_item, kode_lot)
);

-- 5. TABEL SYNC OUTBOX (Antrean Pengiriman Otomatis ke Odoo)
CREATE TABLE IF NOT EXISTS sync_outbox (
  id SERIAL PRIMARY KEY,
  wip_order_id INT NOT NULL REFERENCES wip_orders(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'synced', 'failed')),
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  synced_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status);

-- 6. TABEL AUDIT LOGS (Catatan Log & Unlock)
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL,
  wip_order_id INT NULL,
  action VARCHAR(100) NOT NULL,
  reason VARCHAR(255) NULL,
  before_data JSONB NULL,
  after_data JSONB NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_wip ON audit_logs(wip_order_id);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);

-- 7. SEED DATA DEFAULT: MASTER ADMIN AKBARI
-- Password: @Bagusbemo1998 (Bcrypt hash)
INSERT INTO users (name, email, password_hash, role)
VALUES (
  'Master Admin Ansania',
  'admin@kantiss.com',
  '$2b$10$CFwmF4NsLB/2dNuIs2XFkO57miI6M8GM9HTYkOmQM.IA5hTNYdHt6',
  'master_admin'
)
ON CONFLICT (email) DO UPDATE 
SET password_hash = EXCLUDED.password_hash, role = 'master_admin', is_active = TRUE;

-- 8. MIGRATION: 3 KATEGORI SISA POTONG KAIN (BSKL)
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS sisa_potong_panjang NUMERIC(12,2) DEFAULT 0;
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS sisa_potong_sedang NUMERIC(12,2) DEFAULT 0;
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS sisa_potong_pendek NUMERIC(12,2) DEFAULT 0;

-- 9. MIGRATION: LOCKING, GRADE B REVISION COUNTER, SURAT JALAN & ADMIN UNLOCK
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS grade_b_submit_count INT DEFAULT 0;
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS no_surat_jalan_grade_b VARCHAR(100) NULL;
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS no_surat_jalan_bskl VARCHAR(100) NULL;
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS is_unlocked_by_admin BOOLEAN DEFAULT FALSE;
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ NULL;
ALTER TABLE wip_orders ADD COLUMN IF NOT EXISTS unlocked_by INT NULL;


