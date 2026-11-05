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

function rulesPriority(typeKey, input) {
  if (typeKey === 'ownership') return rulesOwnership(input);
  if (typeKey === 'insider') return rulesInsider(input);
  if (typeKey === 'event') return rulesEvent(input);
  throw new Error(`Unknown filing type: ${typeKey}`);
}

module.exports = { rulesPriority, rulesOwnership, rulesInsider, rulesEvent, extractEightKItems, isPassiveGiant };
