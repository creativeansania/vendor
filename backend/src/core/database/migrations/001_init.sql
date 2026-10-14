-- 001_init: Vendor PWA base schema

CREATE TABLE IF NOT EXISTS vendors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  odoo_warehouse_id INT NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('master_admin','admin','master_vendor','admin_vendor') NOT NULL,
  vendor_id INT NULL,
  token_version INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_role (role),
  CONSTRAINT fk_users_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wip_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  odoo_wip_id INT NOT NULL UNIQUE,
  odoo_mo_id INT NOT NULL,
  vendor_id INT NOT NULL,
  parent_wip_order_id INT NULL,
  mo_name VARCHAR(100) NOT NULL,
  mo_state VARCHAR(20) NOT NULL,
  sales_order VARCHAR(100) NULL,
  product_name VARCHAR(255) NULL,
  qty_spk DECIMAL(12,2) DEFAULT 0,
  start_spk DATE NULL,
  deadline_spk DATE NULL,
  qty_kebutuhan_kain DECIMAL(12,2) DEFAULT 0,
  kain_dari_gudang DECIMAL(12,2) DEFAULT 0,
  unit_kain VARCHAR(20) NULL,
  accessories_dari_gudang DECIMAL(12,2) DEFAULT 0,
  estimasi_dari_spb DECIMAL(12,2) DEFAULT 0,
  status_kebutuhan_kain VARCHAR(20) NULL,
  actual_cutting DECIMAL(12,2) DEFAULT 0,
  selisih_hasil_cutting DECIMAL(12,2) DEFAULT 0,
  qty_grade_a DECIMAL(12,2) DEFAULT 0,
  qty_grade_b DECIMAL(12,2) DEFAULT 0,
  sisa_makloon_kg DECIMAL(12,2) DEFAULT 0,
  no_surat_jalan_sfp VARCHAR(100) NULL,
  tanggal_sfp DATETIME NULL,
  qty_masuk_sfp DECIMAL(12,2) DEFAULT 0,
  harga_vendor DECIMAL(14,2) DEFAULT 0,
  total_harga DECIMAL(16,2) DEFAULT 0,
  status_produksi VARCHAR(50) DEFAULT 'Proses',
  cutting_locked_at DATETIME NULL,
  cutting_locked_by INT NULL,
  result_locked_at DATETIME NULL,
  result_locked_by INT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  odoo_write_date DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_vendor_active (vendor_id, is_active),
  INDEX idx_mo_name (mo_name),
  INDEX idx_odoo_mo (odoo_mo_id),
  CONSTRAINT fk_wip_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id),
  CONSTRAINT fk_wip_parent FOREIGN KEY (parent_wip_order_id) REFERENCES wip_orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS wip_roll_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wip_order_id INT NOT NULL,
  odoo_line_id INT NULL UNIQUE,
  line_type ENUM('kain','aksesoris') NOT NULL,
  nama_item VARCHAR(255) NOT NULL,
  kode_lot VARCHAR(100) NOT NULL DEFAULT 'Tanpa Lot',
  qty DECIMAL(12,2) DEFAULT 0,
  uom VARCHAR(20) NULL,
  qty_berat_kg DECIMAL(10,2) NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roll (wip_order_id, nama_item, kode_lot),
  CONSTRAINT fk_roll_wip FOREIGN KEY (wip_order_id) REFERENCES wip_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sync_outbox (
  id INT AUTO_INCREMENT PRIMARY KEY,
  wip_order_id INT NOT NULL,
  action ENUM('cutting_rolls','production_result') NOT NULL,
  payload LONGTEXT NOT NULL,
  status ENUM('pending','processing','synced','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  synced_at DATETIME NULL,
  INDEX idx_status (status),
  CONSTRAINT fk_outbox_wip FOREIGN KEY (wip_order_id) REFERENCES wip_orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  wip_order_id INT NULL,
  action VARCHAR(50) NOT NULL,
  reason VARCHAR(255) NULL,
  before_data LONGTEXT NULL,
  after_data LONGTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_wip (wip_order_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
