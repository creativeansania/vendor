import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const NO_CREATE_OPTS = "{'no_create': True, 'no_create_edit': True, 'no_quick_create': True}";

const VIEW_SPECS = [
  // 1. Bank Matching (account.bank.statement.line & account.move.line)
  {
    name: '[Custom] Disable Partner Creation - Bank Matching Quick Create (862)',
    model: 'account.bank.statement.line',
    inheritId: 862,
    type: 'form',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Bank Matching Form (861)',
    model: 'account.bank.statement.line',
    inheritId: 861,
    type: 'form',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Bank Matching List (860)',
    model: 'account.bank.statement.line',
    inheritId: 860,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Bank Matching Edit Line (4153)',
    model: 'account.move.line',
    inheritId: 4153,
    type: 'form',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Bank Matching Move Line List (865)',
    model: 'account.move.line',
    inheritId: 865,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },

  // 2. Invoices, Vendor Bills & Journal Entries (account.move)
  {
    name: '[Custom] Disable Partner Creation - Account Move Form (700)',
    model: 'account.move',
    inheritId: 700,
    type: 'form',
    arch: `<data>
  <xpath expr="//group[@id='header_left_group']//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
  <xpath expr="//group[@id='header_left_group']//field[@name='partner_shipping_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
  <xpath expr="//field[@name='line_ids']/list//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
  <xpath expr="//field[@name='line_ids']/form//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Account Move List (689)',
    model: 'account.move',
    inheritId: 689,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },

  // 3. Journal Items & Manual Reconcile (account.move.line)
  {
    name: '[Custom] Disable Partner Creation - Journal Items List (678)',
    model: 'account.move.line',
    inheritId: 678,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Manual Reconcile List (851)',
    model: 'account.move.line',
    inheritId: 851,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },

  // 4. Customer & Vendor Payments (account.payment)
  {
    name: '[Custom] Disable Partner Creation - Payment Form (667)',
    model: 'account.payment',
    inheritId: 667,
    type: 'form',
    arch: `<data>
  <xpath expr="//group[@name='group1']/field[@name='partner_id'][1]" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
  <xpath expr="//group[@name='group1']/field[@name='partner_id'][2]" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Payment List (662)',
    model: 'account.payment',
    inheritId: 662,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },

  // 5. Reconciliation Models (account.reconcile.model)
  {
    name: '[Custom] Disable Partner Creation - Reconcile Model Form (731)',
    model: 'account.reconcile.model',
    inheritId: 731,
    type: 'form',
    arch: `<data>
  <xpath expr="//field[@name='match_partner_ids']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },

  // 6. Analytic Accounting (account.analytic.*)
  {
    name: '[Custom] Disable Partner Creation - Analytic Account Form (417)',
    model: 'account.analytic.account',
    inheritId: 417,
    type: 'form',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Analytic Distribution Form (425)',
    model: 'account.analytic.distribution.model',
    inheritId: 425,
    type: 'form',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Analytic Distribution List (424)',
    model: 'account.analytic.distribution.model',
    inheritId: 424,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Analytic Line Form (771)',
    model: 'account.analytic.line',
    inheritId: 771,
    type: 'form',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  },
  {
    name: '[Custom] Disable Partner Creation - Analytic Line List (411)',
    model: 'account.analytic.line',
    inheritId: 411,
    type: 'list',
    arch: `<data>
  <xpath expr="//field[@name='partner_id']" position="attributes">
    <attribute name="options">${NO_CREATE_OPTS}</attribute>
  </xpath>
</data>`
  }
];

async function upsertExtensionView(spec) {
  const existing = await adminOdooClient._callObject('ir.ui.view', 'search_read', [
    [['name', '=', spec.name], ['model', '=', spec.model]]
  ], { fields: ['id'] });

  const payload = {
    name: spec.name,
    model: spec.model,
    inherit_id: spec.inheritId,
    mode: 'extension',
    priority: 200,
    active: true,
    arch: spec.arch
  };

  if (existing && existing.length > 0) {
    const viewId = existing[0].id;
    await adminOdooClient._callObject('ir.ui.view', 'write', [[viewId], payload]);
    console.log(`Updated extension view #${viewId}: ${spec.name}`);
    return viewId;
  }

  const viewId = await adminOdooClient._callObject('ir.ui.view', 'create', [payload]);
  console.log(`Created extension view #${viewId}: ${spec.name}`);
  return viewId;
}

async function verifyViews() {
  const checks = [
    ['account.bank.statement.line', 862, 'form'],
    ['account.bank.statement.line', 861, 'form'],
    ['account.bank.statement.line', 860, 'list'],
    ['account.move.line', 4153, 'form'],
    ['account.move.line', 865, 'list'],
    ['account.move', 700, 'form'],
    ['account.move', 689, 'list'],
    ['account.move.line', 678, 'list'],
    ['account.move.line', 851, 'list'],
    ['account.payment', 667, 'form'],
    ['account.payment', 662, 'list'],
    ['account.reconcile.model', 731, 'form'],
    ['account.analytic.account', 417, 'form'],
    ['account.analytic.distribution.model', 425, 'form'],
    ['account.analytic.distribution.model', 424, 'list'],
    ['account.analytic.line', false, 'form'],
    ['account.analytic.line', 411, 'list']
  ];

  for (const [model, viewId, viewType] of checks) {
    const res = await adminOdooClient._callObject(model, 'get_views', [
      [[viewId, viewType]]
    ]);
    const arch = res?.views?.[viewType]?.arch || '';
    if (!arch.includes('no_create')) {
      throw new Error(`Verification failed: ${model} (${viewType} #${viewId}) missing no_create in compiled arch.`);
    }
    console.log(`Verified ${model} [${viewType} #${viewId || 'default'}]: compiled cleanly with no_create.`);
  }
}

async function main() {
  await adminOdooClient.authenticate();

  for (const spec of VIEW_SPECS) {
    await upsertExtensionView(spec);
  }

  await verifyViews();
  console.log(`\nAll ${VIEW_SPECS.length} Accounting partner no_create extension views installed & verified.`);
}

main().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
