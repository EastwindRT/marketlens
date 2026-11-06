// Rule-based noise filter and provisional priority for filings. Pure functions,
// no I/O and no API keys. Used on its own when no Jev key is configured
// (FILING_TRIAGE_MODE=rules) and as a free pre-filter ahead of Jev (hybrid).
// It only handles what rules can know from form type, filer, item codes and
// transaction amounts; Jev reads the filing text for the nuance.

const { tierForPriority } = require('./filingTriage.cjs');

// Passive index/asset managers: their 13G filings are almost always mechanical
// threshold crossings, not conviction.
const PASSIVE_GIANTS = [
  /blackrock/i, /vanguard/i, /state street/i, /geode/i, /fmr\b|fidelity/i, /invesco/i, /t\.? rowe price/i,
  /dimensional fund/i, /northern trust/i, /norges/i, /charles schwab/i, /capital (world|research|international)/i,
  /wellington management/i, /morgan stanley/i, /goldman sachs (asset|group)/i, /jpmorgan/i, /ubs (asset|group)/i,
];

function isPassiveGiant(filerName) {
  return PASSIVE_GIANTS.some((re) => re.test(String(filerName || '')));
}

function result(priority, reason) {
  const p = Math.max(0, Math.min(100, Math.round(priority)));
  return { priority: p, priorityTier: tierForPriority(p), reason };
}

// 13D / 13G
function rulesOwnership({ formType, filerName }) {
  const form = String(formType || '').toUpperCase();
  const amendment = form.includes('/A');
  const giant = isPassiveGiant(filerName);
  if (form.includes('13D')) {
    return amendment
      ? result(55, 'Schedule 13D amendment: the holder\'s plans or stake changed')
      : result(70, 'New Schedule 13D: a holder above 5% that may seek influence');
  }
  if (giant) return result(5, 'Routine 13G from a large passive manager');
  return amendment
    ? result(12, 'Passive 13G amendment')
    : result(25, 'New passive 13G: a holder above 5%');
}

// Form 4. Inputs come from the parsed transactions (server.cjs).
function rulesInsider({ buyValue = 0, sellValue = 0, clusterBuy = false, isExecutive = false }) {
  if (clusterBuy) return result(isExecutive ? 80 : 75, 'Cluster buying: several insiders bought in the same window');
  if (buyValue > 0) {
    let p = buyValue >= 250_000 ? 65 : buyValue >= 100_000 ? 55 : buyValue >= 25_000 ? 35 : 20;
    if (isExecutive && buyValue >= 25_000) p += 10;
    return result(p, `Open-market purchase of about $${Math.round(buyValue).toLocaleString('en-US')}${isExecutive ? ' by an executive' : ''}`);
  }
  if (sellValue >= 10_000_000) return result(40, `Large open-market sale of about $${Math.round(sellValue / 1e6)}M`);
  if (sellValue >= 2_000_000) return result(30, `Open-market sale of about $${(sellValue / 1e6).toFixed(1)}M`);
  if (sellValue >= 500_000) return result(15, 'Moderate open-market sale');
  return result(5, 'Small open-market sale');
}

// 8-K item codes. Highest-weight item present sets the priority.
const EIGHT_K_WEIGHTS = {
  '1.03': [85, 'Bankruptcy or receivership'],
  '2.04': [80, 'Debt acceleration or covenant trigger'],
  '3.01': [80, 'Delisting or listing-rule notice'],
  '4.02': [85, 'Restatement: prior financials should not be relied on'],
  '1.05': [75, 'Material cybersecurity incident'],
  '5.01': [75, 'Change in control'],
  '1.01': [55, 'Material agreement signed'],
  '2.01': [55, 'Acquisition or disposition completed'],
  '1.02': [45, 'Material agreement terminated'],
  '2.05': [45, 'Restructuring or exit costs'],
  '2.06': [45, 'Material impairment'],
  '3.02': [40, 'Unregistered equity sale (dilution)'],
  '4.01': [40, 'Auditor change'],
  '5.02': [40, 'Director or officer change'],
  '2.03': [35, 'New financial obligation'],
  '2.02': [35, 'Earnings release'],
  '8.01': [25, 'Other event'],
  '5.03': [15, 'Bylaw or charter amendment'],
  '5.07': [3, 'Shareholder vote results'],
  '7.01': [3, 'Reg FD disclosure'],
  '9.01': [3, 'Exhibits only'],
};

function extractEightKItems(text) {
  const found = new Set();
  for (const m of String(text || '').matchAll(/\bItem\s+(\d\.\d{2})\b/gi)) found.add(m[1]);
  return [...found];
}

function rulesEvent({ itemCodes = [] }) {
  const known = itemCodes.filter((c) => EIGHT_K_WEIGHTS[c]);
  if (!known.length) return result(20, 'Unclassified 8-K (no recognised item codes)');
  const best = known.reduce((a, b) => (EIGHT_K_WEIGHTS[b][0] > EIGHT_K_WEIGHTS[a][0] ? b : a));
  const [priority, label] = EIGHT_K_WEIGHTS[best];
  return result(priority, `Item ${best}: ${label}`);
}

// Form 144: notice that an insider or affiliate intends to sell. Weak, early bearish signal that arrives before the Form 4.
function rulesSaleNotice({ value = 0, pctOutstanding = 0, relationship = '', plan = false, soldPast3Months = 0 }) {
  let p = value >= 50e6 ? 55 : value >= 10e6 ? 45 : value >= 2e6 ? 35 : value >= 500e3 ? 22 : 8;
  const parts = [`planned sale of about ${money(value)}`];
  if (pctOutstanding >= 1) { p += 8; parts.push(`${pctOutstanding.toFixed(1)}% of shares outstanding`); }
  else if (pctOutstanding >= 0.2) parts.push(`${pctOutstanding.toFixed(2)}% of shares outstanding`);
  if (/officer|director|chief|ceo|cfo|president/i.test(relationship) && value >= 2e6) { p += 5; parts.push('by an officer or director'); }
  else if (relationship) parts.push(`by ${/^[aeiou]/i.test(relationship) ? 'an' : 'a'} ${relationship.toLowerCase()}`);
  if (soldPast3Months >= value && soldPast3Months > 0) { p += 5; parts.push(`after ${money(soldPast3Months)} already sold in 3 months`); }
  if (plan) { p -= 10; parts.push('under a 10b5-1 plan'); }
  return result(p, `Form 144: ${parts.join(', ')}`);
}

// NT 10-K / NT 10-Q: the company says it cannot file its report on time.
function rulesLateFiling({ formType = '' }) {
  const annual = /NT 10-K/i.test(formType);
  return result(annual ? 60 : 55, `Late filing notice (${String(formType).toUpperCase()}): the company says it cannot file its ${annual ? 'annual' : 'quarterly'} report on time`);
}

// Tender offers and going-private transactions, keyed by form type.
function rulesTakeover({ formType = '' }) {
  const f = String(formType).toUpperCase();
  const amendment = f.includes('/A');
  if (f.startsWith('SC TO-T')) return result(amendment ? 50 : 85, `${amendment ? 'Amended' : 'New'} third-party tender offer for the company (often at a premium)`);
  if (f.startsWith('SC 13E3')) return result(amendment ? 55 : 80, `${amendment ? 'Amended' : 'New'} going-private transaction filing`);
  if (f.startsWith('SC 14D9')) return result(amendment ? 45 : 70, `${amendment ? 'Amended' : 'New'} board response to a tender offer`);
  if (f.startsWith('SC TO-I')) return result(amendment ? 30 : 45, `${amendment ? 'Amended' : 'New'} issuer tender offer (a buyback)`);
  return result(35, `Tender offer filing (${f})`);
}

// Contested proxies and dissident solicitations, keyed by form type.
function rulesProxyFight({ formType = '' }) {
  const f = String(formType).toUpperCase();
  if (f.startsWith('DFAN14A')) return result(60, 'Dissident soliciting material: an activist is campaigning against the board');
  if (f.startsWith('DEFC14A')) return result(70, 'Definitive proxy statement from a dissident: a contested election is under way');
  if (f.startsWith('PREC14A')) return result(65, 'Preliminary proxy statement from a dissident: a contested election is being set up');
  return result(40, `Proxy contest filing (${f})`);
}

// Canadian insider trades from SEDI (CAD amounts), same shape as the US Form 4 rules.
function rulesCaInsider(input) {
  const r = rulesInsider(input);
  return { ...r, reason: `${r.reason} (CAD, SEDI)` };
}

function money(value) {
  const v = Number(value) || 0;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}K`;
  return `$${Math.round(v)}`;
}

function rulesPriority(typeKey, input) {
  if (typeKey === 'sale_notice') return rulesSaleNotice(input);
  if (typeKey === 'late_filing') return rulesLateFiling(input);
  if (typeKey === 'takeover') return rulesTakeover(input);
  if (typeKey === 'proxy_fight') return rulesProxyFight(input);
  if (typeKey === 'ca_insider') return rulesCaInsider(input);
  if (typeKey === 'ownership') return rulesOwnership(input);
  if (typeKey === 'insider') return rulesInsider(input);
  if (typeKey === 'event') return rulesEvent(input);
  throw new Error(`Unknown filing type: ${typeKey}`);
}

module.exports = { rulesPriority, rulesOwnership, rulesInsider, rulesEvent, extractEightKItems, isPassiveGiant };
