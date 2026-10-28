/**
 * Batch prefetch stock.move, dest/orig moves, origin MOs, and mrp.production.group
 */
export async function prefetchMovesAndGroups(odoo, pickings) {
  const allMoveIds = [...new Set(pickings.flatMap((p) => p.move_ids || []))];
  const movesMap = new Map();
  const destMovesMap = new Map();
  const origMovesMap = new Map();
  const moNameMap = new Map();
  const moMap = new Map();

  if (allMoveIds.length > 0) {
    try {
      const moves = await odoo._callObject('stock.move', 'read', [
        allMoveIds,
        [
          'id', 'raw_material_production_id', 'production_id',
          'move_dest_ids', 'move_orig_ids', 'production_group_id',
          'move_line_ids', 'origin', 'sale_line_id'
        ]
      ]);
      moves.forEach((m) => movesMap.set(m.id, m));

      const allDestMoveIds = [...new Set(moves.flatMap((m) => m.move_dest_ids || []))];
      if (allDestMoveIds.length > 0) {
        const destMoves = await odoo._callObject('stock.move', 'read', [
          allDestMoveIds,
          ['id', 'raw_material_production_id', 'production_id', 'production_group_id', 'sale_line_id', 'origin']
        ]);
        destMoves.forEach((dm) => destMovesMap.set(dm.id, dm));
      }

      const allOrigMoveIds = [...new Set(moves.flatMap((m) => m.move_orig_ids || []))];
      if (allOrigMoveIds.length > 0) {
        const origMoves = await odoo._callObject('stock.move', 'read', [
          allOrigMoveIds,
          ['id', 'raw_material_production_id', 'production_id', 'production_group_id', 'sale_line_id', 'origin']
        ]);
        origMoves.forEach((om) => origMovesMap.set(om.id, om));
      }

      const potentialMoveMoNames = [
        ...new Set([
          ...moves.map((m) => (m.origin || '').trim()).filter((o) => o.includes('/MO/')),
          ...Array.from(origMovesMap.values()).map((om) => (om.origin || '').trim()).filter((o) => o.includes('/MO/'))
        ])
      ];
      if (potentialMoveMoNames.length > 0) {
        try {
          const mosByOrigin = await odoo._callObject('mrp.production', 'search_read', [
            [['name', 'in', potentialMoveMoNames]]
          ], {
            fields: ['id', 'name', 'x_studio_sales_order', 'origin']
          });
          mosByOrigin.forEach((m) => {
            moNameMap.set(m.name, m);
            moMap.set(m.id, m);
          });
        } catch (errMoOrig) {
          console.warn(`[Transfer MO/SO] Note on prefetching MOs by origin name: ${errMoOrig.message}`);
        }
      }
    } catch (errMoves) {
      console.warn(`[Transfer MO/SO] Warning during bulk prefetch of moves: ${errMoves.message}`);
    }
  }

  const allProdGroupIds = [
    ...new Set([
      ...Array.from(movesMap.values()).filter((m) => m.production_group_id && m.production_group_id[0]).map((m) => m.production_group_id[0]),
      ...Array.from(destMovesMap.values()).filter((dm) => dm.production_group_id && dm.production_group_id[0]).map((dm) => dm.production_group_id[0]),
      ...Array.from(origMovesMap.values()).filter((om) => om.production_group_id && om.production_group_id[0]).map((om) => om.production_group_id[0])
    ])
  ];
  const prodGroupMap = new Map();
  if (allProdGroupIds.length > 0) {
    try {
      const groups = await odoo._callObject('mrp.production.group', 'read', [
        allProdGroupIds,
        ['id', 'name', 'production_ids']
      ]);
      groups.forEach((g) => prodGroupMap.set(g.id, g));
    } catch (errG) {
      console.warn(`[Transfer MO/SO] Note on prefetching production groups: ${errG.message}`);
    }
  }

  return { movesMap, destMovesMap, origMovesMap, moNameMap, moMap, prodGroupMap };
}

/**
 * Resolve which MO a given stock.move belongs to
 */
export function createMoveMoResolver({ origMovesMap, destMovesMap, moNameMap, prodGroupMap }) {
  return function getMoRefForMove(m, isSfp = false) {
    if (!m) return null;

    if (m.raw_material_production_id) {
      return { id: m.raw_material_production_id[0], name: m.raw_material_production_id[1] };
    }
    if (m.production_id) {
      return { id: m.production_id[0], name: m.production_id[1] };
    }

    for (const omid of (m.move_orig_ids || [])) {
      const om = origMovesMap.get(omid);
      if (om && om.production_id) {
        return { id: om.production_id[0], name: om.production_id[1] };
      }
      if (om && om.raw_material_production_id) {
        return { id: om.raw_material_production_id[0], name: om.raw_material_production_id[1] };
      }
      const omOrig = (om && om.origin ? om.origin : '').trim();
      if (omOrig && moNameMap.has(omOrig)) {
        const matched = moNameMap.get(omOrig);
        return { id: matched.id, name: matched.name };
      }
    }

    const mOrig = (m.origin || '').trim();
    if (mOrig && moNameMap.has(mOrig)) {
      const matched = moNameMap.get(mOrig);
      return { id: matched.id, name: matched.name };
    }

    for (const dmid of (m.move_dest_ids || [])) {
      const dm = destMovesMap.get(dmid);
      if (dm && dm.raw_material_production_id) {
        return { id: dm.raw_material_production_id[0], name: dm.raw_material_production_id[1] };
      }
      if (dm && dm.production_id) {
        return { id: dm.production_id[0], name: dm.production_id[1] };
      }
    }

    // Fallback to production group ONLY for non-SFP moves if group has exactly 1 MO
    if (!isSfp && m.production_group_id) {
      const g = prodGroupMap.get(m.production_group_id[0]);
      if (g && g.production_ids && g.production_ids.length === 1) {
        const pId = typeof g.production_ids[0] === 'object' ? g.production_ids[0].id : g.production_ids[0];
        return { id: pId, name: g.name };
      }
    }

    return null;
  };
}

/**
 * Prefetch mrp.production and sale.order records in bulk for all pickingPlans
 */
export async function prefetchMosAndSalesOrders(odoo, pickingPlans, moMap) {
  const moIdsToRead = [
    ...new Set([
      ...pickingPlans.filter((p) => p.resolvedMo && p.resolvedMo.id).map((p) => p.resolvedMo.id),
      ...pickingPlans.flatMap((p) => Array.from(p.movesByMo.keys()))
    ])
  ].filter((id) => !moMap.has(id));

  if (moIdsToRead.length > 0) {
    try {
      const moList = await odoo._callObject('mrp.production', 'read', [
        moIdsToRead,
        ['id', 'name', 'x_studio_sales_order', 'origin', 'sale_line_id']
      ]);
      moList.forEach((m) => moMap.set(m.id, m));
    } catch (errMoRead) {
      console.warn(`[Transfer MO/SO] Error reading MO sales orders in bulk: ${errMoRead.message}`);
    }
  }

  const potentialSoOrigins = [
    ...new Set(
      pickingPlans.flatMap((p) => {
        const tokens = [];
        if (p.picking.sale_id && p.picking.sale_id[1]) {
          tokens.push(p.picking.sale_id[1]);
        }
        if (p.picking.origin) {
          p.picking.origin.split(/[,|]/).forEach((tok) => {
            const clean = tok.replace(/^(?:SO\s+|Sisa\s+Makloon\s+-\s+)/i, '').trim();
            if (clean && !clean.includes('/MO/')) {
              tokens.push(clean);
            }
          });
        }
        return tokens;
      })
    )
  ];

  const soMap = new Map();
  if (potentialSoOrigins.length > 0) {
    try {
      const foundSos = await odoo._callObject('sale.order', 'search_read', [
        [['name', 'in', potentialSoOrigins], ['state', '!=', 'cancel']]
      ], {
        fields: ['id', 'name', 'state'],
        order: 'id desc'
      });
      foundSos.forEach((so) => {
        if (!soMap.has(so.name)) {
          soMap.set(so.name, so);
        }
      });
    } catch (errSoRead) {
      console.warn(`[Transfer MO/SO] Error reading Sales Orders in bulk: ${errSoRead.message}`);
    }
  }

  return soMap;
}

