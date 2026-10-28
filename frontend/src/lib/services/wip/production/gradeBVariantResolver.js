import { adminOdooClient } from '../../../odoo/odooClient.js';

/**
 * Resolves the corresponding Grade B product variant for a given product.
 * If the product has attributes (e.g. POLICY / GRADE with values like 'A (GRADE A)', 'B (GRADE B)', and WARNA / COLOR),
 * it finds the matching variant with the same color/attributes but with Grade B.
 * If no Grade B variant exists, it cleanly falls back to parentProductId.
 */
export async function findMatchingGradeBVariant(parentProductId) {
  if (!parentProductId) return parentProductId;
  try {
    const [parentProd] = await adminOdooClient._callObject('product.product', 'read', [
      [parentProductId],
      ['id', 'name', 'display_name', 'product_tmpl_id', 'product_template_attribute_value_ids']
    ]);

    if (!parentProd || !parentProd.product_tmpl_id) {
      return parentProductId;
    }

    const parentPtavIds = parentProd.product_template_attribute_value_ids || [];
    if (parentPtavIds.length === 0) {
      return parentProductId;
    }

    const tmplId = parentProd.product_tmpl_id[0];

    const allVariants = await adminOdooClient._callObject('product.product', 'search_read', [
      [['product_tmpl_id', '=', tmplId]],
      ['id', 'display_name', 'product_template_attribute_value_ids']
    ]);

    if (!allVariants || allVariants.length <= 1) {
      return parentProductId;
    }

    const allPtavIds = [...new Set(allVariants.flatMap((v) => v.product_template_attribute_value_ids || []))];
    const ptavRecords = await adminOdooClient._callObject('product.template.attribute.value', 'read', [
      allPtavIds,
      ['id', 'name', 'attribute_id']
    ]);

    const ptavMap = new Map();
    for (const p of ptavRecords) {
      ptavMap.set(p.id, {
        id: p.id,
        name: p.name,
        attributeId: p.attribute_id[0],
        attributeName: p.attribute_id[1]
      });
    }

    const isGradeBPtav = (p) => {
      const valName = (p.name || '').trim().toLowerCase();
      const attrName = (p.attribute_id ? p.attribute_id[1] : '').toLowerCase();
      if (valName.includes('grade b') || valName === 'b' || valName.startsWith('b (')) return true;
      if (attrName.includes('grade') && (valName === 'b' || valName.includes('b'))) return true;
      return false;
    };

    const gradeBPtavs = ptavRecords.filter(isGradeBPtav);
    if (gradeBPtavs.length === 0) {
      const matchByDisplay = allVariants.find((v) => (v.display_name || '').toLowerCase().includes('grade b'));
      return matchByDisplay ? matchByDisplay.id : parentProductId;
    }

    const gradeBPtavIds = new Set(gradeBPtavs.map((p) => p.id));
    const gradeAttributeIds = new Set(gradeBPtavs.map((p) => p.attribute_id[0]));

    const parentNonGradePtavIds = parentPtavIds.filter((id) => {
      const info = ptavMap.get(id);
      return info && !gradeAttributeIds.has(info.attributeId);
    });

    let bestVariant = null;
    let maxMatch = -1;

    for (const variant of allVariants) {
      const vPtavs = variant.product_template_attribute_value_ids || [];
      const hasGradeB = vPtavs.some((id) => gradeBPtavIds.has(id));
      if (!hasGradeB) continue;

      const vNonGradePtavs = vPtavs.filter((id) => {
        const info = ptavMap.get(id);
        return info && !gradeAttributeIds.has(info.attributeId);
      });

      const isExactNonGradeMatch =
        parentNonGradePtavIds.length === vNonGradePtavs.length &&
        parentNonGradePtavIds.every((id) => vNonGradePtavs.includes(id));

      if (isExactNonGradeMatch) {
        bestVariant = variant;
        break;
      }

      const commonCount = parentNonGradePtavIds.filter((id) => vNonGradePtavs.includes(id)).length;
      if (commonCount > maxMatch) {
        maxMatch = commonCount;
        bestVariant = variant;
      }
    }

    if (bestVariant) {
      console.log(`[findMatchingGradeBVariant] Resolved Grade B variant for ${parentProductId} -> ${bestVariant.id} (${bestVariant.display_name})`);
      return bestVariant.id;
    }

    return parentProductId;
  } catch (err) {
    console.warn('[findMatchingGradeBVariant] Error resolving Grade B variant:', err.message);
    return parentProductId;
  }
}

