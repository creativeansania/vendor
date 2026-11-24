import { adminOdooClient } from '../src/lib/odoo/odooClient.js';

const DRY_RUN = process.argv.includes('--dry-run');

const KSS_COMPANY_ID = 1;
const KSS_PARTNER_ID = 1;
const FINANCE_GROUP_ID = 1;
const INTERCOMPANY_TAG_NAME = 'Intercompany';
const INTERCOMPANY_TAG_COLOR = 4; // Blue

const DASHBOARD_ACCOUNTING_SRC_ID = 2;
const DASHBOARD_INVOICING_SRC_ID = 1;

const DASHBOARD_ACCOUNTING_NEW_NAME = 'Accounting Consolidated';
const DASHBOARD_INVOICING_NEW_NAME = 'Invoicing Consolidated';

const YEAR_FILTER_ID_ACCOUNTING = '7785b753-917c-4640-a937-4b6226222ca8';

/**
 * Normalize an Odoo domain array into a single explicit Polish-notation expression.
 */
function normalizeDomain(domain) {
  if (!Array.isArray(domain) || domain.length === 0) return [];
  let arity = 0;
  for (const token of domain) {
    if (token === '&' || token === '|') {
      arity -= 1;
    } else if (token === '!') {
      // unary operator leaves arity unchanged
    } else {
      arity += 1;
    }
  }
  const prefix = [];
  for (let i = 1; i < arity; i += 1) {
    prefix.push('&');
  }
  return [...prefix, ...domain];
}

function andDomains(domainA, domainB) {
  const a = normalizeDomain(domainA);
  const b = normalizeDomain(domainB);
  if (a.length === 0) return b;
  if (b.length === 0) return a;
  return ['&', ...a, ...b];
}

/**
 * Rule A: Exclude KSS (company_id = 1) lines/invoices where partner has the Intercompany tag.
 * Preserves:
 *  - KSS external customers (not tagged) & lines without partner (partner_id = false)
 *  - All Depo / Konsinyasi / other intercompany entities' own sales (company_id != 1),
 *    including self-partner Konsinyasi invoices (Zatta, Rabbani, Ailescarf).
 */
function buildExclKssToIcDomain(tagId) {
  return [
    '|',
    ['company_id', '!=', KSS_COMPANY_ID],
    '|',
    ['partner_id', '=', false],
    ['partner_id.category_id', 'not in', [tagId]],
  ];
}

/**
 * Rule B: Exclude non-KSS companies' vendor bills/payables from KSS (partner_id = 1).
 * Preserves:
 *  - All KSS factory COGS & external vendor payables (company_id = 1)
 *  - All non-KSS companies' external vendor bills/payables & lines without partner.
 */
function buildExclIcToKssDomain() {
  return [
    '|',
    ['company_id', '=', KSS_COMPANY_ID],
    '|',
    ['partner_id', '=', false],
    ['partner_id', '!=', KSS_PARTNER_ID],
  ];
}

function makeAmlPivot({ id, name, accountType, extraDomain = [], measures = ['balance'] }) {
  const baseDomain = [
    '&',
    ['parent_state', '=', 'posted'],
    ['account_id.account_type', '=', accountType],
  ];
  const domain = extraDomain.length ? andDomains(baseDomain, extraDomain) : baseDomain;
  return {
    type: 'ODOO',
    fieldMatching: {},
    context: {},
    domain,
    id: String(id),
    measures: measures.map((m) => ({ id: m, fieldName: m })),
    model: 'account.move.line',
    name,
    sortedColumn: null,
    formulaId: String(id),
    columns: [{ fieldName: 'date', granularity: 'year' }],
    rows: [],
  };
}

/**
 * Patch an odoo://view/{json} markdown link by ANDing its action.domain with extraDomain.
 */
function patchOdooViewLink(cellValue, extraDomain) {
  if (typeof cellValue !== 'string') return cellValue;
  const match = cellValue.match(/^(\[[^\]]+\]\(odoo:\/\/view\/)(.*)(\))$/);
  if (!match) return cellValue;
  const [, prefix, jsonStr, suffix] = match;
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed?.action && Array.isArray(parsed.action.domain)) {
      parsed.action.domain = andDomains(parsed.action.domain, extraDomain);
      return `${prefix}${JSON.stringify(parsed)}${suffix}`;
    }
  } catch {
    // leave unchanged if non-JSON
  }
  return cellValue;
}

/**
 * Flow value for a single year cell (e.g. C$9, D$9, E$9).
 * Uses SUM(IFERROR(..., 0)) so empty string "" from missing pivot year never produces #VALUE!.
 */
function flowFormula(pivotId, measure, yearRef, negate = false) {
  const expr = `SUM(IFERROR(PIVOT.VALUE(${pivotId},"${measure}","date:year",${yearRef}),0))`;
  return negate ? `=0-${expr}` : `=${expr}`;
}

/**
 * Sum of two flow pivots for a single year (e.g. asset_cash + liability_credit_card).
 */
function flowSum2Formula(pivotId1, pivotId2, measure, yearRef, negate = false) {
  const expr = `SUM(IFERROR(PIVOT.VALUE(${pivotId1},"${measure}","date:year",${yearRef}),0),IFERROR(PIVOT.VALUE(${pivotId2},"${measure}","date:year",${yearRef}),0))`;
  return negate ? `=0-${expr}` : `=${expr}`;
}

/**
 * Cumulative balance as of end of year `yearRef` (all-time total minus movements in years > yearRef).
 * Covers up to 10 years forward so filtering historical years (e.g. 2025, 2024) stays exact.
 */
function cumulativeExpr(pivotId, yearRef) {
  const futureTerms = [];
  for (let offset = 1; offset <= 10; offset += 1) {
    futureTerms.push(`IFERROR(PIVOT.VALUE(${pivotId},"balance","date:year",${yearRef}+${offset}),0)`);
  }
  return `(SUM(IFERROR(PIVOT.VALUE(${pivotId},"balance"),0))-SUM(${futureTerms.join(',')}))`;
}

function cumFormula(pivotId, yearRef, negate = false) {
  const expr = cumulativeExpr(pivotId, yearRef);
  return negate ? `=0-${expr}` : `=${expr}`;
}

function cumSum2Formula(pivotId1, pivotId2, yearRef, negate = false) {
  const expr = `(${cumulativeExpr(pivotId1, yearRef)}+${cumulativeExpr(pivotId2, yearRef)})`;
  return negate ? `=0-${expr}` : `=${expr}`;
}

function buildAccountingConsolidatedJson(srcJson, tagId) {
  const data = JSON.parse(JSON.stringify(srcJson));
  const exclKssToIc = buildExclKssToIcDomain(tagId);
  const exclIcToKss = buildExclIcToKssDomain();

  // 1. Add explicit IDR currency format ("7") so monetary cells always format cleanly as Rp
  data.formats = data.formats || {};
  const CURRENCY_FMT_ID = 7;
  data.formats[String(CURRENCY_FMT_ID)] = '[$Rp]#,##0.00';

  // 2. Patch Invoiced chart & clickable link on Dashboard sheet
  const dashSheet = data.sheets.find((s) => s.name === 'Dashboard') || data.sheets[0];
  const dataSheet = data.sheets.find((s) => s.name === 'Data') || data.sheets[1];

  for (const fig of dashSheet.figures || []) {
    if (fig.data?.metaData?.resModel === 'account.invoice.report' && Array.isArray(fig.data?.searchParams?.domain)) {
      fig.data.searchParams.domain = andDomains(fig.data.searchParams.domain, exclKssToIc);
    }
  }
  if (dashSheet.cells?.A7) {
    dashSheet.cells.A7 = patchOdooViewLink(dashSheet.cells.A7, exclKssToIc);
  }

  // Apply IDR currency format to monetary table cells on Dashboard sheet
  dashSheet.formats = dashSheet.formats || {};
  const dashMonetaryRanges = [
    'B25:C28', // Cash table (2026 & 2025)
    'B40:C40', // Short term cash forecast
    'B46:C46', // Working capital
    'G25:H29', // Profitability table
    'G32:H34', // Balance sheet table
    'G43:H43', // Long term working capital
  ];
  for (const rng of dashMonetaryRanges) {
    dashSheet.formats[rng] = CURRENCY_FMT_ID;
  }

  // 3. Define 17 multi-company account.move.line pivots
  data.pivots = {
    '1': makeAmlPivot({ id: 1, name: 'Income (Consolidated)', accountType: 'income', extraDomain: exclKssToIc }),
    '2': makeAmlPivot({ id: 2, name: 'Other Income (Consolidated)', accountType: 'income_other', extraDomain: exclKssToIc }),
    '3': makeAmlPivot({ id: 3, name: 'Cost of Revenue (Consolidated)', accountType: 'expense_direct_cost', extraDomain: exclIcToKss }),
    '4': makeAmlPivot({ id: 4, name: 'Expenses', accountType: 'expense' }),
    '5': makeAmlPivot({ id: 5, name: 'Depreciation', accountType: 'expense_depreciation' }),
    '6': makeAmlPivot({ id: 6, name: 'Bank and Cash', accountType: 'asset_cash', measures: ['debit', 'credit', 'balance'] }),
    '7': makeAmlPivot({ id: 7, name: 'Credit Cards', accountType: 'liability_credit_card', measures: ['debit', 'credit', 'balance'] }),
    '8': makeAmlPivot({ id: 8, name: 'Receivables (Consolidated)', accountType: 'asset_receivable', extraDomain: exclKssToIc }),
    '9': makeAmlPivot({ id: 9, name: 'Payables (Consolidated)', accountType: 'liability_payable', extraDomain: exclIcToKss }),
    '10': makeAmlPivot({ id: 10, name: 'Current Assets', accountType: 'asset_current' }),
    '11': makeAmlPivot({ id: 11, name: 'Prepayments', accountType: 'asset_prepayments' }),
    '12': makeAmlPivot({ id: 12, name: 'Fixed Assets', accountType: 'asset_fixed' }),
    '13': makeAmlPivot({ id: 13, name: 'Non-Current Assets', accountType: 'asset_non_current' }),
    '14': makeAmlPivot({ id: 14, name: 'Current Liabilities', accountType: 'liability_current' }),
    '15': makeAmlPivot({ id: 15, name: 'Non-Current Liabilities', accountType: 'liability_non_current' }),
    '16': makeAmlPivot({ id: 16, name: 'Equity', accountType: 'equity' }),
    '17': makeAmlPivot({ id: 17, name: 'Unaffected Earnings', accountType: 'equity_unaffected' }),
  };
  data.pivotNextId = 18;

  // 4. Rewrite Data sheet formulas (columns C=Current Year, D=Prev Year, E=Year-2)
  const cells = dataSheet.cells;

  // Safe fallback if Year filter is cleared
  cells.C9 = '=IF(E1="",YEAR(TODAY()),YEAR(E1))';
  cells.D9 = '=C9-1';
  cells.E9 = '=D9-1';
  cells.F9 = '=E9-1';

  // Ensure Dashboard header cells also handle numeric year cleanly
  for (const colPair of [['B24', 'C24'], ['B31', 'C31'], ['B37', 'C37'], ['B42', 'C42'], ['G24', 'H24'], ['G31', 'H31'], ['G37', 'H37']]) {
    dashSheet.cells[colPair[0]] = '=Data!C9';
    dashSheet.cells[colPair[1]] = '=Data!D9';
  }

  for (const col of ['C', 'D', 'E']) {
    const yr = `${col}$9`;

    // Cash (flow during year + cumulative closing balance)
    cells[`${col}11`] = flowSum2Formula(6, 7, 'debit', yr, false); // Cash received
    cells[`${col}12`] = flowSum2Formula(6, 7, 'credit', yr, true); // Cash spent (negative)
    cells[`${col}13`] = `=${col}11+${col}12`; // Cash surplus
    cells[`${col}14`] = cumSum2Formula(6, 7, yr, false); // Closing bank balance

    // P&L (flow during year)
    cells[`${col}48`] = flowFormula(1, 'balance', yr, true); // OPINC (income)
    cells[`${col}49`] = flowFormula(2, 'balance', yr, true); // OIN (income_other)
    cells[`${col}26`] = flowFormula(3, 'balance', yr, false); // COS (expense_direct_cost)
    cells[`${col}28`] = flowFormula(4, 'balance', yr, false); // EXP (expense)
    cells[`${col}64`] = flowFormula(5, 'balance', yr, false); // DEP (expense_depreciation)

    // Balance Sheet (cumulative up to end of year)
    cells[`${col}31`] = cumFormula(8, yr, false); // Receivables (DEB)
    cells[`${col}32`] = cumFormula(9, yr, true); // Payables (CRE)
    cells[`${col}52`] = cumFormula(6, yr, false); // BA (asset_cash)
    cells[`${col}53`] = `=${col}31`; // REC (asset_receivable)
    cells[`${col}54`] = cumFormula(10, yr, false); // CAS (asset_current)
    cells[`${col}55`] = cumFormula(11, yr, false); // PRE (asset_prepayments)
    cells[`${col}56`] = cumFormula(12, yr, false); // FA (asset_fixed)
    cells[`${col}57`] = cumFormula(13, yr, false); // PNCA (asset_non_current)
    cells[`${col}61`] = cumSum2Formula(14, 7, yr, true); // CL1 (liability_current + CC)
    cells[`${col}62`] = `=${col}32`; // CL2 (liability_payable)
    cells[`${col}63`] = cumFormula(15, yr, true); // NL (liability_non_current)
    cells[`${col}65`] = cumFormula(7, yr, true); // CC (liability_credit_card)
    cells[`${col}67`] = cumFormula(16, yr, true); // EQ1 (equity)
    cells[`${col}70`] = `=${col}29`; // CURR_YEAR_EARNINGS_PNL = Net profit of that year
    cells[`${col}71`] = flowFormula(17, 'balance', yr, true); // CURR_YEAR_EARNINGS_ALLOC (movement in year)
    cells[`${col}73`] = `=${col}67`; // RETAINED_EARNINGS (equity)
    cells[`${col}74`] = cumFormula(17, yr, true); // CY_EARN (cumulative unaffected earnings)
  }

  // E72: prior years earnings before E$9 (cumulative P&L + unaffected earnings up to F$9)
  cells.E72 = `=0-(${cumulativeExpr(1, 'F$9')}+${cumulativeExpr(2, 'F$9')}+${cumulativeExpr(3, 'F$9')}+${cumulativeExpr(4, 'F$9')}+${cumulativeExpr(5, 'F$9')}+${cumulativeExpr(17, 'F$9')})`;

  // Remove obsolete ODOO.ACCOUNT.GROUP references in column G (replace with descriptive labels)
  cells.G9 = '=_t("Source")';
  const gLabels = {
    G11: 'Pivot 6+7 (asset_cash + CC debit)',
    G12: 'Pivot 6+7 (asset_cash + CC credit)',
    G14: 'Pivot 6+7 (asset_cash + CC cum)',
    G26: 'Pivot 3 (COGS excl. IC->KSS)',
    G28: 'Pivot 4 (expense)',
    G31: 'Pivot 8 (receivable excl. KSS->IC)',
    G32: 'Pivot 9 (payable excl. IC->KSS)',
    G48: 'Pivot 1 (income excl. KSS->IC)',
    G49: 'Pivot 2 (income_other excl. KSS->IC)',
    G52: 'Pivot 6 (asset_cash cum)',
    G53: 'Pivot 8 (receivable cum)',
    G54: 'Pivot 10 (asset_current cum)',
    G55: 'Pivot 11 (asset_prepayments cum)',
    G56: 'Pivot 12 (asset_fixed cum)',
    G57: 'Pivot 13 (asset_non_current cum)',
    G61: 'Pivot 14+7 (liability_current + CC cum)',
    G62: 'Pivot 9 (payable cum)',
    G63: 'Pivot 15 (liability_non_current cum)',
    G64: 'Pivot 5 (depreciation)',
    G65: 'Pivot 7 (credit_card cum)',
    G67: 'Pivot 16 (equity cum)',
    G70: 'Derived (=Net Profit)',
    G71: 'Pivot 17 (equity_unaffected flow)',
    G72: 'Cumulative prior P&L + unaffected',
    G73: 'Pivot 16 (equity cum)',
  };
  for (const [ref, label] of Object.entries(gLabels)) {
    cells[ref] = label;
  }

  // Apply IDR currency format on Data sheet monetary cells so FORMAT.LARGE.NUMBER(B2..B7) preserves "Rp"
  dataSheet.formats = dataSheet.formats || {};
  const dataMonetaryRanges = [
    'B2:B7',
    'C11:E14',
    'C23:E23',
    'C25:E29',
    'C31:E33',
    'C38:E38',
    'C45:E45',
    'C48:E74',
  ];
  for (const rng of dataMonetaryRanges) {
    dataSheet.formats[rng] = CURRENCY_FMT_ID;
  }

  // Ensure revisionId is fresh
  data.revisionId = 'START_REVISION';

  // Ensure global filter exists as expected
  if (Array.isArray(data.globalFilters)) {
    const yf = data.globalFilters.find((g) => g.id === YEAR_FILTER_ID_ACCOUNTING);
    if (yf) yf.defaultValue = 'this_year';
  }

  return data;
}

function buildInvoicingConsolidatedJson(srcJson, tagId) {
  const data = JSON.parse(JSON.stringify(srcJson));
  const exclKssToIc = buildExclKssToIcDomain(tagId);
  const exclIcToKss = buildExclIcToKssDomain();

  // Add IDR currency format for DSO / KPI monetary cells
  data.formats = data.formats || {};
  const CURRENCY_FMT_ID = 2;
  data.formats[String(CURRENCY_FMT_ID)] = '[$Rp]#,##0.00';

  // 1. Patch all existing account.invoice.report pivots (1..7)
  for (const pivot of Object.values(data.pivots || {})) {
    if (pivot.model === 'account.invoice.report' || pivot.model === 'account.move') {
      pivot.domain = andDomains(pivot.domain || [], exclKssToIc);
    }
  }

  // 2. Patch all lists (account.move)
  for (const list of Object.values(data.lists || {})) {
    if (list.model === 'account.move' || list.model === 'account.invoice.report') {
      list.domain = andDomains(list.domain || [], exclKssToIc);
    }
  }

  // 3. Patch Odoo charts & clickable links on Dashboard sheet
  const dashSheet = data.sheets.find((s) => s.name === 'Dashboard') || data.sheets[0];
  const dataSheet = data.sheets.find((s) => s.name === 'Data') || data.sheets[1];

  for (const fig of dashSheet.figures || []) {
    if (fig.data?.metaData?.resModel === 'account.invoice.report' && Array.isArray(fig.data?.searchParams?.domain)) {
      fig.data.searchParams.domain = andDomains(fig.data.searchParams.domain, exclKssToIc);
    }
  }
  for (const [ref, val] of Object.entries(dashSheet.cells || {})) {
    if (typeof val === 'string' && val.includes('odoo://view/')) {
      dashSheet.cells[ref] = patchOdooViewLink(val, exclKssToIc);
    }
  }

  // 4. Replace ODOO.BALANCE in Data!B5:B7 (KPI - DSO) with multi-company account.move.line pivots
  const nextId = Number(data.pivotNextId || 8);
  const pRecId = nextId;
  const pIncId = nextId + 1;
  const pCogsId = nextId + 2;

  data.pivots[String(pRecId)] = makeAmlPivot({
    id: pRecId,
    name: 'KPI - DSO Receivable (Consolidated)',
    accountType: 'asset_receivable',
    extraDomain: exclKssToIc,
  });
  data.pivots[String(pIncId)] = makeAmlPivot({
    id: pIncId,
    name: 'KPI - DSO Income (Consolidated)',
    accountType: 'income',
    extraDomain: exclKssToIc,
  });
  data.pivots[String(pCogsId)] = makeAmlPivot({
    id: pCogsId,
    name: 'KPI - DSO COGS (Consolidated)',
    accountType: 'expense_direct_cost',
    extraDomain: exclIcToKss,
  });
  data.pivotNextId = nextId + 3;

  dataSheet.cells.B5 = cumFormula(pRecId, '$B$4', false);
  dataSheet.cells.B6 = flowFormula(pIncId, 'balance', '$B$4', true);
  dataSheet.cells.B7 = flowFormula(pCogsId, 'balance', '$B$4', false);
  dataSheet.formats = dataSheet.formats || {};
  dataSheet.formats['B5:B8'] = CURRENCY_FMT_ID;

  data.revisionId = 'START_REVISION';
  return data;
}

async function upsertDashboard({ name, sequence, groupIds, fileName, spreadsheetData }) {
  const existing = await adminOdooClient._callObject('spreadsheet.dashboard', 'search_read', [
    [['name', '=', name], ['dashboard_group_id', '=', FINANCE_GROUP_ID]],
  ], { fields: ['id', 'name', 'is_from_data'] });

  const jsonStr = JSON.stringify(spreadsheetData);
  const b64 = Buffer.from(jsonStr, 'utf8').toString('base64');

  if (existing.length > 0) {
    const rec = existing[0];
    if (rec.is_from_data) {
      throw new Error(`Refusing to overwrite built-in data dashboard ID ${rec.id} (${rec.name})`);
    }
    if (DRY_RUN) {
      console.log(`[DRY-RUN] Would update dashboard ID ${rec.id} (${name}), JSON size=${jsonStr.length} bytes`);
      return rec.id;
    }
    await adminOdooClient._callObject('spreadsheet.dashboard', 'write', [
      [rec.id],
      {
        sequence,
        is_published: true,
        company_ids: [[5, 0, 0]],
        group_ids: [[6, 0, groupIds]],
        spreadsheet_file_name: fileName,
        spreadsheet_binary_data: b64,
      },
    ]);
    console.log(`Updated dashboard ID ${rec.id}: "${name}" (${jsonStr.length} bytes)`);
    return rec.id;
  }

  if (DRY_RUN) {
    console.log(`[DRY-RUN] Would create dashboard "${name}" (sequence=${sequence}, groupIds=${JSON.stringify(groupIds)}, JSON size=${jsonStr.length} bytes)`);
    return null;
  }

  const createdId = await adminOdooClient._callObject('spreadsheet.dashboard', 'create', [{
    name,
    dashboard_group_id: FINANCE_GROUP_ID,
    sequence,
    is_published: true,
    company_ids: [[5, 0, 0]],
    group_ids: [[6, 0, groupIds]],
    spreadsheet_file_name: fileName,
    spreadsheet_binary_data: b64,
  }]);
  console.log(`Created dashboard ID ${createdId}: "${name}" (${jsonStr.length} bytes)`);
  return createdId;
}

async function main() {
  console.log(`=== Setup Consolidated Finance Dashboards (${DRY_RUN ? 'DRY-RUN' : 'LIVE'}) ===`);
  await adminOdooClient.authenticate();

  // 1. Discover all companies & identify non-KSS company partners
  const companies = await adminOdooClient._callObject('res.company', 'search_read', [[]], {
    fields: ['id', 'name', 'partner_id'],
  });
  const icCompanies = companies.filter((c) => c.id !== KSS_COMPANY_ID);
  const icPartnerIds = icCompanies.map((c) => c.partner_id[0]);
  console.log(`Found ${companies.length} companies; ${icCompanies.length} non-KSS intercompany partners:`);
  for (const c of icCompanies) {
    console.log(`  - Company #${c.id} "${c.name}" -> Partner #${c.partner_id[0]}`);
  }

  // 2. Find or create "Intercompany" Contact Tag (res.partner.category)
  const existingTags = await adminOdooClient._callObject('res.partner.category', 'search_read', [
    [['name', '=', INTERCOMPANY_TAG_NAME]],
  ], { fields: ['id', 'name', 'color'] });

  let tagId;
  if (existingTags.length > 0) {
    tagId = existingTags[0].id;
    console.log(`Reusing existing res.partner.category ID ${tagId}: "${INTERCOMPANY_TAG_NAME}"`);
  } else if (DRY_RUN) {
    tagId = 999999; // placeholder for dry-run preview
    console.log(`[DRY-RUN] Would create res.partner.category "${INTERCOMPANY_TAG_NAME}" (color=${INTERCOMPANY_TAG_COLOR})`);
  } else {
    tagId = await adminOdooClient._callObject('res.partner.category', 'create', [{
      name: INTERCOMPANY_TAG_NAME,
      color: INTERCOMPANY_TAG_COLOR,
    }]);
    console.log(`Created res.partner.category ID ${tagId}: "${INTERCOMPANY_TAG_NAME}"`);
  }

  // 3. Assign Intercompany tag to the 9 non-KSS company partners (non-destructively via [4, tagId])
  const partnersBefore = await adminOdooClient._callObject('res.partner', 'read', [
    icPartnerIds,
    ['id', 'name', 'category_id'],
  ]);
  const partnersToTag = partnersBefore.filter((p) => !(p.category_id || []).includes(tagId));
  if (partnersToTag.length === 0) {
    console.log('All intercompany partners already have the Intercompany tag.');
  } else if (DRY_RUN) {
    console.log(`[DRY-RUN] Would add tag "${INTERCOMPANY_TAG_NAME}" to ${partnersToTag.length} partners: ${partnersToTag.map((p) => `${p.id}:${p.name}`).join(', ')}`);
  } else {
    await adminOdooClient._callObject('res.partner', 'write', [
      partnersToTag.map((p) => p.id),
      { category_id: [[4, tagId, 0]] },
    ]);
    console.log(`Tagged ${partnersToTag.length} intercompany partners with tag ID ${tagId}.`);
  }

  // 4. Read source built-in dashboards (read-only; NEVER modified)
  const [srcAccounting, srcInvoicing] = await adminOdooClient._callObject('spreadsheet.dashboard', 'read', [
    [DASHBOARD_ACCOUNTING_SRC_ID, DASHBOARD_INVOICING_SRC_ID],
    ['id', 'name', 'group_ids', 'spreadsheet_data'],
  ]);
  const accSrcJson = JSON.parse(srcAccounting.spreadsheet_data);
  const invSrcJson = JSON.parse(srcInvoicing.spreadsheet_data);

  // 5. Build consolidated JSON definitions
  const accNewJson = buildAccountingConsolidatedJson(accSrcJson, tagId);
  const invNewJson = buildInvoicingConsolidatedJson(invSrcJson, tagId);

  // 6. Upsert both new dashboards in FINANCE group
  const accNewId = await upsertDashboard({
    name: DASHBOARD_ACCOUNTING_NEW_NAME,
    sequence: 15,
    groupIds: srcAccounting.group_ids || [22, 23],
    fileName: 'accounting_consolidated.osheet.json',
    spreadsheetData: accNewJson,
  });

  const invNewId = await upsertDashboard({
    name: DASHBOARD_INVOICING_NEW_NAME,
    sequence: 25,
    groupIds: srcInvoicing.group_ids || [22, 23],
    fileName: 'invoicing_consolidated.osheet.json',
    spreadsheetData: invNewJson,
  });

  console.log('\n=== SUMMARY ===');
  console.log(JSON.stringify({
    dryRun: DRY_RUN,
    intercompanyTagId: tagId,
    taggedPartnerIds: icPartnerIds,
    accountingConsolidatedId: accNewId,
    invoicingConsolidatedId: invNewId,
    untouchedBuiltInIds: [DASHBOARD_ACCOUNTING_SRC_ID, DASHBOARD_INVOICING_SRC_ID],
  }, null, 2));
}

main().catch((err) => {
  console.error('Setup consolidated finance dashboards failed:', err);
  process.exit(1);
});
