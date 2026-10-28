/**
 * Helper: Mapping finishing selection value to display label
 */
export const FINISHING_LABELS = {
  'NECI': 'NECI HALUS',
  'NECI GROSIR': 'NECI GROSIR',
  'LASERCUT': 'LASERCUT',
  'RAWIS': 'RAWIS',
  'SONIC': 'SONIC',
  'STIK': 'STIK',
  'PICOT': 'PICOT',
  'EYELASH': 'EYELASH',
  'OVERDECK': 'OVERDECK',
  'PITA': 'PITA',
  'PASHMINA SINGLE STIK': 'PASHMINA SINGLE STIK',
  'DOUBLE STIK': 'PASHMINA DOUBLE STIK',
  'CUSTOM': 'CUSTOM'
};

export function resolveFinishing(val) {
  if (!val) return null;
  return FINISHING_LABELS[val] || val;
}

export const WIP_ODOO_SYNC_FIELDS = [
  'id', 'x_name', 'x_studio_manufacturing_order', 'x_studio_warehouse',
  'x_studio_product', 'x_studio_consumption_per_pcs_1', 'x_studio_unit_consumption_per_pcs',
  'x_studio_qty_kebutuhan_kain', 'x_studio_kain_dari_gudang_qty', 'x_studio_unit_kain_dari_gudang',
  'x_studio_accessories_dari_gudang', 'x_studio_estimasi_dari_spb', 'x_studio_status_kebutuhan_kain',
  'x_studio_actual_cutting', 'x_studio_selisih_hasil_cutting',
  'x_studio_qty_kirim_a_grade', 'x_studio_qty_kirim_b_grade', 'x_studio_sisa_makloon_kg',
  'x_studio_sisa_potong_panjang', 'x_studio_sisa_potong_sedang', 'x_studio_sisa_potong_pendek',
  'x_studio_no_surat_jalan_sfp', 'x_studio_tanggal_sfp', 'x_studio_qty_masuk_sfp',
  'x_studio_qty_spk', 'x_studio_start_spk', 'x_studio_deadline_spk', 'x_studio_sales_order',
  'x_studio_harga', 'x_studio_total_harga', 'x_studio_status_produksi', 'x_studio_detail_roll_kain',
  'x_studio_related_field_77l_1k5rj70p4', 'x_studio_related_field_52c_1k5rj7ik0',
  'x_studio_qc_pass_1', 'x_studio_qty_qc_pass_1', 'x_studio_qc_status',
  'x_studio_keterangan_qms', 'x_studio_gambar_qc',
  'write_date'
];

export function mapOdooWipToDbPayload(w, overrides = {}) {
  const cVal = w.x_studio_consumption_per_pcs_1 !== undefined && w.x_studio_consumption_per_pcs_1 !== false
    ? Number(w.x_studio_consumption_per_pcs_1)
    : null;
  const cUom = w.x_studio_unit_consumption_per_pcs
    ? (Array.isArray(w.x_studio_unit_consumption_per_pcs) ? w.x_studio_unit_consumption_per_pcs[1] : String(w.x_studio_unit_consumption_per_pcs))
    : null;

  const moId = overrides.odoo_mo_id !== undefined
    ? overrides.odoo_mo_id
    : (w.x_studio_manufacturing_order ? w.x_studio_manufacturing_order[0] : 0);
  const whId = overrides.odoo_warehouse_id !== undefined
    ? overrides.odoo_warehouse_id
    : (w.x_studio_warehouse ? w.x_studio_warehouse[0] : 0);
  const whName = overrides.vendor_name !== undefined
    ? overrides.vendor_name
    : (w.x_studio_warehouse ? w.x_studio_warehouse[1] : 'Unknown');

  const defaultSalesOrder = w.x_studio_sales_order
    ? (Array.isArray(w.x_studio_sales_order) ? w.x_studio_sales_order[1] : String(w.x_studio_sales_order))
    : null;

  return {
    odoo_wip_id: w.id,
    odoo_mo_id: moId,
    odoo_warehouse_id: whId,
    vendor_name: whName,
    mo_name: overrides.mo_name || w.x_name || `WIP#${w.id}`,
    mo_state: overrides.mo_state || 'confirmed',
    sales_order: overrides.sales_order !== undefined ? overrides.sales_order : defaultSalesOrder,
    product_name: w.x_studio_product ? w.x_studio_product[1] : (overrides.product_name || '-'),
    qty_spk: overrides.qty_spk !== undefined ? overrides.qty_spk : Number(w.x_studio_qty_spk || 0),
    start_spk: overrides.start_spk !== undefined ? overrides.start_spk : (w.x_studio_start_spk || null),
    deadline_spk: overrides.deadline_spk !== undefined ? overrides.deadline_spk : (w.x_studio_deadline_spk || null),
    qty_kebutuhan_kain: Number(w.x_studio_qty_kebutuhan_kain || 0),
    kain_dari_gudang: Number(w.x_studio_kain_dari_gudang_qty || 0),
    unit_kain: w.x_studio_unit_kain_dari_gudang
      ? (Array.isArray(w.x_studio_unit_kain_dari_gudang) ? w.x_studio_unit_kain_dari_gudang[1] : w.x_studio_unit_kain_dari_gudang)
      : 'yard',
    consumption_per_pcs: cVal,
    consumption_uom: cUom,
    accessories_dari_gudang: Number(w.x_studio_accessories_dari_gudang || 0),
    estimasi_dari_spb: Number(w.x_studio_estimasi_dari_spb || 0),
    status_kebutuhan_kain: w.x_studio_status_kebutuhan_kain || 'Belum Terpenuhi',
    actual_cutting: overrides.actual_cutting !== undefined ? overrides.actual_cutting : Number(w.x_studio_actual_cutting || 0),
    selisih_hasil_cutting: overrides.selisih_hasil_cutting !== undefined ? overrides.selisih_hasil_cutting : Number(w.x_studio_selisih_hasil_cutting || 0),
    qty_grade_a: Number(w.x_studio_qty_kirim_a_grade || 0),
    qty_grade_b: Number(w.x_studio_qty_kirim_b_grade || 0),
    sisa_makloon_kg: Number(w.x_studio_sisa_makloon_kg || 0),
    sisa_potong_panjang: Number(w.x_studio_sisa_potong_panjang || 0),
    sisa_potong_sedang: Number(w.x_studio_sisa_potong_sedang || 0),
    sisa_potong_pendek: Number(w.x_studio_sisa_potong_pendek || 0),
    finishing: resolveFinishing(w.x_studio_related_field_77l_1k5rj70p4),
    packing: w.x_studio_related_field_52c_1k5rj7ik0 || null,
    qc_pass_id: w.x_studio_qc_pass_1 ? (Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[0] : w.x_studio_qc_pass_1) : null,
    qc_pass_name: w.x_studio_qc_pass_1 && Array.isArray(w.x_studio_qc_pass_1) ? w.x_studio_qc_pass_1[1] : null,
    qty_qc_pass: Number(w.x_studio_qty_qc_pass_1 || 0),
    qc_status: w.x_studio_qc_status || null,
    keterangan_qms: w.x_studio_keterangan_qms || null,
    has_gambar_qc: Boolean(w.x_studio_gambar_qc),
    no_surat_jalan_sfp: w.x_studio_no_surat_jalan_sfp || null,
    tanggal_sfp: w.x_studio_tanggal_sfp || null,
    qty_masuk_sfp: overrides.qty_masuk_sfp !== undefined ? overrides.qty_masuk_sfp : Number(w.x_studio_qty_masuk_sfp || 0),
    harga_vendor: overrides.harga_vendor !== undefined ? overrides.harga_vendor : Number(w.x_studio_harga || 0),
    total_harga: overrides.total_harga !== undefined ? overrides.total_harga : Number(w.x_studio_total_harga || 0),
    status_produksi: w.x_studio_status_produksi || 'Proses',
    odoo_write_date: w.write_date
  };
}

