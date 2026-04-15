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
let congressCache = null;
let congressLastFetch = 0;
const CONGRESS_CACHE_TTL = 30 * 60 * 1000; // 30 min — Quiver updates ~daily but let's stay fresh

// Quiver Quant — free public endpoint, covers both House & Senate, updated daily with ~1-2 day lag
const QUIVER_CONGRESS_URL = 'https://api.quiverquant.com/beta/live/congresstrading';
const QUIVER_HEADERS = { 'Authorization': 'Bearer public', 'Accept': 'application/json' };

async function fetchCongressData() {
  const raw = await httpsGet(QUIVER_CONGRESS_URL, QUIVER_HEADERS);
  return JSON.parse(raw);
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/latest-congress', async (req, res) => {
  try {
    const now = Date.now();
    if (!congressCache || now - congressLastFetch > CONGRESS_CACHE_TTL) {
      congressCache = await fetchCongressData();
      congressLastFetch = now;
    }

    const limit = Math.min(parseInt(req.query.limit || '60', 10), 500);

    // Quiver fields: Representative, ReportDate, TransactionDate, Ticker, Transaction,
    //   Range, House, Amount, Party, TickerType, Description, BioGuideID
    const trades = [];
    for (const t of (Array.isArray(congressCache) ? congressCache : [])) {
      const ticker = (t.Ticker || '').trim().toUpperCase();
      if (!ticker || ticker === 'N/A' || ticker === '--' || ticker.length > 8) continue;
      const txType = (t.Transaction || '').toLowerCase();
      if (!txType.includes('purchase') && !txType.includes('sale') && !txType.includes('sell') && !txType.includes('exchange')) continue;
      const txDate = normaliseDate(t.TransactionDate || '');
      if (!txDate) continue;
      const member = (t.Representative || '').trim();
      if (!member) continue;

      trades.push({
        member,
        party: (t.Party || '').trim(),
        state: '',
        ticker,
        assetDescription: t.Description || '',
        type: txType.includes('purchase') ? 'purchase' : 'sale',
        amount: t.Range || t.Amount || '',
        amountMin: 0,
        transactionDate: txDate,
        disclosureDate: normaliseDate(t.ReportDate || ''),
        filingUrl: '',
        chamber: (t.House || '').toLowerCase() === 'senate' ? 'senate' : 'house',
      });
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

// Latest insider filings via SEC EDGAR daily-index files (cloud-safe, no cgi-bin)
// NOTE: cgi-bin/browse-edgar atom feed is blocked on cloud provider IPs (Render/AWS).
// Replaced with daily-index .idx parsing, same approach used by /api/insider-activity.
let insiderFeedCache = null;
let insiderFeedLastFetch = 0;
const INSIDER_FEED_TTL = 30 * 60 * 1000; // 30min

app.get('/api/latest-insiders', async (req, res) => {
  try {
    const now = Date.now();
    if (!insiderFeedCache || now - insiderFeedLastFetch > INSIDER_FEED_TTL) {
      // fetchRecentForm4Entries scans daily-index .idx files — works from cloud IPs
      const entries = await fetchRecentForm4Entries(5);
      insiderFeedCache = entries.slice(0, 80).map(e => ({
        companyName: e.companyName,
        insiderName: '', // daily-index doesn't include reporter name; fetch individual XML if needed
        formType: e.formType,
        filedDate: e.filedDate,
        filingUrl: `https://www.sec.gov/Archives/edgar/data/${Number(e.cik)}/${e.accession.replace(/-/g, '')}/`,
      }));
      insiderFeedLastFetch = now;
    }
    res.json({ filings: insiderFeedCache });
  } catch (err) {
    console.error('[latest-insiders]', err.message);
    res.status(502).json({ error: err.message, filings: [] });
  }
});

const insiderActivityCaches = { 7: null, 14: null, 30: null };
const insiderActivityLastFetch = { 7: 0, 14: 0, 30: 0 };
const INSIDER_ACTIVITY_TTL = 30 * 60 * 1000;

function quarterOfMonth(month) {
  return Math.floor((month - 1) / 3) + 1;
}

function formatIndexDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return { y, ymd: `${y}${m}${d}`, qtr: quarterOfMonth(date.getUTCMonth() + 1) };
}

function xmlMatch(block, regex) {
  const match = regex.exec(block);
  return match ? match[1].trim() : '';
}

function parseNumber(value) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function inferOwnerTitle(xml) {
  const officerTitle = xmlMatch(xml, /<officerTitle>\s*([^<]*)\s*<\/officerTitle>/i);
  if (officerTitle) return officerTitle;

  const bits = [];
  if (/<isDirector>\s*1\s*<\/isDirector>/i.test(xml)) bits.push('Director');
  if (/<isOfficer>\s*1\s*<\/isOfficer>/i.test(xml)) bits.push('Officer');
  if (/<isTenPercentOwner>\s*1\s*<\/isTenPercentOwner>/i.test(xml)) bits.push('10% Owner');
  const otherText = xmlMatch(xml, /<otherText>\s*([^<]*)\s*<\/otherText>/i);
  if (otherText) bits.push(otherText);
  return bits.join(' · ');
}

async function fetchRecentForm4Entries(daysBack = 7) {
  const entries = [];

  for (let i = 0; i < daysBack; i += 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    const { y, ymd, qtr } = formatIndexDate(date);
    const indexUrl = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${qtr}/company.${ymd}.idx`;

    try {
      const idx = await httpsGet(indexUrl, { 'User-Agent': SEC_UA, Accept: 'text/plain' });
      const lines = idx.split(/\r?\n/);

      for (const line of lines) {
        if (line.length < 100) continue; // skip header, blank, and dashed separator lines
        // Fixed-width format: company name occupies first 62 chars, then form type, CIK, date, filename
        const m = line.match(/^(.{62})(.*?)\s+(\d{6,10})\s+(\d{8})\s+(edgar\/\S+)/);
        if (!m) continue;
        const companyName = m[1].trim();
        const formType = m[2].trim();
        const cik = m[3];
        const dateRaw = m[4];
        const filename = m[5];
        if (formType !== '4' && formType !== '4/A') continue;
        const filedDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
        const accession = filename.split('/').pop()?.replace(/\.txt$/i, '');
        if (!accession) continue;
        entries.push({ cik, companyName, formType, filedDate, filename, accession });
      }
    } catch {
      // Non-trading days simply won't have an index file.
    }
  }

  const seen = new Set();
  return entries.filter((entry) => {
    if (seen.has(entry.filename)) return false;
    seen.add(entry.filename);
    return true;
  });
}

async function fetchSecInsiderActivityItem(entry) {
  const cikClean = String(Number(entry.cik));
  const accClean = entry.accession.replace(/-/g, '');
  const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/`;

  let dirHtml = '';
  try {
    dirHtml = await httpsGet(dirUrl, { 'User-Agent': SEC_UA, Accept: 'text/html' });
  } catch {
    return [];
  }

  const xmlFiles = [...dirHtml.matchAll(/href="([^"]+\.xml)"/gi)]
    .map((match) => match[1])
    .filter((href) => !/xsl/i.test(href));
  const ownershipFile = xmlFiles.find((href) => /ownership|form4/i.test(href))
    || xmlFiles.find((href) => !/primary_doc/i.test(href));
  if (!ownershipFile) return [];

  const xmlUrl = ownershipFile.startsWith('http')
    ? ownershipFile
    : `https://www.sec.gov${ownershipFile.startsWith('/Archives') ? '' : `/Archives/edgar/data/${cikClean}/${accClean}/`}${ownershipFile}`;

  let xml = '';
  try {
    xml = await httpsGet(xmlUrl, { 'User-Agent': SEC_UA, Accept: 'application/xml,text/xml' });
  } catch {
    return [];
  }

  const symbol = xmlMatch(xml, /<issuerTradingSymbol>\s*([^<]+)\s*<\/issuerTradingSymbol>/i).toUpperCase();
  if (!symbol) return [];

  const companyName = xmlMatch(xml, /<issuerName>\s*([^<]+)\s*<\/issuerName>/i) || entry.companyName;
  const insiderName = xmlMatch(xml, /<rptOwnerName>\s*([^<]+)\s*<\/rptOwnerName>/i) || 'Unknown Insider';
  const title = inferOwnerTitle(xml);

  const transactions = [...xml.matchAll(/<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi)];
  return transactions.map((match, index) => {
    const block = match[1];
    const code = xmlMatch(block, /<transactionCode>\s*([^<]+)\s*<\/transactionCode>/i).toUpperCase();
    if (code !== 'P' && code !== 'S' && code !== 'S-') return null;

    const transactionDate = xmlMatch(block, /<transactionDate>[\s\S]*?<value>\s*([^<]+)\s*<\/value>/i);
    const shares = parseNumber(xmlMatch(block, /<transactionShares>[\s\S]*?<value>\s*([^<]+)\s*<\/value>/i));
    const pricePerShare = parseNumber(xmlMatch(block, /<transactionPricePerShare>[\s\S]*?<value>\s*([^<]+)\s*<\/value>/i));
    const totalValue = shares * pricePerShare;
    if (!transactionDate || shares <= 0 || pricePerShare <= 0 || totalValue <= 0) return null;

    return {
      id: `${entry.accession}-${index}`,
      symbol,
      companyName,
      insiderName,
      title,
      type: code === 'P' ? 'BUY' : 'SELL',
      transactionDate: transactionDate.slice(0, 10),
      filingDate: entry.filedDate,
      shares,
      pricePerShare,
      totalValue,
      market: 'US',
      exchange: 'SEC',
      source: 'SEC Form 4',
      filingUrl: `https://www.sec.gov/Archives/${entry.filename}`,
    };
  }).filter(Boolean);
}

async function fetchLatestInsiderActivity(days = 7) {
  // Fetch enough days to cover weekends / holidays
  const daysBack = days + Math.ceil(days / 5) * 2 + 1;
  const entries = await fetchRecentForm4Entries(daysBack);

  // Cut to entries actually within requested window
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const inWindow = entries.filter(e => e.filedDate >= cutoffStr);

  // Group by date then sample evenly across the alphabet so we don't
  // end up with only companies starting with A-C.
  const byDate = new Map();
  for (const e of inWindow) {
    if (!byDate.has(e.filedDate)) byDate.set(e.filedDate, []);
    byDate.get(e.filedDate).push(e);
  }
  const perDay = days <= 7 ? 12 : days <= 14 ? 9 : 6;
  const sampled = [];
  for (const dayEntries of byDate.values()) {
    if (dayEntries.length <= perDay) {
      sampled.push(...dayEntries);
    } else {
      const step = Math.floor(dayEntries.length / perDay);
      for (let i = 0; i < dayEntries.length && sampled.length < perDay * byDate.size; i += step) {
        sampled.push(dayEntries[i]);
      }
    }
  }

  const groups = await Promise.all(sampled.map((entry) => fetchSecInsiderActivityItem(entry)));
  return groups.flat().sort((a, b) => b.totalValue - a.totalValue);
}

app.get('/api/insider-activity', async (req, res) => {
  try {
    const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const now = Date.now();
    if (!insiderActivityCaches[days] || now - insiderActivityLastFetch[days] > INSIDER_ACTIVITY_TTL) {
      insiderActivityCaches[days] = await fetchLatestInsiderActivity(days);
      insiderActivityLastFetch[days] = now;
    }

    const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
    res.json({ trades: insiderActivityCaches[days].slice(0, limit) });
  } catch (err) {
    console.error('[insider-activity]', err.message);
    res.status(502).json({ error: err.message, trades: [] });
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

function lastN(arr, n) {
  return Array.isArray(arr) ? arr.slice(Math.max(0, arr.length - n)) : [];
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values, mean) {
  if (!values.length) return 0;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function summarizeTechnicals(candles) {
  const clean = (candles || [])
    .map((c) => ({
      close: Number(c.close),
      high: Number(c.high),
      low: Number(c.low),
      open: Number(c.open),
      volume: Number(c.volume),
      time: c.time,
    }))
    .filter((c) => Number.isFinite(c.close) && Number.isFinite(c.high) && Number.isFinite(c.low));

  if (clean.length < 25) {
    return 'Technical context unavailable: not enough candle history.';
  }

  const closes = clean.map((c) => c.close);
  const recent20 = lastN(clean, 20);
  const recent10 = lastN(clean, 10);
  const recent60 = lastN(clean, 60);
  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];

  const sma20 = average(recent20.map((c) => c.close));
  const bandStd = stddev(recent20.map((c) => c.close), sma20);
  const upperBand = sma20 + (2 * bandStd);
  const lowerBand = sma20 - (2 * bandStd);
  const support20 = Math.min(...recent20.map((c) => c.low));
  const resistance20 = Math.max(...recent20.map((c) => c.high));
  const support60 = recent60.length ? Math.min(...recent60.map((c) => c.low)) : support20;
  const resistance60 = recent60.length ? Math.max(...recent60.map((c) => c.high)) : resistance20;
  const trend10 = recent10.length >= 2 ? ((recent10[recent10.length - 1].close / recent10[0].close) - 1) * 100 : 0;
  const bandWidthPct = sma20 ? ((upperBand - lowerBand) / sma20) * 100 : 0;

  let pattern = 'Range-bound';
  if (last.close > upperBand) pattern = 'Breakout above upper Bollinger band';
  else if (last.close < lowerBand) pattern = 'Breakdown below lower Bollinger band';
  else if (trend10 > 5 && last.close > sma20) pattern = 'Short-term uptrend with higher closes';
  else if (trend10 < -5 && last.close < sma20) pattern = 'Short-term downtrend with lower closes';
  else if (bandWidthPct < 8) pattern = 'Volatility squeeze';
  else if (prev.low <= lowerBand && last.close > prev.close) pattern = 'Rebound from lower band support';

  const thresholdRead =
    last.close >= resistance20 * 0.98 ? 'Testing recent breakout threshold'
    : last.close <= support20 * 1.02 ? 'Testing near-term floor'
    : 'Trading inside the recent range';

  return [
    `Latest close: $${last.close.toFixed(2)} on ${String(last.time).slice(0, 10)}`,
    `SMA20: $${sma20.toFixed(2)} | Bollinger: lower $${lowerBand.toFixed(2)}, upper $${upperBand.toFixed(2)} | bandwidth ${bandWidthPct.toFixed(1)}%`,
    `Near-term floor / support: $${support20.toFixed(2)} | Near-term threshold / resistance: $${resistance20.toFixed(2)}`,
    `Intermediate floor / support: $${support60.toFixed(2)} | Intermediate threshold / resistance: $${resistance60.toFixed(2)}`,
    `10-bar trend: ${trend10 >= 0 ? '+' : ''}${trend10.toFixed(1)}%`,
    `Detected pattern: ${pattern}`,
    `Regime read: ${thresholdRead}`,
  ].join('\n');
}

function summarizeNews(news) {
  if (!Array.isArray(news) || news.length === 0) return 'No recent company news available.';
  return news.slice(0, 5).map((item, index) =>
    `${index + 1}. ${item.headline} (${item.source || 'Unknown source'})`
  ).join('\n');
}

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
  if (context?.candles?.length) {
    ctx.push('Technical snapshot:');
    ctx.push(summarizeTechnicals(context.candles));
  }
  if (context?.insiders?.length) {
    const buys  = context.insiders.filter(t => t.transactionCode === 'P');
    const sells = context.insiders.filter(t => t.transactionCode === 'S' || t.transactionCode === 'S-');
    ctx.push(`Recent insider activity: ${buys.length} buys, ${sells.length} sells in last 2 years`);
    const top = context.insiders.slice(0, 5).map(t =>
      `${t.name} (${t.title || 'insider'}) ${t.transactionCode === 'P' ? 'BOUGHT' : 'SOLD'} ${Math.abs(t.share).toLocaleString()} shares @ $${t.transactionPrice} on ${t.transactionDate}`
    );
    ctx.push('Recent insider trades:\n' + top.join('\n'));
  }
  if (context?.news?.length) {
    ctx.push('Recent news headlines:');
    ctx.push(summarizeNews(context.news));
  }

  const systemPrompt = `You are a sharp Wall Street equity analyst covering ${symbol}. Answer like a senior analyst briefing a PM - direct, specific, data-driven.

RESPONSE FORMAT RULES:
- Lead with a one-line verdict first
- Use compact markdown sections in this order when the question is analytical:
  **Trend / Regime**
  **Key Levels**
  **Indicator Read**
  **Insider / News Read**
  **Bullish Case**
  **Bearish Case**
  **Bottom line**
- Use bullet points (-) when listing 3+ items
- Bold key numbers and names with **markdown**
- Keep it under 260 words unless the question clearly needs more
- Never use generic disclaimers ("consult a financial advisor", "past performance", etc.)
- If you don't know a specific fact, say so briefly and pivot to what the data does show
- Explicitly mention price floors, thresholds, Bollinger context, and pattern read when technical data is available
- Explicitly comment on insider buy/sell balance and how the news flow supports or conflicts with the chart

STOCK CONTEXT (live data as of today):
${ctx.join('\n') || 'No live context - rely on your training knowledge about this company.'}`;

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
    const value = parseInt(getTag('value') || '0', 10); // XML value field is in full USD dollars
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
  const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/`;
  let infoTableUrl = null;
  try {
    // Scrape the HTML directory listing — reliable for all filers
    // (the {accession}-index.json file does not exist on EDGAR S3 for most filers)
    const html = await httpsGet(dirUrl, { 'User-Agent': 'TARS admin@tars.app' });
    const xmlHrefs = [...html.matchAll(/href="([^"]+\.xml)"/gi)].map(m => m[1]);
    // Exclude primary_doc.xml (cover page) — info table is the other XML file
    const infoHref = xmlHrefs.find(h => !h.toLowerCase().includes('primary_doc'));
    if (infoHref) {
      const filename = infoHref.split('/').pop();
      infoTableUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/${filename}`;
    }
  } catch (e) {
    console.error('[13f/dir]', e.message);
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
  // Mega / Index
  { cik: '102909',  name: 'VANGUARD GROUP INC' },
  { cik: '1315066', name: 'FMR LLC' },
  { cik: '813672',  name: 'CAPITAL RESEARCH GLOBAL INVESTORS' },
  { cik: '1067983', name: 'BERKSHIRE HATHAWAY INC' },
  { cik: '1166559', name: 'BILL & MELINDA GATES FOUNDATION TRUST' },
  // Quant / Multi-strat
  { cik: '1037389', name: 'RENAISSANCE TECHNOLOGIES LLC' },
  { cik: '1273087', name: 'MILLENNIUM MANAGEMENT LLC' },
  { cik: '1423053', name: 'CITADEL ADVISORS LLC' },
  { cik: '1275014', name: 'D E SHAW & CO INC' },
  { cik: '1595882', name: 'TWO SIGMA INVESTMENTS LP' },
  { cik: '1540159', name: 'POINT72 ASSET MANAGEMENT LP' },
  { cik: '1167557', name: 'AQR CAPITAL MANAGEMENT LLC' },
  { cik: '1649339', name: 'MAGNETAR FINANCIAL LLC' },
  { cik: '1218710', name: 'BALYASNY ASSET MANAGEMENT LP' },
  { cik: '1612063', name: 'WINTON GROUP LTD' },
  { cik: '1637460', name: 'MAN GROUP PLC' },
  // Long / Short Equity
  { cik: '1350694', name: 'BRIDGEWATER ASSOCIATES LP' },
  { cik: '1167483', name: 'TIGER GLOBAL MANAGEMENT LLC' },
  { cik: '1466373', name: 'COATUE MANAGEMENT LLC' },
  { cik: '1040273', name: 'VIKING GLOBAL INVESTORS LP' },
  { cik: '1336489', name: 'LONE PINE CAPITAL LLC' },
  { cik: '1056931', name: 'APPALOOSA MANAGEMENT LP' },
  { cik: '875956',  name: 'BAUPOST GROUP LLC' },
  { cik: '1536411', name: 'DUQUESNE FAMILY OFFICE LLC' },
  { cik: '1318757', name: 'MARSHALL WACE LLP' },
  { cik: '1602189', name: 'DRAGONEER INVESTMENT GROUP LLC' },
  { cik: '923093',  name: 'TUDOR INVESTMENT CORP' },
  // Activist
  { cik: '1336528', name: 'PERSHING SQUARE CAPITAL MANAGEMENT LP' },
  { cik: '1040570', name: 'THIRD POINT LLC' },
  { cik: '1079114', name: 'GREENLIGHT CAPITAL INC' },
  { cik: '814180',  name: 'ICAHN CAPITAL LP' },
  { cik: '1162175', name: 'JANA PARTNERS LLC' },
  { cik: '892416',  name: 'ELLIOTT INVESTMENT MANAGEMENT LP' },
  { cik: '1486671', name: 'STARBOARD VALUE LP' },
  // AI / Tech focused
  { cik: '2045724', name: 'SITUATIONAL AWARENESS LP' },
];

// Cached recent-filers response
let recentFilersCache = null;
let recentFilersFetch = 0;
const RECENT_FILERS_TTL = 6 * 60 * 60 * 1000; // 6h

app.get('/api/13f/recent-filers', async (req, res) => {
  try {
    const now = Date.now();
    if (recentFilersCache && now - recentFilersFetch < RECENT_FILERS_TTL) {
      return res.json(recentFilersCache);
    }

    const categories = {
      '102909':  'Index / Mega', '1315066': 'Index / Mega', '813672': 'Index / Mega',
      '1067983': 'Value',         '1166559': 'Foundation',
      '1037389': 'Quant',         '1273087': 'Multi-Strat',  '1423053': 'Multi-Strat',
      '1275014': 'Quant',         '1595882': 'Quant',         '1540159': 'Multi-Strat',
      '1167557': 'Quant',         '1649339': 'Quant',         '1218710': 'Multi-Strat',
      '1612063': 'Quant',         '1637460': 'Multi-Strat',
      '1350694': 'Macro',         '1167483': 'Long/Short',    '1466373': 'Long/Short',
      '1040273': 'Long/Short',    '1336489': 'Long/Short',    '1056931': 'Long/Short',
      '875956':  'Long/Short',    '1536411': 'Family Office', '1318757': 'Long/Short',
      '1602189': 'Growth',        '923093':  'Macro',
      '1336528': 'Activist',      '1040570': 'Activist',      '1079114': 'Activist',
      '814180':  'Activist',      '1162175': 'Activist',      '892416':  'Activist',
      '1486671': 'Activist',      '2045724': 'AI / Tech',
    };

    async function getLatestDate(cik) {
      try {
        const pad = cik.padStart(10, '0');
        const data = await httpsGet(`https://data.sec.gov/submissions/CIK${pad}.json`, { 'User-Agent': 'TARS admin@tars.app' });
        const json = JSON.parse(data);
        const forms = json.filings?.recent?.form ?? [];
        const dates = json.filings?.recent?.filingDate ?? [];
        for (let i = 0; i < forms.length; i++) {
          if (forms[i] === '13F-HR') return dates[i] ?? '';
        }
      } catch {}
      return '';
    }

    // Batch 5 at a time to avoid overwhelming EDGAR
    const batchSize = 5;
    const results = [];
    for (let i = 0; i < KNOWN_FUNDS.length; i += batchSize) {
      const batch = KNOWN_FUNDS.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async f => ({
          cik: f.cik,
          name: f.name,
          lastFiled: await getLatestDate(f.cik),
          category: categories[f.cik] || 'Other',
        }))
      );
      results.push(...batchResults);
    }

    // Sort by most recently filed
    results.sort((a, b) => b.lastFiled.localeCompare(a.lastFiled));

    recentFilersCache = { funds: results };
    recentFilersFetch = now;
    res.json(recentFilersCache);
  } catch (err) {
    console.error('[13f/recent-filers]', err.message);
    res.status(502).json({ error: err.message, funds: [] });
  }
});

app.get('/api/13f/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ funds: [] });
  const qUpper = q.toUpperCase();

  try {
    // Helper: get latest 13F-HR filing date for a CIK from EDGAR submissions API
    async function getLatest13FDate(cik) {
      try {
        const padded = cik.padStart(10, '0');
        const data = await httpsGet(`https://data.sec.gov/submissions/CIK${padded}.json`, { 'User-Agent': 'TARS admin@tars.app' });
        const json = JSON.parse(data);
        const recent = json.filings?.recent ?? {};
        const forms = recent.form ?? [];
        const dates = recent.filingDate ?? [];
        for (let i = 0; i < forms.length; i++) {
          if (forms[i] === '13F-HR') return dates[i] ?? '';
        }
      } catch {}
      return '';
    }

    // 1. Search the curated known-funds list + fetch latest filing dates in parallel
    const knownBase = KNOWN_FUNDS.filter(f => f.name.includes(qUpper));
    const knownMatches = await Promise.all(
      knownBase.map(async f => ({ ...f, lastFiled: await getLatest13FDate(f.cik) }))
    );
    // Sort known matches by most-recent filing first
    knownMatches.sort((a, b) => b.lastFiled.localeCompare(a.lastFiled));

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

    // 3. EDGAR CGI company search — catches private hedge funds not in tickers file
    //    Use default browser UA (TARS UA is blocked by EDGAR CGI, data.sec.gov UA isn't)
    let edgarMatches = [];
    try {
      const edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(q)}&CIK=&type=13F-HR&dateb=&owner=include&count=20&search_text=&action=getcompany&output=atom`;
      const xml = await httpsGet(edgarUrl); // default Mozilla/Chrome UA — do NOT override
      const decode = s => s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(+c));
      const getTag = (block, tag) => { const r=new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i'); const x=r.exec(block); if(!x)return''; const raw=x[1].trim(); const cd=raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/); return decode(cd?cd[1].trim():raw); };
      const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
      let m;
      while ((m = entryRe.exec(xml)) !== null) {
        const block = m[1];
        const title = getTag(block, 'title');
        const updated = getTag(block, 'updated').slice(0, 10);
        const linkRaw = /<link[^>]+href="([^"]+)"/.exec(block);
        const href = linkRaw ? decode(linkRaw[1]) : '';
        const cikMatch = href.match(/[?&]CIK=0*(\d+)/i);
        const cik = cikMatch ? cikMatch[1] : '';
        const nameMatch = title.match(/^[\w\/\-]+\s+-\s+(.+?)\s+\(\d+\)/);
        const name = nameMatch ? nameMatch[1].trim() : '';
        if (cik && name) edgarMatches.push({ cik, name, lastFiled: updated });
      }
      console.log(`[13f/search] EDGAR CGI: xml=${xml.length}b entries=${edgarMatches.length}`);
    } catch (e) {
      console.error('[13f/edgar]', e.message);
    }

    // Merge all three sources (known list → public tickers → EDGAR CGI), deduplicate by CIK
    // Known list is pre-sorted by lastFiled desc; others follow after
    const seen = new Set();
    const funds = [];
    for (const f of [...knownMatches, ...tickerMatches, ...edgarMatches]) {
      if (!seen.has(f.cik)) { seen.add(f.cik); funds.push(f); }
      if (funds.length >= 15) break;
    }

    console.log(`[13f/search] q="${q}" known=${knownMatches.length} tickers=${tickerMatches.length} edgar=${edgarMatches.length}`);
    res.json({ funds });
  } catch (err) {
    console.error('[13f/search]', err.message);
    res.status(502).json({ error: err.message, funds: [] });
  }
});

// Get 13F holdings for a fund CIK — latest + previous for QoQ change detection
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

    const totalValue = current.reduce((s, h) => s + h.value, 0);

    // Build a lookup from previous quarter by CUSIP (primary) or name (fallback)
    const prevMap = new Map();
    for (const h of (previous ?? [])) {
      if (h.cusip) prevMap.set(h.cusip, h);
      prevMap.set(h.name.toUpperCase(), h);
    }

    const withFlags = current.map(h => {
      const key = h.cusip || h.name.toUpperCase();
      const prev = prevMap.get(key);
      let changeType = 'unchanged';
      let changePct = 0;
      if (!previous) {
        changeType = 'unknown';
      } else if (!prev) {
        changeType = 'new';
      } else {
        changePct = prev.shares > 0 ? ((h.shares - prev.shares) / prev.shares) * 100 : 0;
        if (changePct > 1)       changeType = 'increased';
        else if (changePct < -1) changeType = 'decreased';
        else                     changeType = 'unchanged';
      }
      return {
        ...h,
        isNew: changeType === 'new',
        changeType,
        changePct,
        pctOfPortfolio: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
      };
    });

    // Positions held last quarter but gone this quarter (fully exited)
    const currentKeys = new Set(current.flatMap(h => [h.cusip, h.name.toUpperCase()].filter(Boolean)));
    const exited = (previous ?? [])
      .filter(h => !currentKeys.has(h.cusip) && !currentKeys.has(h.name.toUpperCase()))
      .map(h => ({ ...h, changeType: 'exited', changePct: -100, isNew: false, pctOfPortfolio: 0 }));

    const newCount       = withFlags.filter(h => h.changeType === 'new').length;
    const increasedCount = withFlags.filter(h => h.changeType === 'increased').length;
    const decreasedCount = withFlags.filter(h => h.changeType === 'decreased').length;

    res.json({
      fund: name,
      meta: {
        filingDate: latestFiling.filingDate,
        period: latestFiling.period,
        totalValue,
        positionCount: current.length,
        newCount,
        increasedCount,
        decreasedCount,
        exitedCount: exited.length,
      },
      current: withFlags,
      exited,
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

// ── Cross-fund options scan ───────────────────────────────────────────────────
// Pre-fetches options positions (putCall != null) from all curated KNOWN_FUNDS.
// Runs in background on startup + cached 24h. Returns {positions, loading}.
let optionsScanCache = null;
let optionsScanLastFetch = 0;
let optionsScanBuilding = false;
const OPTIONS_SCAN_TTL = 24 * 60 * 60 * 1000;

async function buildOptionsScan() {
  if (optionsScanBuilding) return;
  optionsScanBuilding = true;
  try {
    const all = [];
    const batchSize = 3;
    for (let i = 0; i < KNOWN_FUNDS.length; i += batchSize) {
      const batch = KNOWN_FUNDS.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(async (fund) => {
        try {
          const { results: filings } = await get13FFilings(fund.cik);
          if (!filings.length) return [];
          const holdings = await fetchHoldings(fund.cik, filings[0].accession);
          return holdings
            .filter(h => h.putCall)
            .map(h => ({
              fund: fund.name,
              fundCik: fund.cik,
              name: h.name,
              cusip: h.cusip,
              putCall: h.putCall,
              value: h.value,
              shares: h.shares,
              sector: h.sector,
            }));
        } catch { return []; }
      }));
      for (const r of results) {
        if (r.status === 'fulfilled') all.push(...r.value);
      }
    }
    optionsScanCache = all.sort((a, b) => b.value - a.value);
    optionsScanLastFetch = Date.now();
    console.log(`[options-scan] built: ${optionsScanCache.length} positions across ${KNOWN_FUNDS.length} funds`);
  } catch (e) {
    console.error('[options-scan]', e.message);
  } finally {
    optionsScanBuilding = false;
  }
}

app.get('/api/13f/options-scan', async (_req, res) => {
  const now = Date.now();
  if (optionsScanCache && now - optionsScanLastFetch < OPTIONS_SCAN_TTL) {
    return res.json({ positions: optionsScanCache, loading: false });
  }
  if (!optionsScanBuilding) buildOptionsScan(); // fire-and-forget refresh
  if (optionsScanCache) {
    return res.json({ positions: optionsScanCache, loading: true }); // stale while refreshing
  }
  res.json({ positions: [], loading: true }); // first load — still building
});

// Pre-warm on startup (delay 8s to let server stabilise first)
setTimeout(() => buildOptionsScan().catch(e => console.error('[options-scan init]', e.message)), 8000);

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
