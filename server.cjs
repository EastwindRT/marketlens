const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Proxy: /api/tmx → app-money.tmx.com (SEDI insider data + TSX quotes)
app.use(
  '/api/tmx',
  createProxyMiddleware({
    target: 'https://app-money.tmx.com',
    changeOrigin: true,
    pathRewrite: { '^/api/tmx': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('Origin', 'https://money.tmx.com');
        proxyReq.setHeader('Referer', 'https://money.tmx.com/');
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      },
    },
  })
);

// Proxy: /api/yahoo → query1.finance.yahoo.com (OHLCV candles for .TO stocks)
app.use(
  '/api/yahoo',
  createProxyMiddleware({
    target: 'https://query1.finance.yahoo.com',
    changeOrigin: true,
    pathRewrite: { '^/api/yahoo': '' },
    on: {
      proxyReq: (proxyReq) => {
        proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36');
      },
    },
  })
);

// Proxy: /api/sec → www.sec.gov  (SEC EDGAR browse + Atom feeds)
// Proxy: /api/edgar → efts.sec.gov (SEC EDGAR full-text search API)
// User-Agent format required by SEC: "<Org> <contact-email>"
const SEC_UA = 'TARS admin@tars.app';

app.use('/api/sec', createProxyMiddleware({
  target: 'https://www.sec.gov',
  changeOrigin: true,
  pathRewrite: { '^/api/sec': '' },
  on: { proxyReq: (pr) => { pr.setHeader('User-Agent', SEC_UA); pr.setHeader('Accept', 'text/xml,application/xml,*/*'); } },
}));

app.use('/api/edgar', createProxyMiddleware({
  target: 'https://efts.sec.gov',
  changeOrigin: true,
  pathRewrite: { '^/api/edgar': '' },
  on: { proxyReq: (pr) => { pr.setHeader('User-Agent', SEC_UA); pr.setHeader('Accept', 'application/json'); } },
}));

// ── AI Filing Analysis ────────────────────────────────────────────────────
const https = require('https');

// ── Server-side data fetchers (avoid CORS / 403 from client) ─────────────

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
      }
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        resolve(body);
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// In-memory cache
let houseCache = null;
let houseLastFetch = 0;
const HOUSE_CACHE_TTL = 60 * 60 * 1000; // 1h

// Senate Stock Watcher GitHub — free, public, server-side accessible
// Data is organised by ticker: [{ticker, transactions:[{senator, type, amount, transaction_date, ...}]}]
const SENATE_ALL_URL = 'https://raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/master/aggregate/all_ticker_transactions.json';

async function fetchCongressData() {
  return httpsGet(SENATE_ALL_URL);
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/latest-congress', async (req, res) => {
  try {
    const now = Date.now();
    if (!houseCache || now - houseLastFetch > HOUSE_CACHE_TTL) {
      const raw = await fetchCongressData();
      const data = JSON.parse(raw);
      houseCache = Array.isArray(data) ? data : [];
      houseLastFetch = now;
    }

    const limit = Math.min(parseInt(req.query.limit || '60', 10), 200);

    // Flatten ticker-keyed senate data into a trades list
    const trades = [];
    for (const entry of houseCache) {
      const ticker = (entry.ticker || '').trim().toUpperCase();
      if (!ticker || ticker === 'N/A' || ticker === '--' || ticker.length > 8) continue;
      for (const t of (entry.transactions || [])) {
        const typeLower = (t.type || '').toLowerCase();
        if (!typeLower.includes('purchase') && !typeLower.includes('sale') && !typeLower.includes('sell') && !typeLower.includes('exchange')) continue;
        const txDate = normaliseDate(t.transaction_date || '');
        if (!txDate) continue;
        const member = (t.senator || '').replace(/^Sen\.\s*/i, '').trim();
        if (!member) continue;
        trades.push({
          member,
          party: '',   // senate source doesn't include party
          state: '',
          ticker,
          assetDescription: t.asset_description || '',
          type: typeLower.includes('purchase') ? 'purchase' : 'sale',
          amount: t.amount || '',
          amountMin: 0,
          transactionDate: txDate,
          disclosureDate: normaliseDate(t.disclosure_date || ''),
          filingUrl: t.ptr_link || t.link || '',
          chamber: 'senate',
        });
      }
    }

    trades.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
    res.json({ trades: trades.slice(0, limit) });
  } catch (err) {
    console.error('[latest-congress]', err.message);
    res.status(502).json({ error: err.message, trades: [] });
  }
});

function normaliseDate(d) {
  if (!d) return '';
  const s = String(d);
  // MM/DD/YYYY
  if (s.includes('/')) {
    const [m, dd, yyyy] = s.split('/');
    if (yyyy && yyyy.length === 4) return `${yyyy}-${m.padStart(2,'0')}-${dd.padStart(2,'0')}`;
  }
  return s.slice(0, 10);
}

// Latest insider filings via SEC EDGAR Form 4 atom feed (all companies, no Finnhub needed)
let insiderFeedCache = null;
let insiderFeedLastFetch = 0;
const INSIDER_FEED_TTL = 30 * 60 * 1000; // 30min

app.get('/api/latest-insiders', async (req, res) => {
  try {
    const now = Date.now();
    if (!insiderFeedCache || now - insiderFeedLastFetch > INSIDER_FEED_TTL) {
      const url = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&dateb=&owner=include&count=80&output=atom';
      const xml = await httpsGet(url, { 'User-Agent': 'TARS admin@tars.app', 'Accept': 'text/xml' });

      // Parse atom XML entries
      // EDGAR Form 4 feed has alternating entries: (Reporting) = person, (Issuer) = company
      // We pair them by accession number (same accession, consecutive entries)
      const rawEntries = [];
      const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
      let m;
      while ((m = entryRe.exec(xml)) !== null) {
        const block = m[1];
        const getTag = (tag) => { const r = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`); const x = r.exec(block); return x ? x[1].trim() : ''; };
        const title = getTag('title');
        const filedDate = getTag('updated').slice(0, 10);
        const linkMatch = /<link[^>]*href="([^"]*)"/.exec(block);
        const filingUrl = linkMatch ? linkMatch[1] : '';
        // Accession number from filename: "0001193125-26-148615-index.htm"
        // Same accession appears for both Reporting and Issuer entries
        const accMatch = filingUrl.match(/\/(\d{10}-\d{2}-\d+)-index\.htm/);
        const accession = accMatch ? accMatch[1] : filingUrl;
        rawEntries.push({ title, filedDate, filingUrl, accession });
      }

      // Build deduplicated filings: one entry per accession, prefer (Issuer) for company name
      const byAccession = new Map();
      for (const e of rawEntries) {
        const isIssuer = e.title.includes('(Issuer)');
        const isReporting = e.title.includes('(Reporting)');
        // Extract name: "4 - NAME (CIK) (Role)" → NAME
        const nameMatch = e.title.match(/^[\d\/A-Z]+\s*-\s*(.*?)\s*\(\d+\)/);
        const name = nameMatch ? nameMatch[1].trim() : e.title;

        if (!byAccession.has(e.accession)) {
          byAccession.set(e.accession, { companyName: '', insiderName: '', filedDate: e.filedDate, filingUrl: e.filingUrl });
        }
        const rec = byAccession.get(e.accession);
        if (isIssuer) rec.companyName = name;
        else if (isReporting) rec.insiderName = name;
      }

      const entries = [];
      for (const [, rec] of byAccession) {
        if (!rec.companyName || !rec.filedDate) continue;
        entries.push({ companyName: rec.companyName, insiderName: rec.insiderName, formType: '4', filedDate: rec.filedDate, filingUrl: rec.filingUrl });
      }

      insiderFeedCache = entries;
      insiderFeedLastFetch = now;
    }

    res.json({ filings: insiderFeedCache });
  } catch (err) {
    console.error('[latest-insiders]', err.message);
    res.status(502).json({ error: err.message, filings: [] });
  }
});

app.use(express.json());

async function fetchEdgarFilingText(edgarUrl) {
  const UA = 'TARS admin@tars.app';

  function secFetch(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': UA } }, (res) => {
        // Follow up to 2 redirects
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          return secFetch(res.headers.location).then(resolve).catch(reject);
        }
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve(body));
      });
      req.on('error', reject);
      req.setTimeout(15000, () => { req.destroy(); reject(new Error('SEC fetch timeout')); });
    });
  }

  // Fetch the EDGAR filing index page
  const indexHtml = await secFetch(edgarUrl);

  // Find the primary .htm document (first non-index .htm in the filing)
  const docLinkRe = /href="(\/Archives\/edgar\/data\/[^"]+\.htm[^"]*)"/gi;
  let primaryDocPath = null;
  let m;
  while ((m = docLinkRe.exec(indexHtml)) !== null) {
    const p = m[1].toLowerCase();
    if (!p.endsWith('-index.htm') && !p.includes('/index.htm')) {
      primaryDocPath = m[1];
      break;
    }
  }

  if (!primaryDocPath) {
    // Fallback: try .txt
    const txtMatch = indexHtml.match(/href="(\/Archives\/edgar\/data\/[^"]+\.txt)"/i);
    if (txtMatch) primaryDocPath = txtMatch[1];
  }

  if (!primaryDocPath) {
    throw new Error('Could not locate primary document in EDGAR filing index');
  }

  const docHtml = await secFetch(`https://www.sec.gov${primaryDocPath}`);

  // Strip HTML and clean text
  const text = docHtml
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Truncate to ~6000 words — most relevant content is at the start
  return text.split(' ').slice(0, 6000).join(' ');
}

const QUANT_PROMPT = `You are a hedge fund quantitative analyst. Analyze this SEC 13D or 13G activist/passive investor filing and produce a structured investment signal.

Return ONLY a valid JSON object — no markdown, no code fences, no commentary:

{
  "signal": "BULLISH" | "BEARISH" | "NEUTRAL" | "WATCH",
  "conviction": "HIGH" | "MEDIUM" | "LOW",
  "ownership": {
    "currentStake": "<e.g. '7.4%'>",
    "shareCount": "<e.g. '4,200,000'>",
    "changeFromPrior": "<e.g. '+1.2%' or 'New Position' or 'N/A'>"
  },
  "investorType": "Activist" | "Passive" | "Strategic" | "Unknown",
  "statedIntent": "<one sentence — investor's stated purpose>",
  "catalysts": ["<catalyst 1>", "<catalyst 2>"],
  "risks": ["<risk 1>", "<risk 2>"],
  "thesis": "<2-3 sentence quant interpretation of the investment signal>",
  "keyQuote": "<most revealing direct quote from the filing, max 30 words>"
}

Signal logic:
- BULLISH: activist with value-unlock agenda, significant new position, or large add-on
- BEARISH: activist short thesis, forced sale, or major reduction
- NEUTRAL: routine passive filing, no change in intent
- WATCH: ambiguous intent, amendment with context shift, or steady position worth monitoring

Extract exact stake percentages and share counts from the filing text.`;

async function callAI(provider, apiKey, filingText) {
  const userContent = `${QUANT_PROMPT}\n\n---\nFILING TEXT:\n${filingText}`;

  if (provider === 'anthropic') {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{ role: 'user', content: userContent }],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) return reject(new Error(parsed.error.message));
              resolve(parsed.content?.[0]?.text ?? '');
            } catch {
              reject(new Error('Invalid Anthropic response'));
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Anthropic API timeout')); });
      req.write(body);
      req.end();
    });
  }

  if (provider === 'openai') {
    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: QUANT_PROMPT },
        { role: 'user', content: `FILING TEXT:\n${filingText}` },
      ],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.openai.com',
          path: '/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) return reject(new Error(parsed.error.message));
              resolve(parsed.choices?.[0]?.message?.content ?? '');
            } catch {
              reject(new Error('Invalid OpenAI response'));
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('OpenAI API timeout')); });
      req.write(body);
      req.end();
    });
  }

  // Groq — OpenAI-compatible API, just different hostname + model
  if (provider === 'groq') {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: QUANT_PROMPT },
        { role: 'user', content: `FILING TEXT:\n${filingText}` },
      ],
    });

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: 'api.groq.com',
          path: '/openai/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (c) => (data += c));
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) return reject(new Error(parsed.error.message ?? JSON.stringify(parsed.error)));
              resolve(parsed.choices?.[0]?.message?.content ?? '');
            } catch {
              reject(new Error('Invalid Groq response'));
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(30000, () => { req.destroy(); reject(new Error('Groq API timeout')); });
      req.write(body);
      req.end();
    });
  }

  throw new Error(`Unknown provider: ${provider}`);
}

app.post('/api/analyze-filing', async (req, res) => {
  const { edgarUrl } = req.body ?? {};

  if (!edgarUrl || typeof edgarUrl !== 'string')
    return res.status(400).json({ error: 'Missing edgarUrl' });

  // SSRF guard — only allow SEC EDGAR URLs
  if (!edgarUrl.startsWith('https://www.sec.gov/'))
    return res.status(400).json({ error: 'edgarUrl must point to www.sec.gov' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI analysis not configured — ask your admin to set GROQ_API_KEY.' });
  }

  try {
    const filingText = await fetchEdgarFilingText(edgarUrl);
    const rawJson = await callAI('groq', apiKey, filingText);
    // Strip markdown fences if model wrapped despite instructions
    const cleaned = rawJson.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const analysis = JSON.parse(cleaned);
    res.json({ analysis });
  } catch (err) {
    console.error('[analyze-filing]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Insider AI Analysis ──────────────────────────────────────────────────────

const INSIDER_QUANT_PROMPT = `You are a senior quant analyst at a top-tier Wall Street hedge fund (think Citadel, Renaissance Technologies, or Point72). You specialise in reading insider transaction filings (SEC Form 4, SEDI) to extract high-conviction trading signals before the market reacts.

Your job: analyse the insider trading data below and produce a precise, actionable intelligence briefing in the style of a prop-desk morning note.

Evaluate:
- Net flow direction and magnitude (buy vs sell dollar value)
- Who is trading: C-suite vs directors vs beneficial owners (weight CEO/CFO buys most heavily)
- Timing patterns: cluster buys, trades near earnings blackout windows, 10b5-1 plan sales vs discretionary
- Size relative to position (large % of holdings = high conviction)
- Divergence signals: insiders buying while selling their options/grants simultaneously

THE MOST IMPORTANT FIELD is "hypothesis" — it must be one razor-sharp sentence that captures the single best reason WHY insiders are buying or selling. Think like a PM pitching a trade idea in 15 seconds: be specific, name the likely catalyst or concern, and make it sound like something you'd hear on a hedge fund morning call. Examples of good hypothesis lines:
- "CFO loading up at 52-week lows suggests the company is tracking ahead of guidance it hasn't yet published."
- "Three directors buying within 10 days of each other signals management believes the recent selloff is overdone ahead of a re-rating event."
- "Sustained $47M in executive sales into strength — insiders see limited near-term upside at these multiples."

Return ONLY valid JSON — no markdown, no prose outside the object:
{
  "hypothesis": "one razor-sharp sentence — the single best reason WHY insiders are buying or selling right now",
  "signal": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED",
  "conviction": "HIGH" | "MEDIUM" | "LOW",
  "sentimentSummary": "one sharp sentence — quant desk headline",
  "pattern": "detected regime e.g. 'Cluster buy — multiple insiders same 30d window' | 'Routine 10b5-1 disposal — low signal' | 'Executive accumulation trend' | 'Distribution — sustained selling pressure'",
  "topInsiders": ["Name · Title · BUY $X.XM · YYYY-MM-DD", "..."],
  "netBuyValue": "$XM (positive = net buying, negative = net selling)",
  "buyCount": number,
  "sellCount": number,
  "thesis": "2-3 sentences — what does this insider flow imply for the stock? What are insiders seeing that the street may be missing?",
  "catalysts": ["catalyst that insiders may be positioning for"],
  "risks": ["key risk to the bullish/bearish read"],
  "keyTrade": "The single most significant trade and why it matters"
}`;

function buildInsiderSummary(symbol, trades) {
  if (!trades || trades.length === 0) return 'No insider transactions available.';

  const buys  = trades.filter(t => (t.transactionCode === 'P') || (t.change > 0 && t.transactionCode !== 'A' && t.transactionCode !== 'F'));
  const sells = trades.filter(t => (t.transactionCode === 'S' || t.transactionCode === 'S-') || (t.change < 0 && t.transactionCode !== 'F'));
  const taxSells = trades.filter(t => t.transactionCode === 'F');

  const sumValue = (arr) => arr.reduce((s, t) => s + (Math.abs(t.change) * (t.transactionPrice || 0)), 0);
  const buyValue  = sumValue(buys);
  const sellValue = sumValue(sells);
  const netFlow   = buyValue - sellValue;

  const fmt = (n) => n >= 1e9 ? `$${(n/1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n/1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n/1e3).toFixed(1)}K` : `$${n.toFixed(0)}`;

  const lines = [
    `SYMBOL: ${symbol}`,
    `PERIOD: ${trades[trades.length-1]?.transactionDate?.slice(0,10) || 'n/a'} to ${trades[0]?.transactionDate?.slice(0,10) || 'n/a'}`,
    `TOTAL TRANSACTIONS: ${trades.length} (${buys.length} buys · ${sells.length} open-market sells · ${taxSells.length} tax-withholding)`,
    `NET INSIDER FLOW: ${fmt(Math.abs(netFlow))} ${netFlow >= 0 ? 'NET BUY' : 'NET SELL'}`,
    `BUY VALUE: ${fmt(buyValue)} | SELL VALUE: ${fmt(sellValue)}`,
    '',
    'INDIVIDUAL TRANSACTIONS (sorted newest first):',
  ];

  const topTrades = trades.slice(0, 30); // cap at 30 for token budget
  for (const t of topTrades) {
    const val = Math.abs(t.change) * (t.transactionPrice || 0);
    const type = t.transactionCode === 'P' ? 'BUY'
      : (t.transactionCode === 'S' || t.transactionCode === 'S-') ? 'SELL'
      : t.transactionCode === 'F' ? 'TAX-SELL'
      : t.transactionCode === 'A' ? 'GRANT'
      : t.transactionCode;
    lines.push(`  ${t.transactionDate?.slice(0,10) || ''} | ${type.padEnd(8)} | ${(t.name || 'Unknown').padEnd(30)} | ${(t.title || '').padEnd(25)} | ${Math.abs(t.change).toLocaleString().padStart(10)} shares @ $${(t.transactionPrice||0).toFixed(2)} = ${fmt(val)}`);
  }

  return lines.join('\n');
}

app.post('/api/analyze-insiders', async (req, res) => {
  const { symbol, trades } = req.body ?? {};

  if (!symbol || typeof symbol !== 'string')
    return res.status(400).json({ error: 'Missing symbol' });
  if (!Array.isArray(trades))
    return res.status(400).json({ error: 'Missing trades array' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey)
    return res.status(503).json({ error: 'AI analysis not configured — ask your admin to set GROQ_API_KEY.' });

  try {
    const summary = buildInsiderSummary(symbol, trades);
    const prompt  = `${INSIDER_QUANT_PROMPT}\n\n---\nINSIDER TRANSACTION DATA:\n${summary}`;
    const rawJson = await callAI('groq', apiKey, prompt);
    const cleaned = rawJson.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const analysis = JSON.parse(cleaned);
    res.json({ analysis });
  } catch (err) {
    console.error('[analyze-insiders]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Congress AI Analysis ─────────────────────────────────────────────────────

const CONGRESS_QUANT_PROMPT = `You are a senior political risk analyst and quant strategist at a top hedge fund. You read STOCK Act congressional trading disclosures to extract market signals — politicians often trade ahead of regulatory changes, defence contracts, healthcare legislation, and infrastructure bills.

Analyse the congressional trade data below and produce an intelligence briefing in the style of a DC-based political risk desk note.

Evaluate:
- Net direction: are members buying or selling?
- Which sectors/tickers are clustered — signals a legislative or regulatory catalyst
- Party dynamics: bipartisan buying = higher conviction signal
- Committee memberships: Armed Services buying defence = higher signal than random
- Timing: trades near committee votes, earnings, or government contract announcements

THE MOST IMPORTANT FIELD is "hypothesis" — one razor-sharp sentence on WHY congress members are buying or selling RIGHT NOW. Be specific about the likely legislative or macro catalyst. Examples:
- "Bipartisan accumulation in defence names ahead of the supplemental appropriations vote signals committee members expect a large contracts announcement."
- "Five members liquidating retail positions into strength as consumer spending legislation faces headwinds in the Senate."

Return ONLY valid JSON — no markdown, no prose outside the object:
{
  "hypothesis": "one razor-sharp sentence — the single best reason WHY congress is buying or selling",
  "signal": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED",
  "conviction": "HIGH" | "MEDIUM" | "LOW",
  "sentimentSummary": "one sharp sentence — political risk desk headline",
  "pattern": "detected regime e.g. 'Bipartisan cluster buy' | 'Committee-informed selling' | 'Broad liquidation ahead of volatility' | 'Sector rotation into defence/health'",
  "topMembers": ["Name (Party-State) · BUY/SELL TICKER $X–$Y · YYYY-MM-DD", "..."],
  "buyCount": number,
  "sellCount": number,
  "thesis": "2-3 sentences — what legislative or macro event are members positioning for?",
  "catalysts": ["specific legislative or policy catalyst"],
  "risks": ["key risk to this read"],
  "keyTrade": "The single most significant trade and why it matters"
}`;

function buildCongressSummary(trades) {
  if (!trades || trades.length === 0) return 'No congressional transactions available.';

  const buys  = trades.filter(t => t.type === 'purchase');
  const sells = trades.filter(t => t.type === 'sale');
  const tickers = [...new Set(trades.map(t => t.ticker))];

  const lines = [
    `TOTAL DISCLOSURES: ${trades.length} (${buys.length} purchases · ${sells.length} sales)`,
    `UNIQUE TICKERS: ${tickers.join(', ')}`,
    `DATE RANGE: ${trades[trades.length-1]?.transactionDate?.slice(0,10) || 'n/a'} to ${trades[0]?.transactionDate?.slice(0,10) || 'n/a'}`,
    '',
    'INDIVIDUAL TRADES (newest first):',
  ];

  for (const t of trades.slice(0, 40)) {
    const type = (t.type || '').toUpperCase();
    lines.push(`  ${t.transactionDate?.slice(0,10) || ''} | ${type.padEnd(8)} | ${(t.member || '').padEnd(28)} | ${(t.party || '?').padEnd(2)} ${(t.state || '').padEnd(3)} | ${(t.ticker || '').padEnd(8)} | ${t.amount || ''}`);
  }

  return lines.join('\n');
}

app.post('/api/analyze-congress', async (req, res) => {
  const { trades } = req.body ?? {};

  if (!Array.isArray(trades))
    return res.status(400).json({ error: 'Missing trades array' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey)
    return res.status(503).json({ error: 'AI analysis not configured — ask your admin to set GROQ_API_KEY.' });

  try {
    const summary = buildCongressSummary(trades);
    const prompt  = `${CONGRESS_QUANT_PROMPT}\n\n---\nCONGRESSIONAL TRADE DATA:\n${summary}`;
    const rawJson = await callAI('groq', apiKey, prompt);
    const cleaned = rawJson.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
    const analysis = JSON.parse(cleaned);
    res.json({ analysis });
  } catch (err) {
    console.error('[analyze-congress]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── Stock Q&A Chat ────────────────────────────────────────────────────────────
app.post('/api/ask-stock', async (req, res) => {
  const { question, symbol, context } = req.body ?? {};
  if (!question || !symbol) return res.status(400).json({ error: 'Missing question or symbol' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  // Build context block from what the client sends
  const ctx = [];
  if (context?.price)       ctx.push(`Current price: ${context.price}`);
  if (context?.change)      ctx.push(`Day change: ${context.change}`);
  if (context?.marketCap)   ctx.push(`Market cap: ${context.marketCap}`);
  if (context?.volume)      ctx.push(`Volume: ${context.volume}`);
  if (context?.exchange)    ctx.push(`Exchange: ${context.exchange}`);
  if (context?.insiders?.length) {
    const buys  = context.insiders.filter(t => t.transactionCode === 'P');
    const sells = context.insiders.filter(t => t.transactionCode === 'S' || t.transactionCode === 'S-');
    ctx.push(`Recent insider activity: ${buys.length} buys, ${sells.length} sells in last 2 years`);
    const top = context.insiders.slice(0, 5).map(t =>
      `${t.name} (${t.title || 'insider'}) ${t.transactionCode === 'P' ? 'BOUGHT' : 'SOLD'} ${Math.abs(t.share).toLocaleString()} shares @ $${t.transactionPrice} on ${t.transactionDate}`
    );
    ctx.push('Recent insider trades:\n' + top.join('\n'));
  }

  const systemPrompt = `You are a sharp Wall Street equity analyst covering ${symbol}. Answer like a senior analyst briefing a PM — direct, specific, data-driven.

RESPONSE FORMAT RULES:
- Lead with the direct answer or bottom-line verdict in the first sentence
- Use bullet points (•) when listing 3+ items — never prose lists
- Bold key numbers and names with **markdown**
- End with a one-sentence "Bottom line:" when the question is analytical
- Under 200 words unless the question genuinely requires more depth
- Never use generic disclaimers ("consult a financial advisor", "past performance", etc.)
- If you don't know a specific fact, say so in one clause and pivot to what the data does show

STOCK CONTEXT (live data as of today):
${ctx.join('\n') || 'No live context — rely on your training knowledge about this company.'}`;

  try {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 512,
      temperature: 0.4,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
    });

    const answer = await new Promise((resolve, reject) => {
      const opts = {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
      };
      const req2 = https.request(opts, r => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          try {
            const j = JSON.parse(d);
            resolve(j.choices?.[0]?.message?.content || 'No response');
          } catch { reject(new Error('Parse error')); }
        });
      });
      req2.on('error', reject);
      req2.setTimeout(30000, () => { req2.destroy(); reject(new Error('Timeout')); });
      req2.write(body);
      req2.end();
    });

    res.json({ answer });
  } catch (err) {
    console.error('[ask-stock]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── 13F Fund search + holdings ────────────────────────────────────────────────

function classifySector(name) {
  const n = (name || '').toUpperCase();
  if (/APPLE|MICROSOFT|NVIDIA|AMD|INTEL|ALPHABET|GOOGLE|META PLATFORM|SALESFORCE|ORACLE|CISCO|QUALCOMM|BROADCOM|TAIWAN SEMI|TSMC|SAMSUNG|SEMICONDUCTOR|SOFTWARE|TECH|DIGITAL|CYBER|SNOWFLAKE|PALANTIR|WORKDAY|ADOBE|SERVICENOW/.test(n)) return 'Technology';
  if (/AMAZON|WALMART|TARGET|COSTCO|HOME DEPOT|LOWES|STARBUCKS|MCDONALDS|NIKE|TESLA|FORD|GENERAL MOTORS| GM |CONSUMER|RETAIL|LUXURY|LVMH|HERMES/.test(n)) return 'Consumer';
  if (/PHARMA|BIOTECH|HEALTH|MEDICAL|AMGEN|MERCK|PFIZER|MODERNA|ABBVIE|LILLY|BRISTOL|JOHNSON|UNITEDHEALTH|CVS|ANTHEM|CIGNA|HUMANA|REGENERON|BIOGEN|GILEAD|NOVO NORDISK/.test(n)) return 'Healthcare';
  if (/BANK|FINANCIAL|GOLDMAN|MORGAN STANLEY|JPMORGAN|WELLS FARGO|CAPITAL ONE|INSURANCE|BERKSHIRE|BLACKROCK|AMERICAN EXPRESS|VISA|MASTERCARD|PAYPAL|CITIGROUP|BANK OF AMER|ASSET MGMT|HEDGE/.test(n)) return 'Financials';
  if (/EXXON|CHEVRON|CONOCOPHILLIPS|PIONEER|HALLIBURTON|SCHLUMBERGER|BAKER HUGHES|DEVON|ENERGY INC|OIL CORP|GAS CORP/.test(n)) return 'Energy';
  if (/BOEING|LOCKHEED|RAYTHEON|NORTHROP|GENERAL DYNAMICS|CATERPILLAR|DEERE|HONEYWELL|3M |INDUSTRIAL|AEROSPACE|DEFENSE/.test(n)) return 'Industrials';
  if (/VERIZON|AT&T|T-MOBILE|COMCAST|CHARTER|DISNEY|NETFLIX|TELECOM|COMMUNICATIONS|MEDIA/.test(n)) return 'Communications';
  if (/DUKE ENERGY|SOUTHERN CO|NEXTERA|DOMINION|AMERICAN ELECTRIC|UTILITY|UTILITIES|ELECTRIC POWER/.test(n)) return 'Utilities';
  if (/PROLOGIS|SIMON PROPERTY|CROWN CASTLE|AMERICAN TOWER|EQUITY RESIDENTIAL|REAL ESTATE|REIT/.test(n)) return 'Real Estate';
  if (/LINDE|AIR PRODUCTS|DOW INC|DUPONT|NUCOR|FREEPORT|NEWMONT|MATERIAL|CHEMICAL|MINING|STEEL|COPPER/.test(n)) return 'Materials';
  return 'Other';
}

function parse13FXml(xml) {
  const holdings = [];
  const tableRe = /<infoTable>([\s\S]*?)<\/infoTable>/gi;
  let m;
  while ((m = tableRe.exec(xml)) !== null) {
    const block = m[1];
    const getTag = (tag) => {
      const r = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
      const x = r.exec(block);
      return x ? x[1].trim() : '';
    };
    const name = getTag('nameOfIssuer');
    const cusip = getTag('cusip');
    const valueRaw = parseInt(getTag('value') || '0', 10);
    const value = valueRaw * 1000; // SEC reports in thousands
    const shares = parseInt(getTag('sshPrnamt') || '0', 10);
    const shareType = getTag('sshPrnamtType');
    const putCall = getTag('putCall') || null;
    if (name && value > 0) {
      holdings.push({ name, cusip, value, shares, shareType, putCall, sector: classifySector(name) });
    }
  }
  return holdings.sort((a, b) => b.value - a.value);
}

async function get13FFilings(cik) {
  const paddedCik = cik.toString().padStart(10, '0');
  const data = await httpsGet(`https://data.sec.gov/submissions/CIK${paddedCik}.json`, { 'User-Agent': 'TARS admin@tars.app' });
  const json = JSON.parse(data);
  const recent = json.filings?.recent ?? {};
  const forms = recent.form ?? [];
  const accessions = recent.accessionNumber ?? [];
  const dates = recent.filingDate ?? [];
  const periods = recent.periodOfReport ?? [];
  const results = [];
  for (let i = 0; i < forms.length; i++) {
    if (forms[i] === '13F-HR') {
      results.push({ accession: accessions[i], filingDate: dates[i], period: periods[i] });
    }
  }
  return { name: json.name, results: results.slice(0, 4) };
}

async function fetchHoldings(cik, accession) {
  const cikClean = cik.toString().replace(/^0+/, '');
  const accClean = accession.replace(/-/g, '');
  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/${accession}-index.json`;
  let infoTableUrl = null;
  try {
    const indexData = await httpsGet(indexUrl, { 'User-Agent': 'TARS admin@tars.app' });
    const index = JSON.parse(indexData);
    const docs = index.directory?.item ?? [];
    for (const doc of docs) {
      const fname = (doc.name || '').toLowerCase();
      const type = (doc.type || '').toUpperCase();
      if (type === 'INFORMATION TABLE' || fname.includes('infotable') || (fname.includes('form13f') && fname.endsWith('.xml'))) {
        infoTableUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/${doc.name}`;
        break;
      }
    }
    if (!infoTableUrl) {
      for (const doc of docs) {
        const fname = (doc.name || '').toLowerCase();
        if (fname.endsWith('.xml') && !fname.includes('primary') && !fname.includes('index') && fname !== `${accession}.xml`) {
          infoTableUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/${doc.name}`;
          break;
        }
      }
    }
  } catch (e) {
    console.error('[13f/index]', e.message);
  }
  if (!infoTableUrl) return [];
  const xml = await httpsGet(infoTableUrl, { 'User-Agent': 'TARS admin@tars.app' });
  return parse13FXml(xml);
}

// Search for funds by name — EDGAR CGI company search (atom feed)
// 13F search — uses SEC company_tickers.json (static file, reliable) filtered to known 13F filers
// Supplemented by a curated list of institutional funds not in the tickers file
let tickerCache = null;
let tickerLastFetch = 0;
const TICKER_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

// Well-known institutional funds (private, not in company_tickers.json) with verified CIKs
const KNOWN_FUNDS = [
  { cik: '1067983', name: 'BERKSHIRE HATHAWAY INC' },
  { cik: '1350694', name: 'BRIDGEWATER ASSOCIATES LP' },
  { cik: '1037389', name: 'RENAISSANCE TECHNOLOGIES LLC' },
  { cik: '1423043', name: 'CITADEL ADVISORS LLC' },
  { cik: '1167483', name: 'TIGER GLOBAL MANAGEMENT LLC' },
  { cik: '1466373', name: 'COATUE MANAGEMENT LLC' },
  { cik: '1040273', name: 'VIKING GLOBAL INVESTORS LP' },
  { cik: '1336528', name: 'PERSHING SQUARE CAPITAL MANAGEMENT LP' },
  { cik: '1040570', name: 'THIRD POINT LLC' },
  { cik: '1056931', name: 'APPALOOSA MANAGEMENT LP' },
  { cik: '875956',  name: 'BAUPOST GROUP LLC' },
  { cik: '1079114', name: 'GREENLIGHT CAPITAL INC' },
  { cik: '814180',  name: 'ICAHN CAPITAL LP' },
  { cik: '1162175', name: 'JANA PARTNERS LLC' },
  { cik: '892416',  name: 'ELLIOTT INVESTMENT MANAGEMENT LP' },
  { cik: '1486671', name: 'STARBOARD VALUE LP' },
  { cik: '1275014', name: 'D E SHAW & CO INC' },
  { cik: '1595882', name: 'TWO SIGMA INVESTMENTS LP' },
  { cik: '1540159', name: 'POINT72 ASSET MANAGEMENT LP' },
  { cik: '1536411', name: 'DUQUESNE FAMILY OFFICE LLC' },
  { cik: '1336489', name: 'LONE PINE CAPITAL LLC' },
  { cik: '1315066', name: 'FMR LLC' },
  { cik: '1166559', name: 'BILL & MELINDA GATES FOUNDATION TRUST' },
  { cik: '813672',  name: 'CAPITAL RESEARCH GLOBAL INVESTORS' },
  { cik: '102909',  name: 'VANGUARD GROUP INC' },
];

app.get('/api/13f/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ funds: [] });
  const qUpper = q.toUpperCase();

  try {
    // 1. Search the curated known-funds list
    const knownMatches = KNOWN_FUNDS.filter(f => f.name.includes(qUpper));

    // 2. Fetch + cache SEC company_tickers.json (all public companies)
    const now = Date.now();
    if (!tickerCache || now - tickerLastFetch > TICKER_CACHE_TTL) {
      try {
        const raw = await httpsGet('https://www.sec.gov/files/company_tickers.json', { 'User-Agent': 'TARS admin@tars.app' });
        tickerCache = Object.values(JSON.parse(raw)); // [{cik_str, ticker, title}, ...]
        tickerLastFetch = now;
      } catch (e) {
        console.error('[13f/tickers]', e.message);
        tickerCache = [];
      }
    }

    const tickerMatches = tickerCache
      .filter(c => (c.title || '').toUpperCase().includes(qUpper))
      .slice(0, 20)
      .map(c => ({ cik: String(c.cik_str), name: c.title, lastFiled: '' }));

    // Merge: known funds first, then public-company matches (deduplicate by CIK)
    const seen = new Set();
    const funds = [];
    for (const f of [...knownMatches, ...tickerMatches]) {
      if (!seen.has(f.cik)) { seen.add(f.cik); funds.push(f); }
      if (funds.length >= 15) break;
    }

    console.log(`[13f/search] q="${q}" known=${knownMatches.length} tickers=${tickerMatches.length}`);
    res.json({ funds });
  } catch (err) {
    console.error('[13f/search]', err.message);
    res.status(502).json({ error: err.message, funds: [] });
  }
});

// Get 13F holdings for a fund CIK — latest + previous for new-position detection
app.get('/api/13f/holdings', async (req, res) => {
  const cik = (req.query.cik || '').trim().replace(/^0+/, '');
  if (!cik) return res.status(400).json({ error: 'Missing cik' });
  try {
    const { name, results: filings } = await get13FFilings(cik);
    if (!filings.length) return res.json({ fund: name, current: [], previous: null, meta: {} });
    const [latestFiling, prevFiling] = filings;
    const [current, previous] = await Promise.all([
      fetchHoldings(cik, latestFiling.accession),
      prevFiling ? fetchHoldings(cik, prevFiling.accession) : Promise.resolve(null),
    ]);
    const prevCusips = new Set((previous ?? []).map(h => h.cusip).filter(Boolean));
    const prevNames  = new Set((previous ?? []).map(h => h.name.toUpperCase()));
    const totalValue = current.reduce((s, h) => s + h.value, 0);
    const withFlags = current.map(h => ({
      ...h,
      isNew: !!previous && !prevCusips.has(h.cusip) && !prevNames.has(h.name.toUpperCase()),
      pctOfPortfolio: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
    }));
    res.json({
      fund: name,
      meta: { filingDate: latestFiling.filingDate, period: latestFiling.period, totalValue, positionCount: current.length },
      current: withFlags,
      previous: previous ? previous.map(h => ({ name: h.name, cusip: h.cusip, shares: h.shares, value: h.value })) : null,
    });
  } catch (err) {
    console.error('[13f/holdings]', err.message);
    res.status(502).json({ error: err.message, current: [] });
  }
});

// Fund AI chat
app.post('/api/ask-fund', async (req, res) => {
  const { question, fund, holdings, meta } = req.body ?? {};
  if (!question) return res.status(400).json({ error: 'Missing question' });
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI not configured' });

  const topH = (holdings || []).slice(0, 30).map((h, i) =>
    `${i + 1}. ${h.name}${h.putCall ? ` (${h.putCall})` : ''}${h.isNew ? ' [NEW]' : ''}: $${(h.value / 1e6).toFixed(1)}M (${(h.pctOfPortfolio || 0).toFixed(1)}%) — ${(h.shares || 0).toLocaleString()} shares`
  ).join('\n');

  const sectorMap = {};
  for (const h of (holdings || [])) sectorMap[h.sector] = (sectorMap[h.sector] || 0) + h.value;
  const totalVal = Object.values(sectorMap).reduce((a, b) => a + b, 0);
  const sectorStr = Object.entries(sectorMap).sort((a, b) => b[1] - a[1])
    .map(([s, v]) => `${s}: ${((v / totalVal) * 100).toFixed(1)}%`).join(', ');

  const systemPrompt = `You are a senior portfolio analyst specialising in institutional fund analysis and 13F filings. Deep knowledge of hedge fund strategies, portfolio construction, and regulatory disclosures.

FUND: ${fund || 'Unknown'}
PORTFOLIO: ${meta?.positionCount || 0} positions · $${((meta?.totalValue || 0) / 1e9).toFixed(2)}B AUM · period ending ${meta?.period || 'unknown'}
SECTOR BREAKDOWN: ${sectorStr || 'unavailable'}

TOP HOLDINGS (by market value):
${topH || 'No data'}

RESPONSE FORMAT:
- Lead with the direct answer in the first sentence
- Use bullet points (•) for 3+ items
- Bold key numbers and names with **markdown**
- End analytical answers with a "Bottom line:" sentence
- Under 200 words unless depth is genuinely needed
- No generic disclaimers`;

  try {
    const body = JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      max_tokens: 600,
      temperature: 0.4,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }],
    });
    const answer = await new Promise((resolve, reject) => {
      const r = https.request({
        hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(body) },
      }, res2 => {
        let d = '';
        res2.on('data', c => d += c);
        res2.on('end', () => {
          try { resolve(JSON.parse(d).choices?.[0]?.message?.content || 'No response'); }
          catch { reject(new Error('Parse error')); }
        });
      });
      r.on('error', reject);
      r.setTimeout(30000, () => { r.destroy(); reject(new Error('Timeout')); });
      r.write(body);
      r.end();
    });
    res.json({ answer });
  } catch (err) {
    console.error('[ask-fund]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Serve built React app
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA fallback — send index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TARS server running on port ${PORT}`);
});
