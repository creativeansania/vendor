import { adminOdooClient } from '../odoo/odooClient.js';

export class TransferService {
  constructor(odooClient = adminOdooClient) {
    this.odoo = odooClient;
  }

  /**
   * Resolve and link Manufacturing Order (x_studio_manufacturing_order) and
   * Sales Order (sale_id / x_studio_sales_order) on stock.picking (Transfer).
   * Supports operation types: PC (Pick Component), SFP (Store Finished Product), INT (Internal Transfer), etc.
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

    if (allMoveIds.length > 0) {
      try {
        const moves = await this.odoo._callObject('stock.move', 'read', [
          allMoveIds,
          ['id', 'raw_material_production_id', 'production_id', 'move_dest_ids', 'production_group_id', 'move_line_ids', 'origin']
        ]);
        moves.forEach(m => movesMap.set(m.id, m));

        // Batch Prefetch 2: Destination moves
        const allDestMoveIds = [...new Set(moves.flatMap(m => m.move_dest_ids || []))];
        if (allDestMoveIds.length > 0) {
          const destMoves = await this.odoo._callObject('stock.move', 'read', [
            allDestMoveIds,
            ['id', 'raw_material_production_id', 'production_id', 'production_group_id']
          ]);
          destMoves.forEach(dm => destMovesMap.set(dm.id, dm));
        }
      } catch (errMoves) {
        console.warn(`[Transfer MO/SO] Warning during bulk prefetch of moves: ${errMoves.message}`);
      }
    }

    // Batch Prefetch 3: Production groups in Odoo
    const allProdGroupIds = [
      ...new Set([
        ...Array.from(movesMap.values()).filter(m => m.production_group_id && m.production_group_id[0]).map(m => m.production_group_id[0]),
        ...Array.from(destMovesMap.values()).filter(dm => dm.production_group_id && dm.production_group_id[0]).map(dm => dm.production_group_id[0])
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
    const getMoRefForMove = (m) => {
      if (!m) return null;
      for (const dmid of (m.move_dest_ids || [])) {
        const dm = destMovesMap.get(dmid);
        if (dm && dm.raw_material_production_id) {
          return { id: dm.raw_material_production_id[0], name: dm.raw_material_production_id[1] };
        }
        if (dm && dm.production_id) {
          return { id: dm.production_id[0], name: dm.production_id[1] };
        }
        if (dm && dm.production_group_id) {
          const g = prodGroupMap.get(dm.production_group_id[0]);
          if (g && g.production_ids && g.production_ids.length > 0) {
            const pId = typeof g.production_ids[0] === 'object' ? g.production_ids[0].id : g.production_ids[0];
            return { id: pId, name: g.name };
          }
        }
      }

      if (m.raw_material_production_id) {
        return { id: m.raw_material_production_id[0], name: m.raw_material_production_id[1] };
      }
      if (m.production_id) {
        return { id: m.production_id[0], name: m.production_id[1] };
      }

      if (m.production_group_id) {
        const g = prodGroupMap.get(m.production_group_id[0]);
        if (g && g.production_ids && g.production_ids.length > 0) {
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
      else if (upperName.includes('/SFP/')) seqCode = 'SFP';
      else if (upperName.includes('/INT/')) seqCode = 'INT';
      else if (upperName.includes('/PICK/')) seqCode = 'PICK';
      else if (upperName.includes('/OUT/')) seqCode = 'OUT';
      else if (upperName.includes('/IN/')) seqCode = 'IN';

      const isMatchedType =
        ['PC', 'SFP', 'INT'].includes(seqCode) ||
        upperName.includes('/PC/') ||
        upperName.includes('/SFP/') ||
        upperName.includes('/INT/');

      const originClean = picking.origin ? picking.origin.split(',')[0].trim() : '';
      const namePrefix = pickingName.includes('/') ? pickingName.split('/')[0].trim() : '';

      const pMoves = (picking.move_ids || []).map(mid => movesMap.get(mid)).filter(Boolean);
      const movesByMo = new Map();

      for (const m of pMoves) {
        const moRef = getMoRefForMove(m);
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

      const canAutoSplit =
        isMatchedType &&
        movesByMo.size > 1 &&
        pMoves.length > 1 &&
        !isMasterAdmin &&
        !['done', 'cancel'].includes(picking.state);

      pickingPlans.push({
        picking,
        pickingName,
        seqCode,
        isMatchedType,
        originClean,
        namePrefix,
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
    ];
    const moMap = new Map();
    if (moIdsToRead.length > 0) {
      try {
        const moList = await this.odoo._callObject('mrp.production', 'read', [
          moIdsToRead,
          ['id', 'name', 'x_studio_sales_order', 'origin']
        ]);
        moList.forEach(m => moMap.set(m.id, m));
      } catch (errMoRead) {
        console.warn(`[Transfer MO/SO] Error reading MO sales orders in bulk: ${errMoRead.message}`);
      }
    }

    // Prefetch Sales Orders in bulk
    const potentialSoOrigins = [
      ...new Set(
        pickingPlans
          .map(p => p.originClean)
          .filter(orig => orig && !orig.includes('/MO/'))
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
      try {
        const { picking, pickingName, seqCode, isMatchedType, originClean, namePrefix, movesByMo, canAutoSplit } = plan;
        let resolvedMo = plan.resolvedMo;
        let resolvedSo = null;

        // Fallback for MO: Origin Match
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
                fields: ['id', 'name', 'x_studio_sales_order', 'origin'],
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

        // Resolve SO
        if (resolvedMo && moMap.has(resolvedMo.id)) {
          const moData = moMap.get(resolvedMo.id);
          if (moData && moData.x_studio_sales_order && moData.x_studio_sales_order[0]) {
            resolvedSo = {
              id: moData.x_studio_sales_order[0],
              name: moData.x_studio_sales_order[1]
            };
          }
        }

        if (!resolvedSo && originClean && soMap.has(originClean)) {
          const so = soMap.get(originClean);
          resolvedSo = { id: so.id, name: so.name };
        }

        // Auto-split logic: 1 MO = 1 Transfer
        if (canAutoSplit) {
          console.log(`[Transfer Auto-Split] Transfer ${pickingName} (ID: ${picking.id}) contains moves for ${movesByMo.size} distinct MOs! Auto-splitting...`);

          const moGroups = Array.from(movesByMo.values());
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
          if (picking.sale_id) {
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
            isMatchedType,
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
        if (isMatchedType) {
          if (resolvedMo && resolvedMo.id !== currentMoId) {
            vals.x_studio_manufacturing_order = resolvedMo.id;
          }
          if (resolvedSo && resolvedSo.id !== currentStudioSoId) {
            vals.x_studio_sales_order = resolvedSo.id;
          }
          if (picking.sale_id) {
            vals.sale_id = false;
          }
        } else {
          if (resolvedSo && (!picking.sale_id || picking.sale_id[0] !== resolvedSo.id)) {
            vals.sale_id = resolvedSo.id;
          }
          if (currentStudioSoId) {
            vals.x_studio_sales_order = false;
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
          isMatchedType,
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
