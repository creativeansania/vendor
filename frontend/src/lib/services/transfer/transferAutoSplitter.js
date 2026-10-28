/**
 * Auto-split a multi-MO internal transfer so 1 MO = 1 Transfer
 */
export async function executeAutoSplitPicking(odoo, plan, resolvedSo, moMap) {
  const { picking, pickingName, seqCode, isFactoryInternal, movesByMo } = plan;
  const moGroups = Array.from(movesByMo.values()).filter((g) => g.moveIds && g.moveIds.length > 0);
  if (moGroups.length <= 1) {
    return null;
  }

  console.log(`[Transfer Auto-Split] Transfer ${pickingName} (ID: ${picking.id}) contains moves for ${moGroups.length} distinct MOs! Auto-splitting...`);

  const firstMoGroup = moGroups[0];
  const newCreatedPickings = [];

  for (let i = 1; i < moGroups.length; i++) {
    const moGroup = moGroups[i];
    if (!moGroup.moveIds || moGroup.moveIds.length === 0) {
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

    const newPickingId = await odoo._callObject('stock.picking', 'create', [newPickVals], {
      context: { tracking_disable: true, no_automation: true, mail_auto_delete: true }
    });

    await odoo._callObject('stock.move', 'write', [
      moGroup.moveIds,
      { picking_id: newPickingId }
    ], {
      context: { tracking_disable: true, no_automation: true }
    });

    if (moGroup.moveLineIds && moGroup.moveLineIds.length > 0) {
      await odoo._callObject('stock.move.line', 'write', [
        moGroup.moveLineIds,
        { picking_id: newPickingId }
      ], {
        context: { tracking_disable: true, no_automation: true }
      });
    }

    if (['assigned', 'confirmed'].includes(picking.state)) {
      try {
        await odoo._callObject('stock.picking', 'action_assign', [[newPickingId]], {
          context: { tracking_disable: true, no_automation: true }
        });
      } catch (errAssign) {
        console.warn(`[Transfer Auto-Split] Note on action_assign for new picking ${newPickingId}: ${errAssign.message}`);
      }
    }

    newCreatedPickings.push(newPickingId);
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

  await odoo._callObject('stock.picking', 'write', [[picking.id], origVals], {
    context: { tracking_disable: true, no_automation: true, mail_auto_delete: true }
  });

  if (['assigned', 'confirmed'].includes(picking.state)) {
    try {
      await odoo._callObject('stock.picking', 'action_assign', [[picking.id]], {
        context: { tracking_disable: true, no_automation: true }
      });
    } catch (errAssign) {
      console.warn(`[Transfer Auto-Split] Note on action_assign for orig picking ${picking.id}: ${errAssign.message}`);
    }
  }

  return {
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
  };
}

/**
 * Link MO and SO fields on a standard single-MO stock.picking
 */
export async function executeSinglePickingLink(odoo, plan, resolvedMo, resolvedSo) {
  const { picking, pickingName, seqCode, isFactoryInternal, isDeliveryType } = plan;

  const currentMoId = picking.x_studio_manufacturing_order ? picking.x_studio_manufacturing_order[0] : null;
  const currentStudioSoId = picking.x_studio_sales_order ? picking.x_studio_sales_order[0] : null;

  const vals = {};

  if (resolvedMo && resolvedMo.id !== currentMoId) {
    vals.x_studio_manufacturing_order = resolvedMo.id;
  }

  if (resolvedSo && resolvedSo.id !== currentStudioSoId) {
    vals.x_studio_sales_order = resolvedSo.id;
  }

  if (isFactoryInternal) {
    // Internal factory movements (PC, SPB, SFP, INT) must NEVER have native sale_id
    if (picking.sale_id) {
      vals.sale_id = false;
    }
  } else if (isDeliveryType) {
    if (resolvedSo && (!picking.sale_id || picking.sale_id[0] !== resolvedSo.id)) {
      vals.sale_id = resolvedSo.id;
    }
  }

  let updated = false;
  if (Object.keys(vals).length > 0) {
    console.log(`[Transfer MO/SO] Writing updates to picking ${pickingName} (ID: ${picking.id}):`, vals);
    await odoo._callObject('stock.picking', 'write', [[picking.id], vals], {
      context: {
        tracking_disable: true,
        no_automation: true,
        mail_auto_delete: true
      }
    });
    updated = true;
  }

  return {
    pickingId: picking.id,
    pickingName,
    seqCode,
    isFactoryInternal,
    isDeliveryType,
    resolvedMo: resolvedMo ? { id: resolvedMo.id, name: resolvedMo.name } : null,
    resolvedSo: resolvedSo ? { id: resolvedSo.id, name: resolvedSo.name } : null,
    updatedFields: Object.keys(vals),
    updated
  };
}

