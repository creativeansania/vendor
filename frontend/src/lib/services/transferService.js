import { adminOdooClient } from '../odoo/odooClient.js';

export class TransferService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

  /**
   * Resolve and link Manufacturing Order (x_studio_manufacturing_order) and
   * Sales Order (sale_id / x_studio_sales_order) on stock.picking (Transfer).
   * Supports operation types:
   *  - Factory Internal: PC (Pick Component), SPB (Surat Pengantar Bahan), SFP (Store Finished Product), INT (Internal Transfer)
   *  - Delivery: PICK (Pick), OUT (Delivery Orders)
   *  - Other: IN (Receipts)
   */
  async resolveTransferMoAndSo(pickingIds) {
    let ids = [];
    if (Array.isArray(pickingIds)) {
      ids = pickingIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    } else if (typeof pickingIds === 'number' || !isNaN(Number(pickingIds))) {
      ids = [Number(pickingIds)];
    }

    if (ids.length === 0) {
      throw new Error('No valid picking ID provided to resolve MO/SO');
    }

    console.log(`[Transfer MO/SO] Resolving references for ${ids.length} transfer(s): [${ids.join(', ')}]`);

    const pickings = await this.odoo._callObject('stock.picking', 'read', [
      ids,
      [
        'id', 'name', 'origin', 'picking_type_id', 'sale_id',
        'x_studio_manufacturing_order', 'x_studio_sales_order', 'move_ids',
        'company_id', 'state', 'location_id', 'location_dest_id', 'partner_id',
        'scheduled_date', 'date_deadline', 'move_type', 'create_uid'
      ]
    ]);

    if (!pickings || pickings.length === 0) {
      throw new Error(`None of the requested pickings found in Odoo: [${ids.join(', ')}]`);
    }

    const results = [];
    const allCreatedPickingIds = [];

    // Batch Prefetch 1: Read all stock.moves across all pickings
    const allMoveIds = [...new Set(pickings.flatMap(p => p.move_ids || []))];
    const movesMap = new Map();
    const destMovesMap = new Map();
    const origMovesMap = new Map();
    const moNameMap = new Map();
    const moMap = new Map();

    if (allMoveIds.length > 0) {
      try {
        const moves = await this.odoo._callObject('stock.move', 'read', [
          allMoveIds,
          [
            'id', 'raw_material_production_id', 'production_id',
            'move_dest_ids', 'move_orig_ids', 'production_group_id',
            'move_line_ids', 'origin', 'sale_line_id'
          ]
        ]);
        moves.forEach(m => movesMap.set(m.id, m));

        // Batch Prefetch 2: Destination moves
        const allDestMoveIds = [...new Set(moves.flatMap(m => m.move_dest_ids || []))];
        if (allDestMoveIds.length > 0) {
          const destMoves = await this.odoo._callObject('stock.move', 'read', [
            allDestMoveIds,
            ['id', 'raw_material_production_id', 'production_id', 'production_group_id', 'sale_line_id', 'origin']
          ]);
          destMoves.forEach(dm => destMovesMap.set(dm.id, dm));
        }

        // Batch Prefetch 2b: Origin moves (vital for SFP finished goods)
        const allOrigMoveIds = [...new Set(moves.flatMap(m => m.move_orig_ids || []))];
        if (allOrigMoveIds.length > 0) {
          const origMoves = await this.odoo._callObject('stock.move', 'read', [
            allOrigMoveIds,
            ['id', 'raw_material_production_id', 'production_id', 'production_group_id', 'sale_line_id', 'origin']
          ]);
          origMoves.forEach(om => origMovesMap.set(om.id, om));
        }

        // Batch Prefetch 2c: Prefetch MOs matching move origins (e.g. "VDKWS/MO/05189-002")
        const potentialMoveMoNames = [
          ...new Set([
            ...moves.map(m => (m.origin || '').trim()).filter(o => o.includes('/MO/')),
            ...Array.from(origMovesMap.values()).map(om => (om.origin || '').trim()).filter(o => o.includes('/MO/'))
          ])
        ];
        if (potentialMoveMoNames.length > 0) {
          try {
            const mosByOrigin = await this.odoo._callObject('mrp.production', 'search_read', [
              [['name', 'in', potentialMoveMoNames]]
            ], {
              fields: ['id', 'name', 'x_studio_sales_order', 'origin']
            });
            mosByOrigin.forEach(m => {
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

    // Batch Prefetch 3: Production groups in Odoo
    const allProdGroupIds = [
      ...new Set([
        ...Array.from(movesMap.values()).filter(m => m.production_group_id && m.production_group_id[0]).map(m => m.production_group_id[0]),
        ...Array.from(destMovesMap.values()).filter(dm => dm.production_group_id && dm.production_group_id[0]).map(dm => dm.production_group_id[0]),
        ...Array.from(origMovesMap.values()).filter(om => om.production_group_id && om.production_group_id[0]).map(om => om.production_group_id[0])
      ])
    ];
    const prodGroupMap = new Map();
    if (allProdGroupIds.length > 0) {
      try {
        const groups = await this.odoo._callObject('mrp.production.group', 'read', [
          allProdGroupIds,
          ['id', 'name', 'production_ids']
        ]);
        groups.forEach(g => prodGroupMap.set(g.id, g));
      } catch (errG) {
        console.warn(`[Transfer MO/SO] Note on prefetching production groups: ${errG.message}`);
      }
    }

    // Helper: Resolve which MO a given stock.move belongs to
    const getMoRefForMove = (m, isSfp = false) => {
      if (!m) return null;

      // 1. Direct MO link on the move
      if (m.raw_material_production_id) {
        return { id: m.raw_material_production_id[0], name: m.raw_material_production_id[1] };
      }
      if (m.production_id) {
        return { id: m.production_id[0], name: m.production_id[1] };
      }

      // 2. Origin moves (for SFP / finished goods produced by an MO)
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

      // 3. Move origin matching MO name (e.g. VDKWS/MO/05189-002)
      const mOrig = (m.origin || '').trim();
      if (mOrig && moNameMap.has(mOrig)) {
        const matched = moNameMap.get(mOrig);
        return { id: matched.id, name: matched.name };
      }

      // 4. Destination moves (for component moves feeding an MO)
      for (const dmid of (m.move_dest_ids || [])) {
        const dm = destMovesMap.get(dmid);
        if (dm && dm.raw_material_production_id) {
          return { id: dm.raw_material_production_id[0], name: dm.raw_material_production_id[1] };
        }
        if (dm && dm.production_id) {
          return { id: dm.production_id[0], name: dm.production_id[1] };
        }
      }

      // 5. Fallback to production group ONLY for non-SFP moves if group has exactly 1 MO
      // NEVER use production_group_id[0] for SFP because multiple MOs share 1 group!
      if (!isSfp && m.production_group_id) {
        const g = prodGroupMap.get(m.production_group_id[0]);
        if (g && g.production_ids && g.production_ids.length === 1) {
          const pId = typeof g.production_ids[0] === 'object' ? g.production_ids[0].id : g.production_ids[0];
          return { id: pId, name: g.name };
        }
      }

      return null;
    };

    const pickingPlans = [];

    for (const picking of pickings) {
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

      const pMoves = (picking.move_ids || []).map(mid => movesMap.get(mid)).filter(Boolean);
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

      const validMoGroups = Array.from(movesByMo.values()).filter(g => g.moveIds && g.moveIds.length > 0);

      // Auto-split applies to factory internal component transfers (PC, SPB, SFP, INT)
      const canAutoSplit =
        isFactoryInternal &&
        validMoGroups.length > 1 &&
        pMoves.length > 1 &&
        !isMasterAdmin &&
        !['done', 'cancel'].includes(picking.state);

      pickingPlans.push({
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
      });
    }

    // Prefetch mrp.production for all resolved/grouped MOs
    const moIdsToRead = [
      ...new Set([
        ...pickingPlans.filter(p => p.resolvedMo && p.resolvedMo.id).map(p => p.resolvedMo.id),
        ...pickingPlans.flatMap(p => Array.from(p.movesByMo.keys()))
      ])
    ].filter(id => !moMap.has(id));
    if (moIdsToRead.length > 0) {
      try {
        const moList = await this.odoo._callObject('mrp.production', 'read', [
          moIdsToRead,
          ['id', 'name', 'x_studio_sales_order', 'origin', 'sale_line_id']
        ]);
        moList.forEach(m => moMap.set(m.id, m));
      } catch (errMoRead) {
        console.warn(`[Transfer MO/SO] Error reading MO sales orders in bulk: ${errMoRead.message}`);
      }
    }

    // Prefetch Sales Orders in bulk from picking origins & native sale_ids
    const potentialSoOrigins = [
      ...new Set(
        pickingPlans.flatMap(p => {
          const tokens = [];
          if (p.picking.sale_id && p.picking.sale_id[1]) {
            tokens.push(p.picking.sale_id[1]);
          }
          if (p.picking.origin) {
            p.picking.origin.split(/[,|]/).forEach(tok => {
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
        const foundSos = await this.odoo._callObject('sale.order', 'search_read', [
          [['name', 'in', potentialSoOrigins], ['state', '!=', 'cancel']]
        ], {
          fields: ['id', 'name', 'state'],
          order: 'id desc'
        });
        foundSos.forEach(so => {
          if (!soMap.has(so.name)) {
            soMap.set(so.name, so);
          }
        });
      } catch (errSoRead) {
        console.warn(`[Transfer MO/SO] Error reading Sales Orders in bulk: ${errSoRead.message}`);
      }
    }

    for (const plan of pickingPlans) {
      const { picking, pickingName, seqCode, isFactoryInternal, isDeliveryType, originClean, namePrefix, pMoves, movesByMo, canAutoSplit } = plan;
      try {
        let resolvedMo = plan.resolvedMo;
        let resolvedSo = null;

        // Fallback for MO: Check regex patterns in picking.origin (e.g. Sisa Makloon - VDKWS/MO/05358 | MO VDKWS/MO/05358)
        if (!resolvedMo && picking.origin) {
          const moMatches = picking.origin.match(/([A-Z0-9]+(?:\/[A-Z0-9]+)+\/\d+(?:-\d+)?)/g);
          if (moMatches && moMatches.length > 0) {
            for (const moName of moMatches) {
              try {
                const foundMos = await this.odoo._callObject('mrp.production', 'search_read', [
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
              } catch (errMoMatch) {}
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
              const foundMos = await this.odoo._callObject('mrp.production', 'search_read', [d], {
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

        // Resolve SO:
        // 1. Direct native picking.sale_id
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
              const sLines = await this.odoo._callObject('sale.order.line', 'read', [
                [moData.sale_line_id[0]],
                ['order_id']
              ]);
              if (sLines && sLines[0] && sLines[0].order_id) {
                resolvedSo = { id: sLines[0].order_id[0], name: sLines[0].order_id[1] };
              }
            } catch (e) {}
          } else if (moData && moData.origin && soMap.has(moData.origin.trim())) {
            const so = soMap.get(moData.origin.trim());
            resolvedSo = { id: so.id, name: so.name };
          }
        }

        // 3. Resolve from picking origin tokens
        if (!resolvedSo && picking.origin) {
          const tokens = picking.origin
            .split(/[,|]/)
            .map(t => t.replace(/^(?:SO\s+|Sisa\s+Makloon\s+-\s+)/i, '').trim())
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
                const sLines = await this.odoo._callObject('sale.order.line', 'read', [
                  [m.sale_line_id[0]],
                  ['order_id']
                ]);
                if (sLines && sLines[0] && sLines[0].order_id) {
                  resolvedSo = { id: sLines[0].order_id[0], name: sLines[0].order_id[1] };
                  break;
                }
              } catch (e) {}
            }
          }
        }

        // 5. If MO is missing on delivery picking, but SO is known:
        if (!resolvedMo && resolvedSo) {
          try {
            const candidateMos = await this.odoo._callObject('mrp.production', 'search_read', [
              ['|', ['x_studio_sales_order', '=', resolvedSo.id], ['origin', '=', resolvedSo.name]]
            ], {
              fields: ['id', 'name'],
              limit: 2
            });
            if (candidateMos && candidateMos.length === 1) {
              resolvedMo = { id: candidateMos[0].id, name: candidateMos[0].name };
            }
          } catch (e) {}
        }

        // Auto-split logic: 1 MO = 1 Transfer
        if (canAutoSplit) {
          const moGroups = Array.from(movesByMo.values()).filter(g => g.moveIds && g.moveIds.length > 0);
          if (moGroups.length <= 1) {
            continue;
          }

          console.log(`[Transfer Auto-Split] Transfer ${pickingName} (ID: ${picking.id}) contains moves for ${moGroups.length} distinct MOs! Auto-splitting...`);

          const firstMoGroup = moGroups[0];
          const newCreatedPickings = [];

          for (let i = 1; i < moGroups.length; i++) {
            const moGroup = moGroups[i];
            if (!moGroup.moveIds || moGroup.moveIds.length === 0) {
              console.log(`[Transfer Auto-Split] Skipping MO ${moGroup.moName} because it has 0 moves.`);
              continue;
            }
            const moInfo = moMap.get(moGroup.moId) || {};
            const moSo = (moInfo.x_studio_sales_order && moInfo.x_studio_sales_order[0])
              ? { id: moInfo.x_studio_sales_order[0], name: moInfo.x_studio_sales_order[1] }
              : resolvedSo;

            const newPickVals = {
              picking_type_id: picking.picking_type_id[0],
              location_id: picking.location_id[0],
              location_dest_id: picking.location_dest_id[0],
              move_type: picking.move_type || 'direct',
              partner_id: picking.partner_id ? picking.partner_id[0] : false,
              origin: moGroup.moName || picking.origin,
              scheduled_date: picking.scheduled_date,
              date_deadline: picking.date_deadline,
              company_id: picking.company_id ? picking.company_id[0] : false,
              x_studio_manufacturing_order: moGroup.moId,
              x_studio_sales_order: moSo ? moSo.id : false
            };

            const newPickingId = await this.odoo._callObject('stock.picking', 'create', [newPickVals], {
              context: { tracking_disable: true, no_automation: true, mail_auto_delete: true }
            });

            await this.odoo._callObject('stock.move', 'write', [
              moGroup.moveIds,
              { picking_id: newPickingId }
            ], {
              context: { tracking_disable: true, no_automation: true }
            });

            if (moGroup.moveLineIds && moGroup.moveLineIds.length > 0) {
              await this.odoo._callObject('stock.move.line', 'write', [
                moGroup.moveLineIds,
                { picking_id: newPickingId }
              ], {
                context: { tracking_disable: true, no_automation: true }
              });
            }

            if (['assigned', 'confirmed'].includes(picking.state)) {
              try {
                await this.odoo._callObject('stock.picking', 'action_assign', [[newPickingId]], {
                  context: { tracking_disable: true, no_automation: true }
                });
              } catch (errAssign) {
                console.warn(`[Transfer Auto-Split] Note on action_assign for new picking ${newPickingId}: ${errAssign.message}`);
              }
            }

            newCreatedPickings.push(newPickingId);
            allCreatedPickingIds.push(newPickingId);
            console.log(`[Transfer Auto-Split] Created transfer #${newPickingId} for MO ${moGroup.moName} (${moGroup.moveIds.length} moves reassigned).`);
          }

          const firstMoInfo = moMap.get(firstMoGroup.moId) || {};
          const firstMoSo = (firstMoInfo.x_studio_sales_order && firstMoInfo.x_studio_sales_order[0])
            ? { id: firstMoInfo.x_studio_sales_order[0], name: firstMoInfo.x_studio_sales_order[1] }
            : resolvedSo;

          const origVals = {
            origin: firstMoGroup.moName || picking.origin,
            x_studio_manufacturing_order: firstMoGroup.moId
          };
          if (firstMoSo) {
            origVals.x_studio_sales_order = firstMoSo.id;
          }
          if (isFactoryInternal && picking.sale_id) {
            origVals.sale_id = false;
          }

          await this.odoo._callObject('stock.picking', 'write', [[picking.id], origVals], {
            context: { tracking_disable: true, no_automation: true, mail_auto_delete: true }
          });

          if (['assigned', 'confirmed'].includes(picking.state)) {
            try {
              await this.odoo._callObject('stock.picking', 'action_assign', [[picking.id]], {
                context: { tracking_disable: true, no_automation: true }
              });
            } catch (errAssign) {
              console.warn(`[Transfer Auto-Split] Note on action_assign for orig picking ${picking.id}: ${errAssign.message}`);
            }
          }

          results.push({
            pickingId: picking.id,
            pickingName,
            seqCode,
            isFactoryInternal,
            action: 'auto_split',
            totalMos: moGroups.length,
            originalPickingMo: firstMoGroup.moName,
            createdPickingsCount: newCreatedPickings.length,
            createdPickingIds: newCreatedPickings,
            updated: true
          });
          continue;
        }

        // Standard Single-MO Transfer Linking
        const currentMoId = picking.x_studio_manufacturing_order ? picking.x_studio_manufacturing_order[0] : null;
        const currentStudioSoId = picking.x_studio_sales_order ? picking.x_studio_sales_order[0] : null;

        const vals = {};

        // Always link x_studio_manufacturing_order if resolved and different
        if (resolvedMo && resolvedMo.id !== currentMoId) {
          vals.x_studio_manufacturing_order = resolvedMo.id;
        }

        // Always link x_studio_sales_order if resolved and different
        if (resolvedSo && resolvedSo.id !== currentStudioSoId) {
          vals.x_studio_sales_order = resolvedSo.id;
        }

        // Native sale_id handling:
        if (isFactoryInternal) {
          // Internal factory movements (PC, SPB, SFP, INT) must NEVER have native sale_id
          // so they don't count towards the Sales Order "Delivery" button!
          if (picking.sale_id) {
            vals.sale_id = false;
          }
        } else if (isDeliveryType) {
          // Delivery transfers (PICK, OUT) should keep or populate native sale_id
          if (resolvedSo && (!picking.sale_id || picking.sale_id[0] !== resolvedSo.id)) {
            vals.sale_id = resolvedSo.id;
          }
        }

        let updated = false;
        if (Object.keys(vals).length > 0) {
          console.log(`[Transfer MO/SO] Writing updates to picking ${pickingName} (ID: ${picking.id}):`, vals);
          await this.odoo._callObject('stock.picking', 'write', [[picking.id], vals], {
            context: {
              tracking_disable: true,
              no_automation: true,
              mail_auto_delete: true
            }
          });
          updated = true;
        }

        results.push({
          pickingId: picking.id,
          pickingName,
          seqCode,
          isFactoryInternal,
          isDeliveryType,
          resolvedMo: resolvedMo ? { id: resolvedMo.id, name: resolvedMo.name } : null,
          resolvedSo: resolvedSo ? { id: resolvedSo.id, name: resolvedSo.name } : null,
          updatedFields: Object.keys(vals),
          updated
        });
      } catch (pickErr) {
        console.error(`[Transfer MO/SO] Error processing picking ID ${picking.id}:`, pickErr.message);
        results.push({
          pickingId: picking.id,
          error: pickErr.message
        });
      }
    }

    return {
      success: true,
      count: results.length,
      createdPickingIds: allCreatedPickingIds,
      results
    };
  }
}

export const transferService = new TransferService();
