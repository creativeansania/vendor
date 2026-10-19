/**
 * Centralized formatting utilities for dates, numbers, currency, and garment units.
 */

export function formatDateIndo(dateStr) {
  if (!dateStr) return '-';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return (
      d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) + ' WIB'
    );
  } catch (e) {
    return String(dateStr);
  }
}

export function formatRupiah(amount) {
  const num = Number(amount) || 0;
  return `Rp ${num.toLocaleString('id-ID')}`;
}

export function formatNumber(amount, decimals = 0) {
  const num = Number(amount) || 0;
  return decimals > 0
    ? num.toLocaleString('id-ID', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : num.toLocaleString('id-ID');
}

export function getLineUom(line, defaultUom = 'pcs') {
  return (line?.uom || defaultUom).toUpperCase();
}

export function getLineLabel(line, defaultUom = '') {
  const uom = (line?.uom || defaultUom).toLowerCase();
  if (uom === 'kg') return 'BERAT TIMBANG';
  if (uom === 'yard' || uom === 'yd') return 'PANJANG FISIK';
  if (uom === 'meter' || uom === 'm') return 'PANJANG FISIK';
  return 'JUMLAH FISIK';
}

export function adjustQty(setter, currentVal, delta, min = 0) {
  const curr = parseFloat(currentVal) || 0;
  const next = Math.max(min, curr + delta);
  // Keep clean decimals if float, integer otherwise
  setter(next % 1 === 0 ? String(next) : next.toFixed(2));
}
