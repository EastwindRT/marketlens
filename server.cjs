const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const LOCAL_DEV_LIVE_ORIGIN = process.env.LOCAL_DEV_LIVE_ORIGIN || 'https://marketlens-jn9s.onrender.com';
const SERVICE_SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SERVICE_SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const serverSupabase = SERVICE_SUPABASE_URL && SERVICE_SUPABASE_KEY
  ? createSupabaseClient(SERVICE_SUPABASE_URL, SERVICE_SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

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

// Retry wrapper — retries on transient failures (429, 5xx, timeouts, network errors)
// with exponential backoff + jitter. Used by httpsGet/httpsPost below.
async function withRetry(fn, { retries = 2, baseMs = 500, label = 'req' } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      const transient = /HTTP (408|425|429|5\d\d)|Timeout|ECONN|socket hang up|ETIMEDOUT|EAI_AGAIN/i.test(msg);
      if (!transient || i === retries) throw err;
      const delay = Math.round(baseMs * Math.pow(2, i) + Math.random() * 250);
      console.log(`[retry:${label}] ${msg} — attempt ${i + 1}/${retries} after ${delay}ms`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

function httpsGetOnce(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', ...headers } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGetOnce(res.headers.location, headers).then(resolve).catch(reject);
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

function httpsGet(url, headers = {}) {
  return withRetry(() => httpsGetOnce(url, headers), { label: `GET ${new URL(url).hostname}` });
}

function httpsPostOnce(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ...headers,
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(data);
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(bodyStr);
    req.end();
  });
}

function httpsPost(url, body, headers = {}) {
  return withRetry(() => httpsPostOnce(url, body, headers), { label: `POST ${new URL(url).hostname}` });
}

function toFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const MARKET_DATA_DATASETS = {
  congress: 'congress_trades',
  usInsiders(days) {
    return `us_insider_${days}`;
  },
  caInsiders(days, mode) {
    return `ca_insider_${days}_${mode}`;
  },
};

function hasServerSupabase() {
  return Boolean(serverSupabase);
}

function hasMarketDataDb() {
  return hasServerSupabase();
}

async function getMarketDataSyncState(dataset) {
  if (!hasMarketDataDb()) return null;
  const { data, error } = await serverSupabase
    .from('market_data_sync_state')
    .select('dataset,synced_at,row_count')
    .eq('dataset', dataset)
    .maybeSingle();
  if (error) {
    throw new Error(`sync state read failed for ${dataset}: ${error.message}`);
  }
  return data || null;
}

async function setMarketDataSyncState(dataset, rowCount) {
  if (!hasMarketDataDb()) return;
  const payload = {
    dataset,
    synced_at: new Date().toISOString(),
    row_count: Number.isFinite(rowCount) ? rowCount : 0,
  };
  const { error } = await serverSupabase
    .from('market_data_sync_state')
    .upsert(payload, { onConflict: 'dataset' });
  if (error) {
    throw new Error(`sync state write failed for ${dataset}: ${error.message}`);
  }
}

function isSyncStateFresh(syncState, ttlMs) {
  if (!syncState?.synced_at) return false;
  const syncedAtMs = Date.parse(syncState.synced_at);
  if (!Number.isFinite(syncedAtMs)) return false;
  return Date.now() - syncedAtMs <= ttlMs;
}

async function readCongressTradesFromDb({ tickers = null, cutoff = null, limit = null } = {}) {
  if (!hasMarketDataDb()) return [];

  let query = serverSupabase
    .from('congress_trades')
    .select('id,member,party,state,ticker,asset_description,type,amount,amount_min,transaction_date,disclosure_date,filing_url,chamber')
    .order('transaction_date', { ascending: false })
    .order('amount_min', { ascending: false });

  if (Array.isArray(tickers) && tickers.length) {
    query = query.in('ticker', tickers);
  }
  if (cutoff) {
    query = query.gte('transaction_date', cutoff);
  }
  if (Number.isFinite(limit) && limit > 0) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`congress db read failed: ${error.message}`);
  }

  return (data || []).map((trade) => ({
    id: trade.id,
    member: trade.member,
    party: trade.party || '',
    state: trade.state || '',
    ticker: trade.ticker,
    assetDescription: trade.asset_description || '',
    type: trade.type,
    amount: trade.amount || '',
    amountMin: Number(trade.amount_min || 0),
    transactionDate: trade.transaction_date || '',
    disclosureDate: trade.disclosure_date || '',
    filingUrl: trade.filing_url || '',
    chamber: trade.chamber || 'house',
  }));
}

async function writeCongressTradesToDb(trades) {
  if (!hasMarketDataDb() || !Array.isArray(trades) || trades.length === 0) {
    return { written: 0, skipped: 0, failedChunks: 0 };
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 365);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Dedupe by id within the batch. Postgres upsert with ON CONFLICT errors out
  // ("cannot affect row a second time") if the same conflict key appears twice
  // in one statement, which is common in the Quiver feed when amount/date/etc
  // collide for the same member+ticker+type.
  const dedup = new Map();
  let skipped = 0;
  for (const trade of trades) {
    if (!trade?.id) { skipped += 1; continue; }
    if (!trade.transactionDate || trade.transactionDate < cutoffStr) { skipped += 1; continue; }
    if (dedup.has(trade.id)) { skipped += 1; continue; }
    dedup.set(trade.id, {
      id: trade.id,
      member: trade.member,
      party: trade.party || null,
      state: trade.state || null,
      ticker: trade.ticker,
      asset_description: trade.assetDescription || null,
      type: trade.type,
      amount: trade.amount || null,
      amount_min: Number.isFinite(trade.amountMin) ? trade.amountMin : 0,
      transaction_date: trade.transactionDate || null,
      disclosure_date: trade.disclosureDate || null,
      filing_url: trade.filingUrl || null,
      chamber: trade.chamber || 'house',
      updated_at: new Date().toISOString(),
    });
  }

  const rows = Array.from(dedup.values());
  const chunkSize = 200;
  let written = 0;
  let failedChunks = 0;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await serverSupabase
      .from('congress_trades')
      .upsert(chunk, { onConflict: 'id' });
    if (error) {
      failedChunks += 1;
      console.error(`[congress-db-write] chunk ${i}-${i + chunk.length} failed: ${error.message}`);
      continue;
    }
    written += chunk.length;
  }

  console.log(`[congress-db-write] written=${written} skipped=${skipped} failedChunks=${failedChunks} total=${trades.length}`);
  return { written, skipped, failedChunks };
}

async function readCaInsiderTradesFromDb(days, mode) {
  if (!hasMarketDataDb()) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let query = serverSupabase
    .from('ca_insider_filings')
    .select('id,symbol,company_name,insider_name,title,type,open_market,transaction_date,filing_date,shares,price_per_share,total_value,market,exchange,source,filing_url')
    .gte('filing_date', cutoffStr)
    .order('filing_date', { ascending: false })
    .order('transaction_date', { ascending: false })
    .order('total_value', { ascending: false });

  if (mode === 'insiders') {
    query = query.eq('open_market', true);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`ca insider db read failed: ${error.message}`);
  }

  return (data || []).map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    companyName: trade.company_name || '',
    insiderName: trade.insider_name || '',
    title: trade.title || '',
    type: trade.type,
    transactionDate: trade.transaction_date || '',
    filingDate: trade.filing_date || '',
    shares: toFiniteNumber(trade.shares),
    pricePerShare: toFiniteNumber(trade.price_per_share),
    totalValue: toFiniteNumber(trade.total_value),
    market: trade.market || 'CA',
    exchange: trade.exchange || 'TSX',
    source: trade.source || 'TMX/SEDI',
    filingUrl: trade.filing_url || null,
  }));
}

async function writeCaInsiderTradesToDb(trades) {
  if (!hasMarketDataDb() || !Array.isArray(trades) || trades.length === 0) return;

  const rows = trades.map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    company_name: trade.companyName || null,
    insider_name: trade.insiderName || null,
    title: trade.title || null,
    type: trade.type,
    open_market: trade.type === 'BUY' || trade.type === 'SELL',
    transaction_date: trade.transactionDate || null,
    filing_date: trade.filingDate || null,
    shares: trade.shares,
    price_per_share: trade.pricePerShare,
    total_value: trade.totalValue,
    market: trade.market || 'CA',
    exchange: trade.exchange || 'TSX',
    source: trade.source || 'TMX/SEDI',
    filing_url: trade.filingUrl || null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await serverSupabase
    .from('ca_insider_filings')
    .upsert(rows, { onConflict: 'id' });
  if (error) {
    throw new Error(`ca insider db write failed: ${error.message}`);
  }
}

async function readUsInsiderTradesFromDb(days) {
  if (!hasMarketDataDb()) return [];

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const { data, error } = await serverSupabase
    .from('us_insider_trades')
    .select('id,symbol,company_name,insider_name,title,type,transaction_code,event_category,transaction_date,filing_date,shares,price_per_share,total_value,market,exchange,source,filing_url')
    .gte('filing_date', cutoffStr)
    .order('filing_date', { ascending: false })
    .order('transaction_date', { ascending: false })
    .order('total_value', { ascending: false });
  if (error) {
    throw new Error(`us insider db read failed: ${error.message}`);
  }

  return (data || []).map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
    companyName: trade.company_name || '',
    insiderName: trade.insider_name || '',
    title: trade.title || '',
    type: trade.type || 'OTHER',
    transactionCode: trade.transaction_code || null,
    eventCategory: trade.event_category || 'other',
    transactionDate: trade.transaction_date || '',
    filingDate: trade.filing_date || '',
    shares: toFiniteNumber(trade.shares) || 0,
    pricePerShare: toFiniteNumber(trade.price_per_share),
    totalValue: toFiniteNumber(trade.total_value),
    market: trade.market || 'US',
    exchange: trade.exchange || 'SEC',
    source: trade.source || 'SEC Form 4',
    filingUrl: trade.filing_url || '',
  }));
}

async function writeUsInsiderTradesToDb(trades) {
  if (!hasMarketDataDb() || !Array.isArray(trades) || trades.length === 0) return;

  const dedupedTrades = [...new Map(trades
    .filter((trade) => trade?.id && trade?.symbol)
    .map((trade) => [trade.id, trade])
  ).values()];

  const rows = dedupedTrades.map((trade) => ({
    id: String(trade.id),
    symbol: String(trade.symbol).toUpperCase(),
    company_name: trade.companyName || null,
    insider_name: trade.insiderName || null,
    title: trade.title || null,
    type: trade.type || 'OTHER',
    transaction_code: trade.transactionCode || null,
    event_category: trade.eventCategory || 'other',
    transaction_date: trade.transactionDate || null,
    filing_date: trade.filingDate || null,
    shares: trade.shares,
    price_per_share: trade.pricePerShare,
    total_value: trade.totalValue,
    market: trade.market || 'US',
    exchange: trade.exchange || 'SEC',
    source: trade.source || 'SEC Form 4',
    filing_url: trade.filingUrl || null,
    updated_at: new Date().toISOString(),
  }));

  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error } = await serverSupabase
      .from('us_insider_trades')
      .upsert(chunk, { onConflict: 'id' });
    if (error) {
      throw new Error(`us insider db write failed: ${error.message}`);
    }
  }
}

// In-memory cache
let congressCache = null;
let congressRefreshBuild = null;
let congressLastFetch = 0;
const CONGRESS_CACHE_TTL = 30 * 60 * 1000; // 30 min — Quiver updates ~daily but let's stay fresh

// Quiver Quant — free public endpoint, covers both House & Senate, updated daily with ~1-2 day lag
const QUIVER_CONGRESS_URL = 'https://api.quiverquant.com/beta/live/congresstrading';
const QUIVER_HEADERS = { 'Authorization': 'Bearer public', 'Accept': 'application/json' };

async function fetchCongressData() {
  const raw = await httpsGet(QUIVER_CONGRESS_URL, QUIVER_HEADERS);
  return JSON.parse(raw);
}

async function refreshCongressTradesFromSource() {
  if (congressRefreshBuild) return congressRefreshBuild;

  congressRefreshBuild = (async () => {
    const rawTrades = await fetchCongressData();
    congressCache = rawTrades;
    congressLastFetch = Date.now();

    const mappedTrades = (Array.isArray(rawTrades) ? rawTrades : [])
      .map(mapQuiverCongressTrade)
      .filter(Boolean)
      .sort((a, b) =>
        (b.transactionDate || '').localeCompare(a.transactionDate || '')
        || ((b.amountMin || 0) - (a.amountMin || 0))
      );

    if (hasMarketDataDb()) {
      try {
        const result = await writeCongressTradesToDb(mappedTrades);
        if (result.written > 0) {
          await setMarketDataSyncState(MARKET_DATA_DATASETS.congress, result.written);
        } else {
          console.error('[congress-refresh] no rows written; sync state not updated');
        }
      } catch (err) {
        console.error('[congress-refresh] db write threw:', err.message);
      }
    }

    return mappedTrades;
  })().finally(() => {
    congressRefreshBuild = null;
  });

  return congressRefreshBuild;
}

function parseAmountMin(amount) {
  const clean = String(amount || '').replace(/[,$]/g, '').toLowerCase();
  const match = clean.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function mapQuiverCongressTrade(t) {
  const ticker = (t.Ticker || '').trim().toUpperCase();
  if (!ticker || ticker === 'N/A' || ticker === '--' || ticker.length > 8) return null;

  const txType = (t.Transaction || '').toLowerCase();
  if (!txType.includes('purchase') && !txType.includes('sale') && !txType.includes('sell') && !txType.includes('exchange')) {
    return null;
  }

  const txDate = normaliseDate(t.TransactionDate || '');
  if (!txDate) return null;

  const member = (t.Representative || '').trim();
  if (!member) return null;

  const amount = t.Range || t.Amount || '';
  const disclosureDate = normaliseDate(t.ReportDate || '');
  const amountMin = parseAmountMin(amount);
  const chamber = (t.House || '').toLowerCase() === 'senate' ? 'senate' : 'house';

  return {
    id: `congress-${slugify(member)}-${ticker}-${txDate}-${txType.includes('purchase') ? 'purchase' : txType.includes('exchange') ? 'exchange' : 'sale'}-${amountMin}-${disclosureDate || 'na'}-${chamber}`,
    member,
    party: (t.Party || '').trim(),
    state: '',
    ticker,
    assetDescription: t.Description || '',
    type: txType.includes('purchase') ? 'purchase' : txType.includes('exchange') ? 'exchange' : 'sale',
    amount,
    amountMin,
    transactionDate: txDate,
    disclosureDate,
    filingUrl: '',
    chamber,
  };
}

function formatDateFromUnix(timestamp) {
  if (!Number.isFinite(timestamp)) return '';
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

function findEntryCloseForDate(bars, tradeDate) {
  if (!Array.isArray(bars) || !bars.length || !tradeDate) return null;
  let bestOnOrBefore = null;
  let firstAfter = null;

  for (const bar of bars) {
    const barDate = formatDateFromUnix(bar.time);
    if (!barDate) continue;
    if (barDate <= tradeDate) {
      bestOnOrBefore = bar;
    } else if (!firstAfter) {
      firstAfter = bar;
      break;
    }
  }

  return finiteNumber((bestOnOrBefore || firstAfter)?.close);
}

async function buildCongressReturnMap(trades) {
  const tickers = [...new Set((trades || []).map((trade) => trade.ticker).filter(Boolean))];
  const entries = await Promise.all(
    tickers.map(async (ticker) => {
      try {
        const { bars } = await fetchYahooChart(ticker, '1y', '1d');
        const latestClose = bars.length ? finiteNumber(bars[bars.length - 1]?.close) : null;
        return [ticker, { bars, latestClose }];
      } catch (err) {
        console.error(`[congress-returns:${ticker}]`, err.message);
        return [ticker, { bars: [], latestClose: null }];
      }
    })
  );
  return new Map(entries);
}

async function enrichCongressTradesWithReturns(trades) {
  const returnMap = await buildCongressReturnMap(trades);
  return trades.map((trade) => {
    if (trade.type !== 'purchase' && trade.type !== 'sale') {
      return {
        ...trade,
        estimatedReturnPct: null,
        currentPrice: null,
        entryPrice: null,
      };
    }

    const tickerData = returnMap.get(trade.ticker);
    const currentPrice = finiteNumber(tickerData?.latestClose);
    const entryPrice = findEntryCloseForDate(tickerData?.bars || [], trade.transactionDate);
    if (!Number.isFinite(currentPrice) || !Number.isFinite(entryPrice) || entryPrice <= 0) {
      return {
        ...trade,
        estimatedReturnPct: null,
        currentPrice: currentPrice ?? null,
        entryPrice: entryPrice ?? null,
      };
    }

    const rawPct = ((currentPrice / entryPrice) - 1) * 100;
    const estimatedReturnPct = trade.type === 'sale' ? -rawPct : rawPct;

    return {
      ...trade,
      estimatedReturnPct,
      currentPrice,
      entryPrice,
    };
  });
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.get('/api/latest-congress', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '60', 10), 500);
    const { trades, stale } = await ensureCongressTrades({ limit });
    if (stale) {
      res.setHeader('X-Data-Stale', '1');
    }
    res.json({ trades });
  } catch (err) {
    console.error('[latest-congress]', err.message);
    res.status(502).json({ error: err.message, trades: [] });
  }
});

function groupCongressMemberActivity(trades) {
  const members = new Map();

  for (const trade of trades) {
    const memberId = `${slugify(trade.member)}:${trade.chamber}:${(trade.state || '').toUpperCase()}`;
    if (!members.has(memberId)) {
      members.set(memberId, {
        memberId,
        member: trade.member,
        party: trade.party || '',
        state: trade.state || '',
        chamber: trade.chamber,
        totalTrades: 0,
        purchaseCount: 0,
        saleCount: 0,
        exchangeCount: 0,
        buyAmountMin: 0,
        sellAmountMin: 0,
        totalAmountMin: 0,
        returnWeight: 0,
        weightedReturnSum: 0,
        latestTradeDate: '',
        topTickers: new Map(),
        recentTrades: [],
      });
    }

    const bucket = members.get(memberId);
    bucket.totalTrades += 1;
    bucket.totalAmountMin += trade.amountMin || 0;
    bucket.latestTradeDate = bucket.latestTradeDate > trade.transactionDate ? bucket.latestTradeDate : trade.transactionDate;
    if (trade.type === 'purchase') {
      bucket.purchaseCount += 1;
      bucket.buyAmountMin += trade.amountMin || 0;
    } else if (trade.type === 'sale') {
      bucket.saleCount += 1;
      bucket.sellAmountMin += trade.amountMin || 0;
    } else if (trade.type === 'exchange') {
      bucket.exchangeCount += 1;
    }

    const tickerKey = trade.ticker;
    if (!bucket.topTickers.has(tickerKey)) {
      bucket.topTickers.set(tickerKey, {
        ticker: trade.ticker,
        tradeCount: 0,
        purchaseCount: 0,
        saleCount: 0,
        estimatedGrossAmountMin: 0,
        estimatedNetAmountMin: 0,
        returnWeight: 0,
        weightedReturnSum: 0,
        averageReturnPct: null,
        latestTradeDate: '',
      });
    }
    const tickerBucket = bucket.topTickers.get(tickerKey);
    tickerBucket.tradeCount += 1;
    tickerBucket.estimatedGrossAmountMin += trade.amountMin || 0;
    tickerBucket.latestTradeDate = tickerBucket.latestTradeDate > trade.transactionDate ? tickerBucket.latestTradeDate : trade.transactionDate;
    if (trade.type === 'purchase') {
      tickerBucket.purchaseCount += 1;
      tickerBucket.estimatedNetAmountMin += trade.amountMin || 0;
    } else if (trade.type === 'sale') {
      tickerBucket.saleCount += 1;
      tickerBucket.estimatedNetAmountMin -= trade.amountMin || 0;
    }

    if (Number.isFinite(trade.estimatedReturnPct)) {
      const weight = trade.amountMin > 0 ? trade.amountMin : 1;
      bucket.returnWeight += weight;
      bucket.weightedReturnSum += trade.estimatedReturnPct * weight;
      tickerBucket.returnWeight += weight;
      tickerBucket.weightedReturnSum += trade.estimatedReturnPct * weight;
    }

    if (bucket.recentTrades.length < 8) {
      bucket.recentTrades.push(trade);
    }
  }

  return [...members.values()].map((member) => ({
    memberId: member.memberId,
    member: member.member,
    party: member.party,
    state: member.state,
    chamber: member.chamber,
    totalTrades: member.totalTrades,
    purchaseCount: member.purchaseCount,
    saleCount: member.saleCount,
    exchangeCount: member.exchangeCount,
    buyAmountMin: member.buyAmountMin,
    sellAmountMin: member.sellAmountMin,
    netAmountMin: member.buyAmountMin - member.sellAmountMin,
    totalAmountMin: member.totalAmountMin,
    latestTradeDate: member.latestTradeDate,
    topTickers: [...member.topTickers.values()]
      .map((ticker) => ({
        ...ticker,
        averageReturnPct: ticker.returnWeight > 0 ? ticker.weightedReturnSum / ticker.returnWeight : null,
      }))
      .sort((a, b) => b.estimatedGrossAmountMin - a.estimatedGrossAmountMin || b.tradeCount - a.tradeCount)
      .slice(0, 10),
    averageReturnPct: member.returnWeight > 0 ? member.weightedReturnSum / member.returnWeight : null,
    recentTrades: [...member.recentTrades]
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || (b.amountMin || 0) - (a.amountMin || 0))
      .slice(0, 8),
  }));
}

async function buildCongressMemberActivity(days) {
  const cacheKey = String(days);
  const cached = congressMemberCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < CONGRESS_MEMBER_TTL) {
    return cached.payload;
  }

  const { trades: filtered } = await ensureCongressTrades({ days });
  const enrichedTrades = await enrichCongressTradesWithReturns(filtered);
  const members = groupCongressMemberActivity(enrichedTrades).sort((a, b) =>
    b.totalAmountMin - a.totalAmountMin
    || b.totalTrades - a.totalTrades
    || b.latestTradeDate.localeCompare(a.latestTradeDate)
  );

  const payload = {
    asOf: new Date().toISOString(),
    days,
    memberCount: members.length,
    members,
  };

  congressMemberCache.set(cacheKey, { ts: Date.now(), payload });
  return payload;
}

app.get('/api/congress-members', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '180', 10), 30), 365);
  const cacheKey = String(days);

  try {
    const cached = congressMemberCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CONGRESS_MEMBER_TTL) {
      return res.json(cached.payload);
    }

    if (!congressMemberBuilds.has(cacheKey)) {
      congressMemberBuilds.set(
        cacheKey,
        buildCongressMemberActivity(days).finally(() => {
          congressMemberBuilds.delete(cacheKey);
        })
      );
    }

    const payload = await congressMemberBuilds.get(cacheKey);
    res.json(payload);
  } catch (err) {
    console.error('[congress-members]', err.message);
    res.status(502).json({ error: err.message, members: [] });
  }
});

app.get('/api/congress-trades', async (req, res) => {
  try {
    const tickers = String(req.query.tickers || '')
      .split(',')
      .map((ticker) => ticker.trim().replace(/\.(TO|TSX)$/i, '').toUpperCase())
      .filter(Boolean);
    const uniqueTickers = [...new Set(tickers)];
    if (uniqueTickers.length === 0) {
      return res.json({ trades: [] });
    }

    const days = Math.min(Math.max(parseInt(req.query.days || '90', 10), 1), 365);
    const { trades, stale } = await ensureCongressTrades({ tickers: uniqueTickers, days });
    if (stale) {
      res.setHeader('X-Data-Stale', '1');
    }
    res.json({ trades });
  } catch (err) {
    console.error('[congress-trades]', err.message);
    res.status(502).json({ error: err.message, trades: [] });
  }
});

app.get('/api/symbol-metadata', async (req, res) => {
  const symbols = String(req.query.symbols || '')
    .split(',')
    .map((symbol) => normalizeSymbol(symbol))
    .filter(Boolean);
  const uniqueSymbols = [...new Set(symbols)];
  if (uniqueSymbols.length === 0) {
    return res.json({ items: [] });
  }

  try {
    const items = await Promise.all(uniqueSymbols.map((symbol) => getSymbolMetadata(symbol)));
    res.json({ items });
  } catch (err) {
    console.error('[symbol-metadata]', err.message);
    res.status(502).json({ error: err.message, items: [] });
  }
});

app.get('/api/company-metadata', async (req, res) => {
  const subjects = String(req.query.subjects || '')
    .split('||')
    .map((subject) => subject.trim())
    .filter(Boolean);
  if (subjects.length === 0) {
    return res.json({ items: [] });
  }

  try {
    const directory = await loadSecCompanyTickerDirectory();
    const normalizedSubjects = [...new Set(subjects)];
    const resolved = await Promise.all(normalizedSubjects.map(async (subjectCompany) => {
      const match = directory.byNormalizedName.get(normalizeCompanyName(subjectCompany));
      if (!match?.ticker) {
        return { subjectCompany, symbol: null, sector: null, industry: null };
      }
      const metadata = await getSymbolMetadata(match.ticker, subjectCompany);
      return {
        subjectCompany,
        symbol: match.ticker,
        sector: metadata.sector,
        industry: metadata.industry,
      };
    }));
    res.json({ items: resolved });
  } catch (err) {
    console.error('[company-metadata]', err.message);
    res.status(502).json({ error: err.message, items: [] });
  }
});


function ensureMarketFilingsCache(cacheKey, days, force = false) {
  const cached = marketFilingsCache.get(cacheKey);
  if (!force && cached && Date.now() - cached.ts < MARKET_FILINGS_TTL) {
    return Promise.resolve(cached.payload);
  }
  if (marketFilingsBuilds.has(cacheKey)) {
    return marketFilingsBuilds.get(cacheKey);
  }
  const build = fetchMarketFilings(days)
    .then((filings) => {
      const payload = { filings };
      marketFilingsCache.set(cacheKey, { ts: Date.now(), payload });
      return payload;
    })
    .catch((err) => {
      if (cached) return cached.payload;
      throw err;
    })
    .finally(() => {
      marketFilingsBuilds.delete(cacheKey);
    });
  marketFilingsBuilds.set(cacheKey, build);
  return build;
}

app.get('/api/market-filings', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days || '14', 10), 7), 30);
  const cacheKey = String(days);

  try {
    const cached = marketFilingsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MARKET_FILINGS_TTL) {
      return res.json(cached.payload);
    }
    if (cached) {
      void ensureMarketFilingsCache(cacheKey, days, true);
      return res.json(cached.payload);
    }
    const payload = await ensureMarketFilingsCache(cacheKey, days, true);
    res.json(payload);
  } catch (err) {
    console.error('[market-filings]', err.message);
    res.status(502).json({ error: err.message, filings: [] });
  }
});

const FINNHUB_KEY = process.env.FINNHUB_API_KEY || process.env.VITE_FINNHUB_API_KEY || '';
const STOCK_INTELLIGENCE_TTL = 10 * 60 * 1000;
const stockIntelligenceCache = new Map();
const stockIntelligenceBuilds = new Map();
const SYMBOL_METADATA_TTL = 24 * 60 * 60 * 1000;
const symbolMetadataCache = new Map();
const symbolMetadataBuilds = new Map();
const CONGRESS_MEMBER_TTL = 30 * 60 * 1000;
const congressMemberCache = new Map();
const congressMemberBuilds = new Map();
const MARKET_FILINGS_TTL = 60 * 60 * 1000;
const marketFilingsCache = new Map();
const marketFilingsBuilds = new Map();
let secCompanyTickerDirectory = null;
let secCompanyTickerDirectoryFetch = 0;
let secCompanyTickerDirectoryBuild = null;
const SEC_COMPANY_DIRECTORY_TTL = 24 * 60 * 60 * 1000;

function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

function isCanadianTicker(symbol) {
  return /\.TO$/i.test(symbol);
}

function baseTicker(symbol) {
  return normalizeSymbol(symbol).replace(/\.TO$/i, '');
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCompanyName(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/\b(INCORPORATED|INC|CORPORATION|CORP|COMPANY|CO|LIMITED|LTD|PLC|HOLDINGS|HOLDING)\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function average(values) {
  const nums = values.map(finiteNumber).filter((value) => value != null);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function latestSma(closes, period) {
  if (!Array.isArray(closes) || closes.length < period) return null;
  return average(closes.slice(-period));
}

function pctDiff(value, basis) {
  if (!Number.isFinite(value) || !Number.isFinite(basis) || basis === 0) return null;
  return ((value / basis) - 1) * 100;
}

function describeTrend(close, sma20, sma50, sma200) {
  if (!Number.isFinite(close)) {
    return { trendState: 'unknown', trendExplanation: 'Price data unavailable.' };
  }

  const above20 = Number.isFinite(sma20) ? close > sma20 : null;
  const above50 = Number.isFinite(sma50) ? close > sma50 : null;
  const above200 = Number.isFinite(sma200) ? close > sma200 : null;

  if (above20 && above50 && above200) {
    return {
      trendState: 'bullish',
      trendExplanation: 'Price is above the 20, 50, and 200 day averages.',
    };
  }

  if (above20 === false && above50 === false && above200 === false) {
    return {
      trendState: 'bearish',
      trendExplanation: 'Price is below the 20, 50, and 200 day averages.',
    };
  }

  if (above20 && above50 === false) {
    return {
      trendState: 'mixed',
      trendExplanation: 'Short-term price is improving, but it remains below the 50 day average.',
    };
  }

  if (above20 === false && above50) {
    return {
      trendState: 'pullback',
      trendExplanation: 'Price is below the 20 day average but still above the 50 day average.',
    };
  }

  return {
    trendState: 'mixed',
    trendExplanation: 'Trend is not clearly aligned across the key moving averages.',
  };
}

function describeParticipation(relativeVolume) {
  if (!Number.isFinite(relativeVolume)) return 'unknown';
  if (relativeVolume >= 2) return 'very high';
  if (relativeVolume >= 1.3) return 'high';
  if (relativeVolume >= 0.8) return 'normal';
  return 'light';
}

function inferOwnershipSignal(filings) {
  if (!Array.isArray(filings) || filings.length === 0) return 'none';
  if (filings.some((filing) => filing.formType === '13D' || filing.formType === '13D/A')) return 'activist';
  if (filings.some((filing) => filing.formType === '13G' || filing.formType === '13G/A')) return 'passive';
  return 'neutral';
}

function summarizeOwnershipConviction({ ownershipFilings, insiderSummary, congressTrades, market }) {
  const insiderNet = finiteNumber(insiderSummary?.last30d?.netValue) || 0;
  const insiderBuys = insiderSummary?.last30d?.buyCount || 0;
  const insiderSells = insiderSummary?.last30d?.sellCount || 0;
  const congressBuys = Array.isArray(congressTrades) ? congressTrades.filter((trade) => trade.type === 'purchase').length : 0;
  const congressSells = Array.isArray(congressTrades) ? congressTrades.filter((trade) => trade.type === 'sale').length : 0;
  const hasActivist = Array.isArray(ownershipFilings) && ownershipFilings.some((filing) => filing.formType === '13D' || filing.formType === '13D/A');
  const hasPassive = Array.isArray(ownershipFilings) && ownershipFilings.some((filing) => filing.formType === '13G' || filing.formType === '13G/A');

  let score = 40;
  const reasons = [];

  if (hasActivist) {
    score += 22;
    reasons.push('Activist-style 13D ownership disclosure is present.');
  } else if (hasPassive) {
    score += 12;
    reasons.push('Passive 13G ownership disclosure is present.');
  }

  if (insiderBuys > insiderSells && insiderNet > 0) {
    score += 18;
    reasons.push('Recent insider buying outweighs selling.');
  } else if (insiderSells > insiderBuys && insiderNet < 0) {
    score -= 12;
    reasons.push('Recent insider selling outweighs buying.');
  } else if (insiderBuys + insiderSells > 0) {
    reasons.push('Insider activity is active but mixed.');
  }

  if (congressBuys > congressSells) {
    score += 6;
    reasons.push('Congress disclosures lean net-buying.');
  } else if (congressSells > congressBuys) {
    score -= 4;
    reasons.push('Congress disclosures lean net-selling.');
  }

  score = Math.max(0, Math.min(100, score));
  const label = score >= 72
    ? 'High Conviction'
    : score >= 58
    ? 'Constructive'
    : score >= 42
    ? 'Mixed'
    : 'Weak';

  return { score, label, reasons };
}

function summarizeEventPressure({ daysToEarnings, recentNewsCount, recentInsiderTrades, recentOwnershipFilings, recentCongressTrades }) {
  let score = 0;
  const reasons = [];

  if (daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= 14) {
    score += 35;
    reasons.push('Earnings are inside the next 14 days.');
  } else if (daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= 30) {
    score += 20;
    reasons.push('Earnings are within the next month.');
  }

  if (recentNewsCount >= 8) {
    score += 18;
    reasons.push('News flow is unusually busy.');
  } else if (recentNewsCount >= 3) {
    score += 10;
    reasons.push('News flow is active.');
  }

  if (recentInsiderTrades >= 4) {
    score += 15;
    reasons.push('Insider filing activity is elevated.');
  } else if (recentInsiderTrades > 0) {
    score += 8;
    reasons.push('Recent insider filings are present.');
  }

  if (recentOwnershipFilings > 0) {
    score += 16;
    reasons.push('Recent 13D/13G ownership filings add event pressure.');
  }

  if (recentCongressTrades >= 3) {
    score += 10;
    reasons.push('Congress trading activity is elevated.');
  } else if (recentCongressTrades > 0) {
    score += 5;
    reasons.push('Recent congress trades are present.');
  }

  const label = score >= 55 ? 'High' : score >= 28 ? 'Moderate' : 'Low';
  return { score, label, reasons };
}

function buildWhyMoving(price, trend, eventCounts) {
  const reasons = [];
  if (Number.isFinite(price.relativeVolume) && price.relativeVolume >= 1.3) {
    reasons.push(`Trading at ${price.relativeVolume.toFixed(2)}x normal volume.`);
  }
  if (trend.trendState === 'bullish') {
    reasons.push('Price is above the 20, 50, and 200 day averages.');
  } else if (trend.trendState === 'bearish') {
    reasons.push('Price is below the major moving averages.');
  } else if (trend.trendExplanation) {
    reasons.push(trend.trendExplanation);
  }
  if (eventCounts.daysToEarnings != null && eventCounts.daysToEarnings >= 0 && eventCounts.daysToEarnings <= 30) {
    reasons.push(`Upcoming earnings are ${eventCounts.daysToEarnings} days away.`);
  }
  if ((eventCounts.recentOwnershipFilings || 0) > 0) {
    reasons.push('Recent 13D/13G ownership filings are on record.');
  }
  return reasons.slice(0, 4);
}

function htmlDecode(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractXmlTag(block, tag) {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
  if (!match) return '';
  const raw = match[1].trim();
  const cdata = raw.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return htmlDecode((cdata ? cdata[1] : raw).trim());
}

function parseCompanyOwnershipFeed(xml) {
  const subjectCompanyMatch = xml.match(/<company-info>[\s\S]*?<conformed-name>([\s\S]*?)<\/conformed-name>/i);
  const subjectCompany = htmlDecode(subjectCompanyMatch?.[1] || '').trim();
  const filings = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const entry = match[1];
    const filingType = extractXmlTag(entry, 'filing-type');
    if (!/^SCHEDULE\s+13[DG](?:\/A)?$/i.test(filingType)) continue;
    const filingDate = extractXmlTag(entry, 'filing-date');
    const accessionNo = extractXmlTag(entry, 'accession-number');
    const filingHref = extractXmlTag(entry, 'filing-href');
    filings.push({
      accessionNo,
      formType: filingType.replace(/^SCHEDULE\s+/i, '').toUpperCase(),
      filedDate: filingDate,
      edgarUrl: filingHref,
      filerName: '',
      subjectCompany,
    });
  }
  return filings
    .filter((filing) => filing.filedDate)
    .sort((a, b) => b.filedDate.localeCompare(a.filedDate));
}

async function fetchCompanyOwnershipFilings(symbol) {
  if (isCanadianTicker(symbol)) return [];
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(baseTicker(symbol))}&type=SCHEDULE+13&dateb=&owner=include&count=20&output=atom`;
  try {
    const xml = await httpsGet(url);
    return parseCompanyOwnershipFeed(xml).slice(0, 10);
  } catch (err) {
    console.error('[stock-intelligence/ownership]', err.message);
    return [];
  }
}

async function fetchYahooChart(symbol, range = '3mo', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const raw = await httpsGet(url);
  const json = JSON.parse(raw);
  const result = json?.chart?.result?.[0];
  if (!result) return { bars: [], dayQuote: null };

  const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const opens = Array.isArray(quote.open) ? quote.open : [];
  const highs = Array.isArray(quote.high) ? quote.high : [];
  const lows = Array.isArray(quote.low) ? quote.low : [];
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const volumes = Array.isArray(quote.volume) ? quote.volume : [];

  const bars = timestamps.map((ts, index) => {
    const open = finiteNumber(opens[index]);
    const high = finiteNumber(highs[index]);
    const low = finiteNumber(lows[index]);
    const close = finiteNumber(closes[index]);
    const volume = finiteNumber(volumes[index]) ?? 0;
    if (open == null || high == null || low == null || close == null) return null;
    return { time: ts, open, high, low, close, volume };
  }).filter(Boolean);

  const meta = result.meta || {};
  const dayQuote = meta.regularMarketPrice ? {
    dayHigh: finiteNumber(meta.regularMarketDayHigh),
    dayLow: finiteNumber(meta.regularMarketDayLow),
    open: finiteNumber(meta.regularMarketOpen),
    prevClose: finiteNumber(meta.regularMarketPreviousClose),
    volume: finiteNumber(meta.regularMarketVolume),
  } : null;

  return { bars, dayQuote };
}

async function fetchFinnhubJson(endpoint, params = {}) {
  if (!FINNHUB_KEY) return null;
  const url = new URL(`https://finnhub.io/api/v1${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  url.searchParams.set('token', FINNHUB_KEY);
  try {
    const raw = await httpsGet(url.toString());
    const json = JSON.parse(raw);
    if (json && json.error) throw new Error(json.error);
    return json;
  } catch (err) {
    console.error('[stock-intelligence/finnhub]', endpoint, err.message);
    return null;
  }
}

async function fetchQuoteProfileAndContext(symbol) {
  const today = new Date();
  const fromDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const toDate = today.toISOString().slice(0, 10);
  const earningsTo = new Date(today.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const candlesPromise = fetchYahooChart(symbol, '3mo', '1d').catch(() => ({ bars: [], dayQuote: null }));

  if (isCanadianTicker(symbol)) {
    const ticker = baseTicker(symbol);
    const quotePromise = httpsPost(TMX_GQL_URL, {
      query: `{ getQuoteBySymbol(symbol: "${ticker}", locale: "en") {
        symbol name price priceChange percentChange prevClose openPrice
        exchangeCode exchangeName MarketCap volume weeks52high weeks52low
      } }`,
    }, TMX_HEADERS).then((raw) => {
      const json = JSON.parse(raw);
      return json?.data?.getQuoteBySymbol || null;
    }).catch(() => null);

    const newsPromise = fetchFinnhubJson('/company-news', { symbol, from: fromDate, to: toDate }).then((data) => Array.isArray(data) ? data : []);

    const [quote, candlesData, news] = await Promise.all([quotePromise, candlesPromise, newsPromise]);
    return {
      quote: quote ? {
        c: finiteNumber(quote.price),
        d: finiteNumber(quote.priceChange),
        dp: finiteNumber(quote.percentChange),
        pc: finiteNumber(quote.prevClose),
        o: finiteNumber(candlesData.dayQuote?.open ?? quote.openPrice),
        h: finiteNumber(candlesData.dayQuote?.dayHigh),
        l: finiteNumber(candlesData.dayQuote?.dayLow),
        volume: finiteNumber(candlesData.dayQuote?.volume ?? quote.volume),
      } : null,
      profile: quote ? {
        name: quote.name,
        exchange: quote.exchangeCode,
        marketCapitalization: finiteNumber(quote.MarketCap),
        currency: 'CAD',
      } : null,
      candles: candlesData.bars,
      news,
      basics: null,
      earningsCalendar: [],
    };
  }

  const [quote, profile, basics, news, earningsCalendar, candlesData] = await Promise.all([
    fetchFinnhubJson('/quote', { symbol }),
    fetchFinnhubJson('/stock/profile2', { symbol }),
    fetchFinnhubJson('/stock/metric', { symbol, metric: 'all' }),
    fetchFinnhubJson('/company-news', { symbol, from: fromDate, to: toDate }).then((data) => Array.isArray(data) ? data : []),
    fetchFinnhubJson('/calendar/earnings', { symbol, from: toDate, to: earningsTo }).then((data) => Array.isArray(data?.earningsCalendar) ? data.earningsCalendar : []),
    candlesPromise,
  ]);

  return {
    quote: quote ? {
      c: finiteNumber(quote.c),
      d: finiteNumber(quote.d),
      dp: finiteNumber(quote.dp),
      pc: finiteNumber(quote.pc),
      o: finiteNumber(quote.o),
      h: finiteNumber(quote.h),
      l: finiteNumber(quote.l),
      volume: finiteNumber(candlesData.dayQuote?.volume),
    } : null,
    profile: profile ? {
      name: profile.name,
      exchange: profile.exchange,
      marketCapitalization: Number.isFinite(profile.marketCapitalization) ? profile.marketCapitalization * 1e6 : null,
      currency: profile.currency,
      finnhubIndustry: profile.finnhubIndustry,
    } : null,
    candles: candlesData.bars,
    news,
    basics: basics?.metric || null,
    earningsCalendar,
  };
}

async function buildSymbolMetadata(symbol, fallbackName = '') {
  const normalized = normalizeSymbol(symbol);
  const cached = symbolMetadataCache.get(normalized);
  if (cached && Date.now() - cached.ts < SYMBOL_METADATA_TTL) {
    return cached.payload;
  }

  const profile = FINNHUB_KEY
    ? await fetchFinnhubJson('/stock/profile2', { symbol: normalized })
    : null;

  const payload = {
    symbol: normalized,
    baseSymbol: baseTicker(normalized),
    market: isCanadianTicker(normalized) ? 'CA' : 'US',
    companyName: profile?.name || fallbackName || baseTicker(normalized),
    sector: profile?.finnhubIndustry || null,
    industry: profile?.finnhubIndustry || null,
    exchange: profile?.exchange || (isCanadianTicker(normalized) ? 'TSX' : null),
  };

  symbolMetadataCache.set(normalized, { ts: Date.now(), payload });
  return payload;
}

async function getSymbolMetadata(symbol, fallbackName = '') {
  const normalized = normalizeSymbol(symbol);
  const cached = symbolMetadataCache.get(normalized);
  if (cached && Date.now() - cached.ts < SYMBOL_METADATA_TTL) {
    return cached.payload;
  }

  if (!symbolMetadataBuilds.has(normalized)) {
    symbolMetadataBuilds.set(
      normalized,
      buildSymbolMetadata(normalized, fallbackName).finally(() => {
        symbolMetadataBuilds.delete(normalized);
      })
    );
  }

  return symbolMetadataBuilds.get(normalized);
}

async function loadSecCompanyTickerDirectory() {
  const isFresh = secCompanyTickerDirectory && Date.now() - secCompanyTickerDirectoryFetch < SEC_COMPANY_DIRECTORY_TTL;
  if (isFresh) return secCompanyTickerDirectory;
  if (secCompanyTickerDirectoryBuild) return secCompanyTickerDirectoryBuild;

  secCompanyTickerDirectoryBuild = (async () => {
    const raw = await httpsGet('https://www.sec.gov/files/company_tickers.json', { 'User-Agent': 'TARS admin@tars.app' });
    const values = Object.values(JSON.parse(raw));
    const byNormalizedName = new Map();
    const byCik = new Map();
    for (const item of values) {
      const normalizedName = normalizeCompanyName(item.title);
      const entry = {
        ticker: String(item.ticker || '').toUpperCase(),
        title: String(item.title || ''),
        cik: String(item.cik_str || ''),
      };
      if (normalizedName && !byNormalizedName.has(normalizedName)) {
        byNormalizedName.set(normalizedName, entry);
      }
      if (entry.cik) byCik.set(entry.cik, entry);
    }
    secCompanyTickerDirectory = { byNormalizedName, byCik };
    secCompanyTickerDirectoryFetch = Date.now();
    return secCompanyTickerDirectory;
  })().finally(() => {
    secCompanyTickerDirectoryBuild = null;
  });

  return secCompanyTickerDirectoryBuild;
}

function parseMarketFilingsFeed(xml) {
  const filings = [];
  const parsed = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/gi;
  let match;
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1];
    const title = extractXmlTag(block, 'title');
    const summaryRaw = extractXmlTag(block, 'summary').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const hrefMatch = /<link[^>]+href="([^"]+)"/i.exec(block);
    const href = hrefMatch ? htmlDecode(hrefMatch[1]) : '';

    const titleMatch = title.match(/^SCHEDULE\s+(13[DG](?:\/A)?)\s+-\s+(.+?)\s+\((\d+)\)\s+\((Filed by|Subject)\)$/i);
    if (!titleMatch) continue;

    const dateMatch = summaryRaw.match(/Filed:\s*(\d{4}-\d{2}-\d{2})/i);
    const accMatch = summaryRaw.match(/AccNo:\s*([\d]+-[\d]+-[\d]+)/i);
    parsed.push({
      accessionNo: accMatch?.[1] ?? '',
      formType: titleMatch[1].toUpperCase(),
      companyName: titleMatch[2].trim(),
      cik: titleMatch[3],
      role: titleMatch[4].toLowerCase() === 'subject' ? 'subject' : 'filer',
      filedDate: dateMatch?.[1] ?? '',
      edgarUrl: href,
    });
  }

  const byAccession = new Map();
  for (const entry of parsed) {
    if (!byAccession.has(entry.accessionNo)) byAccession.set(entry.accessionNo, {});
    const bucket = byAccession.get(entry.accessionNo);
    if (entry.role === 'subject') bucket.subject = entry;
    else bucket.filer = entry;
  }

  for (const [, bucket] of byAccession) {
    const base = bucket.subject ?? bucket.filer;
    if (!base?.filedDate) continue;
    filings.push({
      accessionNo: base.accessionNo,
      formType: base.formType,
      filedDate: base.filedDate,
      edgarUrl: base.edgarUrl,
      filerName: bucket.filer?.companyName ?? '—',
      subjectCompany: bucket.subject?.companyName,
      subjectCik: bucket.subject?.cik ?? '',
    });
  }

  return filings.sort((a, b) => b.filedDate.localeCompare(a.filedDate));
}

async function fetchMarketFilings(days = 14) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // SEC requires a compliant "<Org> <contact-email>" User-Agent on every request;
  // pass SEC_UA explicitly here instead of falling through to httpsGet's generic
  // spoofed-browser default, since this feed is now polled by the triage job too.
  const [d, g, da, ga] = await Promise.allSettled([
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13D')}&dateb=&owner=include&count=80&output=atom`, { 'User-Agent': SEC_UA }),
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13G')}&dateb=&owner=include&count=80&output=atom`, { 'User-Agent': SEC_UA }),
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13D/A')}&dateb=&owner=include&count=80&output=atom`, { 'User-Agent': SEC_UA }),
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13G/A')}&dateb=&owner=include&count=80&output=atom`, { 'User-Agent': SEC_UA }),
  ]);

  const merged = [
    ...(d.status === 'fulfilled' ? parseMarketFilingsFeed(d.value) : []),
    ...(g.status === 'fulfilled' ? parseMarketFilingsFeed(g.value) : []),
    ...(da.status === 'fulfilled' ? parseMarketFilingsFeed(da.value) : []),
    ...(ga.status === 'fulfilled' ? parseMarketFilingsFeed(ga.value) : []),
  ];

  if (merged.length === 0) throw new Error('No market filings returned from SEC EDGAR');

  const directory = await loadSecCompanyTickerDirectory().catch(() => null);
  const deduped = [];
  const seen = new Set();
  for (const filing of merged) {
    const key = filing.accessionNo || `${filing.filerName}-${filing.filedDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!filing.filedDate || filing.filedDate < cutoff) continue;
    deduped.push(filing);
  }

  const symbolMap = new Map();
  for (const filing of deduped) {
    const subjectName = normalizeCompanyName(filing.subjectCompany || '');
    const subjectCik = String(filing.subjectCik || '');
    const match = directory?.byCik?.get(subjectCik) || directory?.byNormalizedName?.get(subjectName) || null;
    if (match?.ticker) {
      symbolMap.set(match.ticker, filing.subjectCompany || match.title);
      filing.symbol = match.ticker;
    } else {
      filing.symbol = null;
    }
  }

  const metadataEntries = await Promise.all(
    [...symbolMap.entries()].map(([symbol, fallbackName]) => getSymbolMetadata(symbol, fallbackName))
  );
  const metadataMap = new Map(metadataEntries.map((entry) => [entry.symbol, entry]));

  return deduped.map((filing) => {
    const meta = filing.symbol ? metadataMap.get(filing.symbol) : null;
    return {
      ...filing,
      sector: meta?.sector || null,
      industry: meta?.industry || null,
    };
  });
}

async function ensureCongressTrades({ tickers = null, days = null, limit = null } = {}) {
  const cutoff = Number.isFinite(days) && days > 0
    ? (() => {
        const date = new Date();
        date.setUTCDate(date.getUTCDate() - days);
        return date.toISOString().slice(0, 10);
      })()
    : null;

  if (hasMarketDataDb()) {
    try {
      const [dbTrades, syncState] = await Promise.all([
        readCongressTradesFromDb({ tickers, cutoff, limit }),
        getMarketDataSyncState(MARKET_DATA_DATASETS.congress),
      ]);
      const isFresh = isSyncStateFresh(syncState, CONGRESS_CACHE_TTL);

      if (dbTrades.length) {
        if (!isFresh) {
          refreshCongressTradesFromSource().catch((err) => {
            console.error('[congress-refresh]', err.message);
          });
        }
        return { trades: dbTrades, stale: !isFresh };
      }

      const refreshed = await refreshCongressTradesFromSource();
      const filtered = refreshed.filter((trade) => {
        if (Array.isArray(tickers) && tickers.length && !tickers.includes(trade.ticker)) return false;
        if (cutoff && trade.transactionDate < cutoff) return false;
        return true;
      });
      return {
        trades: Number.isFinite(limit) && limit > 0 ? filtered.slice(0, limit) : filtered,
        stale: false,
      };
    } catch (err) {
      console.error('[congress-db-fallback]', err.message);
    }
  }

  const now = Date.now();
  if (!congressCache || now - congressLastFetch > CONGRESS_CACHE_TTL) {
    await refreshCongressTradesFromSource();
  }

  const mappedTrades = (Array.isArray(congressCache) ? congressCache : [])
    .map(mapQuiverCongressTrade)
    .filter(Boolean)
    .filter((trade) => {
      if (Array.isArray(tickers) && tickers.length && !tickers.includes(trade.ticker)) return false;
      if (cutoff && trade.transactionDate < cutoff) return false;
      return true;
    })
    .sort((a, b) =>
      (b.transactionDate || '').localeCompare(a.transactionDate || '')
      || ((b.amountMin || 0) - (a.amountMin || 0))
    );

  return {
    trades: Number.isFinite(limit) && limit > 0 ? mappedTrades.slice(0, limit) : mappedTrades,
    stale: false,
  };
}

async function buildStockIntelligence(symbol) {
  const normalized = normalizeSymbol(symbol);
  const market = isCanadianTicker(normalized) ? 'CA' : 'US';

  try {
    if (!Array.isArray(insiderActivityCaches[30]) || insiderActivityCaches[30].length === 0) {
      await buildInsiderActivityCache(30);
    }
  } catch (err) {
    console.error('[stock-intelligence/insiders]', err.message);
  }

  const [marketData, ownershipFilings, congressResult] = await Promise.all([
    fetchQuoteProfileAndContext(normalized),
    fetchCompanyOwnershipFilings(normalized),
    ensureCongressTrades({ tickers: [baseTicker(normalized)], days: 90 }).catch(() => ({ trades: [] })),
  ]);

  const closeSeries = marketData.candles.map((bar) => finiteNumber(bar.close)).filter((value) => value != null);
  const volumeSeries = marketData.candles.map((bar) => finiteNumber(bar.volume)).filter((value) => value != null);
  const latestClose = closeSeries.length ? closeSeries[closeSeries.length - 1] : finiteNumber(marketData.quote?.c);
  const latestVolume = volumeSeries.length ? volumeSeries[volumeSeries.length - 1] : finiteNumber(marketData.quote?.volume);
  const avgVolume20d = volumeSeries.length >= 20 ? average(volumeSeries.slice(-20)) : average(volumeSeries);
  const relativeVolume = (Number.isFinite(latestVolume) && Number.isFinite(avgVolume20d) && avgVolume20d > 0)
    ? latestVolume / avgVolume20d
    : null;

  const trend = (() => {
    const sma20 = latestSma(closeSeries, 20);
    const sma50 = latestSma(closeSeries, 50);
    const sma200 = latestSma(closeSeries, 200);
    const description = describeTrend(latestClose, sma20, sma50, sma200);
    return {
      close: latestClose,
      dma20: sma20,
      dma50: sma50,
      dma200: sma200,
      priceVs20dPct: pctDiff(latestClose, sma20),
      priceVs50dPct: pctDiff(latestClose, sma50),
      priceVs200dPct: pctDiff(latestClose, sma200),
      ...description,
    };
  })();

  const insiderTrades = (() => {
    const cacheWindow = insiderActivityCaches[30]?.length ? insiderActivityCaches[30] : [];
    return cacheWindow
      .filter((trade) => normalizeSymbol(trade.symbol) === baseTicker(normalized))
      .slice(0, 10);
  })();

  const insiderSummary = (() => {
    const buyTrades = insiderTrades.filter((trade) => trade.type === 'BUY');
    const sellTrades = insiderTrades.filter((trade) => trade.type === 'SELL');
    const buyValue = buyTrades.reduce((sum, trade) => sum + (finiteNumber(trade.totalValue) || 0), 0);
    const sellValue = sellTrades.reduce((sum, trade) => sum + (finiteNumber(trade.totalValue) || 0), 0);
    return {
      last30d: {
        buyCount: buyTrades.length,
        sellCount: sellTrades.length,
        netValue: buyValue - sellValue,
      },
      recent: insiderTrades.map((trade) => ({
        filingDate: trade.filingDate || null,
        transactionDate: trade.transactionDate || null,
        insiderName: trade.insiderName || '',
        title: trade.title || '',
        type: trade.type,
        shares: finiteNumber(trade.shares),
        pricePerShare: finiteNumber(trade.pricePerShare),
        totalValue: finiteNumber(trade.totalValue),
        filingUrl: trade.filingUrl || '',
      })),
    };
  })();

  const normalizedCongress = Array.isArray(congressResult?.trades)
    ? congressResult.trades
    : [];

  const nextEarnings = Array.isArray(marketData.earningsCalendar) && marketData.earningsCalendar.length
    ? marketData.earningsCalendar
        .filter((item) => item?.date)
        .sort((a, b) => a.date.localeCompare(b.date))[0]
    : null;
  const daysToEarnings = nextEarnings?.date
    ? Math.round((new Date(nextEarnings.date) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  const ownershipSummary = {
    recent: ownershipFilings.map((filing) => ({
      accessionNo: filing.accessionNo || '',
      formType: filing.formType,
      filedDate: filing.filedDate,
      subjectCompany: filing.subjectCompany || marketData.profile?.name || '',
      edgarUrl: filing.edgarUrl || '',
    })),
    hasActivistSignal: ownershipFilings.some((filing) => filing.formType === '13D' || filing.formType === '13D/A'),
    hasPassiveStakeSignal: ownershipFilings.some((filing) => filing.formType === '13G' || filing.formType === '13G/A'),
  };

  const eventCounts = {
    earningsDate: nextEarnings?.date || null,
    daysToEarnings,
    recentNewsCount: Array.isArray(marketData.news) ? marketData.news.length : 0,
    recentInsiderTrades: insiderTrades.length,
    recentOwnershipFilings: ownershipFilings.length,
    recentCongressTrades: normalizedCongress.length,
  };
  const recentNews = Array.isArray(marketData.news)
    ? marketData.news.slice(0, 8).map((item) => ({
        headline: item.headline || item.title || '',
        source: item.source || '',
        datetime: item.datetime || item.publishedAt || null,
        summary: item.summary || '',
        url: item.url || '',
      }))
    : [];
  const ownershipConviction = summarizeOwnershipConviction({
    ownershipFilings,
    insiderSummary,
    congressTrades: normalizedCongress,
    market,
  });
  const eventPressure = summarizeEventPressure(eventCounts);
  const sharesOutstanding = finiteNumber(marketData.profile?.shareOutstanding);
  const shareFloat = finiteNumber(marketData.basics?.shareFloat);
  const shortFloatPercent = null;

  const price = {
    last: finiteNumber(marketData.quote?.c ?? latestClose),
    change: finiteNumber(marketData.quote?.d),
    changePct: finiteNumber(marketData.quote?.dp),
    volume: latestVolume,
    avgVolume20d,
    relativeVolume,
    participation: describeParticipation(relativeVolume),
    currency: marketData.profile?.currency || (market === 'CA' ? 'CAD' : 'USD'),
  };

  const signals = {
    participation: price.participation,
    ownershipSignal: inferOwnershipSignal(ownershipFilings),
    eventRisk: daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= 14 ? 'high' : daysToEarnings != null && daysToEarnings <= 30 ? 'medium' : 'low',
    ownershipConviction,
    eventPressure,
    squeezeRisk: 'unknown',
    compositeScore: [
      trend.trendState === 'bullish' ? 30 : trend.trendState === 'mixed' || trend.trendState === 'pullback' ? 18 : 8,
      price.relativeVolume >= 2 ? 25 : price.relativeVolume >= 1.3 ? 18 : price.relativeVolume >= 0.8 ? 12 : 5,
      ownershipSummary.hasActivistSignal ? 20 : ownershipSummary.hasPassiveStakeSignal ? 12 : 6,
      insiderSummary.last30d.buyCount > insiderSummary.last30d.sellCount ? 15 : 8,
      normalizedCongress.length > 0 ? 10 : 5,
    ].reduce((sum, value) => sum + value, 0),
  };

  const payload = {
    symbol: normalized,
    asOf: new Date().toISOString(),
    market,
    company: {
      name: marketData.profile?.name || baseTicker(normalized),
      exchange: marketData.profile?.exchange || (market === 'CA' ? 'TSX' : null),
      industry: marketData.profile?.finnhubIndustry || null,
      marketCap: finiteNumber(marketData.profile?.marketCapitalization),
      sharesOutstanding,
    },
    price,
    trend,
    events: eventCounts,
    news: recentNews,
    insiders: insiderSummary,
    ownershipFilings: ownershipSummary,
    congress: {
      recent: normalizedCongress.slice(0, 10),
      buyCount90d: normalizedCongress.filter((trade) => trade.type === 'purchase').length,
      sellCount90d: normalizedCongress.filter((trade) => trade.type === 'sale').length,
    },
    fundamentals: marketData.basics ? {
      peRatio: finiteNumber(marketData.basics.peNormalizedAnnual ?? marketData.basics.peTTM ?? marketData.basics.peBasicExclExtraTTM),
      pegRatio: finiteNumber(marketData.basics.pegRatioTTM),
      psRatio: finiteNumber(marketData.basics.psTTM),
      epsTTM: finiteNumber(marketData.basics.epsNormalizedAnnual ?? marketData.basics.epsTTM),
      revenueGrowthYoy: finiteNumber(marketData.basics.revenueGrowthTTMYoy ?? marketData.basics.revenueGrowthQuarterlyYoy),
      epsGrowthYoy: finiteNumber(marketData.basics.epsGrowthTTMYoy ?? marketData.basics.epsGrowthQuarterlyYoy),
      grossMargin: finiteNumber(marketData.basics.grossMarginTTM),
      operatingMargin: finiteNumber(marketData.basics.operatingMarginTTM),
      netMargin: finiteNumber(marketData.basics.netProfitMarginTTM),
      roe: finiteNumber(marketData.basics.roeTTM ?? marketData.basics.roeRfy),
      weeks52high: finiteNumber(marketData.basics['52WeekHigh']),
      weeks52low: finiteNumber(marketData.basics['52WeekLow']),
      shareFloat,
      shortFloatPercent,
    } : null,
    signals,
    explanations: {
      whyMoving: buildWhyMoving(price, trend, eventCounts),
      bullCase: [
        trend.trendState === 'bullish' ? 'Trend is aligned above key moving averages.' : 'Trend is not fully aligned yet.',
        Number.isFinite(price.relativeVolume) && price.relativeVolume >= 1.3 ? 'Participation is above average.' : 'Volume participation is not elevated yet.',
        ownershipSummary.hasActivistSignal ? 'Recent 13D activity suggests an activist ownership angle.' : ownershipSummary.hasPassiveStakeSignal ? 'Recent 13G activity shows notable ownership disclosure.' : 'No recent ownership-filing catalyst is present.',
      ],
      bearCase: [
        insiderSummary.last30d.sellCount > insiderSummary.last30d.buyCount ? 'Recent insider selling outweighs buying.' : 'Insider flow does not show heavy accumulation.',
        signals.eventRisk === 'high' ? 'Upcoming earnings create near-term event risk.' : 'No immediate earnings catalyst is forcing the timeline.',
        trend.trendState === 'bearish' ? 'Price remains below key moving averages.' : 'Trend is not decisively bearish, but it is not risk-free.',
      ],
    },
    dataAvailability: {
      shortInterest: null,
      optionsPositioning: null,
    },
    sources: {
      quote: market === 'CA' ? 'TMX / Yahoo Finance' : 'Finnhub / Yahoo Finance',
      candles: 'Yahoo Finance',
      insiders: 'SEC Form 4 cache',
      ownershipFilings: market === 'CA' ? 'Unavailable' : 'SEC EDGAR Schedule 13D/13G',
      congress: 'Quiver',
      fundamentals: market === 'CA' ? 'Unavailable' : 'Finnhub',
    },
  };

  stockIntelligenceCache.set(normalized, { ts: Date.now(), payload });
  return payload;
}

function buildStockIntelligenceSchema() {
  return {
    version: 'v1',
    endpoint: '/api/stock-intelligence?symbol=NVDA',
    description: 'Normalized stock intelligence object for agent and UI consumers.',
    notes: [
      'Null means unavailable or not yet supported.',
      'Market is CA for Canadian tickers and US otherwise.',
      'Congress data is recent disclosed trade activity, not a reconciled live holdings ledger.',
      'Ownership filings are currently US-only.',
    ],
    fields: {
      symbol: 'Normalized ticker symbol string.',
      asOf: 'ISO timestamp when the payload was assembled.',
      market: '"US" | "CA".',
      company: {
        name: 'Display name / company name.',
        exchange: 'Primary exchange when available.',
        industry: 'Industry text from source metadata when available.',
        marketCap: 'Market capitalization number when available.',
        sharesOutstanding: 'Reported shares outstanding when available.',
      },
      price: {
        last: 'Latest price.',
        change: 'Absolute day change.',
        changePct: 'Percent day change.',
        volume: 'Latest session volume.',
        avgVolume20d: '20-day average volume.',
        relativeVolume: 'Latest volume divided by 20-day average.',
        participation: '"high" | "above_average" | "normal" | "light".',
        currency: 'Trading currency, typically USD or CAD.',
      },
      trend: {
        close: 'Latest close used for trend calculations.',
        dma20: '20-day moving average.',
        dma50: '50-day moving average.',
        dma200: '200-day moving average.',
        priceVs20dPct: 'Percent distance vs 20-day moving average.',
        priceVs50dPct: 'Percent distance vs 50-day moving average.',
        priceVs200dPct: 'Percent distance vs 200-day moving average.',
        trendState: '"bullish" | "mixed" | "pullback" | "bearish".',
        trendExplanation: 'Plain-English trend read.',
      },
      events: {
        earningsDate: 'Upcoming earnings date when available.',
        daysToEarnings: 'Days until earnings, negative when stale.',
        recentNewsCount: 'News items counted in the context window.',
        recentInsiderTrades: 'Recent insider trade rows included.',
        recentOwnershipFilings: 'Recent 13D/13G filings included.',
        recentCongressTrades: 'Recent congress trades included.',
      },
      insiders: {
        last30d: {
          buyCount: 'Count of BUY insider trades in the cached window.',
          sellCount: 'Count of SELL insider trades in the cached window.',
          netValue: 'Buy value minus sell value.',
        },
        recent: 'Recent normalized insider trade rows.',
      },
      ownershipFilings: {
        recent: 'Recent normalized 13D/13G filings.',
        hasActivistSignal: 'True when a 13D/13D-A is present.',
        hasPassiveStakeSignal: 'True when a 13G/13G-A is present.',
      },
      congress: {
        recent: 'Recent normalized congress trades for the symbol.',
        buyCount90d: 'Purchase count over the last 90 days.',
        sellCount90d: 'Sale count over the last 90 days.',
      },
      fundamentals: 'Normalized fundamentals object or null when unavailable. May include shareFloat and shortFloatPercent when a provider exposes them.',
      signals: {
        participation: 'Copied qualitative participation label.',
        ownershipSignal: 'Ownership-derived signal label.',
        eventRisk: '"high" | "medium" | "low".',
        ownershipConviction: 'Ownership-conviction score, label, and reasons derived from insiders, 13D/13G, congress, and tracked 13F holders.',
        eventPressure: 'Event-pressure score, label, and reasons derived from earnings timing, news flow, insider filings, ownership filings, and congress activity.',
        squeezeRisk: 'Currently "unknown" until a provider is added.',
        compositeScore: 'Simple multi-factor score on a 0-100-ish scale.',
      },
      explanations: {
        whyMoving: 'Array of short evidence statements.',
        bullCase: 'Array of bull-case points.',
        bearCase: 'Array of bear-case points.',
      },
      dataAvailability: {
        shortInterest: 'Null until provider is added.',
        optionsPositioning: 'Null until provider is added.',
      },
      sources: {
        quote: 'Quote provider label.',
        candles: 'Chart provider label.',
        insiders: 'Insider provider label.',
        ownershipFilings: 'Ownership filing provider label.',
        congress: 'Congress provider label.',
        fundamentals: 'Fundamentals provider label.',
      },
    },
    example: {
      symbol: 'NVDA',
      asOf: '2026-04-25T22:30:00.000Z',
      market: 'US',
      company: { name: 'NVIDIA Corp', exchange: 'NASDAQ', industry: 'Technology', marketCap: 2200000, sharesOutstanding: 2460000000 },
      price: { last: 942.15, change: 18.42, changePct: 1.99, volume: 48211320, avgVolume20d: 27100450, relativeVolume: 1.78, participation: 'high', currency: 'USD' },
      trend: { close: 942.15, dma20: 915.24, dma50: 884.91, dma200: 731.02, priceVs20dPct: 2.94, priceVs50dPct: 6.47, priceVs200dPct: 28.88, trendState: 'bullish', trendExplanation: 'Price is above the 20, 50, and 200 day averages.' },
      events: { earningsDate: '2026-05-22', daysToEarnings: 27, recentNewsCount: 6, recentInsiderTrades: 2, recentOwnershipFilings: 1, recentCongressTrades: 0 },
      insiders: { last30d: { buyCount: 2, sellCount: 5, netValue: -2100000 }, recent: [] },
      ownershipFilings: { recent: [], hasActivistSignal: false, hasPassiveStakeSignal: true },
      congress: { recent: [], buyCount90d: 0, sellCount90d: 0 },
      fundamentals: { peRatio: 45.2, pegRatio: 1.9, psRatio: 23.4, epsTTM: 12.3, revenueGrowthYoy: 62.1, epsGrowthYoy: 78.4, grossMargin: 73.2, operatingMargin: 56.1, netMargin: 48.2, roe: 59.7, weeks52high: 980.0, weeks52low: 530.0, shareFloat: null, shortFloatPercent: null },
      signals: { participation: 'high', ownershipSignal: 'passive_stake', eventRisk: 'medium', ownershipConviction: { score: 68, label: 'Constructive', reasons: ['Passive 13G ownership disclosure is present.', 'Held by at least one tracked 13F fund.'] }, eventPressure: { score: 34, label: 'Moderate', reasons: ['Earnings are within the next month.', 'News flow is active.'] }, squeezeRisk: 'unknown', compositeScore: 78 },
      explanations: { whyMoving: ['Trading at 1.78x normal volume', 'Price above key moving averages'], bullCase: ['Trend remains intact'], bearCase: ['Insider selling outweighs buying'] },
      dataAvailability: { shortInterest: null, optionsPositioning: null },
      sources: { quote: 'Finnhub / Yahoo Finance', candles: 'Yahoo Finance', insiders: 'SEC Form 4 cache', ownershipFilings: 'SEC EDGAR Schedule 13D/13G', congress: 'Quiver', fundamentals: 'Finnhub' },
    },
  };
}

app.get('/api/stock-intelligence/schema', async (_req, res) => {
  res.json(buildStockIntelligenceSchema());
});

async function getStockIntelligenceCached(symbol) {
  const cached = stockIntelligenceCache.get(symbol);
  if (cached && Date.now() - cached.ts < STOCK_INTELLIGENCE_TTL) return cached.payload;
  if (!stockIntelligenceBuilds.has(symbol)) {
    stockIntelligenceBuilds.set(
      symbol,
      buildStockIntelligence(symbol).finally(() => {
        stockIntelligenceBuilds.delete(symbol);
      })
    );
  }
  return stockIntelligenceBuilds.get(symbol);
}

app.get('/api/stock-intelligence', async (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) {
    return res.status(400).json({ error: 'symbol query param is required' });
  }

  try {
    res.json(await getStockIntelligenceCached(symbol));
  } catch (err) {
    console.error('[stock-intelligence]', err.message);
    res.status(502).json({ error: err.message });
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

// ── Canadian insider activity via TMX / SEDI ──────────────────────────────────
// Queries TMX GraphQL server-side for a curated list of top TSX stocks.
// Two modes: insiders (open-market buys/sells only) and filings (all SEDI types).

const CA_TSX_STOCKS = [
  // Banks
  { sym: 'RY', name: 'Royal Bank of Canada' },
  { sym: 'TD', name: 'TD Bank' },
  { sym: 'BNS', name: 'Bank of Nova Scotia' },
  { sym: 'BMO', name: 'Bank of Montreal' },
  { sym: 'CM', name: 'CIBC' },
  { sym: 'NA', name: 'National Bank' },
  // Insurance / Financial
  { sym: 'SLF', name: 'Sun Life Financial' },
  { sym: 'MFC', name: 'Manulife Financial' },
  { sym: 'IFC', name: 'Intact Financial' },
  { sym: 'POW', name: 'Power Corporation' },
  { sym: 'GWO', name: 'Great-West Lifeco' },
  // Energy
  { sym: 'CNQ', name: 'Canadian Natural Resources' },
  { sym: 'SU', name: 'Suncor Energy' },
  { sym: 'CVE', name: 'Cenovus Energy' },
  { sym: 'TRP', name: 'TC Energy' },
  { sym: 'ENB', name: 'Enbridge' },
  { sym: 'PPL', name: 'Pembina Pipeline' },
  { sym: 'IMO', name: 'Imperial Oil' },
  { sym: 'ARC', name: 'ARC Resources' },
  // Mining
  { sym: 'ABX', name: 'Barrick Gold' },
  { sym: 'WPM', name: 'Wheaton Precious Metals' },
  { sym: 'FM', name: 'First Quantum Minerals' },
  { sym: 'LUN', name: 'Lundin Mining' },
  { sym: 'AGI', name: 'Alamos Gold' },
  // Technology
  { sym: 'SHOP', name: 'Shopify' },
  { sym: 'CSU', name: 'Constellation Software' },
  { sym: 'OTEX', name: 'Open Text' },
  { sym: 'DSG', name: 'Descartes Systems' },
  { sym: 'KXS', name: 'Kinaxis' },
  // Utilities
  { sym: 'FTS', name: 'Fortis' },
  { sym: 'AQN', name: 'Algonquin Power' },
  { sym: 'EMA', name: 'Emera' },
  // Consumer / Retail
  { sym: 'L', name: 'Loblaw' },
  { sym: 'MRU', name: 'Metro Inc' },
  { sym: 'DOL', name: 'Dollarama' },
  { sym: 'EMP', name: 'Empire Company' },
  // Transportation / Industrial
  { sym: 'CP', name: 'Canadian Pacific' },
  { sym: 'CNR', name: 'Canadian National Railway' },
  { sym: 'TFII', name: 'TFI International' },
  { sym: 'CAE', name: 'CAE Inc' },
  { sym: 'WSP', name: 'WSP Global' },
  // Telecom
  { sym: 'T', name: 'TELUS' },
  { sym: 'BCE', name: 'BCE Inc' },
  // Other
  { sym: 'GFL', name: 'GFL Environmental' },
  { sym: 'DOO', name: 'BRP Inc' },
  // Mid-cap / sector diversity — more insider activity than large-caps
  { sym: 'NTR', name: 'Nutrien' },
  { sym: 'ATD', name: 'Alimentation Couche-Tard' },
  { sym: 'CCO', name: 'Cameco' },
  { sym: 'BAM', name: 'Brookfield Asset Management' },
  { sym: 'BIP', name: 'Brookfield Infrastructure' },
  { sym: 'BEP', name: 'Brookfield Renewable' },
  { sym: 'AEM', name: 'Agnico Eagle Mines' },
  { sym: 'K', name: 'Kinross Gold' },
  { sym: 'IMG', name: 'IAMGOLD' },
  { sym: 'PVG', name: 'Pretium Resources' },
  { sym: 'ERO', name: 'Ero Copper' },
  { sym: 'OR', name: 'Osisko Royalties' },
  { sym: 'FR', name: 'First Majestic Silver' },
  { sym: 'MAG', name: 'MAG Silver' },
  { sym: 'WRN', name: 'Western Copper and Gold' },
  { sym: 'HBM', name: 'Hudbay Minerals' },
  { sym: 'CS', name: 'Capstone Copper' },
  { sym: 'TECK.B', name: 'Teck Resources' },
  { sym: 'IVN', name: 'Ivanhoe Mines' },
  { sym: 'SVM', name: 'Silvercorp Metals' },
  { sym: 'PEY', name: 'Peyto Exploration' },
  { sym: 'BTE', name: 'Baytex Energy' },
  { sym: 'MEG', name: 'MEG Energy' },
  { sym: 'WCP', name: 'Whitecap Resources' },
  { sym: 'TVE', name: 'Tamarack Valley Energy' },
  { sym: 'VET', name: 'Vermilion Energy' },
  { sym: 'CPG', name: 'Crescent Point Energy' },
  { sym: 'TOU', name: 'Tourmaline Oil' },
  { sym: 'AAV', name: 'Advantage Energy' },
  { sym: 'SES', name: 'Secure Energy Services' },
  { sym: 'XI', name: 'Maxim Power' },
  { sym: 'PBH', name: 'Premium Brands Holdings' },
  { sym: 'QBR.B', name: 'Quebecor' },
  { sym: 'CCA', name: 'Cogeco Communications' },
  { sym: 'CJR.B', name: 'Corus Entertainment' },
  { sym: 'FSZ', name: 'Fiera Capital' },
  { sym: 'EFN', name: 'Element Fleet Management' },
  { sym: 'ECN', name: 'ECN Capital' },
  { sym: 'GS', name: 'Goeasy' },
  { sym: 'EQB', name: 'EQB Inc' },
  { sym: 'LB', name: 'Laurentian Bank' },
  { sym: 'CWB', name: 'Canadian Western Bank' },
  { sym: 'HCG', name: 'Home Capital Group' },
  { sym: 'ACM', name: 'Acumine Capital' },
  { sym: 'CIGI', name: 'Colliers International' },
  { sym: 'BPF.UN', name: 'Boston Pizza Royalties' },
  { sym: 'SRU.UN', name: 'SmartCentres REIT' },
  { sym: 'REI.UN', name: 'RioCan REIT' },
  { sym: 'AP.UN', name: 'Allied Properties REIT' },
  { sym: 'CRT.UN', name: 'CT REIT' },
  { sym: 'PLZ.UN', name: 'Plaza Retail REIT' },
  { sym: 'MRC', name: 'Morguard' },
  { sym: 'NWC', name: 'North West Company' },
  { sym: 'STN', name: 'Stantec' },
  { sym: 'BYD', name: 'Boyd Group Services' },
  { sym: 'CLS', name: 'Celestica' },
  { sym: 'MG', name: 'Magna International' },
  { sym: 'MDA', name: 'MDA Space' },
  { sym: 'LSPD', name: 'Lightspeed Commerce' },
  { sym: 'DCBO', name: 'Docebo' },
  { sym: 'DND', name: 'Dye & Durham' },
  { sym: 'TCS', name: 'Topicus.com' },
  { sym: 'NVEI', name: 'Nuvei' },
  { sym: 'CTRE', name: 'CareTrust REIT' },
  { sym: 'WELL', name: 'WELL Health Technologies' },
  { sym: 'GUD', name: 'Knight Therapeutics' },
  { sym: 'DRX', name: 'ADF Group' },
];

const EXTRA_CA_TSX_STOCKS = [
  { sym: 'CPX', name: 'Capital Power' },
  { sym: 'CU', name: 'Canadian Utilities' },
  { sym: 'BIR', name: 'Birchcliff Energy' },
  { sym: 'ARX', name: 'ARC Resources Ltd' },
  { sym: 'ATH', name: 'Athabasca Oil' },
  { sym: 'SCR', name: 'Strathcona Resources' },
  { sym: 'CJ', name: 'Cardinal Energy' },
  { sym: 'HWX', name: 'Headwater Exploration' },
  { sym: 'SGY', name: 'Surge Energy' },
  { sym: 'OBE', name: 'Obsidian Energy' },
  { sym: 'PXT', name: 'Parex Resources' },
  { sym: 'ERF', name: 'Enerplus' },
  { sym: 'BHC', name: 'Bausch Health Companies' },
  { sym: 'AND', name: 'Andlauer Healthcare Group' },
  { sym: 'TFPM', name: 'Triple Flag Precious Metals' },
  { sym: 'OGC', name: 'OceanaGold' },
  { sym: 'PAAS', name: 'Pan American Silver' },
  { sym: 'SSL', name: 'Sandstorm Gold' },
  { sym: 'NGD', name: 'New Gold' },
  { sym: 'DML', name: 'Denison Mines' },
  { sym: 'UEX', name: 'UEX Corp' },
  { sym: 'TIH', name: 'Toromont Industries' },
  { sym: 'ATS', name: 'ATS Corporation' },
  { sym: 'SIS', name: 'Savaria' },
  { sym: 'ADEN', name: 'Adena Corp' },
  { sym: 'ATZ', name: 'Aritzia' },
  { sym: 'GOOS', name: 'Canada Goose' },
  { sym: 'X', name: 'TMX Group' },
  { sym: 'FC', name: 'Firm Capital Property Trust' },
  { sym: 'DIR.UN', name: 'Dream Industrial REIT' },
  { sym: 'GRT.UN', name: 'Granite REIT' },
  { sym: 'CAR.UN', name: 'Canadian Apartment Properties REIT' },
  { sym: 'BEI.UN', name: 'Boardwalk REIT' },
  { sym: 'MI.UN', name: 'Minto Apartment REIT' },
  { sym: 'PRV.UN', name: 'PRO Real Estate Investment Trust' },
  { sym: 'CSH.UN', name: 'Chartwell Retirement Residences' },
  { sym: 'PSK', name: 'PrairieSky Royalty' },
  { sym: 'MAL', name: 'Magellan Aerospace' },
  { sym: 'QIPT', name: 'Quipt Home Medical' },
  { sym: 'SVI', name: 'StorageVault Canada' },
  { sym: 'LMN', name: 'Lumine Group' },
  { sym: 'TOI', name: 'Topicus.com Inc' },
  { sym: 'PKI', name: 'Parkland Corporation' },
  { sym: 'BDT', name: 'Bird Construction' },
  { sym: 'IFP', name: 'Interfor' },
  { sym: 'CF', name: 'Canaccord Genuity Group' },
  { sym: 'TSU', name: 'Trisura Group' },
];

const CA_TMX_UNIVERSE = [...CA_TSX_STOCKS, ...EXTRA_CA_TSX_STOCKS].filter((item, index, arr) =>
  arr.findIndex((candidate) => candidate.sym === item.sym) === index
);

const TMX_GQL_URL = 'https://app-money.tmx.com/graphql';
const TMX_HEADERS = {
  'Origin': 'https://money.tmx.com',
  'Referer': 'https://money.tmx.com/',
};

const BACKGROUND_SYNC_ENABLED = process.env.DISABLE_BACKGROUND_SYNC !== '1';
const BACKGROUND_SYNC_WARM_DELAY_MS = 12000;
const CONGRESS_BACKGROUND_SYNC_MS = 25 * 60 * 1000;
const CA_BACKGROUND_SYNC_MS = 25 * 60 * 1000;
const CA_BACKGROUND_TARGETS = [
  { days: 7, mode: 'insiders', label: '7-insiders' },
  { days: 7, mode: 'filings', label: '7-filings' },
  { days: 30, mode: 'filings', label: '30-filings' },
];

// Cache keyed by `${days}-${mode}` so the insiders and filings tabs don't
// invalidate each other on switch.
const caInsiderCaches = {};
const caInsiderLastFetch = {};
const caInsiderBuilds = {};
const CA_INSIDER_TTL = 30 * 60 * 1000;

async function buildCaInsiderCache(days, mode) {
  const cacheKey = `${days}-${mode}`;
  if (caInsiderBuilds[cacheKey]) return caInsiderBuilds[cacheKey];

  caInsiderBuilds[cacheKey] = (async () => {
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      const allTrades = [];
      const batchSize = 10;

      for (let i = 0; i < CA_TMX_UNIVERSE.length; i += batchSize) {
        const batch = CA_TMX_UNIVERSE.slice(i, i + batchSize);
        const results = await Promise.allSettled(
          batch.map(async ({ sym, name }) => {
            try {
              const body = { query: `{ getInsiderTransactions(symbol: "${sym}") }` };
              const raw = await httpsPost(TMX_GQL_URL, body, TMX_HEADERS);
              const json = JSON.parse(raw);
              const txns = json.data?.getInsiderTransactions ?? [];
              return { sym, name, txns };
            } catch {
              return { sym, name, txns: [] };
            }
          })
        );

        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const { sym, name, txns } = r.value;
          for (const t of txns) {
            const txDate = (t.filingdate || t.datefrom || t.date || '').slice(0, 10);
            if (!txDate || txDate < cutoffStr) continue;

            // SEDI code 1 = open-market transaction (buy or sell based on amount sign)
            // code 2 = rare private placement; others = grants, options, buybacks, etc.
            const isOpenMarket = t.transactionTypeCode === 1;
            if (mode === 'insiders' && !isOpenMarket) continue;

            const shares = toFiniteNumber(t.amount);
            const pricePerShare = toFiniteNumber(t.pricefrom);
            const marketValue = toFiniteNumber(t.marketvalue);
            const computedTotalValue = shares !== null && pricePerShare !== null
              ? Math.abs(shares) * pricePerShare
              : null;
            const totalValue = (marketValue !== null && marketValue > 0)
              ? marketValue
              : computedTotalValue;

            if (shares === null || shares === 0) continue;
            if (pricePerShare === null || pricePerShare <= 0) continue;
            if (totalValue === null || totalValue <= 0) continue;

            const parts = (t.filer || '').split(',').map(s => s.trim());
            const insiderName = parts.length === 2 ? `${parts[1]} ${parts[0]}` : t.filer;
            const title = (t.relationship || '').replace(/\s+of\s+(the\s+)?Issuer$/i, '').trim();
            // Sign of amount determines direction: positive = buy, negative = sell
            const txType = isOpenMarket
              ? (t.amount > 0 ? 'BUY' : 'SELL')
              : 'OTHER';

            allTrades.push({
              id: `ca-${t.transactionid || `${sym}-${txDate}-${t.amount}`}`,
              symbol: `${sym}.TO`,
              companyName: name,
              insiderName,
              title,
              type: txType,
              transactionDate: (t.datefrom || t.date || '').slice(0, 10),
              filingDate: (t.filingdate || '').slice(0, 10),
              shares: Math.abs(shares),
              pricePerShare,
              totalValue,
              market: 'CA',
              exchange: 'TSX',
              source: 'TMX/SEDI',
              filingUrl: null,
            });
          }
        }
      }

      allTrades.sort((a, b) =>
        (b.filingDate || '').localeCompare(a.filingDate || '')
        || (b.transactionDate || '').localeCompare(a.transactionDate || '')
        || ((b.totalValue || 0) - (a.totalValue || 0))
      );

      if (hasMarketDataDb()) {
        if (allTrades.length) {
          await writeCaInsiderTradesToDb(allTrades);
        }
        await setMarketDataSyncState(MARKET_DATA_DATASETS.caInsiders(days, mode), allTrades.length);
      }

      caInsiderCaches[cacheKey] = { trades: allTrades };
      caInsiderLastFetch[cacheKey] = Date.now();
      return caInsiderCaches[cacheKey];
    } catch (err) {
      console.error(`[ca-insider-activity:${cacheKey}]`, err.message);
      if (!caInsiderCaches[cacheKey]) throw err;
      return caInsiderCaches[cacheKey];
    } finally {
      delete caInsiderBuilds[cacheKey];
    }
  })();

  return caInsiderBuilds[cacheKey];
}

app.get('/api/ca-insider-activity', async (req, res) => {
  const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
  const mode = req.query.mode === 'filings' ? 'filings' : 'insiders'; // insiders=open-market only, filings=all types
  const force = req.query.force === '1' || req.query.refresh === '1';
  const cacheKey = `${days}-${mode}`;
  const hasCache = Boolean(caInsiderCaches[cacheKey]);
  const isFresh = hasCache && (Date.now() - (caInsiderLastFetch[cacheKey] || 0) <= CA_INSIDER_TTL);

  try {
    if (hasMarketDataDb()) {
      try {
        const [dbTrades, syncState] = await Promise.all([
          readCaInsiderTradesFromDb(days, mode),
          getMarketDataSyncState(MARKET_DATA_DATASETS.caInsiders(days, mode)),
        ]);
        const dbLatest = latestFilingDateFromTrades(dbTrades);
        const dbFresh = isSyncStateFresh(syncState, CA_INSIDER_TTL) && !isLatestFilingDateStale(dbLatest);

        if (dbTrades.length) {
          if (force) {
            try {
              const refreshed = await buildCaInsiderCache(days, mode);
              const refreshedTrades = refreshed?.trades || [];
              if (refreshedTrades.length) {
                return res.json({
                  trades: refreshedTrades,
                  overview: buildInsiderOverview(refreshedTrades),
                  meta: buildInsiderFeedMeta({
                    market: 'CA',
                    source: 'TMX/SEDI live refresh',
                    days,
                    mode,
                    trades: refreshedTrades,
                    syncState: await getMarketDataSyncState(MARKET_DATA_DATASETS.caInsiders(days, mode)).catch(() => null),
                    stale: false,
                    refreshed: true,
                  }),
                });
              }
            } catch (refreshErr) {
              console.error(`[ca-insider-db-refresh:${cacheKey}]`, refreshErr.message);
              res.setHeader('X-Data-Stale', '1');
              return res.json({
                trades: dbTrades,
                overview: buildInsiderOverview(dbTrades),
                meta: buildInsiderFeedMeta({
                  market: 'CA',
                  source: 'Supabase stale fallback',
                  days,
                  mode,
                  trades: dbTrades,
                  syncState,
                  stale: true,
                  refreshed: false,
                  error: refreshErr.message,
                }),
              });
            }
          } else if (!dbFresh) {
            buildCaInsiderCache(days, mode).catch((refreshErr) => {
              console.error(`[ca-insider-db-refresh:${cacheKey}]`, refreshErr.message);
            });
            res.setHeader('X-Data-Stale', '1');
            return res.json({
              trades: dbTrades,
              overview: buildInsiderOverview(dbTrades),
              meta: buildInsiderFeedMeta({
                market: 'CA',
                source: 'Supabase stale fallback',
                days,
                mode,
                trades: dbTrades,
                syncState,
                stale: true,
                refreshed: false,
              }),
            });
          }
          return res.json({
            trades: dbTrades,
            overview: buildInsiderOverview(dbTrades),
            meta: buildInsiderFeedMeta({
              market: 'CA',
              source: 'Supabase cache',
              days,
              mode,
              trades: dbTrades,
              syncState,
              stale: !dbFresh,
              refreshed: false,
            }),
          });
        }
      } catch (err) {
        console.error(`[ca-insider-db-fallback:${cacheKey}]`, err.message);
      }
    }

    if (!hasCache) {
      await buildCaInsiderCache(days, mode);
    } else if (!isFresh) {
      buildCaInsiderCache(days, mode).catch((err) => {
        console.error(`[ca-insider-activity-refresh:${cacheKey}]`, err.message);
      });
      res.setHeader('X-Data-Stale', '1');
    }
  } catch (err) {
    return res.status(502).json({ error: err.message, trades: [] });
  }

  res.json({
    trades: caInsiderCaches[cacheKey].trades,
    overview: buildInsiderOverview(caInsiderCaches[cacheKey].trades),
    meta: buildInsiderFeedMeta({
      market: 'CA',
      source: 'TMX/SEDI memory cache',
      days,
      mode,
      trades: caInsiderCaches[cacheKey].trades,
      stale: !isFresh,
      refreshed: !hasCache || force,
    }),
  });
});

const insiderActivityCaches = { 7: null, 14: null, 30: null };
const insiderActivityLastFetch = { 7: 0, 14: 0, 30: 0 };
const insiderActivityBuilds = { 7: null, 14: null, 30: null };
const INSIDER_ACTIVITY_TTL = 10 * 60 * 1000;

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

function classifyUsInsiderEvent(code) {
  switch ((code || '').toUpperCase()) {
    case 'P':
      return { type: 'BUY', category: 'open_market_buy' };
    case 'S':
    case 'S-':
      return { type: 'SELL', category: 'open_market_sell' };
    case 'F':
      return { type: 'OTHER', category: 'tax_withholding' };
    case 'A':
      return { type: 'OTHER', category: 'grant' };
    case 'G':
      return { type: 'OTHER', category: 'gift' };
    case 'M':
    case 'X':
    case 'C':
      return { type: 'OTHER', category: 'conversion_or_exercise' };
    default:
      return { type: 'OTHER', category: 'other' };
  }
}

function buildInsiderOverview(trades) {
  const list = Array.isArray(trades) ? trades : [];
  const summaryMap = new Map();
  let buyValue = 0;
  let sellValue = 0;
  let taxValue = 0;
  let otherValue = 0;

  for (const trade of list) {
    const eventCategory = trade.eventCategory || 'other';
    const value = Number(trade.totalValue || 0);
    if (trade.type === 'BUY') buyValue += value;
    else if (trade.type === 'SELL') sellValue += value;
    else if (eventCategory === 'tax_withholding') taxValue += value;
    else otherValue += value;

    if (!summaryMap.has(trade.symbol)) {
      summaryMap.set(trade.symbol, {
        symbol: trade.symbol,
        companyName: trade.companyName || '',
        tradeCount: 0,
        buyCount: 0,
        sellCount: 0,
        taxCount: 0,
        otherCount: 0,
        buyValue: 0,
        sellValue: 0,
        taxValue: 0,
        otherValue: 0,
        netValue: 0,
        signal: 'mixed',
        latestFilingDate: '',
      });
    }

    const bucket = summaryMap.get(trade.symbol);
    bucket.tradeCount += 1;
    bucket.latestFilingDate = bucket.latestFilingDate > (trade.filingDate || '') ? bucket.latestFilingDate : (trade.filingDate || '');
    if (trade.type === 'BUY') {
      bucket.buyCount += 1;
      bucket.buyValue += value;
      bucket.netValue += value;
    } else if (trade.type === 'SELL') {
      bucket.sellCount += 1;
      bucket.sellValue += value;
      bucket.netValue -= value;
    } else if (eventCategory === 'tax_withholding') {
      bucket.taxCount += 1;
      bucket.taxValue += value;
    } else {
      bucket.otherCount += 1;
      bucket.otherValue += value;
    }
  }

  const bySymbol = [...summaryMap.values()]
    .map((bucket) => {
      let signal = 'mixed';
      if (bucket.buyValue > 0 && bucket.sellValue === 0 && bucket.taxValue === 0) signal = 'net_buy';
      else if (bucket.sellValue > 0 && bucket.buyValue === 0 && bucket.taxValue === 0) signal = 'net_sell';
      else if (bucket.taxValue > 0 && bucket.buyValue === 0 && bucket.sellValue === 0) signal = 'tax_heavy';
      else if (bucket.buyValue > bucket.sellValue * 1.5 && bucket.buyValue > 0) signal = 'buy_skew';
      else if (bucket.sellValue > bucket.buyValue * 1.5 && bucket.sellValue > 0) signal = 'sell_skew';
      return { ...bucket, signal };
    })
    .sort((a, b) =>
      Math.abs(b.netValue) - Math.abs(a.netValue)
      || b.tradeCount - a.tradeCount
      || b.latestFilingDate.localeCompare(a.latestFilingDate)
    );

  const netValue = buyValue - sellValue;
  let marketSignal = 'mixed';
  if (buyValue > sellValue * 1.5 && buyValue > 0) marketSignal = 'net_buy';
  else if (sellValue > buyValue * 1.5 && sellValue > 0) marketSignal = 'net_sell';
  else if (taxValue > buyValue + sellValue && taxValue > 0) marketSignal = 'tax_heavy';

  return {
    market: {
      signal: marketSignal,
      tradeCount: list.length,
      buyValue,
      sellValue,
      taxValue,
      otherValue,
      netValue,
    },
    bySymbol,
  };
}

function latestFilingDateFromTrades(trades) {
  return (Array.isArray(trades) ? trades : []).reduce((latest, trade) => {
    const value = trade?.filingDate || trade?.filedDate || '';
    return value > latest ? value : latest;
  }, '');
}

function isLatestFilingDateStale(latestDate, maxAgeDays = 5) {
  if (!latestDate) return true;
  const time = new Date(`${latestDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > maxAgeDays * 24 * 60 * 60 * 1000;
}

function buildInsiderFeedMeta({ market, source, days, mode, trades, syncState = null, stale = false, refreshed = false, error = null }) {
  return {
    market,
    source,
    days,
    mode: mode || null,
    latestFilingDate: latestFilingDateFromTrades(trades),
    rowCount: Array.isArray(trades) ? trades.length : 0,
    syncedAt: syncState?.synced_at || null,
    syncRowCount: syncState?.row_count ?? null,
    stale: Boolean(stale),
    refreshed: Boolean(refreshed),
    error: error || null,
  };
}

function shouldUseLocalDevLiveFallback() {
  return process.env.NODE_ENV !== 'production' && !hasMarketDataDb() && LOCAL_DEV_LIVE_ORIGIN;
}

async function fetchLiveUsInsiderFallback(days, limit) {
  if (!shouldUseLocalDevLiveFallback()) return null;
  const url = `${LOCAL_DEV_LIVE_ORIGIN.replace(/\/$/, '')}/api/insider-activity?days=${days}&limit=${limit}`;
  const raw = await httpsGet(url, { Accept: 'application/json' });
  const payload = JSON.parse(raw);
  if (!Array.isArray(payload?.trades) || payload.trades.length === 0) return null;
  return payload;
}

async function fetchDailyIndexEntries(daysBack, accepts) {
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
        if (!accepts(formType)) continue;
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

async function fetchRecentForm4Entries(daysBack = 7) {
  return fetchDailyIndexEntries(daysBack, (form) => form === '4' || form === '4/A');
}

async function fetchCurrentForm4AtomEntries(start = 0) {
  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=4&owner=include&count=100&start=${start}&output=atom`;
  const atom = await httpsGet(url, { 'User-Agent': SEC_UA, Accept: 'application/atom+xml,application/xml,text/xml' });
  const entries = [];
  for (const match of atom.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const block = match[1];
    const title = htmlDecode(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const href = htmlDecode(block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '');
    const summary = htmlDecode(block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || '');
    const formType = (block.match(/<category[^>]*term="([^"]+)"/i)?.[1] || '').trim();
    if (formType !== '4' && formType !== '4/A' && !/^4\s/i.test(title)) continue;
    if (/\(Reporting\)/i.test(title)) continue;

    const cik = href.match(/\/data\/(\d+)\//i)?.[1] || title.match(/\((\d{6,10})\)/)?.[1];
    const accession = summary.match(/AccNo:\s*(?:<\/b>)?\s*([0-9-]+)/i)?.[1]
      || block.match(/accession-number=([0-9-]+)/i)?.[1]
      || href.match(/\/([0-9]{10}-[0-9]{2}-[0-9]{6})-/i)?.[1];
    const filedDate = summary.match(/Filed:\s*(?:<\/b>)?\s*(\d{4}-\d{2}-\d{2})/i)?.[1]
      || block.match(/<updated[^>]*>(\d{4}-\d{2}-\d{2})/i)?.[1];
    if (!cik || !accession || !filedDate) continue;

    const companyName = title.replace(/^4\/?A?\s*-\s*/i, '').replace(/\s+\(\d{6,10}\).*$/i, '').trim();
    entries.push({
      cik,
      companyName,
      formType: formType || '4',
      filedDate,
      filename: `edgar/data/${String(Number(cik))}/${accession}.txt`,
      accession,
    });
  }
  return entries;
}

async function fetchSecInsiderActivityItem(entry) {
  const cikClean = String(Number(entry.cik));
  const accClean = entry.accession.replace(/-/g, '');
  const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/`;

  let xml = '';
  const txtUrl = `https://www.sec.gov/Archives/${entry.filename}`;
  try {
    const txt = await httpsGet(txtUrl, { 'User-Agent': SEC_UA, Accept: 'text/plain,application/xml,text/xml' });
    xml = txt.match(/<ownershipDocument[\s\S]*?<\/ownershipDocument>/i)?.[0] || '';
  } catch {
    xml = '';
  }

  let dirHtml = '';
  if (!xml) {
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

    try {
      xml = await httpsGet(xmlUrl, { 'User-Agent': SEC_UA, Accept: 'application/xml,text/xml' });
    } catch {
      return [];
    }
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
    const { type, category } = classifyUsInsiderEvent(code);
    if (!code) return null;

    const transactionDate = xmlMatch(block, /<transactionDate>[\s\S]*?<value>\s*([^<]+)\s*<\/value>/i);
    const shares = parseNumber(xmlMatch(block, /<transactionShares>[\s\S]*?<value>\s*([^<]+)\s*<\/value>/i));
    const pricePerShare = parseNumber(xmlMatch(block, /<transactionPricePerShare>[\s\S]*?<value>\s*([^<]+)\s*<\/value>/i));
    const totalValue = shares * pricePerShare;
    if (!transactionDate || shares <= 0) return null;
    if ((type === 'BUY' || type === 'SELL' || category === 'tax_withholding') && (!pricePerShare || pricePerShare <= 0 || totalValue <= 0)) return null;

    return {
      id: `${entry.accession}-${index}`,
      symbol,
      companyName,
      insiderName,
      title,
      type,
      transactionCode: code,
      eventCategory: category,
      transactionDate: transactionDate.slice(0, 10),
      filingDate: entry.filedDate,
      shares,
      pricePerShare: pricePerShare > 0 ? pricePerShare : null,
      totalValue: totalValue > 0 ? totalValue : null,
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
  let entries = [];
  try {
    entries = await fetchCurrentForm4AtomEntries();
  } catch (err) {
    console.error('[us-insider-atom]', err.message);
  }
  if (entries.length === 0) {
    entries = await fetchRecentForm4Entries(daysBack);
  }

  // Cut to entries actually within requested window
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const inWindow = entries.filter(e => e.filedDate >= cutoffStr);

  // Group by date then keep a much wider slice per day. The previous
  // aggressively thinned sampling made the feed feel stale/sparse even when
  // newer filings existed. We still cap it to avoid exploding SEC fetches.
  const byDate = new Map();
  for (const e of inWindow) {
    if (!byDate.has(e.filedDate)) byDate.set(e.filedDate, []);
    byDate.get(e.filedDate).push(e);
  }
  const perDay = days <= 7 ? 30 : days <= 14 ? 22 : 16;
  const sampled = [];
  for (const [_, dayEntries] of [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    dayEntries.sort((a, b) => a.companyName.localeCompare(b.companyName));
    if (dayEntries.length <= perDay) {
      sampled.push(...dayEntries);
    } else {
      const step = Math.max(1, Math.floor(dayEntries.length / perDay));
      for (let i = 0; i < dayEntries.length && sampled.length < perDay * byDate.size; i += step) {
        sampled.push(dayEntries[i]);
      }
    }
  }

  const groups = [];
  const batchSize = days <= 7 ? 4 : 3;
  for (let i = 0; i < sampled.length; i += batchSize) {
    const batch = sampled.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map((entry) => fetchSecInsiderActivityItem(entry)));
    groups.push(...batchResults);
  }
  return groups.flat().sort((a, b) =>
    (b.filingDate || '').localeCompare(a.filingDate || '')
    || (b.transactionDate || '').localeCompare(a.transactionDate || '')
    || ((b.totalValue || 0) - (a.totalValue || 0))
  );
}

async function buildInsiderActivityCache(days) {
  if (insiderActivityBuilds[days]) return insiderActivityBuilds[days];

  insiderActivityBuilds[days] = (async () => {
    try {
      const trades = await fetchLatestInsiderActivity(days);
      if (hasMarketDataDb()) {
        try {
          const existingTrades = await readUsInsiderTradesFromDb(days).catch(() => []);
          const fetchedLatest = latestFilingDateFromTrades(trades);
          const existingLatest = latestFilingDateFromTrades(existingTrades);
          if (existingLatest && (!fetchedLatest || fetchedLatest < existingLatest)) {
            console.error(`[us-insider-db-write:${days}] refusing older refresh latest=${fetchedLatest || 'none'} existing=${existingLatest}`);
            insiderActivityCaches[days] = existingTrades;
            insiderActivityLastFetch[days] = Date.now();
            return existingTrades;
          }
          if (trades.length) {
            await writeUsInsiderTradesToDb(trades);
            await setMarketDataSyncState(MARKET_DATA_DATASETS.usInsiders(days), trades.length);
          }
        } catch (err) {
          console.error(`[us-insider-db-write:${days}]`, err.message);
        }
      }
      insiderActivityCaches[days] = trades;
      insiderActivityLastFetch[days] = Date.now();
      return trades;
    } finally {
      insiderActivityBuilds[days] = null;
    }
  })();

  return insiderActivityBuilds[days];
}

app.get('/api/insider-activity', async (req, res) => {
  try {
    const days = [7, 14, 30].includes(Number(req.query.days)) ? Number(req.query.days) : 7;
    const force = req.query.force === '1' || req.query.refresh === '1';
    if (hasMarketDataDb()) {
      try {
        const [dbTrades, syncState] = await Promise.all([
          readUsInsiderTradesFromDb(days),
          getMarketDataSyncState(MARKET_DATA_DATASETS.usInsiders(days)),
        ]);
        const dbLatest = latestFilingDateFromTrades(dbTrades);
        const dbFresh = isSyncStateFresh(syncState, INSIDER_ACTIVITY_TTL) && !isLatestFilingDateStale(dbLatest);
        if (dbTrades.length) {
          if (force) {
            try {
              const refreshedTrades = await buildInsiderActivityCache(days);
              if (refreshedTrades.length) {
                const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
                const limitedTrades = refreshedTrades.slice(0, limit);
                return res.json({
                  trades: limitedTrades,
                  overview: buildInsiderOverview(refreshedTrades),
                  meta: buildInsiderFeedMeta({
                    market: 'US',
                    source: 'SEC live refresh',
                    days,
                    trades: refreshedTrades,
                    syncState: await getMarketDataSyncState(MARKET_DATA_DATASETS.usInsiders(days)).catch(() => null),
                    stale: false,
                    refreshed: true,
                  }),
                });
              }
            } catch (refreshErr) {
              console.error('[insider-activity-db-refresh]', refreshErr.message);
              res.setHeader('X-Data-Stale', '1');
              const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
              const limitedTrades = dbTrades.slice(0, limit);
              return res.json({
                trades: limitedTrades,
                overview: buildInsiderOverview(dbTrades),
                meta: buildInsiderFeedMeta({
                  market: 'US',
                  source: 'Supabase stale fallback',
                  days,
                  trades: dbTrades,
                  syncState,
                  stale: true,
                  refreshed: false,
                  error: refreshErr.message,
                }),
              });
            }
          } else if (!dbFresh) {
            const memoryTrades = Array.isArray(insiderActivityCaches[days]) ? insiderActivityCaches[days] : [];
            const memoryLatest = latestFilingDateFromTrades(memoryTrades);
            const dbLatest = latestFilingDateFromTrades(dbTrades);
            if (memoryTrades.length && memoryLatest && (!dbLatest || memoryLatest > dbLatest)) {
              const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
              const limitedTrades = memoryTrades.slice(0, limit);
              return res.json({
                trades: limitedTrades,
                overview: buildInsiderOverview(memoryTrades),
                meta: buildInsiderFeedMeta({
                  market: 'US',
                  source: 'SEC memory cache',
                  days,
                  trades: memoryTrades,
                  syncState,
                  stale: false,
                  refreshed: false,
                }),
              });
            }
            buildInsiderActivityCache(days).catch((refreshErr) => {
              console.error('[insider-activity-db-refresh]', refreshErr.message);
            });
            res.setHeader('X-Data-Stale', '1');
            const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
            const limitedTrades = dbTrades.slice(0, limit);
            return res.json({
              trades: limitedTrades,
              overview: buildInsiderOverview(dbTrades),
              meta: buildInsiderFeedMeta({
                market: 'US',
                source: 'Supabase stale fallback',
                days,
                trades: dbTrades,
                syncState,
                stale: true,
                refreshed: false,
              }),
            });
          }
          const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
          const limitedTrades = dbTrades.slice(0, limit);
          return res.json({
            trades: limitedTrades,
            overview: buildInsiderOverview(dbTrades),
            meta: buildInsiderFeedMeta({
              market: 'US',
              source: 'Supabase cache',
              days,
              trades: dbTrades,
              syncState,
              stale: !dbFresh,
              refreshed: false,
            }),
          });
        }
      } catch (err) {
        console.error(`[us-insider-db-fallback:${days}]`, err.message);
      }
    }

    const hasCache = Array.isArray(insiderActivityCaches[days]) && insiderActivityCaches[days].length > 0;
    const isFresh = hasCache && (Date.now() - insiderActivityLastFetch[days] <= INSIDER_ACTIVITY_TTL);

    if (!hasCache) {
      await buildInsiderActivityCache(days);
    } else if (!isFresh) {
      buildInsiderActivityCache(days).catch((err) => {
        console.error('[insider-activity-refresh]', err.message);
      });
      res.setHeader('X-Data-Stale', '1');
    }

    const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
    if (!Array.isArray(insiderActivityCaches[days]) || insiderActivityCaches[days].length === 0) {
      try {
        const fallback = await fetchLiveUsInsiderFallback(days, limit);
        if (fallback?.trades?.length) {
          return res.json({
            trades: fallback.trades.slice(0, limit),
            overview: fallback.overview || buildInsiderOverview(fallback.trades),
            meta: {
              ...(fallback.meta || buildInsiderFeedMeta({
                market: 'US',
                source: 'Live fallback',
                days,
                trades: fallback.trades,
                stale: false,
                refreshed: false,
              })),
              source: 'Live fallback',
              refreshed: false,
              error: null,
            },
          });
        }
      } catch (fallbackErr) {
        console.error('[insider-activity-live-fallback]', fallbackErr.message);
      }
    }

    const trades = insiderActivityCaches[days].slice(0, limit);
    res.json({
      trades,
      overview: buildInsiderOverview(insiderActivityCaches[days]),
      meta: buildInsiderFeedMeta({
        market: 'US',
        source: 'SEC memory cache',
        days,
        trades: insiderActivityCaches[days],
        stale: !isFresh,
        refreshed: !hasCache || force,
      }),
    });
  } catch (err) {
    console.error('[insider-activity]', err.message);
    res.status(502).json({ error: err.message, trades: [] });
  }
});

app.use(express.json());

// Structured request logging — attach reqId, log completion with duration + status.
const crypto = require('crypto');
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/')) return next();
  const reqId = crypto.randomBytes(4).toString('hex');
  const start = Date.now();
  req.reqId = reqId;
  res.on('finish', () => {
    const ms = Date.now() - start;
    const tag = res.statusCode >= 500 ? '🔴' : res.statusCode >= 400 ? '🟡' : '  ';
    console.log(`${tag} [${reqId}] ${req.method} ${req.path} → ${res.statusCode} ${ms}ms`);
  });
  next();
});

// AI response cache — keyed by hash of (symbol, question, context-summary).
// Identical repeat questions are common (reloading the tab, etc.) — 15min TTL.
const AI_CACHE_TTL = 15 * 60 * 1000;
const aiResponseCache = new Map();
function aiCacheKey(parts) {
  return crypto.createHash('sha1').update(JSON.stringify(parts)).digest('hex');
}
function aiCacheGet(key) {
  const hit = aiResponseCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > AI_CACHE_TTL) { aiResponseCache.delete(key); return null; }
  return hit.answer;
}
function aiCacheSet(key, answer) {
  aiResponseCache.set(key, { answer, ts: Date.now() });
  // Simple bounded size — evict oldest if > 200 entries
  if (aiResponseCache.size > 200) {
    const firstKey = aiResponseCache.keys().next().value;
    aiResponseCache.delete(firstKey);
  }
}

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

// ── Deep Analyze (Claude Sonnet) ─────────────────────────────────────────────
// Dedicated long-form analysis endpoint. Uses Anthropic Claude Sonnet 4.5
// (override via CLAUDE_MODEL env var). Returns markdown text rather than JSON
// so the client can render a long structured briefing.

const CLAUDE_MODEL_FULL = process.env.CLAUDE_MODEL_FULL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const CLAUDE_MODEL_PRESET = process.env.CLAUDE_MODEL_PRESET || 'claude-haiku-4-5-20251001';

async function callClaude(systemPrompt, userPrompt, { model = CLAUDE_MODEL_FULL, maxTokens = 2500, temperature = 0.4 } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('Deep analysis not configured — ANTHROPIC_API_KEY missing.');

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return withRetry(() => new Promise((resolve, reject) => {
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
            if (parsed.type === 'error' || parsed.error) {
              return reject(new Error(parsed.error?.message ?? 'Claude API error'));
            }
            const text = parsed.content?.[0]?.text;
            if (!text) return reject(new Error('Empty Claude response'));
            resolve(text);
          } catch {
            reject(new Error('Invalid Claude response'));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(90000, () => { req.destroy(); reject(new Error('Claude API timeout')); });
    req.write(body);
    req.end();
  }), { retries: 1, baseMs: 1000, label: 'claude' });
}

const DEEP_ANALYZE_STOCK_PROMPT = `You are a senior buy-side equity analyst writing a long-form deep dive for a portfolio manager. You have access to live market, technical, fundamental, insider, and news context for the stock below. Produce a thorough, specific, actionable briefing.

STRUCTURE (use these markdown headers exactly, in this order — skip a section only if the context truly has no data for it):

## Thesis
Two or three sentences. The single strongest read on this stock right now. Name the setup, the driver, and the edge.

## What the Data Says
Walk through the live context: price action and trend, key technical levels, valuation vs peers/history, insider flow, recent news catalysts. Cite specific numbers. Call out where the data agrees and where it conflicts.

## Bull Case
3-5 bullets. Each bullet leads with the catalyst or lever, then explains the mechanism and the specific evidence from the context.

## Bear Case
3-5 bullets. Same structure — be equally rigorous. Name what breaks the thesis.

## Key Levels & Triggers
Bulleted list. Support, resistance, technical triggers, upcoming dates (earnings, filings, guidance), and the price points where the thesis is proven or invalidated.

## Bottom Line
One or two sentences — direction, conviction, and the single thing to watch next.

RULES:
- Use **bold** for key numbers, names, and levels.
- Never include generic disclaimers ("consult a financial advisor", "past performance", "do your own research").
- If a section has no supporting data, write a single italic line ("_No supporting data in context._") rather than fabricating.
- Keep total length 500-900 words.
- Write like a sharp hedge-fund morning note — dense, specific, no filler.`;

const DEEP_ANALYZE_FILING_PROMPT = `You are a senior event-driven equity analyst. A 13D/13G filing just landed. Produce a thorough deep dive for a portfolio manager who needs to decide whether to act.

STRUCTURE (use these markdown headers exactly, skip if no data):

## What Just Happened
Two or three sentences. Plain-English read of who filed what, the stake size, and the immediate implication.

## Filer Profile
Who is the filer — activist, passive, strategic, known history? What does this filer typically do after a 5%+ filing?

## Likely Playbook
3-5 bullets. The most plausible scenarios: board seats, buyback push, sale of the company, spinoff, cost cuts, strategic review. Rank by likelihood and cite specific clues from the filing text or filer history.

## Market Reaction Read
How does the stock typically react to this filer / this form type? What's the usual timeline from filing to the inflection point?

## Risks & Counter-Scenarios
3-5 bullets. What could make this a false signal (passive rebalance, tax-driven, index-driven)? How to tell fast?

## Bottom Line
One or two sentences — is this tradable, and what's the setup.

RULES:
- Use **bold** for key numbers, filer names, and stake sizes.
- Quote the filing directly if you see a revealing phrase.
- Never include generic disclaimers.
- Keep total length 400-700 words.
- If a section has no supporting data, write a single italic line ("_No supporting data in context._") rather than guessing.`;

const DEEP_ANALYZE_NEWS_PROMPT = `You are a senior sell-side analyst writing a same-day reaction note to a news headline. A PM has flagged this story and wants a sharp deep-dive in under 90 seconds of reading.

STRUCTURE (use these markdown headers exactly):

## The Story
One or two sentences. What actually happened in plain English — strip the headline hype.

## Why It Matters
3-5 bullets. The specific mechanisms by which this moves the stock or sector. Name the second-order effects.

## Reading Between the Lines
What is the market likely to miss or mis-price? Where's the edge — is this bigger, smaller, or different than the headline implies?

## Trade Implications
Bulleted list. Direct beneficiaries, direct losers, pair-trade ideas, options setups if relevant. Be specific with tickers.

## Risks to the Read
2-3 bullets. What would invalidate this take?

## Bottom Line
One sentence — direction and conviction.

RULES:
- Use **bold** for tickers, numbers, and names.
- Never include generic disclaimers.
- Keep total length 300-600 words.
- If a section has no supporting data, write a single italic line ("_No supporting data in context._") rather than guessing.`;

function buildDeepStockContext(symbol, context) {
  const lines = [`SYMBOL: ${symbol}`];
  const quick = [];
  if (context?.price)     quick.push(`Price ${context.price}`);
  if (context?.change)    quick.push(`Day change ${context.change}`);
  if (context?.marketCap) quick.push(`Market Cap ${context.marketCap}`);
  if (context?.volume)    quick.push(`Volume ${context.volume}`);
  if (context?.exchange)  quick.push(`Exchange ${context.exchange}`);
  if (quick.length) lines.push(`MARKET SNAPSHOT: ${quick.join(' · ')}`);

  if (context?.candles?.length) {
    lines.push('\n--- TECHNICAL READ ---');
    lines.push(summarizeTechnicals(context.candles));
  }
  if (context?.fundamentals) {
    const f = { ...context.fundamentals };
    if (!Number.isFinite(f.currentPrice) && context?.priceRaw) {
      f.currentPrice = Number(context.priceRaw);
    }
    const block = summarizeFundamentals(f);
    if (block) {
      lines.push('\n--- FUNDAMENTALS & ANALYST VIEW ---');
      lines.push(block);
    }
  }
  if (context?.insiders?.length) {
    lines.push('\n--- INSIDER FLOW ---');
    lines.push(summarizeInsiders(context.insiders));
  }
  if (context?.news?.length) {
    lines.push('\n--- RECENT NEWS ---');
    lines.push(summarizeNews(context.news));
  }
  return lines.join('\n');
}

function buildDeepStockFocusBlock(focus) {
  if (!focus) return '';
  const normalized = String(focus).toLowerCase();
  if (normalized.includes('bull')) {
    return `\nANALYSIS FOCUS: Bull Case\nSpend extra time on upside drivers, what supports the long thesis, and what evidence is strongest right now. Still include the bear case, but lead with the bullish setup.`;
  }
  if (normalized.includes('bear')) {
    return `\nANALYSIS FOCUS: Bear Case\nSpend extra time on downside risks, broken trend evidence, valuation pressure, and what would make this fail. Still include the bull case, but lead with the bearish setup.`;
  }
  if (normalized.includes('2-week') || normalized.includes('two-week') || normalized.includes('near-term')) {
    return `\nANALYSIS FOCUS: Near-Term Setup\nFrame the note for the next two weeks. Prioritize catalysts, event risk, support and resistance, volume behavior, and the most important trigger levels.`;
  }
  if (normalized.includes('change') || normalized.includes('thesis')) {
    return `\nANALYSIS FOCUS: What Changes The Thesis\nEmphasize the key confirms, invalidation levels, and the specific data points that would upgrade or downgrade conviction.`;
  }
  return `\nANALYSIS FOCUS: ${focus}\nTilt the analysis toward this focus while still grounding every conclusion in the provided data.`;
}

function getDeepAnalyzeProfile(type, focus) {
  if (type === 'stock' && focus) {
    return {
      model: CLAUDE_MODEL_PRESET,
      maxTokens: 1100,
      temperature: 0.25,
      profile: 'preset',
    };
  }

  return {
    model: CLAUDE_MODEL_FULL,
    maxTokens: 2500,
    temperature: 0.35,
    profile: 'full',
  };
}

function buildDeepFilingContext(filing) {
  const parts = [];
  parts.push(`FORM TYPE: ${filing?.formType || 'unknown'}`);
  if (filing?.filedDate) parts.push(`FILED: ${filing.filedDate}`);
  if (filing?.filerName) parts.push(`FILER: ${filing.filerName}`);
  if (filing?.subjectCompany) parts.push(`TARGET COMPANY: ${filing.subjectCompany}`);
  if (filing?.accessionNo) parts.push(`ACCESSION: ${filing.accessionNo}`);
  if (filing?.edgarUrl) parts.push(`EDGAR URL: ${filing.edgarUrl}`);
  return parts.join('\n');
}

function buildDeepNewsContext(news, symbol) {
  const parts = [];
  if (symbol) parts.push(`RELATED SYMBOL: ${symbol}`);
  if (news?.source) parts.push(`SOURCE: ${news.source}`);
  if (news?.datetime) {
    const d = new Date(news.datetime * 1000);
    parts.push(`PUBLISHED: ${d.toISOString().slice(0, 10)}`);
  }
  if (news?.headline) parts.push(`HEADLINE: ${news.headline}`);
  if (news?.summary)  parts.push(`\nSUMMARY:\n${news.summary}`);
  if (news?.url)      parts.push(`\nURL: ${news.url}`);
  return parts.join('\n');
}

app.post('/api/deep-analyze', async (req, res) => {
  const { type, symbol, context, filing, news, focus } = req.body ?? {};

  if (!type || !['stock', 'filing', 'news'].includes(type)) {
    return res.status(400).json({ error: 'type must be "stock" | "filing" | "news"' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'Deep analysis not configured — ask your admin to set ANTHROPIC_API_KEY.' });
  }

  try {
    let systemPrompt;
    let userPrompt;
    let cacheParts;

    if (type === 'stock') {
      if (!symbol) return res.status(400).json({ error: 'Missing symbol' });
      systemPrompt = DEEP_ANALYZE_STOCK_PROMPT;
      userPrompt = `Deep dive on ${symbol}.${buildDeepStockFocusBlock(focus)}\n\nLIVE CONTEXT:\n${buildDeepStockContext(symbol, context || {})}`;
      const priceBucket = context?.priceRaw ? Math.round(Number(context.priceRaw)) : 0;
      cacheParts = { route: 'deep-stock', symbol, priceBucket, focus: focus || 'full' };
    } else if (type === 'filing') {
      if (!filing) return res.status(400).json({ error: 'Missing filing' });
      systemPrompt = DEEP_ANALYZE_FILING_PROMPT;
      userPrompt = `Deep dive on this filing.\n\nFILING CONTEXT:\n${buildDeepFilingContext(filing)}`;
      cacheParts = { route: 'deep-filing', accession: filing.accessionNo, form: filing.formType };
    } else { // news
      if (!news) return res.status(400).json({ error: 'Missing news' });
      systemPrompt = DEEP_ANALYZE_NEWS_PROMPT;
      userPrompt = `Deep dive on this news story.\n\nNEWS CONTEXT:\n${buildDeepNewsContext(news, symbol)}`;
      cacheParts = { route: 'deep-news', id: news.id || news.url || news.headline, symbol: symbol || '' };
    }

    const profile = getDeepAnalyzeProfile(type, focus);
    const cacheKey = aiCacheKey({ ...cacheParts, model: profile.model, profile: profile.profile });
    const cached = aiCacheGet(cacheKey);
    if (cached) return res.json({ analysis: cached, cached: true, model: profile.model, profile: profile.profile });

    const analysis = await callClaude(systemPrompt, userPrompt, {
      model: profile.model,
      maxTokens: profile.maxTokens,
      temperature: profile.temperature,
    });
    aiCacheSet(cacheKey, analysis);
    res.json({ analysis, cached: false, model: profile.model, profile: profile.profile });
  } catch (err) {
    console.error('[deep-analyze]', err.message);
    res.status(502).json({ error: err.message });
  }
});

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

// ── Filing Triage (13D/13G, Form 4, 8-K via Jev + LLM escalation) ────────────
// Every new filing gets a fast structured read from Jev (TypeSafe System One:
// typed choice/score/noul answers, not prose; ~$0.042 per 1M input tokens,
// output free, 70-500ms). Jev's materiality becomes a unified 0-100 priority.
// Only filings that clear their type's escalation rule get a written LLM
// thesis. Per-type questions/rules live in filingTriage.cjs (pure, testable).
// See docs/filing-triage.md for the full design.

const { FILING_TYPES, buildSignal } = require('./filingTriage.cjs');
const { rulesPriority, extractEightKItems } = require('./filingRules.cjs');

// Jev can be reached directly (TYPESAFE_API_KEY) or through OpenRouter (OPENROUTER_API_KEY, no TypeSafe
// account needed). The direct key wins if both are set. JEV_ENDPOINT / JEV_MODEL override either route.
const JEV_VIA_OPENROUTER = !process.env.TYPESAFE_API_KEY && Boolean(process.env.OPENROUTER_API_KEY);
const TYPESAFE_API_KEY = process.env.TYPESAFE_API_KEY || process.env.OPENROUTER_API_KEY || '';
const JEV_ENDPOINT = process.env.JEV_ENDPOINT
  || (JEV_VIA_OPENROUTER ? 'https://openrouter.ai/api/v1/systemone' : 'https://api.typesafe.ai/v1/systemone');
const FILING_TRIAGE_ENABLED =
  process.env.FILING_TRIAGE_ENABLED === '1' || process.env.OWNERSHIP_TRIAGE_ENABLED === '1';
const JEV_MODEL = process.env.JEV_MODEL || (JEV_VIA_OPENROUTER ? '~typesafe/jev-latest' : 'jev-latest');

// rules  = free rule-based noise filter + priority, no Jev key needed
// hybrid = rules drop the obvious noise, Jev scores everything else (default when a key exists)
// jev    = Jev scores everything
const FILING_TRIAGE_MODE = (() => {
  const requested = String(process.env.FILING_TRIAGE_MODE || '').toLowerCase();
  if (['rules', 'hybrid', 'jev'].includes(requested)) return requested;
  return TYPESAFE_API_KEY ? 'hybrid' : 'rules';
})();
const TRIAGE_NOISE_FLOOR = Math.min(100, Math.max(0, parseInt(process.env.FILING_TRIAGE_NOISE_FLOOR || '15', 10) || 15));
const INSIDER_CLUSTER_MIN = 3;
const EVENT_ROUTINE_ITEMS = new Set(['9.01', '7.01', '5.07']);

function hasFilingDb() {
  return Boolean(serverSupabase);
}

async function callJev(state, questions) {
  if (!TYPESAFE_API_KEY) throw new Error('No Jev key configured (set TYPESAFE_API_KEY or OPENROUTER_API_KEY)');
  const raw = await httpsPost(
    JEV_ENDPOINT,
    { state, model: JEV_MODEL, questions },
    { Authorization: `Bearer ${TYPESAFE_API_KEY}` }
  );
  const parsed = JSON.parse(raw);
  if (!parsed?.answers) throw new Error('Invalid Jev response - missing answers');
  return parsed;
}

async function scoreFilingWithJev(typeKey, state, context = {}) {
  const started = Date.now();
  const def = FILING_TYPES[typeKey];
  const result = await callJev(state, def.questions);
  const signal = buildSignal(typeKey, result.answers || {}, context);
  return {
    ...signal,
    jevModel: result.model || JEV_MODEL,
    jevRaw: result,
    tokensUsed: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
    msElapsed: Date.now() - started,
  };
}

function parseJsonLoose(text) {
  const cleaned = String(text || '').replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

// Written thesis for filings that cleared escalation. Ownership keeps its
// existing Groq QUANT_PROMPT path; Form 4 and 8-K use the Claude preset model.
async function generateFilingThesis(def, stateText) {
  if (def.key === 'ownership' && process.env.GROQ_API_KEY) {
    const raw = await callAI('groq', process.env.GROQ_API_KEY, stateText);
    return { thesis: parseJsonLoose(raw), model: 'groq-llama-3.3-70b', tokens: 0 };
  }
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const systemPrompt = def.thesisPrompt || QUANT_PROMPT;
  const { answer, usage } = await callClaudeRaw(systemPrompt, `FILING:\n${stateText}`, {
    model: CLAUDE_MODEL_PRESET,
    maxTokens: 1024,
    temperature: 0.2,
  });
  return {
    thesis: parseJsonLoose(answer),
    model: CLAUDE_MODEL_PRESET,
    tokens: (usage?.input_tokens || 0) + (usage?.output_tokens || 0),
  };
}

async function upsertFilingSignal(row) {
  if (!hasFilingDb()) return null;
  const { data, error } = await serverSupabase
    .from('filing_signals')
    .upsert(row, { onConflict: 'accession_no' })
    .select('id')
    .maybeSingle();
  if (error) { console.error('[filing-signals upsert]', error.message); return null; }
  return data?.id ?? null;
}

const FILING_SIGNAL_COLUMNS =
  'id,accession_no,filing_type,form_type,symbol,subject_company,subject_cik,filer_name,filed_date,filing_url,' +
  'priority,priority_tier,materiality_score,materiality_confidence,signals,escalated,llm_thesis,llm_model,sector,industry,created_at';

async function getFilingByAccession(accessionNo) {
  if (!hasFilingDb()) return null;
  const { data, error } = await serverSupabase
    .from('filing_signals')
    .select(FILING_SIGNAL_COLUMNS)
    .eq('accession_no', accessionNo)
    .maybeSingle();
  if (error) { console.error('[filing-signals by-accession]', error.message); return null; }
  return data ?? null;
}

async function getFilingSignals({ types = null, minPriority = 0, tier = null, days = 14, escalatedOnly = false, symbol = null, symbols = null, limit = 100 } = {}) {
  if (!hasFilingDb()) return [];
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  let query = serverSupabase
    .from('filing_signals')
    .select(FILING_SIGNAL_COLUMNS)
    .gte('filed_date', cutoff)
    .order('priority', { ascending: false })
    .order('filed_date', { ascending: false })
    .limit(Math.min(limit, 500));
  if (types?.length) query = query.in('filing_type', types);
  if (minPriority > 0) query = query.gte('priority', minPriority);
  if (tier) query = query.eq('priority_tier', tier);
  if (escalatedOnly) query = query.eq('escalated', true);
  if (symbol) query = query.eq('symbol', symbol);
  if (symbols && symbols.length) query = query.in('symbol', symbols);
  const { data, error } = await query;
  if (error) { console.error('[filing-signals query]', error.message); return []; }
  return data ?? [];
}

// ── Coverage settings ────────────────────────────────────────────────────────
// Live "current filings" atom feeds only show the latest entries and the daily
// index only exists for completed days, so discovery combines both: paged atom
// feeds for today plus the daily index for the previous TRIAGE_INDEX_DAYS days.
// A real day is ~400 8-Ks and ~1,600 Form 4s, far more than one 100-entry page.

const TRIAGE_ATOM_PAGE_SIZE = 100;
const TRIAGE_ATOM_MAX_PAGES = Math.min(12, Math.max(1, parseInt(process.env.TRIAGE_ATOM_MAX_PAGES || '8', 10) || 8));
const TRIAGE_INDEX_DAYS = Math.min(7, Math.max(1, parseInt(process.env.TRIAGE_INDEX_DAYS || '3', 10) || 3));
const TRIAGE_MAX_PER_TYPE = Math.min(1000, Math.max(10, parseInt(process.env.FILING_TRIAGE_MAX_PER_TYPE || '250', 10) || 250));
const TRIAGE_CONCURRENCY = Math.min(8, Math.max(1, parseInt(process.env.FILING_TRIAGE_CONCURRENCY || '4', 10) || 4));
const TRIAGE_BUDGET_MS = Math.max(30_000, parseInt(process.env.FILING_TRIAGE_BUDGET_MS || String(8 * 60 * 1000), 10) || 8 * 60 * 1000);

// ── Seen-set: every accession number already handled (scored or deliberately
// skipped), so skipped filings are never re-downloaded. Memoized in-process;
// filing_triage_seen is the durable copy.

const triageSeenMemo = new Set();
const triageEmptyAttempts = new Map();

async function getSeenAccessionNumbers(accessionNos) {
  const seen = new Set();
  const unknown = [];
  for (const acc of accessionNos) {
    if (triageSeenMemo.has(acc)) seen.add(acc);
    else unknown.push(acc);
  }
  if (!unknown.length || !hasFilingDb()) return seen;
  for (let i = 0; i < unknown.length; i += 150) {
    const { data, error } = await serverSupabase
      .from('filing_triage_seen')
      .select('accession_no')
      .in('accession_no', unknown.slice(i, i + 150));
    // Throw rather than guess: treating a failed lookup as "nothing seen" would re-score everything.
    if (error) throw new Error(`filing_triage_seen lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      seen.add(row.accession_no);
      triageSeenMemo.add(row.accession_no);
    }
  }
  return seen;
}

async function markAccessionsSeen(rows) {
  if (!rows.length || !hasFilingDb()) return;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await serverSupabase
      .from('filing_triage_seen')
      .upsert(chunk.map((r) => ({ ...r, seen_at: new Date().toISOString() })), { onConflict: 'accession_no' });
    if (error) { console.error('[filing-triage-seen upsert]', error.message); continue; }
    for (const r of chunk) triageSeenMemo.add(r.accession_no);
  }
  if (triageSeenMemo.size > 100_000) triageSeenMemo.clear();
}

function indexPageUrl(entry) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(entry.cik)}/${entry.accession.replace(/-/g, '')}/${entry.accession}-index.htm`;
}

function byNewest(a, b) {
  return String(b.filedDate).localeCompare(String(a.filedDate));
}

// ── Discovery: each returns { candidates, stats } where candidates are
// { accessionNo, formType, filedDate, filingUrl, symbol, subjectCompany,
// subjectCik, filerName, sector, industry, context, loadState() } for filings
// not yet seen, newest first. With dryRun, nothing is written.

async function discoverOwnershipCandidates({ days, maxNew, dryRun }) {
  const filings = (await fetchMarketFilings(days)).filter((f) => f.accessionNo);
  const seen = await getSeenAccessionNumbers(filings.map((f) => f.accessionNo));
  const unseen = filings.filter((f) => !seen.has(f.accessionNo)).sort(byNewest);
  return {
    stats: { listed: filings.length, unseen: unseen.length, skipped: 0 },
    candidates: unseen.slice(0, maxNew).map((f) => ({
      accessionNo: f.accessionNo,
      formType: f.formType,
      filedDate: f.filedDate,
      filingUrl: f.edgarUrl,
      symbol: f.symbol || null,
      subjectCompany: f.subjectCompany || f.filerName || '',
      subjectCik: f.subjectCik || null,
      filerName: f.filerName || '',
      sector: f.sector || null,
      industry: f.industry || null,
      context: {},
      ruleInput: { formType: f.formType, filerName: f.filerName },
      loadState: () => fetchEdgarFilingText(f.edgarUrl),
    })),
  };
}

function describeInsiderTransaction(t) {
  const kind = t.eventCategory && t.eventCategory !== 'other' ? t.eventCategory.replace(/_/g, ' ') : t.type;
  const price = t.pricePerShare ? ` @ $${t.pricePerShare}` : '';
  const value = t.totalValue ? ` = $${Math.round(t.totalValue).toLocaleString('en-US')}` : '';
  return `- ${t.transactionDate} | code ${t.transactionCode} (${kind}) | ${Math.round(t.shares).toLocaleString('en-US')} shares${price}${value}`;
}

async function collectForm4Entries() {
  const merged = new Map();
  for (let page = 0; page < TRIAGE_ATOM_MAX_PAGES; page += 1) {
    let batch = [];
    try {
      batch = await fetchCurrentForm4AtomEntries(page * TRIAGE_ATOM_PAGE_SIZE);
    } catch (err) {
      console.error(`[triage form4 atom page ${page}]`, err.message);
      break;
    }
    if (!batch.length) break;
    for (const e of batch) merged.set(e.accession, e);
  }
  const indexed = await fetchDailyIndexEntries(TRIAGE_INDEX_DAYS, (form) => form === '4' || form === '4/A').catch(() => []);
  for (const e of indexed) if (!merged.has(e.accession)) merged.set(e.accession, e);
  return [...merged.values()].sort(byNewest);
}

async function discoverInsiderCandidates({ maxNew, dryRun }) {
  const entries = await collectForm4Entries();
  const seen = await getSeenAccessionNumbers(entries.map((e) => e.accession));
  const unseen = entries.filter((e) => !seen.has(e.accession));
  const toParse = unseen.slice(0, maxNew * 3);

  const parsed = [];
  for (let i = 0; i < toParse.length; i += 6) {
    const batch = await Promise.allSettled(toParse.slice(i, i + 6).map(async (entry) => ({ entry, trades: await fetchSecInsiderActivityItem(entry) })));
    for (const r of batch) if (r.status === 'fulfilled') parsed.push(r.value);
  }

  // Mechanical-only filings (grants, tax withholding, exercises) carry no
  // discretionary signal; they are recorded as seen so they are never re-parsed.
  // An empty result is ambiguous (derivative-only filing or a transient SEC
  // error), so it is only recorded after a second empty attempt.
  const skipped = [];
  const discretionary = [];
  for (const { entry, trades } of parsed) {
    if (!trades.length) {
      const attempts = (triageEmptyAttempts.get(entry.accession) || 0) + 1;
      triageEmptyAttempts.set(entry.accession, attempts);
      if (attempts >= 2) skipped.push({ accession_no: entry.accession, filing_type: 'insider', outcome: 'skipped' });
      continue;
    }
    if (!trades.some((t) => t.type === 'BUY' || t.type === 'SELL')) {
      skipped.push({ accession_no: entry.accession, filing_type: 'insider', outcome: 'skipped' });
      continue;
    }
    discretionary.push({ entry, trades });
  }
  if (!dryRun) await markAccessionsSeen(skipped);

  const buyersBySymbol = new Map();
  for (const { trades } of discretionary) {
    for (const t of trades.filter((x) => x.type === 'BUY')) {
      if (!buyersBySymbol.has(t.symbol)) buyersBySymbol.set(t.symbol, new Set());
      buyersBySymbol.get(t.symbol).add(t.insiderName);
    }
  }

  const candidates = discretionary.slice(0, maxNew).map(({ entry, trades }) => {
    const first = trades[0];
    const buys = trades.filter((t) => t.type === 'BUY');
    const totalValue = trades.reduce((sum, t) => sum + (t.type === 'BUY' || t.type === 'SELL' ? t.totalValue || 0 : 0), 0);
    const clusterBuy = buys.length > 0 && (buyersBySymbol.get(first.symbol)?.size || 0) >= INSIDER_CLUSTER_MIN;
    const state = [
      'FORM 4 INSIDER TRANSACTION REPORT',
      `Issuer: ${first.companyName} (${first.symbol})`,
      `Reporting insider: ${first.insiderName}${first.title ? `, ${first.title}` : ''}`,
      `Filed: ${entry.filedDate}`,
      'Transactions:',
      ...trades.map(describeInsiderTransaction),
      clusterBuy ? `Note: ${buyersBySymbol.get(first.symbol).size} different insiders bought ${first.symbol} in the current filing window.` : '',
    ].filter(Boolean).join('\n');
    return {
      accessionNo: entry.accession,
      formType: entry.formType || '4',
      filedDate: entry.filedDate,
      filingUrl: first.filingUrl,
      symbol: first.symbol,
      subjectCompany: first.companyName,
      subjectCik: entry.cik ? String(entry.cik) : null,
      filerName: first.insiderName,
      sector: null,
      industry: null,
      context: { clusterBuy, totalValue },
      ruleInput: {
        buyValue: buys.reduce((sum, t) => sum + (t.totalValue || 0), 0),
        sellValue: trades.filter((t) => t.type === 'SELL').reduce((sum, t) => sum + (t.totalValue || 0), 0),
        clusterBuy,
        isExecutive: /chief|\bceo\b|\bcfo\b|\bcoo\b|president|chair/i.test(first.title || ''),
      },
      loadState: async () => state,
    };
  });
  return { candidates, stats: { listed: entries.length, unseen: unseen.length, skipped: skipped.length } };
}

function parseEightKAtomBlock(block) {
  const title = htmlDecode(block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const href = htmlDecode(block.match(/<link[^>]*href="([^"]+)"/i)?.[1] || '');
  const summary = htmlDecode(block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i)?.[1] || '').replace(/<[^>]+>/g, ' ');
  const t = title.match(/^(8-K(?:\/A)?)\s+-\s+(.+?)\s+\((\d{6,10})\)/i);
  if (!t) return null;
  const accessionNo = summary.match(/AccNo:\s*([\d-]+)/i)?.[1];
  const filedDate = summary.match(/Filed:\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
  if (!accessionNo || !filedDate || !href) return null;
  const itemCodes = [...summary.matchAll(/Item\s+(\d\.\d{2})/gi)].map((m) => m[1]);
  return { accessionNo, formType: t[1].toUpperCase(), company: t[2].trim(), cik: t[3], filedDate, href, itemCodes };
}

async function collectEightKItems() {
  const merged = new Map();
  for (let page = 0; page < TRIAGE_ATOM_MAX_PAGES; page += 1) {
    let atom;
    try {
      atom = await httpsGet(
        `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=8-K&owner=include&count=${TRIAGE_ATOM_PAGE_SIZE}&start=${page * TRIAGE_ATOM_PAGE_SIZE}&output=atom`,
        { 'User-Agent': SEC_UA, Accept: 'application/atom+xml,application/xml,text/xml' }
      );
    } catch (err) {
      console.error(`[triage 8-K atom page ${page}]`, err.message);
      break;
    }
    const blocks = [...atom.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
    if (!blocks.length) break;
    for (const block of blocks) {
      const item = parseEightKAtomBlock(block);
      if (item) merged.set(item.accessionNo, item);
    }
    if (blocks.length < TRIAGE_ATOM_PAGE_SIZE) break;
  }
  // The index has no item codes, so these cannot be pre-filtered as routine;
  // Jev classifies them (event_category "routine") instead.
  const indexed = await fetchDailyIndexEntries(TRIAGE_INDEX_DAYS, (form) => form === '8-K' || form === '8-K/A').catch(() => []);
  for (const e of indexed) {
    if (merged.has(e.accession)) continue;
    merged.set(e.accession, {
      accessionNo: e.accession, formType: e.formType.toUpperCase(), company: e.companyName, cik: e.cik,
      filedDate: e.filedDate, href: indexPageUrl(e), itemCodes: [],
    });
  }
  return [...merged.values()].sort(byNewest);
}

async function discoverEventCandidates({ maxNew, dryRun }) {
  const items = await collectEightKItems();
  const directory = await loadSecCompanyTickerDirectory().catch(() => null);
  const seen = await getSeenAccessionNumbers(items.map((i) => i.accessionNo));
  const unseen = items.filter((i) => !seen.has(i.accessionNo));

  const routine = unseen.filter((i) => i.itemCodes.length && i.itemCodes.every((c) => EVENT_ROUTINE_ITEMS.has(c)));
  if (!dryRun) await markAccessionsSeen(routine.map((i) => ({ accession_no: i.accessionNo, filing_type: 'event', outcome: 'skipped' })));
  const routineSet = new Set(routine.map((i) => i.accessionNo));

  const candidates = unseen
    .filter((i) => !routineSet.has(i.accessionNo))
    .slice(0, maxNew)
    .map((i) => {
      const match = directory?.byCik?.get(String(i.cik)) || directory?.byCik?.get(String(Number(i.cik))) || null;
      return {
        accessionNo: i.accessionNo,
        formType: i.formType,
        filedDate: i.filedDate,
        filingUrl: i.href,
        symbol: match?.ticker || null,
        subjectCompany: i.company,
        subjectCik: i.cik,
        filerName: i.company,
        sector: null,
        industry: null,
        context: {},
        itemCodes: i.itemCodes,
        loadState: async () => {
          const text = await fetchEdgarFilingText(i.href);
          const head = i.itemCodes.length ? `Items reported: ${i.itemCodes.join(', ')}\n` : '';
          return `FORM 8-K CURRENT REPORT\nIssuer: ${i.company}\n${head}${text.split(' ').slice(0, 3500).join(' ')}`;
        },
      };
    });
  return { candidates, stats: { listed: items.length, unseen: unseen.length, skipped: routine.length } };
}

const FILING_DISCOVERERS = {
  ownership: discoverOwnershipCandidates,
  insider: discoverInsiderCandidates,
  event: discoverEventCandidates,
};

async function saveTriageRow(typeKey, candidate, row) {
  const savedId = await upsertFilingSignal({
    accession_no: candidate.accessionNo,
    filing_type: typeKey,
    form_type: candidate.formType,
    symbol: candidate.symbol,
    subject_company: candidate.subjectCompany,
    subject_cik: candidate.subjectCik,
    filer_name: candidate.filerName,
    filed_date: candidate.filedDate,
    filing_url: candidate.filingUrl,
    sector: candidate.sector,
    industry: candidate.industry,
    updated_at: new Date().toISOString(),
    ...row,
  });
  if (!savedId) throw new Error('failed to persist signal');
  await markAccessionsSeen([{ accession_no: candidate.accessionNo, filing_type: typeKey, outcome: 'scored' }]);
}

function buildRuleVerdict(typeKey, candidate, stateText) {
  const input = typeKey === 'event'
    ? { itemCodes: candidate.itemCodes && candidate.itemCodes.length ? candidate.itemCodes : extractEightKItems(String(stateText).slice(0, 60000)) }
    : candidate.ruleInput || {};
  const verdict = rulesPriority(typeKey, input);
  const signals = { scored_by: 'rules', rule_reason: verdict.reason, rule_priority: verdict.priority };
  if (typeKey === 'insider') {
    signals.cluster_buy = Boolean(input.clusterBuy);
    signals.is_executive = Boolean(input.isExecutive);
    signals.total_value = Math.round((input.buyValue || 0) + (input.sellValue || 0)) || null;
  }
  if (typeKey === 'event') signals.items = (input.itemCodes || []).join(',');
  return { verdict, signals };
}

async function triageCandidate(typeKey, candidate) {
  const def = FILING_TYPES[typeKey];
  const stateText = await candidate.loadState();
  const { verdict, signals: ruleSignals } = buildRuleVerdict(typeKey, candidate, stateText);

  // Noise: recorded as seen so it is never re-fetched, but not stored in the feed.
  if (FILING_TRIAGE_MODE !== 'jev' && verdict.priority < TRIAGE_NOISE_FLOOR) {
    await markAccessionsSeen([{ accession_no: candidate.accessionNo, filing_type: typeKey, outcome: 'skipped' }]);
    return { tokens: 0, escalated: false, noise: true };
  }

  const rulesRow = {
    priority: verdict.priority,
    priority_tier: verdict.priorityTier,
    materiality_score: null,
    materiality_confidence: null,
    signals: ruleSignals,
    jev_raw: null,
    jev_model: null,
    escalated: false,
    llm_thesis: null,
    llm_model: null,
  };

  if (FILING_TRIAGE_MODE === 'rules') {
    await saveTriageRow(typeKey, candidate, rulesRow);
    return { tokens: 0, escalated: false };
  }

  let signal;
  try {
    signal = await scoreFilingWithJev(typeKey, stateText, candidate.context);
  } catch (err) {
    if (FILING_TRIAGE_MODE === 'jev') throw err;
    // Treat Jev as an unreliable provider: keep the filing visible with its rule-based score.
    console.error(`[filing-triage jev ${candidate.accessionNo}] using rules instead:`, err.message);
    await saveTriageRow(typeKey, candidate, { ...rulesRow, signals: { ...ruleSignals, jev_error: String(err.message).slice(0, 160) } });
    return { tokens: 0, escalated: false };
  }
  let tokens = signal.tokensUsed;

  let llm = null;
  if (def.shouldEscalate(signal)) {
    try {
      llm = await generateFilingThesis(def, stateText);
      if (llm) tokens += llm.tokens || 0;
    } catch (err) {
      console.error(`[filing-triage llm ${candidate.accessionNo}]`, err.message);
    }
  }

  await saveTriageRow(typeKey, candidate, {
    priority: signal.priority,
    priority_tier: signal.priorityTier,
    materiality_score: signal.materialityScore,
    materiality_confidence: signal.materialityConfidence,
    signals: { ...signal.fields, scored_by: 'jev', rule_priority: verdict.priority, rule_reason: verdict.reason },
    jev_raw: signal.jevRaw,
    jev_model: signal.jevModel,
    escalated: Boolean(llm?.thesis),
    llm_thesis: llm?.thesis ?? null,
    llm_model: llm?.model ?? null,
  });
  return { tokens, escalated: Boolean(llm?.thesis) };
}

let filingTriageRunning = false;

async function runPool(items, limit, worker, shouldStop) {
  let next = 0;
  async function lane() {
    while (next < items.length && !shouldStop()) {
      const item = items[next];
      next += 1;
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return items.length - next;
}

async function runFilingTriageJob({ types = Object.keys(FILING_TYPES), days = 3, maxNewPerType = TRIAGE_MAX_PER_TYPE } = {}) {
  const started = Date.now();
  if (!FILING_TRIAGE_ENABLED) return { skipped: true, reason: 'disabled (FILING_TRIAGE_ENABLED != 1)' };
  if (FILING_TRIAGE_MODE !== 'rules' && !TYPESAFE_API_KEY) return { skipped: true, reason: `No Jev key configured: set TYPESAFE_API_KEY or OPENROUTER_API_KEY (mode ${FILING_TRIAGE_MODE})` };
  if (!hasFilingDb()) return { skipped: true, reason: 'no database configured' };
  if (filingTriageRunning) return { skipped: true, reason: 'a triage run is already in progress' };

  filingTriageRunning = true;
  const summary = {};
  let tokensUsed = 0;
  const errors = [];
  const outOfTime = () => Date.now() - started > TRIAGE_BUDGET_MS;
  try {
    for (const typeKey of types) {
      const discover = FILING_DISCOVERERS[typeKey];
      if (!discover) continue;
      const stats = { listed: 0, unseen: 0, skipped: 0, candidates: 0, scored: 0, noise: 0, escalated: 0, deferred: 0 };
      summary[typeKey] = stats;
      let found;
      try {
        found = await discover({ days, maxNew: maxNewPerType, dryRun: false });
      } catch (err) {
        errors.push(`${typeKey} discovery: ${err.message}`);
        continue;
      }
      Object.assign(stats, found.stats, { candidates: found.candidates.length });
      stats.deferred = await runPool(found.candidates, TRIAGE_CONCURRENCY, async (candidate) => {
        try {
          const result = await triageCandidate(typeKey, candidate);
          tokensUsed += result.tokens;
          if (result.noise) stats.noise += 1;
          else stats.scored += 1;
          if (result.escalated) stats.escalated += 1;
        } catch (err) {
          errors.push(`${typeKey} ${candidate.accessionNo}: ${err.message}`);
        }
      }, outOfTime);
      // Anything unscored (over the per-run cap or out of time) stays unseen
      // and is picked up first on the next run.
      stats.deferred += Math.max(0, stats.unseen - stats.skipped - stats.candidates);
    }
  } finally {
    filingTriageRunning = false;
  }

  const scored = Object.values(summary).reduce((n, s) => n + s.scored, 0);
  await logAgentRun({
    job: 'filing-triage',
    itemsProcessed: scored,
    tokensUsed,
    msElapsed: Date.now() - started,
    error: errors.length ? errors.slice(0, 5).join(' | ') : null,
  });
  return { mode: FILING_TRIAGE_MODE, scored, tokensUsed, byType: summary, errors: errors.slice(0, 20) };
}

function parseSymbolsParam(value) {
  if (!value) return null;
  const list = (Array.isArray(value) ? value : String(value).split(/[\s,]+/))
    .map((v) => normalizeSymbol(String(v)))
    .filter(Boolean)
    .slice(0, 50);
  return list.length ? list : null;
}

function parseTypesParam(value) {
  if (!value) return null;
  const wanted = String(value).split(',').map((s) => s.trim()).filter((s) => FILING_TYPES[s]);
  return wanted.length ? wanted : null;
}

app.get('/api/filings/feed', async (req, res) => {
  try {
    const signals = await getFilingSignals({
      types: parseTypesParam(req.query.types),
      minPriority: Math.max(0, Number(req.query.minPriority ?? 0) || 0),
      tier: ['critical', 'high', 'medium', 'low'].includes(req.query.tier) ? req.query.tier : null,
      days: Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 90),
      escalatedOnly: req.query.escalatedOnly === '1',
      symbol: req.query.symbol ? normalizeSymbol(String(req.query.symbol)) : null,
      symbols: parseSymbolsParam(req.query.symbols),
      limit: Math.min(parseInt(req.query.limit || '100', 10) || 100, 500),
    });
    res.json({ schemaVersion: 2, triageMode: FILING_TRIAGE_MODE, signals, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[api/filings/feed]', err.message);
    res.status(502).json({ schemaVersion: 2, signals: [], generatedAt: new Date().toISOString(), error: err.message });
  }
});

// Legacy 13D/13G endpoint kept for the existing /ownership-filings page:
// flattens the ownership-specific fields back to their original column names.
app.get('/api/ownership-filings/triage', async (req, res) => {
  try {
    const minMateriality = Number(req.query.minMateriality ?? 0);
    const investorType = req.query.investorType ? String(req.query.investorType) : null;
    const rows = await getFilingSignals({
      types: ['ownership'],
      days: Math.min(Math.max(parseInt(req.query.days || '14', 10), 1), 90),
      escalatedOnly: req.query.escalatedOnly === '1',
      limit: Math.min(parseInt(req.query.limit || '100', 10) || 100, 500),
    });
    const signals = rows
      .map((r) => ({ ...r, ...(r.signals || {}) }))
      .filter((r) => (minMateriality > 0 ? (r.materiality_score ?? 0) >= minMateriality : true))
      .filter((r) => (investorType ? r.investor_type === investorType : true))
      .sort((a, b) => (b.materiality_score ?? -1) - (a.materiality_score ?? -1) || String(b.filed_date).localeCompare(String(a.filed_date)));
    res.json({ schemaVersion: 1, signals, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[api/ownership-filings/triage]', err.message);
    res.status(502).json({ schemaVersion: 1, signals: [], generatedAt: new Date().toISOString(), error: err.message });
  }
});

app.post('/api/filings/run-now', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  try {
    const types = parseTypesParam(req.query.types) || undefined;
    const result = await runFilingTriageJob({ types });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/ownership-filings/run-now', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  try {
    res.json({ ok: true, ...(await runFilingTriageJob({ types: ['ownership'] })) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Dry run: lists what the next triage pass would pick up (and how much is
// already handled) without calling Jev, the LLM, or writing anything.
app.post('/api/filings/discover', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  try {
    const types = parseTypesParam(req.query.types) || Object.keys(FILING_TYPES);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '25', 10) || 25, 1), 100);
    const byType = {};
    for (const typeKey of types) {
      const { candidates, stats } = await FILING_DISCOVERERS[typeKey]({ days: 3, maxNew: limit, dryRun: true });
      byType[typeKey] = {
        ...stats,
        sample: candidates.slice(0, 5).map((c) => ({ accessionNo: c.accessionNo, formType: c.formType, filedDate: c.filedDate, symbol: c.symbol, company: c.subjectCompany })),
      };
      if (req.query.preview === '1') {
        // Score the candidates with the rules only (no Jev, no writes) to show what rules mode would keep.
        const scored = [];
        await runPool(candidates, TRIAGE_CONCURRENCY, async (c) => {
          try {
            const { verdict } = buildRuleVerdict(typeKey, c, await c.loadState());
            scored.push({ symbol: c.symbol, company: c.subjectCompany, form: c.formType, priority: verdict.priority, tier: verdict.priorityTier, keep: verdict.priority >= TRIAGE_NOISE_FLOOR, reason: verdict.reason });
          } catch (err) {
            scored.push({ company: c.subjectCompany, form: c.formType, error: err.message });
          }
        }, () => false);
        scored.sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1));
        byType[typeKey].preview = {
          mode: FILING_TRIAGE_MODE,
          noiseFloor: TRIAGE_NOISE_FLOOR,
          previewed: scored.length,
          keptAsSignal: scored.filter((r) => r.keep).length,
          droppedAsNoise: scored.filter((r) => r.keep === false).length,
          rows: scored,
        };
      }
    }
    res.json({ ok: true, dryRun: true, byType });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── MCP server (Streamable HTTP, tools only) ─────────────────────────────────
// Lets Claude and other MCP clients query the triaged filing feed directly.
// Optional MCP_API_KEY: when set, clients must send `Authorization: Bearer <key>`.

const { handleMcpRequest } = require('./mcp.cjs');
const MCP_API_KEY = process.env.MCP_API_KEY || '';

const MCP_INSTRUCTIONS =
  'TARS triages SEC filings (13D/13G ownership, Form 4 insider trades, 8-K events). Each filing has a ' +
  'priority 0-100 (tier: critical >=75, high >=50, medium >=25, low) derived from a fast classifier (Jev). ' +
  "Filings that cleared their type's escalation rule also carry llm_thesis, a written AI read. " +
  'Start with get_priority_feed, then get_filing for one accession number. Treat filing dates and ' +
  'accession numbers as evidence; separate facts in the filing from inference in llm_thesis.';

const MCP_FILING_TYPES = Object.keys(FILING_TYPES);

const MCP_TOOLS = [
  {
    name: 'get_priority_feed',
    description: 'Ranked feed of triaged SEC filings, highest priority first. Filter by filing type, priority, tier, window and whether an AI thesis exists.',
    inputSchema: {
      type: 'object',
      properties: {
        types: { type: 'array', items: { type: 'string', enum: MCP_FILING_TYPES }, description: 'ownership = 13D/13G, insider = Form 4, event = 8-K. Default: all.' },
        symbols: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Only these tickers (your watchlist). Default: all.' },
        min_priority: { type: 'integer', minimum: 0, maximum: 100, description: 'Default 50 (high and critical only).' },
        tier: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        days: { type: 'integer', minimum: 1, maximum: 90, description: 'Look-back window in days. Default 3.' },
        escalated_only: { type: 'boolean', description: 'Only filings that have an AI thesis.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 25.' },
      },
    },
    handler: async (a) => {
      const types = Array.isArray(a.types) ? a.types.filter((t) => FILING_TYPES[t]) : null;
      const signals = await getFilingSignals({
        types: types && types.length ? types : null,
        symbols: parseSymbolsParam(a.symbols),
        minPriority: a.min_priority === undefined ? 50 : Math.max(0, Number(a.min_priority) || 0),
        tier: ['critical', 'high', 'medium', 'low'].includes(a.tier) ? a.tier : null,
        days: Math.min(Math.max(parseInt(a.days ?? 3, 10) || 3, 1), 90),
        escalatedOnly: a.escalated_only === true,
        limit: Math.min(Math.max(parseInt(a.limit ?? 25, 10) || 25, 1), 100),
      });
      return { count: signals.length, signals, generatedAt: new Date().toISOString() };
    },
  },
  {
    name: 'get_filing',
    description: 'One triaged filing by SEC accession number (e.g. 0001104659-26-120752), including its typed signals and AI thesis if present.',
    inputSchema: {
      type: 'object',
      properties: { accession_no: { type: 'string', description: 'Accession number with dashes.' } },
      required: ['accession_no'],
    },
    handler: async (a) => {
      const accession = String(a.accession_no || '').trim();
      if (!/^\d{10}-\d{2}-\d{6}$/.test(accession)) throw new Error('accession_no must look like 0001104659-26-120752');
      const filing = await getFilingByAccession(accession);
      if (!filing) throw new Error(`No triaged filing found for ${accession}`);
      return filing;
    },
  },
  {
    name: 'get_ticker_filings',
    description: 'All triaged filings for one ticker, highest priority first, across 13D/13G, Form 4 and 8-K.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: 'US ticker, e.g. NVDA.' },
        days: { type: 'integer', minimum: 1, maximum: 90, description: 'Default 30.' },
        min_priority: { type: 'integer', minimum: 0, maximum: 100, description: 'Default 0 (everything triaged).' },
      },
      required: ['symbol'],
    },
    handler: async (a) => {
      const symbol = normalizeSymbol(String(a.symbol || ''));
      if (!symbol) throw new Error('symbol is required');
      const signals = await getFilingSignals({
        symbol,
        minPriority: Math.max(0, Number(a.min_priority) || 0),
        days: Math.min(Math.max(parseInt(a.days ?? 30, 10) || 30, 1), 90),
        limit: 100,
      });
      return { symbol, count: signals.length, signals };
    },
  },
  {
    name: 'get_stock_intelligence',
    description: 'Per-ticker context: price and trend, insider flow, 13D/13G filings, congress trades, tracked fund holders, fundamentals and derived signals.',
    inputSchema: {
      type: 'object',
      properties: { symbol: { type: 'string', description: 'Ticker, e.g. AAPL or SHOP.TO.' } },
      required: ['symbol'],
    },
    handler: async (a) => {
      const symbol = normalizeSymbol(String(a.symbol || ''));
      if (!symbol) throw new Error('symbol is required');
      return getStockIntelligenceCached(symbol);
    },
  },
];

app.get('/mcp', (req, res) => {
  res.status(405).set('Allow', 'POST').json({ error: 'This MCP endpoint is stateless: use POST with a JSON-RPC body.' });
});

app.post('/mcp', async (req, res) => {
  if (MCP_API_KEY && req.headers.authorization !== `Bearer ${MCP_API_KEY}`) {
    return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } });
  }
  try {
    const { status, body } = await handleMcpRequest(req.body, {
      serverInfo: { name: 'tars-filings', version: '1.0.0' },
      instructions: MCP_INSTRUCTIONS,
      tools: MCP_TOOLS,
    });
    if (body === undefined) return res.status(status).end();
    res.status(status).json(body);
  } catch (err) {
    console.error('[mcp]', err.message);
    res.status(500).json({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Internal error' } });
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

  if (clean.length < 25) return 'Technical context unavailable: not enough candle history.';

  const last = clean[clean.length - 1];
  const prev = clean[clean.length - 2];
  const recent5  = lastN(clean, 5);
  const recent10 = lastN(clean, 10);
  const recent20 = lastN(clean, 20);
  const recent30 = lastN(clean, 30);
  const recent50 = lastN(clean, 50);
  const recent60 = lastN(clean, 60);
  const recent90 = lastN(clean, 90);

  // Moving averages
  const sma20 = average(recent20.map((c) => c.close));
  const sma50 = recent50.length >= 50 ? average(recent50.map((c) => c.close)) : null;

  // Bollinger (20,2)
  const bandStd   = stddev(recent20.map((c) => c.close), sma20);
  const upperBand = sma20 + (2 * bandStd);
  const lowerBand = sma20 - (2 * bandStd);
  const bandWidthPct = sma20 ? ((upperBand - lowerBand) / sma20) * 100 : 0;

  // Support / resistance at multiple horizons
  const support20    = Math.min(...recent20.map((c) => c.low));
  const resistance20 = Math.max(...recent20.map((c) => c.high));
  const support60    = recent60.length ? Math.min(...recent60.map((c) => c.low)) : support20;
  const resistance60 = recent60.length ? Math.max(...recent60.map((c) => c.high)) : resistance20;
  const support90    = recent90.length ? Math.min(...recent90.map((c) => c.low)) : support60;
  const resistance90 = recent90.length ? Math.max(...recent90.map((c) => c.high)) : resistance60;

  // Returns at multiple timeframes
  const ret = (arr) => arr.length >= 2 ? ((arr[arr.length - 1].close / arr[0].close) - 1) * 100 : 0;
  const trend10 = ret(recent10);
  const trend30 = ret(recent30);
  const trend60 = ret(recent60);
  const trend90 = ret(recent90);

  // Volume context
  const vol5Avg  = average(recent5.map(c => c.volume).filter(Number.isFinite));
  const vol30Avg = average(recent30.map(c => c.volume).filter(Number.isFinite));
  const volRatio = vol30Avg > 0 ? (vol5Avg / vol30Avg) : 1;

  // Pattern detection
  let pattern = 'Range-bound';
  if (last.close > upperBand) pattern = 'Breakout above upper Bollinger band';
  else if (last.close < lowerBand) pattern = 'Breakdown below lower Bollinger band';
  else if (trend30 > 10 && last.close > sma20 && (sma50 && last.close > sma50)) pattern = 'Sustained uptrend — price above both 20/50 MA';
  else if (trend30 < -10 && last.close < sma20 && (sma50 && last.close < sma50)) pattern = 'Sustained downtrend — price below both 20/50 MA';
  else if (trend10 > 5 && last.close > sma20) pattern = 'Short-term uptrend with higher closes';
  else if (trend10 < -5 && last.close < sma20) pattern = 'Short-term downtrend with lower closes';
  else if (bandWidthPct < 8) pattern = 'Volatility squeeze — coiling for move';
  else if (prev.low <= lowerBand && last.close > prev.close) pattern = 'Rebound from lower band support';

  const regime =
    last.close >= resistance20 * 0.98 ? 'Testing 20-bar breakout threshold'
    : last.close <= support20 * 1.02  ? 'Testing 20-bar floor'
    : last.close >= resistance90 * 0.97 ? 'Near 90-bar highs'
    : last.close <= support90 * 1.03  ? 'Near 90-bar lows'
    : 'Mid-range within recent swing';

  // Price vs key MAs
  const vsSma20 = sma20 ? ((last.close / sma20) - 1) * 100 : 0;
  const vsSma50 = sma50 ? ((last.close / sma50) - 1) * 100 : null;

  const lines = [
    `Latest close: $${last.close.toFixed(2)} on ${String(last.time).slice(0, 10)} (1-bar change: ${prev ? (((last.close/prev.close) - 1) * 100).toFixed(2) : 'n/a'}%)`,
    `Moving averages — SMA20: $${sma20.toFixed(2)} (price ${vsSma20 >= 0 ? '+' : ''}${vsSma20.toFixed(1)}% vs MA)${sma50 ? ` · SMA50: $${sma50.toFixed(2)} (price ${vsSma50 >= 0 ? '+' : ''}${vsSma50.toFixed(1)}% vs MA)` : ''}`,
    `Bollinger (20,2): lower $${lowerBand.toFixed(2)} · upper $${upperBand.toFixed(2)} · bandwidth ${bandWidthPct.toFixed(1)}%${bandWidthPct < 8 ? ' (tight — squeeze)' : bandWidthPct > 20 ? ' (wide — elevated vol)' : ''}`,
    `Support / Resistance — 20bar: $${support20.toFixed(2)} / $${resistance20.toFixed(2)} · 60bar: $${support60.toFixed(2)} / $${resistance60.toFixed(2)} · 90bar: $${support90.toFixed(2)} / $${resistance90.toFixed(2)}`,
    `Returns — 10bar: ${trend10 >= 0 ? '+' : ''}${trend10.toFixed(1)}% · 30bar: ${trend30 >= 0 ? '+' : ''}${trend30.toFixed(1)}% · 60bar: ${trend60 >= 0 ? '+' : ''}${trend60.toFixed(1)}% · 90bar: ${trend90 >= 0 ? '+' : ''}${trend90.toFixed(1)}%`,
    `Volume — 5-day avg vs 30-day avg: ${(volRatio * 100).toFixed(0)}% ${volRatio > 1.3 ? '(heavy — conviction)' : volRatio < 0.7 ? '(light — drying up)' : '(normal)'}`,
    `Pattern: ${pattern}`,
    `Regime: ${regime}`,
  ];

  return lines.join('\n');
}

// ── Fundamentals summary — fed from Finnhub client-side fetches ──────────────
function summarizeFundamentals(fund) {
  if (!fund || typeof fund !== 'object') return '';
  const lines = [];

  // Valuation / growth / margins
  const vals = [];
  if (Number.isFinite(fund.peRatio))     vals.push(`P/E ${fund.peRatio.toFixed(1)}`);
  if (Number.isFinite(fund.pegRatio))    vals.push(`PEG ${fund.pegRatio.toFixed(2)}`);
  if (Number.isFinite(fund.psRatio))     vals.push(`P/S ${fund.psRatio.toFixed(1)}`);
  if (Number.isFinite(fund.epsTTM))      vals.push(`EPS TTM $${fund.epsTTM.toFixed(2)}`);
  if (vals.length) lines.push(`Valuation: ${vals.join(' · ')}`);

  const growth = [];
  if (Number.isFinite(fund.revenueGrowthYoy)) growth.push(`Revenue YoY ${fund.revenueGrowthYoy >= 0 ? '+' : ''}${fund.revenueGrowthYoy.toFixed(1)}%`);
  if (Number.isFinite(fund.epsGrowthYoy))     growth.push(`EPS YoY ${fund.epsGrowthYoy >= 0 ? '+' : ''}${fund.epsGrowthYoy.toFixed(1)}%`);
  if (growth.length) lines.push(`Growth: ${growth.join(' · ')}`);

  const margins = [];
  if (Number.isFinite(fund.grossMargin))     margins.push(`Gross ${fund.grossMargin.toFixed(1)}%`);
  if (Number.isFinite(fund.operatingMargin)) margins.push(`Op ${fund.operatingMargin.toFixed(1)}%`);
  if (Number.isFinite(fund.netMargin))       margins.push(`Net ${fund.netMargin.toFixed(1)}%`);
  if (Number.isFinite(fund.roe))             margins.push(`ROE ${fund.roe.toFixed(1)}%`);
  if (margins.length) lines.push(`Margins: ${margins.join(' · ')}`);

  // 52-week context
  if (Number.isFinite(fund.weeks52high) && Number.isFinite(fund.weeks52low)) {
    const pctFromHigh = Number.isFinite(fund.currentPrice) ? ((fund.currentPrice / fund.weeks52high - 1) * 100) : null;
    const pctFromLow  = Number.isFinite(fund.currentPrice) ? ((fund.currentPrice / fund.weeks52low  - 1) * 100) : null;
    let line = `52-week range: $${fund.weeks52low.toFixed(2)} — $${fund.weeks52high.toFixed(2)}`;
    if (pctFromHigh !== null && pctFromLow !== null) {
      line += ` (price ${pctFromHigh.toFixed(1)}% from high, ${pctFromLow >= 0 ? '+' : ''}${pctFromLow.toFixed(1)}% from low)`;
    }
    lines.push(line);
  }

  // Analyst consensus
  if (fund.analystRec && (fund.analystRec.buy || fund.analystRec.hold || fund.analystRec.sell)) {
    const r = fund.analystRec;
    const total = (r.strongBuy || 0) + (r.buy || 0) + (r.hold || 0) + (r.sell || 0) + (r.strongSell || 0);
    lines.push(`Analyst consensus: ${r.strongBuy || 0} strong buy · ${r.buy || 0} buy · ${r.hold || 0} hold · ${r.sell || 0} sell · ${r.strongSell || 0} strong sell (n=${total})`);
  }

  if (Number.isFinite(fund.priceTargetMean)) {
    const upside = Number.isFinite(fund.currentPrice) ? ((fund.priceTargetMean / fund.currentPrice - 1) * 100) : null;
    let line = `Price target: $${fund.priceTargetMean.toFixed(2)} mean`;
    if (Number.isFinite(fund.priceTargetHigh) && Number.isFinite(fund.priceTargetLow)) {
      line += ` (range $${fund.priceTargetLow.toFixed(2)} — $${fund.priceTargetHigh.toFixed(2)})`;
    }
    if (upside !== null) line += ` · ${upside >= 0 ? '+' : ''}${upside.toFixed(1)}% implied upside`;
    lines.push(line);
  }

  // Upcoming earnings
  if (fund.upcomingEarningsDate) {
    const d = new Date(fund.upcomingEarningsDate);
    const now = new Date();
    const days = Math.round((d - now) / (1000 * 60 * 60 * 24));
    lines.push(`Next earnings: ${fund.upcomingEarningsDate}${days >= 0 ? ` (in ${days} days)` : ''}`);
  }

  return lines.length ? lines.join('\n') : '';
}

function summarizeNews(news) {
  if (!Array.isArray(news) || news.length === 0) return 'No recent company news available.';
  const now = Date.now();
  return news.slice(0, 6).map((item, index) => {
    // Finnhub datetime is Unix seconds
    const ts = typeof item.datetime === 'number' ? item.datetime * 1000 : (item.datetime ? Date.parse(item.datetime) : 0);
    const ageLabel = ts > 0 ? (() => {
      const days = Math.round((now - ts) / (1000 * 60 * 60 * 24));
      if (days <= 0) return 'today';
      if (days === 1) return '1d ago';
      if (days < 14) return `${days}d ago`;
      if (days < 60) return `${Math.round(days / 7)}w ago`;
      return `${Math.round(days / 30)}mo ago`;
    })() : '';
    return `${index + 1}. ${item.headline} — ${item.source || 'Unknown'}${ageLabel ? ` (${ageLabel})` : ''}`;
  }).join('\n');
}

// Insider summary: windowed counts, net dollar flow, biggest trades, recent
function summarizeInsiders(insiders) {
  if (!Array.isArray(insiders) || insiders.length === 0) return 'No recent insider transactions.';

  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const clean = insiders.filter(t => t.transactionDate && t.transactionPrice > 0).map(t => ({
    ...t,
    dateMs: Date.parse(t.transactionDate),
    isBuy: t.transactionCode === 'P',
    isSell: t.transactionCode === 'S' || t.transactionCode === 'S-',
    value: Math.abs(t.share || 0) * (t.transactionPrice || 0),
  }));

  const windows = { '30d': 30, '90d': 90, '1y': 365, '2y': 730 };
  const countsByWindow = {};
  for (const [label, days] of Object.entries(windows)) {
    const cutoff = now.getTime() - days * msPerDay;
    const win = clean.filter(t => t.dateMs >= cutoff);
    const buys  = win.filter(t => t.isBuy);
    const sells = win.filter(t => t.isSell);
    const netUsd = buys.reduce((s, t) => s + t.value, 0) - sells.reduce((s, t) => s + t.value, 0);
    countsByWindow[label] = {
      buys: buys.length, sells: sells.length,
      netUsd,
      uniqueBuyers: new Set(buys.map(t => t.name)).size,
      uniqueSellers: new Set(sells.map(t => t.name)).size,
    };
  }

  const allBuys  = clean.filter(t => t.isBuy).sort((a, b) => b.value - a.value);
  const allSells = clean.filter(t => t.isSell).sort((a, b) => b.value - a.value);
  const recent   = [...clean].sort((a, b) => b.dateMs - a.dateMs).slice(0, 5);

  const lines = ['Insider transaction windows:'];
  for (const [label, w] of Object.entries(countsByWindow)) {
    const netLabel = w.netUsd >= 0 ? `+$${(w.netUsd / 1000).toFixed(0)}k net buy` : `-$${(Math.abs(w.netUsd) / 1000).toFixed(0)}k net sell`;
    lines.push(`  ${label}: ${w.buys} buys / ${w.sells} sells · ${w.uniqueBuyers} unique buyers · ${netLabel}`);
  }

  if (allBuys[0]) {
    const t = allBuys[0];
    lines.push(`Biggest buy: ${t.name} (${t.title || 'insider'}) — ${Math.abs(t.share).toLocaleString()} sh @ $${t.transactionPrice} = $${(t.value / 1000).toFixed(0)}k on ${t.transactionDate.slice(0, 10)}`);
  }
  if (allSells[0]) {
    const t = allSells[0];
    lines.push(`Biggest sell: ${t.name} (${t.title || 'insider'}) — ${Math.abs(t.share).toLocaleString()} sh @ $${t.transactionPrice} = $${(t.value / 1000).toFixed(0)}k on ${t.transactionDate.slice(0, 10)}`);
  }

  if (recent.length) {
    lines.push('Most recent 5:');
    for (const t of recent) {
      const action = t.isBuy ? 'BOUGHT' : t.isSell ? 'SOLD' : (t.transactionCode || '?');
      lines.push(`  ${t.transactionDate.slice(0, 10)} · ${t.name} ${action} ${Math.abs(t.share).toLocaleString()} sh @ $${t.transactionPrice}`);
    }
  }

  return lines.join('\n');
}

// ── Stock Q&A Chat ────────────────────────────────────────────────────────────
function compactJsonForPrompt(value, maxChars = 9000) {
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > maxChars ? `${text.slice(0, maxChars)}\n...truncated...` : text;
  } catch {
    return '';
  }
}

function summarizeStockIntelligenceForAsk(intel) {
  if (!intel || typeof intel !== 'object') return '';
  return [
    `SYMBOL INTELLIGENCE (${intel.asOf || 'unknown time'}):`,
    compactJsonForPrompt({
      company: intel.company,
      price: intel.price,
      trend: intel.trend,
      signals: intel.signals,
      events: intel.events,
      news: intel.news,
      insiders: intel.insiders,
      ownershipFilings: intel.ownershipFilings,
      congress: intel.congress,
      fundamentals: intel.fundamentals,
      explanations: intel.explanations,
      dataAvailability: intel.dataAvailability,
      sources: intel.sources,
    }, 11000),
  ].join('\n');
}

async function buildStockIntelligenceForAsk(symbol) {
  try {
    return await Promise.race([
      buildStockIntelligence(symbol),
      new Promise((resolve) => setTimeout(() => resolve(null), 9000)),
    ]);
  } catch (err) {
    console.warn('[ask-stock/intelligence]', err.message);
    return null;
  }
}

async function callGroqChat(apiKey, body) {
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req2 = https.request(
      {
        hostname: 'api.groq.com',
        path: '/openai/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(raw),
        },
      },
      (r) => {
        let d = '';
        r.on('data', (c) => { d += c; });
        r.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.error) return reject(new Error(j.error.message || 'Groq API error'));
            resolve(j.choices?.[0]?.message?.content || '');
          } catch {
            reject(new Error('Invalid Groq response'));
          }
        });
      }
    );
    req2.on('error', reject);
    req2.setTimeout(45000, () => { req2.destroy(); reject(new Error('Groq API timeout')); });
    req2.write(raw);
    req2.end();
  });
}

function buildAskStockContext(symbol, context, intelligence) {
  const ctx = [];
  const quick = [];
  const companyLabel = context?.companyName || intelligence?.company?.name || symbol;

  if (context?.price) quick.push(`Price ${context.price}`);
  if (context?.change) quick.push(`Day change ${context.change}`);
  if (context?.marketCap) quick.push(`Mkt Cap ${context.marketCap}`);
  if (context?.volume) quick.push(`Volume ${context.volume}`);
  if (context?.exchange) quick.push(`Exchange ${context.exchange}`);
  if (quick.length) ctx.push(`CLIENT MARKET SNAPSHOT: ${quick.join(' | ')}`);

  const intelligenceBlock = summarizeStockIntelligenceForAsk(intelligence);
  if (intelligenceBlock) ctx.push(intelligenceBlock);

  if (context?.candles?.length) {
    ctx.push('--- CLIENT TECHNICAL READ ---');
    ctx.push(summarizeTechnicals(context.candles));
  }

  if (context?.fundamentals) {
    const fundWithPrice = { ...context.fundamentals };
    if (!Number.isFinite(fundWithPrice.currentPrice) && context?.priceRaw) {
      fundWithPrice.currentPrice = Number(context.priceRaw);
    }
    const fundBlock = summarizeFundamentals(fundWithPrice);
    if (fundBlock) {
      ctx.push('--- CLIENT FUNDAMENTALS & ANALYST VIEW ---');
      ctx.push(fundBlock);
    }
  }

  if (context?.insiders?.length) {
    ctx.push('--- CLIENT INSIDER FLOW ---');
    ctx.push(summarizeInsiders(context.insiders));
  }

  if (context?.news?.length) {
    ctx.push('--- CLIENT RECENT NEWS ---');
    ctx.push(summarizeNews(context.news));
  }

  return {
    companyLabel,
    contextText: ctx.join('\n\n') || 'No live context available.',
  };
}

app.post('/api/ask-stock', async (req, res) => {
  const { question, symbol, context, history } = req.body ?? {};
  if (!question || !symbol) return res.status(400).json({ error: 'Missing question or symbol' });

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!anthropicKey && !groqKey) {
    return res.status(503).json({ error: 'AI not configured - set ANTHROPIC_API_KEY or GROQ_API_KEY.' });
  }

  // Cache check — same question on same symbol within 15min returns the cached answer.
  // Key incorporates price bucket so quote moves still invalidate.
  const priceBucket = context?.priceRaw ? Math.round(Number(context.priceRaw)) : 0;
  const cacheKey = aiCacheKey({ route: 'ask-stock-v2', symbol, question, priceBucket });
  const cached = aiCacheGet(cacheKey);
  if (cached) return res.json({ answer: cached, cached: true, provider: 'cache' });

  // Build context block from what the client sends
  const ctx = [];
  const quick = [];
  const companyLabel = context?.companyName ? `${context.companyName} (${symbol})` : symbol;
  if (context?.price)       quick.push(`Price ${context.price}`);
  if (context?.change)      quick.push(`Day change ${context.change}`);
  if (context?.marketCap)   quick.push(`Mkt Cap ${context.marketCap}`);
  if (context?.volume)      quick.push(`Volume ${context.volume}`);
  if (context?.exchange)    quick.push(`Exchange ${context.exchange}`);
  if (quick.length) ctx.push(`Market snapshot: ${quick.join(' · ')}`);

  if (context?.candles?.length) {
    ctx.push('--- TECHNICAL READ ---');
    ctx.push(summarizeTechnicals(context.candles));
  }

  // Fundamentals + analyst block (client fetches from Finnhub and passes here)
  if (context?.fundamentals) {
    // Ensure current price is set for % calculations
    const fundWithPrice = { ...context.fundamentals };
    if (!Number.isFinite(fundWithPrice.currentPrice) && context?.priceRaw) {
      fundWithPrice.currentPrice = Number(context.priceRaw);
    }
    const fundBlock = summarizeFundamentals(fundWithPrice);
    if (fundBlock) {
      ctx.push('--- FUNDAMENTALS & ANALYST VIEW ---');
      ctx.push(fundBlock);
    }
  }

  if (context?.insiders?.length) {
    ctx.push('--- INSIDER FLOW ---');
    ctx.push(summarizeInsiders(context.insiders));
  }

  if (context?.news?.length) {
    ctx.push('--- RECENT NEWS ---');
    ctx.push(summarizeNews(context.news));
  }

  const intelligence = await buildStockIntelligenceForAsk(symbol);
  const intelligenceBlock = summarizeStockIntelligenceForAsk(intelligence);
  if (intelligenceBlock) {
    ctx.unshift(intelligenceBlock);
  }

  const conversationHistory = Array.isArray(history)
    ? history
        .filter((message) =>
          message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          message.content.trim()
        )
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: message.content.trim().slice(0, 2500),
        }))
    : [];

  const systemPrompt = `You are a sharp Wall Street equity analyst covering ${companyLabel}. Answer like a senior analyst briefing a PM — direct, specific, data-driven, and willing to make a call.

ANALYST FRAMEWORK:
- Use the Comprehensive Company Analysis skill for this stock-detail Ask AI flow
- Start from a company snapshot: business model, market position, moat, management/governance when context supports it
- Evaluate financial snapshot and valuation: market cap, EV when available, P/E, EV/EBITDA, PEG, P/S, P/B, growth, margins, FCF, ROIC/ROE, balance sheet, dividend quality
- Compare valuation to peers/sector when peer data is present; explain whether a premium/discount is justified
- Identify model drivers: volume, pricing, mix, market growth, new products/geographies, acquisitions, cost initiatives, and margin expansion
- Include analyst community view when available: rating mix, price target, implied upside/downside, revisions, and dispersion
- Assess news flow and catalysts: earnings, guidance, product launches, regulation, lawsuits, investor days, M&A, activist involvement
- Include market psychology carefully: technicals, support/resistance, social sentiment, insider/congress/fund/filing activity
- Always include explicit risks: execution, competition, customer concentration, cyclicality, regulation, macro, valuation, litigation, and event risk
- Finish with valuation/thesis: Bull/Base/Bear, Buy/Hold/Sell or Overweight/Neutral/Underweight, conviction, and what would change the view

RESPONSE FORMAT:
- Lead with a one-line verdict that actually answers the question and includes Buy/Hold/Sell or Overweight/Neutral/Underweight when the question is investment-oriented
- For analytical questions, use markdown sections in this order when relevant:
  **Verdict**
  **Company snapshot**
  **Valuation**
  **What matters most right now**
  **Financial drivers**
  **Trend / technicals**
  **News / catalysts**
  **Filings / insiders**
  **Bull case**
  **Bear case**
  **Risks**
  **What would change my mind**
  **Bottom line**
- Use bullet points (-) when listing 3+ items
- Bold key numbers and names with **markdown**
- Cite specific numbers from the context (price levels, P/E, insider $ flow, target upside %) rather than vague language
- Explain the why, not just the what: connect the evidence to the conclusion
- If the user's question is broad, synthesize the chart, fundamentals, insider flow, and news into one coherent thesis
- If the user's question is narrow, answer it first and then add the most relevant supporting evidence
- Keep response in the 350-700 word range when the question is analytical; be concise only for narrow factual questions
- Never use generic disclaimers ("consult a financial advisor", "past performance", etc.)
- If a specific fact isn't in the context and you don't know it, say so briefly and pivot to what the data does show
- Do not invent unavailable metrics; write "not available in current context" when a metric is missing
- Use the SYMBOL INTELLIGENCE block first when present; it is the server-normalized source for trend, signals, filings, funds, and data availability
- Tie the technical read to the fundamental read when both are present — do they agree or conflict?
- Comment explicitly on whether news, filings, insider flow, congress trades, fund activity, Reddit/X trends, and price action confirm or contradict each other when present
- Do not hedge every sentence; if the evidence leans one way, say so clearly
- Treat prior conversation as context for follow-up questions and maintain continuity instead of restarting from scratch

STOCK CONTEXT (live data as of today):
${ctx.join('\n') || 'No live context — rely on your training knowledge about this company.'}`;

  try {
    let answer = '';
    let provider = '';

    if (anthropicKey) {
      const userPrompt = [
        ...conversationHistory.map((message) => `${message.role.toUpperCase()}: ${message.content}`),
        `USER: ${question}`,
      ].join('\n\n');
      answer = await callClaude(systemPrompt, userPrompt, {
        model: process.env.ASK_STOCK_MODEL || CLAUDE_MODEL_PRESET,
        maxTokens: Number(process.env.ASK_STOCK_MAX_TOKENS || 1400),
        temperature: 0.2,
      });
      provider = 'anthropic';
    } else {
      answer = await callGroqChat(groqKey, {
        model: process.env.ASK_STOCK_GROQ_MODEL || 'llama-3.3-70b-versatile',
        max_tokens: Number(process.env.ASK_STOCK_MAX_TOKENS || 1600),
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          ...conversationHistory,
          { role: 'user', content: question },
        ],
      });
      provider = 'groq';
    }

    if (!answer || !String(answer).trim()) {
      throw new Error('AI returned an empty answer');
    }

    aiCacheSet(cacheKey, answer);
    res.json({ answer, provider, intelligenceAttached: Boolean(intelligence) });
  } catch (err) {
    console.error('[ask-stock]', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ── 13F Fund search + holdings ────────────────────────────────────────────────

// Background warming/sync keeps the slowest research feeds hot so users do not
// pay the full cold-build cost after restarts or TTL expiry.
function scheduleRepeatingTask(label, intervalMs, task) {
  if (!BACKGROUND_SYNC_ENABLED) return;
  const run = () => {
    task().catch((err) => {
      console.error(`[background-sync:${label}]`, err.message);
    });
  };
  setTimeout(run, BACKGROUND_SYNC_WARM_DELAY_MS);
  setInterval(run, intervalMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// News Impact + Agent Alerts  (Phase 1 — schema helpers + stub endpoints)
// ─────────────────────────────────────────────────────────────────────────────


// ── Supabase helpers ─────────────────────────────────────────────────────────

function hasNewsDb() {
  return Boolean(serverSupabase);
}

async function logAgentRun({ job, itemsProcessed, tokensUsed, msElapsed, error = null }) {
  if (!hasNewsDb()) return;
  const { error: dbErr } = await serverSupabase.from('agent_run_logs').insert({
    job,
    items_processed: itemsProcessed,
    tokens_used: tokensUsed,
    ms_elapsed: msElapsed,
    error: error ?? null,
  });
  if (dbErr) console.error('[agent-run-log insert]', dbErr.message);
}

// callClaudeRaw: like callClaude but also returns raw usage object for token counting.
// NOTE: httpsPost calls JSON.stringify() internally, so pass the object directly.
async function callClaudeRaw(systemPrompt, userPrompt, { model = CLAUDE_MODEL_FULL, maxTokens = 2500, temperature = 0.4 } = {}) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
  if (!ANTHROPIC_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };
  const raw = await httpsPost('https://api.anthropic.com/v1/messages', body, {
    'x-api-key': ANTHROPIC_KEY,
    'anthropic-version': '2023-06-01',
  });
  const json = JSON.parse(raw);
  if (json.error) throw new Error(json.error.message || JSON.stringify(json.error));
  const answer = json.content?.[0]?.text || '';
  return { answer, usage: json.usage };
}


function adminEmails() {
  return (process.env.VITE_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function isAdminRequest(req) {
  const emails = adminEmails();
  const callerEmail = (req.headers['x-admin-email'] || '').toLowerCase().trim();
  return emails.length === 0 || emails.includes(callerEmail);
}

// ── Background scheduler ──────────────

const FILING_TRIAGE_BACKGROUND_SYNC_MS = 20 * 60 * 1000; // 20 minutes

function startBackgroundSync() {
  if (!BACKGROUND_SYNC_ENABLED) {
    console.log('[background-sync] disabled');
    return;
  }

  scheduleRepeatingTask('congress', CONGRESS_BACKGROUND_SYNC_MS, async () => {
    await refreshCongressTradesFromSource();
  });

  scheduleRepeatingTask('ca-insiders', CA_BACKGROUND_SYNC_MS, async () => {
    await Promise.all(
      CA_BACKGROUND_TARGETS.map((target) =>
        buildCaInsiderCache(target.days, target.mode).catch((err) => {
          console.error(`[ca-insider sync:${target.label}]`, err.message);
        })
      )
    );
  });

  if (FILING_TRIAGE_ENABLED) {
    scheduleRepeatingTask('filing-triage', FILING_TRIAGE_BACKGROUND_SYNC_MS, async () => {
      const result = await runFilingTriageJob();
      if (!result.skipped) console.log(`[filing-triage sync] mode=${result.mode} scored=${result.scored} tokens=${result.tokensUsed} ${JSON.stringify(result.byType)}`);
    });
    console.log('[background-sync] filing-triage scheduled at 20-min cadence');
  } else {
    console.log('[background-sync] filing triage disabled (set FILING_TRIAGE_ENABLED=1 to enable)');
  }
}

app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown API route: ${req.method} ${req.originalUrl.split('?')[0]}` });
});

// Serve built React app
const distPath = path.join(__dirname, 'dist');
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/index.html') {
    res.setHeader('Cache-Control', 'no-store');
  } else if (req.path.startsWith('/assets/')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  next();
});
app.use(express.static(distPath));
app.get('/assets/*', (req, res) => {
  res.status(404).json({ error: `Asset not found: ${req.path}` });
});

// SPA fallback — send index.html for all non-API routes
app.get('*', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`TARS server running on port ${PORT}`);
  startBackgroundSync();
});
