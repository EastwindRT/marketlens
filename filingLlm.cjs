// LLM-backed classifier for filings, used when Jev is not available (e.g. free OpenRouter models).
// Pure functions only: builds the prompt from the same typed question sets Jev answers
// (filingTriage.cjs), parses the model's JSON, and normalizes it into Jev-shaped answers so
// buildSignal() needs no changes. Network calls live in server.cjs.

const MAX_STATE_CHARS = 30_000;

function describeQuestion(name, q) {
  if (q.type === 'noul') {
    return `- "${name}" (yes/no probability): ${q.instructions}\n  Answer: {"probability": <0 to 1>}`;
  }
  if (q.type === 'choice') {
    const options = Object.entries(q.criteria || {}).map(([key, desc]) => `    * ${key}: ${desc ?? ''}`).join('\n');
    return `- "${name}" (choose one): ${q.instructions}\n  Options:\n${options}\n  Answer: {"choice": "<one option key>", "confidence": <0 to 1>}`;
  }
  const levels = (q.criteria || []).map((label, i) => `    * ${i} = ${label}`).join('\n');
  return `- "${name}" (score): ${q.instructions}\n  Scale:\n${levels}\n  Answer: {"score": <number on the scale>, "confidence": <0 to 1>}`;
}

function buildMessages(def, stateText) {
  const questions = Object.entries(def.questions).map(([name, q]) => describeQuestion(name, q)).join('\n');
  const system = [
    'You triage SEC filings for a market-intelligence tool. Read the filing and answer the questions.',
    'Respond with ONE JSON object and nothing else (no markdown, no commentary).',
    'Be strict: most filings are routine. Only use high scores for clearly material, time-sensitive information.',
    'Base every answer only on the filing text. Do not give investment advice.',
  ].join(' ');
  const user = [
    `Filing type: ${def.label}`,
    '',
    'Questions:',
    questions,
    '',
    'Return JSON in exactly this shape:',
    '{"answers": { "<question name>": <answer object as specified above>, ... },',
    ' "read": {"headline": "<max 15 words>", "direction": "bullish|bearish|neutral|unclear",',
    '          "why_it_matters": "<max 2 sentences>", "key_facts": ["<up to 3 short facts with numbers or dates from the filing>"]}}',
    '',
    '--- FILING ---',
    String(stateText).slice(0, MAX_STATE_CHARS),
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

// Pull the first balanced JSON object out of a model reply (tolerates code fences and stray text).
function parseModelJson(text) {
  const raw = String(text || '').replace(/```json|```/gi, '').trim();
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('no JSON object in model reply');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error('unterminated JSON object in model reply');
}

function clamp01(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
}

const DIRECTION_TO_SIGNAL = { bullish: 'BULLISH', bearish: 'BEARISH', neutral: 'NEUTRAL', unclear: 'WATCH' };

// Returns { answers (Jev-shaped), thesis }. Throws if the materiality score is missing or invalid,
// since priority cannot be computed without it (callers fall back to the rule score).
function normalizeLlmReply(def, parsed) {
  const given = parsed?.answers || {};
  const answers = {};
  for (const [name, q] of Object.entries(def.questions)) {
    const a = given[name];
    if (a === undefined || a === null) continue;
    if (q.type === 'noul') {
      const p = clamp01(typeof a === 'object' ? a.probability ?? a.noul : a);
      if (p !== null) answers[name] = { type: 'noul', noul: p };
    } else if (q.type === 'choice') {
      const choice = String(typeof a === 'object' ? a.choice : a);
      if (Object.prototype.hasOwnProperty.call(q.criteria || {}, choice)) {
        answers[name] = { type: 'choice', choice, confidence: clamp01(a.confidence) ?? 0.5 };
      }
    } else {
      const max = (q.criteria || []).length - 1;
      const score = Number(typeof a === 'object' ? a.score : a);
      if (Number.isFinite(score)) {
        answers[name] = { type: 'score', score: Math.min(max, Math.max(0, score)), confidence: clamp01(a.confidence) ?? 0.5 };
      }
    }
  }
  if (!answers.materiality) throw new Error('model reply missing a valid materiality score');

  const read = parsed?.read || {};
  const direction = String(read.direction || '').toLowerCase();
  const thesis = {
    headline: typeof read.headline === 'string' ? read.headline.slice(0, 200) : undefined,
    direction: DIRECTION_TO_SIGNAL[direction] ? direction : 'unclear',
    why_it_matters: typeof read.why_it_matters === 'string' ? read.why_it_matters.slice(0, 600) : undefined,
    key_facts: Array.isArray(read.key_facts) ? read.key_facts.filter((f) => typeof f === 'string').slice(0, 3) : undefined,
    // Aliases the 13D/13G page already reads.
    signal: DIRECTION_TO_SIGNAL[direction] || 'WATCH',
    thesis: typeof read.why_it_matters === 'string' ? read.why_it_matters.slice(0, 600) : undefined,
  };
  return { answers, thesis };
}

// ── On-demand single-filing read (not part of automatic triage) ──────────────
const READ_SYSTEM_PROMPT = [
  'You are a senior equity analyst reading ONE SEC or SEDI filing for a trader.',
  'Respond with ONE JSON object and nothing else (no markdown, no commentary).',
  'Shape: {"headline": "<max 15 words>", "direction": "bullish|bearish|neutral|mixed|unclear",',
  '"why_it_matters": "<2-3 sentences>", "key_facts": ["<up to 5 short facts with numbers or dates taken from the filing>"],',
  '"risks_or_unknowns": ["<up to 3 short items>"], "what_to_check_next": ["<up to 3 short items>"]}.',
  'Base everything on the filing text provided. Separate facts from inference. Do not give investment advice.',
].join(' ');

function buildReadMessages(header, text) {
  return [
    { role: 'system', content: READ_SYSTEM_PROMPT },
    { role: 'user', content: `${header}\n\n--- FILING ---\n${String(text).slice(0, MAX_STATE_CHARS)}` },
  ];
}

function cleanList(value, max, maxLen) {
  return Array.isArray(value)
    ? value.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim().slice(0, maxLen)).slice(0, max)
    : undefined;
}

// Throws when the reply has neither a headline nor an explanation, so callers can try the next model.
function normalizeReadReply(parsed) {
  const headline = typeof parsed?.headline === 'string' ? parsed.headline.trim().slice(0, 200) : '';
  const why = typeof parsed?.why_it_matters === 'string' ? parsed.why_it_matters.trim().slice(0, 800) : '';
  if (!headline && !why) throw new Error('model reply has no headline or explanation');
  const direction = String(parsed?.direction || '').toLowerCase();
  const known = ['bullish', 'bearish', 'neutral', 'mixed', 'unclear'];
  const dir = known.includes(direction) ? direction : 'unclear';
  return {
    headline: headline || undefined,
    direction: dir,
    why_it_matters: why || undefined,
    key_facts: cleanList(parsed?.key_facts, 5, 240),
    risks_or_unknowns: cleanList(parsed?.risks_or_unknowns, 3, 240),
    what_to_check_next: cleanList(parsed?.what_to_check_next, 3, 240),
    // Aliases the 13D/13G page already reads.
    signal: DIRECTION_TO_SIGNAL[dir] || 'WATCH',
    thesis: why || undefined,
  };
}

module.exports = { buildMessages, parseModelJson, normalizeLlmReply, describeQuestion, buildReadMessages, normalizeReadReply };
