// Filing triage definitions: per-filing-type Jev questions, answer mapping,
// priority scoring and LLM-escalation rules. Pure functions only (no I/O) so
// they can be unit-tested without the server. server.cjs owns fetching,
// persistence and provider calls.

const PRIORITY_TIERS = [
  { min: 75, tier: 'critical' },
  { min: 50, tier: 'high' },
  { min: 25, tier: 'medium' },
  { min: 0, tier: 'low' },
];

function tierForPriority(priority) {
  return PRIORITY_TIERS.find((t) => priority >= t.min).tier;
}

// Unified 0-100 priority from Jev's 0-3 materiality score, dampened by its
// confidence. `floor` lets type-specific red flags (activist intent, going
// concern, cluster buys) guarantee a minimum priority regardless of the score.
function computePriority({ materialityScore, materialityConfidence, floor = 0 }) {
  if (materialityScore == null || Number.isNaN(Number(materialityScore))) return Math.round(floor);
  const base = (Math.min(3, Math.max(0, Number(materialityScore))) / 3) * 100;
  const conf = materialityConfidence == null ? 0.5 : Math.min(1, Math.max(0, Number(materialityConfidence)));
  return Math.round(Math.max(base * (0.6 + 0.4 * conf), floor));
}

const MATERIALITY_QUESTION = (subject) => ({
  type: 'score',
  instructions: `How significant is this ${subject} for a trader deciding whether to look at it right now?`,
  criteria: [
    'Routine - no market-moving content, safe to skip',
    'Notable - worth a line in a feed but not urgent',
    'Significant - should be reviewed promptly, plausible near-term catalyst',
    'Highly significant - clear, immediate catalyst or risk',
  ],
});

// ── 13D / 13G ownership ──────────────────────────────────────────────────────
const ownership = {
  key: 'ownership',
  label: '13D/13G',
  questions: {
    investor_type: {
      type: 'choice',
      instructions: 'What kind of investor filed this SEC beneficial-ownership disclosure?',
      criteria: {
        activist: 'Investor is known for, or is signaling, intent to influence company strategy, board composition, or capital allocation',
        passive_index: 'A passive institutional holder (index fund, asset manager) crossing a reporting threshold with no signaled intent to act',
        strategic_acquirer: 'A corporate or strategic buyer building a stake, potentially toward an acquisition or commercial relationship',
        other: 'Does not clearly fit the above - e.g. insider/founder consolidation, estate or trust transfer, unclear intent',
      },
    },
    board_or_strategic_intent: {
      type: 'noul',
      instructions: 'Item 4 (Purpose of Transaction) of this filing discloses intent to seek board representation, propose a merger, sale, or other strategic alternative, or otherwise actively influence the company.',
    },
    new_position: {
      type: 'noul',
      instructions: 'This filing represents a brand-new beneficial ownership position rather than a routine periodic update to a stake the filer already disclosed before.',
    },
    mechanical_crossing: {
      type: 'noul',
      instructions: 'This filing looks like a routine passive threshold crossing by an index fund or large asset manager (e.g. BlackRock, Vanguard, State Street, Geode) with no indication of active intent.',
    },
    materiality: MATERIALITY_QUESTION('beneficial-ownership filing'),
  },
  extract(answers) {
    const a = answers || {};
    const intent = a.board_or_strategic_intent?.noul ?? null;
    return {
      materialityScore: a.materiality?.score ?? null,
      materialityConfidence: a.materiality?.confidence ?? null,
      floor: intent != null && intent >= 0.7 ? 85 : 0,
      fields: {
        investor_type: a.investor_type?.choice ?? null,
        investor_type_confidence: a.investor_type?.confidence ?? null,
        board_or_strategic_intent: intent,
        new_position: a.new_position?.noul ?? null,
        mechanical_crossing: a.mechanical_crossing?.noul ?? null,
      },
    };
  },
  shouldEscalate(sig) {
    if (sig.materialityScore == null) return false;
    if (sig.materialityScore >= 2 && (sig.materialityConfidence ?? 0) >= 0.6) return true;
    return (sig.fields.board_or_strategic_intent ?? 0) >= 0.7;
  },
  thesisPrompt: null, // server.cjs supplies QUANT_PROMPT
};

// ── Form 4 insider trades ────────────────────────────────────────────────────
const insider = {
  key: 'insider',
  label: 'Form 4',
  questions: {
    insider_role: {
      type: 'choice',
      instructions: 'What is the reporting insider\'s relationship to the issuer?',
      criteria: {
        executive: 'CEO, CFO, COO, president, or another named executive officer',
        director: 'Member of the board of directors who is not an executive officer',
        ten_percent_owner: 'A holder of more than 10% of the issuer\'s stock',
        other: 'Other officer, affiliate, or unclear relationship',
      },
    },
    discretionary_open_market: {
      type: 'noul',
      instructions: 'The reported transactions are discretionary open-market purchases or sales (transaction code P or S) rather than option exercises, tax withholding, gifts, grants, or other mechanical events.',
    },
    pre_arranged_plan: {
      type: 'noul',
      instructions: 'The transactions were made under a pre-arranged Rule 10b5-1 trading plan or are otherwise routine scheduled selling.',
    },
    conviction_buy: {
      type: 'noul',
      instructions: 'This filing shows an insider buying shares with their own money in a size that signals genuine conviction about the company\'s prospects.',
    },
    materiality: MATERIALITY_QUESTION('insider transaction report'),
  },
  extract(answers, context = {}) {
    const a = answers || {};
    const conviction = a.conviction_buy?.noul ?? null;
    // Cluster buying (3+ distinct insiders, computed by the server) is a classic
    // signal that a single filing's text cannot reveal on its own.
    let floor = 0;
    if (context.clusterBuy) floor = 70;
    else if (conviction != null && conviction >= 0.8 && (context.totalValue ?? 0) >= 100000) floor = 60;
    return {
      materialityScore: a.materiality?.score ?? null,
      materialityConfidence: a.materiality?.confidence ?? null,
      floor,
      fields: {
        insider_role: a.insider_role?.choice ?? null,
        insider_role_confidence: a.insider_role?.confidence ?? null,
        discretionary_open_market: a.discretionary_open_market?.noul ?? null,
        pre_arranged_plan: a.pre_arranged_plan?.noul ?? null,
        conviction_buy: conviction,
        cluster_buy: Boolean(context.clusterBuy),
        total_value: context.totalValue ?? null,
      },
    };
  },
  shouldEscalate(sig) {
    if (sig.fields.cluster_buy) return true;
    if (sig.materialityScore == null) return false;
    return sig.materialityScore >= 2 && (sig.materialityConfidence ?? 0) >= 0.6;
  },
  thesisPrompt: `You are a senior equity analyst reviewing a SEC Form 4 insider transaction report. Return ONLY valid JSON with keys:
"headline" (one sentence), "signal" ("bullish" | "bearish" | "neutral"), "conviction" (1-10),
"why_it_matters" (2-3 sentences), "context_flags" (array of short strings: e.g. "10b5-1 plan", "cluster buying", "first purchase in years"),
"what_to_check_next" (array of up to 3 short strings). Separate facts from inference. Do not give investment advice.`,
};

// ── 8-K current reports ──────────────────────────────────────────────────────
const event = {
  key: 'event',
  label: '8-K',
  questions: {
    event_category: {
      type: 'choice',
      instructions: 'Which best describes the main event reported in this Form 8-K?',
      criteria: {
        earnings: 'Quarterly or annual results announcement (Item 2.02)',
        mna: 'Merger, acquisition, divestiture, tender offer, or strategic transaction',
        leadership_change: 'Departure, appointment, or compensation change of a director or senior executive',
        financing: 'Debt or equity offering, credit facility, or material change to capital structure',
        guidance_or_warning: 'Guidance change, preliminary results, or an operating or liquidity warning',
        regulatory_legal: 'Regulatory action, litigation, investigation, or material legal development',
        distress: 'Bankruptcy, default, delisting notice, going-concern doubt, or non-reliance on prior financials',
        material_agreement: 'Entry into or termination of a material contract or partnership',
        routine: 'Administrative item, exhibit-only filing, Reg FD boilerplate, annual meeting results, or other routine disclosure',
      },
    },
    adverse_surprise: {
      type: 'noul',
      instructions: 'This filing discloses news likely to be negative for shareholders and not already expected, such as a restatement, unexpected executive exit, going-concern doubt, default, or guidance cut.',
    },
    positive_catalyst: {
      type: 'noul',
      instructions: 'This filing discloses news likely to be a positive near-term catalyst for shareholders, such as an acquisition at a premium, a major contract win, or raised guidance.',
    },
    materiality: MATERIALITY_QUESTION('8-K current report'),
  },
  extract(answers) {
    const a = answers || {};
    const category = a.event_category?.choice ?? null;
    const adverse = a.adverse_surprise?.noul ?? null;
    let floor = 0;
    if (category === 'distress') floor = 80;
    else if (adverse != null && adverse >= 0.8) floor = 65;
    return {
      materialityScore: a.materiality?.score ?? null,
      materialityConfidence: a.materiality?.confidence ?? null,
      floor,
      fields: {
        event_category: category,
        event_category_confidence: a.event_category?.confidence ?? null,
        adverse_surprise: adverse,
        positive_catalyst: a.positive_catalyst?.noul ?? null,
      },
    };
  },
  shouldEscalate(sig) {
    if (sig.fields.event_category === 'routine') return false;
    if (sig.fields.event_category === 'distress') return true;
    if (sig.materialityScore == null) return false;
    return sig.materialityScore >= 2 && (sig.materialityConfidence ?? 0) >= 0.6;
  },
  thesisPrompt: `You are a senior equity analyst reviewing a SEC Form 8-K. Return ONLY valid JSON with keys:
"headline" (one sentence), "event_type" (short label), "direction" ("positive" | "negative" | "mixed" | "unclear"),
"impact_horizon" ("immediate" | "weeks" | "months" | "long_term"), "why_it_matters" (2-3 sentences),
"key_facts" (array of up to 4 short strings quoting concrete numbers or dates from the filing),
"risks_or_unknowns" (array of up to 3 short strings). Separate facts from inference. Do not give investment advice.`,
};

const FILING_TYPES = { ownership, insider, event };

// Run Jev's answers through a type definition and return the unified signal.
function buildSignal(typeKey, answers, context = {}) {
  const def = FILING_TYPES[typeKey];
  if (!def) throw new Error(`Unknown filing type: ${typeKey}`);
  const extracted = def.extract(answers, context);
  const priority = computePriority(extracted);
  return {
    filingType: typeKey,
    materialityScore: extracted.materialityScore,
    materialityConfidence: extracted.materialityConfidence,
    priority,
    priorityTier: tierForPriority(priority),
    fields: extracted.fields,
  };
}

module.exports = { FILING_TYPES, PRIORITY_TIERS, tierForPriority, computePriority, buildSignal };
