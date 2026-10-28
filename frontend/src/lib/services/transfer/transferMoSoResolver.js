/**
 * Build initial classification & move-grouping plan for a picking
 */
export function buildPickingPlan(picking, movesMap, getMoRefForMove) {
  const pickingName = picking.name || `PICK#${picking.id}`;
  let seqCode = '';
  const upperName = pickingName.toUpperCase();
  if (upperName.includes('/PC/')) seqCode = 'PC';
  else if (upperName.includes('/SPB/')) seqCode = 'SPB';
  else if (upperName.includes('/SFP/')) seqCode = 'SFP';
  else if (upperName.includes('/INT/')) seqCode = 'INT';
  else if (upperName.includes('/PICK/')) seqCode = 'PICK';
  else if (upperName.includes('/OUT/')) seqCode = 'OUT';
  else if (upperName.includes('/IN/')) seqCode = 'IN';

  const isFactoryInternal =
    ['PC', 'SPB', 'SFP', 'INT'].includes(seqCode) ||
    upperName.includes('/PC/') ||
    upperName.includes('/SPB/') ||
    upperName.includes('/SFP/') ||
    upperName.includes('/INT/');

  const isSfp = upperName.includes('/SFP/');
  const isDeliveryType =
    ['PICK', 'OUT'].includes(seqCode) ||
    upperName.includes('/PICK/') ||
    upperName.includes('/OUT/');

  const originClean = picking.origin ? picking.origin.split(',')[0].trim() : '';
  const namePrefix = pickingName.includes('/') ? pickingName.split('/')[0].trim() : '';

  const pMoves = (picking.move_ids || []).map((mid) => movesMap.get(mid)).filter(Boolean);
  const movesByMo = new Map();

  for (const m of pMoves) {
    const moRef = getMoRefForMove(m, isSfp);
    if (moRef && moRef.id) {
      if (!movesByMo.has(moRef.id)) {
        movesByMo.set(moRef.id, {
          moId: moRef.id,
          moName: moRef.name,
          moveIds: [],
          moveLineIds: []
        });
      }
      const grp = movesByMo.get(moRef.id);
      grp.moveIds.push(m.id);
      if (m.move_line_ids && m.move_line_ids.length > 0) {
        grp.moveLineIds.push(...m.move_line_ids);
      }
    }
  }

  let resolvedMo = null;
  if (movesByMo.size === 1) {
    const firstEntry = movesByMo.values().next().value;
    resolvedMo = { id: firstEntry.moId, name: firstEntry.moName };
  }

  const isMasterAdmin = picking.create_uid && (
    Array.isArray(picking.create_uid) ? picking.create_uid[0] === 7 : picking.create_uid === 7
  );

  const validMoGroups = Array.from(movesByMo.values()).filter((g) => g.moveIds && g.moveIds.length > 0);

  const canAutoSplit =
    isFactoryInternal &&
    validMoGroups.length > 1 &&
    pMoves.length > 1 &&
    !isMasterAdmin &&
    !['done', 'cancel'].includes(picking.state);

  return {
    picking,
    pickingName,
    seqCode,
    isFactoryInternal,
    isDeliveryType,
    originClean,
    namePrefix,
    pMoves,
    movesByMo,
    canAutoSplit,
    resolvedMo,
    resolvedSo: null
  };
}

/**
 * Resolve final MO and SO references for a single picking plan using fallbacks
 */
export async function resolvePlanMoAndSo(odoo, plan, moMap, soMap) {
  const { picking, originClean, namePrefix, pMoves, movesByMo } = plan;
  let resolvedMo = plan.resolvedMo;
  let resolvedSo = null;

  // Fallback for MO: Check regex patterns in picking.origin
  if (!resolvedMo && picking.origin) {
    const moMatches = picking.origin.match(/([A-Z0-9]+(?:\/[A-Z0-9]+)+\/\d+(?:-\d+)?)/g);
    if (moMatches && moMatches.length > 0) {
      for (const moName of moMatches) {
        try {
          const foundMos = await odoo._callObject('mrp.production', 'search_read', [
            [['name', '=', moName]]
          ], {
            fields: ['id', 'name', 'x_studio_sales_order', 'origin', 'sale_line_id'],
            limit: 1
          });
          if (foundMos && foundMos.length > 0) {
            resolvedMo = {
              id: foundMos[0].id,
              name: foundMos[0].name,
              salesOrder: foundMos[0].x_studio_sales_order
            };
            moMap.set(foundMos[0].id, foundMos[0]);
            break;
          }
        } catch {}
      }
    }
  }

  // Fallback for MO: Search by originClean
  if (!resolvedMo && originClean && movesByMo.size === 0) {
    const domainsToTry = [];
    if (namePrefix) {
      domainsToTry.push([
        '&',
        ['name', 'ilike', `${namePrefix}/MO/`],
        '|', '|',
        ['name', '=', originClean],
        ['origin', '=', originClean],
        ['x_studio_origin_mo', '=', originClean]
      ]);
    }
    domainsToTry.push([
      '|', '|', '|', '|',
      ['name', '=', originClean],
      ['name', 'ilike', originClean + '-'],
      ['origin', '=', originClean],
      ['x_studio_origin_mo', '=', originClean],
      ['x_studio_origin_mo', 'ilike', originClean + '-']
    ]);
    if (originClean.includes('/MO/')) {
      const moSuffix = originClean.substring(originClean.indexOf('/MO/'));
      domainsToTry.push([['name', 'ilike', moSuffix]]);
    }

    for (const d of domainsToTry) {
      try {
        const foundMos = await odoo._callObject('mrp.production', 'search_read', [d], {
          fields: ['id', 'name', 'x_studio_sales_order', 'origin', 'sale_line_id'],
          limit: 1
        });
        if (foundMos && foundMos.length > 0) {
          resolvedMo = {
            id: foundMos[0].id,
            name: foundMos[0].name,
            salesOrder: foundMos[0].x_studio_sales_order
          };
          moMap.set(foundMos[0].id, foundMos[0]);
          break;
        }
      } catch (errDomain) {
        console.warn(`[Transfer MO/SO] MO search error for domain ${JSON.stringify(d)}: ${errDomain.message}`);
      }
    }
  }

  // Resolve SO: 1. Direct native picking.sale_id
  if (picking.sale_id && picking.sale_id[0]) {
    resolvedSo = {
      id: picking.sale_id[0],
      name: picking.sale_id[1]
    };
  }

  // 2. Resolve from MO
  if (!resolvedSo && resolvedMo && moMap.has(resolvedMo.id)) {
    const moData = moMap.get(resolvedMo.id);
    if (moData && moData.x_studio_sales_order && moData.x_studio_sales_order[0]) {
      resolvedSo = {
        id: moData.x_studio_sales_order[0],
        name: moData.x_studio_sales_order[1]
      };
    } else if (moData && moData.sale_line_id && moData.sale_line_id[0]) {
      try {
        const sLines = await odoo._callObject('sale.order.line', 'read', [
          [moData.sale_line_id[0]],
          ['order_id']
        ]);
        if (sLines && sLines[0] && sLines[0].order_id) {
          resolvedSo = { id: sLines[0].order_id[0], name: sLines[0].order_id[1] };
        }
      } catch {}
    } else if (moData && moData.origin && soMap.has(moData.origin.trim())) {
      const so = soMap.get(moData.origin.trim());
      resolvedSo = { id: so.id, name: so.name };
    }
  }

  // 3. Resolve from picking origin tokens
  if (!resolvedSo && picking.origin) {
    const tokens = picking.origin
      .split(/[,|]/)
      .map((t) => t.replace(/^(?:SO\s+|Sisa\s+Makloon\s+-\s+)/i, '').trim())
      .filter(Boolean);
    for (const tok of tokens) {
      if (soMap.has(tok)) {
        const so = soMap.get(tok);
        resolvedSo = { id: so.id, name: so.name };
        break;
      }
    }
  }

  // 4. Resolve from moves' sale_line_id
  if (!resolvedSo) {
    for (const m of pMoves) {
      if (m.sale_line_id && m.sale_line_id[0]) {
        try {
          const sLines = await odoo._callObject('sale.order.line', 'read', [
            [m.sale_line_id[0]],
            ['order_id']
          ]);
          if (sLines && sLines[0] && sLines[0].order_id) {
            resolvedSo = { id: sLines[0].order_id[0], name: sLines[0].order_id[1] };
            break;
          }
        } catch {}
      }
    }
  }

  // 5. If MO is missing on delivery picking, but SO is known
  if (!resolvedMo && resolvedSo) {
    try {
      const candidateMos = await odoo._callObject('mrp.production', 'search_read', [
        ['|', ['x_studio_sales_order', '=', resolvedSo.id], ['origin', '=', resolvedSo.name]]
      ], {
        fields: ['id', 'name'],
        limit: 2
      });
      if (candidateMos && candidateMos.length === 1) {
        resolvedMo = { id: candidateMos[0].id, name: candidateMos[0].name };
      }
    } catch {}
  }

  return { resolvedMo, resolvedSo };
}

