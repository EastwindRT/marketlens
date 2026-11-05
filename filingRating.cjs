// Directional signal for a triaged filing: which way the filing leans (bullish / bearish / neutral /
// mixed), how strongly, and what the rest of the ticker's recent filings add. Pure functions, no I/O,
// computed at read time from stored fields so it also works for rows scored before this existed.
//
// This is an automated reading of public filings, not investment advice. "priority" (filingTriage.cjs)
// answers "how important is this filing"; the signal answers "which way does it point and how hard".

const CONTEXT_WINDOW_DAYS = 30;

// 8-K item -> [direction, conviction 0-100, label]. Highest-conviction item present wins.
const EVENT_ITEMS = {
  '1.03': ['bearish', 90, 'Bankruptcy or receivership'],
  '4.02': ['bearish', 85, 'Restatement: prior financials unreliable'],
  '2.04': ['bearish', 80, 'Debt acceleration or covenant trigger'],
  '3.01': ['bearish', 70, 'Delisting or listing-rule notice'],
  '1.05': ['bearish', 60, 'Material cybersecurity incident'],
  '2.06': ['bearish', 50, 'Material impairment'],
  '2.05': ['bearish', 40, 'Restructuring or exit costs'],
  '1.02': ['bearish', 40, 'Material agreement terminated'],
  '3.02': ['bearish', 35, 'Unregistered equity sale (dilution)'],
  '5.01': ['mixed', 60, 'Change in control'],
  '2.01': ['mixed', 45, 'Acquisition or disposition completed'],
  '1.01': ['mixed', 40, 'Material agreement signed'],
  '5.02': ['mixed', 40, 'Director or officer change'],
  '4.01': ['neutral', 25, 'Auditor change'],
  '2.02': ['neutral', 30, 'Earnings release (direction depends on the numbers)'],
  '2.03': ['neutral', 25, 'New financial obligation'],
  '8.01': ['neutral', 15, 'Other event'],
  '5.03': ['neutral', 10, 'Bylaw or charter amendment'],
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function usd(value) {
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

function baseInsider(row) {
  const f = row.signals || {};
  const reason = String(f.rule_reason || '');
  const isBuy = /purchase|cluster buying/i.test(reason);
  const isSale = /\bsale\b/i.test(reason);
  const value = num(f.total_value) || 0;
  const exec = Boolean(f.is_executive) || f.insider_role === 'executive';
  const cluster = Boolean(f.cluster_buy);
  const plan = num(f.pre_arranged_plan) ?? 0;
  const reasons = [];

  if (isBuy || cluster) {
    let c = value >= 1e6 ? 85 : value >= 250e3 ? 70 : value >= 100e3 ? 60 : value >= 25e3 ? 45 : 30;
    reasons.push(`Open-market purchase${value ? ` of about ${usd(value)}` : ''} (conviction ${c})`);
    if (exec) { c += 10; reasons.push('Bought by an executive (+10)'); }
    if (cluster) { c = Math.max(c, 75); reasons.push('Several insiders bought in the same window (floor 75)'); }
    if ((num(f.conviction_buy) ?? 0) >= 0.8) { c += 5; reasons.push('Classifier sees genuine conviction (+5)'); }
    return { direction: 'bullish', conviction: Math.min(100, c), reasons, clustered: cluster };
  }
  if (isSale) {
    let c = value >= 10e6 ? 40 : value >= 2e6 ? 30 : value >= 500e3 ? 20 : 10;
    reasons.push(`Open-market sale${value ? ` of about ${usd(value)}` : ''} (conviction ${c}; insider sales are weak signals)`);
    if (plan >= 0.7) { c = Math.round(c / 2); reasons.push('Looks like a pre-arranged 10b5-1 plan (halved)'); }
    else if (exec) { c += 5; reasons.push('Sold by an executive (+5)'); }
    return { direction: 'bearish', conviction: Math.min(100, c), reasons };
  }
  return { direction: 'neutral', conviction: 5, reasons: ['No discretionary buy or sell detected'] };
}

function baseEvent(row) {
  const f = row.signals || {};
  const items = String(f.items || '').split(',').map((s) => s.trim()).filter(Boolean);
  let best = null;
  for (const code of items) {
    const e = EVENT_ITEMS[code];
    if (e && (!best || e[1] > best.conviction)) best = { code, direction: e[0], conviction: e[1], label: e[2] };
  }
  const reasons = [];
  let out = best || { direction: 'neutral', conviction: 10, label: 'No recognised item codes' };
  reasons.push(best ? `Item ${best.code}: ${out.label} (${out.direction}, conviction ${out.conviction})` : out.label);

  // A text-reading classifier refines the item-code guess when it ran.
  const adverse = num(f.adverse_surprise);
  const positive = num(f.positive_catalyst);
  if (f.event_category === 'distress') {
    out = { direction: 'bearish', conviction: Math.max(out.conviction, 85) };
    reasons.push('Classifier: distress event');
  } else if (adverse !== null && adverse >= 0.7 && (positive ?? 0) < 0.5) {
    out = { direction: 'bearish', conviction: Math.max(out.conviction, Math.round(55 + adverse * 25)) };
    reasons.push(`Classifier: adverse surprise (${Math.round(adverse * 100)}%)`);
  } else if (positive !== null && positive >= 0.7 && (adverse ?? 0) < 0.5) {
    out = { direction: 'bullish', conviction: Math.max(out.conviction, Math.round(45 + positive * 25)) };
    reasons.push(`Classifier: positive catalyst (${Math.round(positive * 100)}%)`);
  } else if (f.event_category === 'routine') {
    out = { direction: 'neutral', conviction: Math.min(out.conviction, 10) };
    reasons.push('Classifier: routine disclosure');
  }
  return { direction: out.direction, conviction: Math.min(100, out.conviction), reasons };
}

function baseOwnership(row) {
  const f = row.signals || {};
  const form = String(row.form_type || '').toUpperCase();
  const reasons = [];
  const intent = num(f.board_or_strategic_intent) ?? 0;
  const mechanical = num(f.mechanical_crossing) ?? 0;
  if (f.investor_type === 'activist' && intent >= 0.7) {
    reasons.push('Classifier: activist with board or strategic intent (conviction 85)');
    return { direction: 'bullish', conviction: 85, reasons };
  }
  if (f.investor_type === 'strategic_acquirer' && (num(f.new_position) ?? 0) >= 0.6) {
    reasons.push('Classifier: strategic buyer building a new stake (conviction 70)');
    return { direction: 'bullish', conviction: 70, reasons };
  }
  if (mechanical >= 0.7 || f.investor_type === 'passive_index') {
    reasons.push('Routine passive threshold crossing (conviction 5)');
    return { direction: 'neutral', conviction: 5, reasons };
  }
  if (form.includes('13D')) {
    return form.includes('/A')
      ? { direction: 'neutral', conviction: 40, reasons: ['13D amendment: the holder\'s plans or stake changed (conviction 40)'] }
      : { direction: 'bullish', conviction: 65, reasons: ['New 13D: a holder above 5% that may seek influence (conviction 65)'] };
  }
  return form.includes('/A')
    ? { direction: 'neutral', conviction: 10, reasons: ['Passive 13G amendment (conviction 10)'] }
    : { direction: 'bullish', conviction: 30, reasons: ['New passive 13G: a holder above 5% (conviction 30)'] };
}

function deriveBase(row) {
  if (row.filing_type === 'insider') return baseInsider(row);
  if (row.filing_type === 'event') return baseEvent(row);
  return baseOwnership(row);
}

function label(score, direction) {
  if (direction === 'mixed' && Math.abs(score) < 25) return 'Mixed';
  if (score >= 60) return 'Strong bullish';
  if (score >= 25) return 'Bullish';
  if (score > -25) return 'Neutral';
  if (score > -60) return 'Bearish';
  return 'Strong bearish';
}

// others = other filings on the same ticker in the last CONTEXT_WINDOW_DAYS (excluding this one).
function buildRating(row, others = []) {
  const base = deriveBase(row);
  const sign = base.direction === 'bullish' ? 1 : base.direction === 'bearish' ? -1 : 0;
  const reasons = [...base.reasons];
  const flags = [];
  let adjust = 0;

  if (sign !== 0 && others.length) {
    const derived = others.map((o) => ({ o, b: deriveBase(o) })).filter(({ b }) => b.conviction >= 30);
    const agree = derived.filter(({ b }) => b.direction === base.direction);
    const oppose = derived.filter(({ b }) => b.direction !== base.direction && b.direction !== 'neutral' && b.direction !== 'mixed');
    // A cluster-buy flag already encodes "several insiders bought", so counting those filings again would double count.
    if (agree.length && !base.clustered) {
      const bump = Math.min(16, agree.length * 8);
      adjust += bump;
      flags.push(`${agree.length} other ${base.direction} filing${agree.length > 1 ? 's' : ''} on this ticker in ${CONTEXT_WINDOW_DAYS} days`);
      reasons.push(`${agree.length} other ${base.direction} filing${agree.length > 1 ? 's' : ''} in ${CONTEXT_WINDOW_DAYS} days (+${bump})`);
    }
    if (oppose.length) {
      const cut = Math.min(20, oppose.length * 10);
      adjust -= cut;
      flags.push(`${oppose.length} conflicting filing${oppose.length > 1 ? 's' : ''} on this ticker in ${CONTEXT_WINDOW_DAYS} days`);
      reasons.push(`${oppose.length} conflicting ${oppose.length > 1 ? 'filings' : 'filing'} in ${CONTEXT_WINDOW_DAYS} days (-${cut})`);
    }
    const activist = others.find((o) => o.filing_type === 'ownership' && String(o.form_type).toUpperCase().includes('13D') && !String(o.form_type).includes('/A'));
    if (activist && base.direction === 'bullish') { adjust += 8; flags.push('New 13D filed recently'); reasons.push('A new 13D was filed recently (+8)'); }
    const distress = others.find((o) => o.filing_type === 'event' && deriveBase(o).direction === 'bearish' && deriveBase(o).conviction >= 70);
    if (distress && base.direction === 'bullish') { adjust -= 12; flags.push('Recent distress 8-K'); reasons.push('A distress 8-K is on file recently (-12)'); }
    if (distress && base.direction === 'bearish' && row.accession_no !== distress.accession_no) { adjust += 8; flags.push('Recent distress 8-K'); reasons.push('Another distress 8-K is on file (+8)'); }
  }

  const magnitude = Math.max(0, Math.min(100, base.conviction + adjust));
  const score = Math.round(sign * magnitude);
  return {
    score,
    label: label(score, base.direction),
    direction: base.direction,
    conviction: Math.round(magnitude),
    reasons,
    context_flags: flags,
  };
}

// rows: feed rows; history: recent filings for the same tickers (any superset of the rows is fine).
function attachRatings(rows, history = []) {
  const cutoff = Date.now() - CONTEXT_WINDOW_DAYS * 864e5;
  const bySymbol = new Map();
  for (const h of history) {
    if (!h.symbol) continue;
    const t = Date.parse(h.filed_date);
    if (Number.isFinite(t) && t < cutoff) continue;
    if (!bySymbol.has(h.symbol)) bySymbol.set(h.symbol, []);
    bySymbol.get(h.symbol).push(h);
  }
  return rows.map((row) => {
    const others = row.symbol ? (bySymbol.get(row.symbol) || []).filter((h) => h.accession_no !== row.accession_no) : [];
    return { ...row, rating: buildRating(row, others) };
  });
}

module.exports = { buildRating, attachRatings, deriveBase, CONTEXT_WINDOW_DAYS };
