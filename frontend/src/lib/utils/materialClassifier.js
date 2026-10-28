const ACCESSORY_KEYWORDS = [
  'hangtag',
  'hang tag',
  'pouch',
  'barcode',
  'kertas',
  'label',
  'plastik',
  'polybag',
  'opp',
  'kancing',
  'benang',
  'zipper',
  'resleting',
  'sleting',
  'acc',
  'acces',
  'aksesoris',
  'pita',
  'renda',
  'kardus',
  'box',
  'tag pin',
  'tali',
  'stiker',
  'sticker'
];

const FABRIC_UOMS = ['yard', 'yd', 'yds', 'kg', 'kilogram', 'meter', 'm'];
const ACCESSORY_UOMS = ['pcs', 'lembar', 'buah', 'biji', 'pack', 'roll', 'set', 'lusin'];

/**
 * Single source of truth for classifying a material line into 'kain' or 'aksesoris'.
 */
export function classifyMaterialLine(namaItem = '', uom = '', explicitType = null) {
  if (explicitType === 'kain' || explicitType === 'aksesoris') {
    return explicitType;
  }

  const lowerName = String(namaItem || '').toLowerCase();
  const lowerUom = String(uom || '').toLowerCase().trim();

  const hasAccKeyword = ACCESSORY_KEYWORDS.some((kw) => lowerName.includes(kw));
  if (hasAccKeyword) {
    return 'aksesoris';
  }

  if (lowerName.includes('kain')) {
    return 'kain';
  }

  if (ACCESSORY_UOMS.includes(lowerUom)) {
    return 'aksesoris';
  }

  if (FABRIC_UOMS.includes(lowerUom)) {
    return 'kain';
  }

  return 'aksesoris';
}

export function isFabricLine(line) {
  if (!line) return false;
  return classifyMaterialLine(line.nama_item || line.x_name || '', line.uom || line.x_studio_uom || '', line.line_type) === 'kain';
}

