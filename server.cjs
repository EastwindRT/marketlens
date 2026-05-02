const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const path = require('path');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
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

async function readPortfolioSnapshotFromDb(playerId) {
  if (!hasServerSupabase()) {
    throw new Error('server supabase not configured');
  }
  if (!playerId) {
    throw new Error('Missing playerId');
  }

  const [playerRes, holdingsRes, watchlistRes] = await Promise.all([
    serverSupabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .maybeSingle(),
    serverSupabase
      .from('holdings')
      .select('*')
      .eq('player_id', playerId)
      .order('updated_at', { ascending: false }),
    serverSupabase
      .from('watchlists')
      .select('*')
      .eq('player_id', playerId)
      .order('updated_at', { ascending: true }),
  ]);

  if (playerRes.error) {
    throw new Error(`player snapshot read failed: ${playerRes.error.message}`);
  }
  if (!playerRes.data) {
    return { player: null, holdings: [], watchlist: [] };
  }
  if (holdingsRes.error) {
    throw new Error(`holdings snapshot read failed: ${holdingsRes.error.message}`);
  }
  if (watchlistRes.error) {
    throw new Error(`watchlist snapshot read failed: ${watchlistRes.error.message}`);
  }

  return {
    player: playerRes.data,
    holdings: holdingsRes.data || [],
    watchlist: (watchlistRes.data || []).map((item) => ({
      symbol: item.symbol,
      name: item.name || undefined,
      exchange: item.exchange || undefined,
    })),
  };
}

async function readLeaderboardSnapshotFromDb(limit = 8) {
  if (!hasServerSupabase()) {
    throw new Error('server supabase not configured');
  }

  const [playersRes, holdingsRes, tradesRes] = await Promise.all([
    serverSupabase
      .from('players')
      .select('*')
      .order('name'),
    serverSupabase
      .from('holdings')
      .select('*'),
    serverSupabase
      .from('trades')
      .select('*, players(name)')
      .order('traded_at', { ascending: false })
      .limit(limit),
  ]);

  if (playersRes.error) {
    throw new Error(`leaderboard players read failed: ${playersRes.error.message}`);
  }
  if (holdingsRes.error) {
    throw new Error(`leaderboard holdings read failed: ${holdingsRes.error.message}`);
  }
  if (tradesRes.error) {
    throw new Error(`leaderboard trades read failed: ${tradesRes.error.message}`);
  }

  return {
    players: playersRes.data || [],
    holdings: holdingsRes.data || [],
    recentTrades: (tradesRes.data || []).map((trade) => ({
      ...trade,
      player_name: trade.players?.name || 'Unknown',
    })),
  };
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

  const rows = trades.map((trade) => ({
    id: trade.id,
    symbol: trade.symbol,
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

  const { error } = await serverSupabase
    .from('us_insider_trades')
    .upsert(rows, { onConflict: 'id' });
  if (error) {
    throw new Error(`us insider db write failed: ${error.message}`);
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

app.get('/api/portfolio-snapshot', async (req, res) => {
  const playerId = String(req.query.playerId || '').trim();
  if (!playerId) {
    return res.status(400).json({ error: 'Missing playerId' });
  }
  if (!hasServerSupabase()) {
    return res.status(503).json({ error: 'Portfolio snapshot not configured' });
  }

  try {
    const snapshot = await readPortfolioSnapshotFromDb(playerId);
    if (!snapshot.player) {
      return res.status(404).json({ error: 'Player not found', player: null, holdings: [], watchlist: [] });
    }
    res.json(snapshot);
  } catch (err) {
    console.error('[portfolio-snapshot]', err.message);
    res.status(502).json({ error: err.message, player: null, holdings: [], watchlist: [] });
  }
});

app.get('/api/leaderboard-snapshot', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit || '8', 10), 1), 50);
  if (!hasServerSupabase()) {
    return res.status(503).json({ error: 'Leaderboard snapshot not configured', players: [], holdings: [], recentTrades: [] });
  }

  try {
    const snapshot = await readLeaderboardSnapshotFromDb(limit);
    res.json(snapshot);
  } catch (err) {
    console.error('[leaderboard-snapshot]', err.message);
    res.status(502).json({ error: err.message, players: [], holdings: [], recentTrades: [] });
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

function summarizeOwnershipConviction({ ownershipFilings, insiderSummary, congressTrades, fundOwnershipSummary, market }) {
  const insiderNet = finiteNumber(insiderSummary?.last30d?.netValue) || 0;
  const insiderBuys = insiderSummary?.last30d?.buyCount || 0;
  const insiderSells = insiderSummary?.last30d?.sellCount || 0;
  const congressBuys = Array.isArray(congressTrades) ? congressTrades.filter((trade) => trade.type === 'purchase').length : 0;
  const congressSells = Array.isArray(congressTrades) ? congressTrades.filter((trade) => trade.type === 'sale').length : 0;
  const trackedFunds = fundOwnershipSummary?.heldByTrackedFunds || 0;
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

  if (market === 'US' && trackedFunds >= 5) {
    score += 14;
    reasons.push('Held broadly across the tracked 13F fund universe.');
  } else if (market === 'US' && trackedFunds >= 1) {
    score += 8;
    reasons.push('Held by at least one tracked 13F fund.');
  } else if (market === 'US') {
    reasons.push('No tracked 13F fund holder match in the current universe.');
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
  const [d, g, da, ga] = await Promise.allSettled([
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13D')}&dateb=&owner=include&count=80&output=atom`),
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13G')}&dateb=&owner=include&count=80&output=atom`),
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13D/A')}&dateb=&owner=include&count=80&output=atom`),
    httpsGet(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent('SCHEDULE 13G/A')}&dateb=&owner=include&count=80&output=atom`),
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

  let fundOwnershipSummary = null;
  if (market === 'US') {
    try {
      fundOwnershipSummary = await buildFundOwnershipByStock(normalized, marketData.profile?.name || '');
    } catch (err) {
      console.error('[stock-intelligence/funds]', err.message);
    }
  }

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
    fundOwnershipSummary,
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
    funds: fundOwnershipSummary,
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
      fundOwnershipByStock: market === 'US'
        ? {
            available: Boolean(fundOwnershipSummary),
            matchingMethod: 'issuer_name',
            trackedFundUniverse: KNOWN_FUNDS.length,
          }
        : null,
    },
    sources: {
      quote: market === 'CA' ? 'TMX / Yahoo Finance' : 'Finnhub / Yahoo Finance',
      candles: 'Yahoo Finance',
      insiders: 'SEC Form 4 cache',
      ownershipFilings: market === 'CA' ? 'Unavailable' : 'SEC EDGAR Schedule 13D/13G',
      congress: 'Quiver',
      funds: market === 'CA' ? 'Unavailable' : 'SEC EDGAR 13F-HR (curated known funds, issuer-name matched)',
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
      funds: {
        heldByTrackedFunds: 'Count of curated tracked 13F funds currently matching the issuer name.',
        trackedFundUniverse: 'Count of curated funds scanned for the match.',
        matchingMethod: 'How the stock-to-holding match was performed.',
        totalTrackedValue: 'Sum of matched position value across the tracked fund universe.',
        totalTrackedShares: 'Sum of matched reported shares across the tracked fund universe when available.',
        latestFiledAt: 'Most recent 13F filing date among the matched holders.',
        topHolders: 'Top matched tracked-fund holders by reported position value.',
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
        fundOwnershipByStock: 'Null for unsupported markets; otherwise describes tracked-fund coverage and matching method.',
      },
      sources: {
        quote: 'Quote provider label.',
        candles: 'Chart provider label.',
        insiders: 'Insider provider label.',
        ownershipFilings: 'Ownership filing provider label.',
        congress: 'Congress provider label.',
        funds: '13F ownership provider label.',
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
      funds: { heldByTrackedFunds: 4, trackedFundUniverse: 36, matchingMethod: 'issuer_name', totalTrackedValue: 12750000000, totalTrackedShares: 18420000, latestFiledAt: '2026-04-14', topHolders: [] },
      fundamentals: { peRatio: 45.2, pegRatio: 1.9, psRatio: 23.4, epsTTM: 12.3, revenueGrowthYoy: 62.1, epsGrowthYoy: 78.4, grossMargin: 73.2, operatingMargin: 56.1, netMargin: 48.2, roe: 59.7, weeks52high: 980.0, weeks52low: 530.0, shareFloat: null, shortFloatPercent: null },
      signals: { participation: 'high', ownershipSignal: 'passive_stake', eventRisk: 'medium', ownershipConviction: { score: 68, label: 'Constructive', reasons: ['Passive 13G ownership disclosure is present.', 'Held by at least one tracked 13F fund.'] }, eventPressure: { score: 34, label: 'Moderate', reasons: ['Earnings are within the next month.', 'News flow is active.'] }, squeezeRisk: 'unknown', compositeScore: 78 },
      explanations: { whyMoving: ['Trading at 1.78x normal volume', 'Price above key moving averages'], bullCase: ['Trend remains intact'], bearCase: ['Insider selling outweighs buying'] },
      dataAvailability: { shortInterest: null, optionsPositioning: null, fundOwnershipByStock: { available: true, matchingMethod: 'issuer_name', trackedFundUniverse: 36 } },
      sources: { quote: 'Finnhub / Yahoo Finance', candles: 'Yahoo Finance', insiders: 'SEC Form 4 cache', ownershipFilings: 'SEC EDGAR Schedule 13D/13G', congress: 'Quiver', funds: 'SEC EDGAR 13F-HR (curated known funds, issuer-name matched)', fundamentals: 'Finnhub' },
    },
  };
}

app.get('/api/stock-intelligence/schema', async (_req, res) => {
  res.json(buildStockIntelligenceSchema());
});

app.get('/api/stock-intelligence', async (req, res) => {
  const symbol = normalizeSymbol(req.query.symbol);
  if (!symbol) {
    return res.status(400).json({ error: 'symbol query param is required' });
  }

  try {
    const cached = stockIntelligenceCache.get(symbol);
    if (cached && Date.now() - cached.ts < STOCK_INTELLIGENCE_TTL) {
      return res.json(cached.payload);
    }

    if (!stockIntelligenceBuilds.has(symbol)) {
      stockIntelligenceBuilds.set(
        symbol,
        buildStockIntelligence(symbol).finally(() => {
          stockIntelligenceBuilds.delete(symbol);
        })
      );
    }

    const payload = await stockIntelligenceBuilds.get(symbol);
    res.json(payload);
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
        const dbFresh = isSyncStateFresh(syncState, CA_INSIDER_TTL);

        if (dbTrades.length) {
          if (!dbFresh) {
            buildCaInsiderCache(days, mode).catch((err) => {
              console.error(`[ca-insider-db-refresh:${cacheKey}]`, err.message);
            });
            res.setHeader('X-Data-Stale', '1');
          }
          return res.json({
            trades: dbTrades,
            overview: buildInsiderOverview(dbTrades),
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
  const entries = await fetchRecentForm4Entries(daysBack);

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
          if (trades.length) {
            await writeUsInsiderTradesToDb(trades);
          }
          await setMarketDataSyncState(MARKET_DATA_DATASETS.usInsiders(days), trades.length);
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
    if (hasMarketDataDb()) {
      try {
        const [dbTrades, syncState] = await Promise.all([
          readUsInsiderTradesFromDb(days),
          getMarketDataSyncState(MARKET_DATA_DATASETS.usInsiders(days)),
        ]);
        const dbFresh = isSyncStateFresh(syncState, INSIDER_ACTIVITY_TTL);
        if (dbTrades.length) {
          if (!dbFresh) {
            buildInsiderActivityCache(days).catch((err) => {
              console.error('[insider-activity-db-refresh]', err.message);
            });
            res.setHeader('X-Data-Stale', '1');
          }
          const limit = Math.min(parseInt(req.query.limit || '150', 10), 300);
          const limitedTrades = dbTrades.slice(0, limit);
          return res.json({
            trades: limitedTrades,
            overview: buildInsiderOverview(dbTrades),
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
    const trades = insiderActivityCaches[days].slice(0, limit);
    res.json({
      trades,
      overview: buildInsiderOverview(insiderActivityCaches[days]),
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

function tradeClientMarker(clientTradeId) {
  return `[client-trade:${clientTradeId}]`;
}

function normalizeTradeInput(raw) {
  const playerId = String(raw?.playerId || '').trim();
  const symbol = normalizeSymbol(raw?.symbol || '');
  const exchange = String(raw?.exchange || '').trim() || 'US';
  const tradeType = String(raw?.tradeType || '').toUpperCase();
  const shares = Number(raw?.shares);
  const price = Number(raw?.price);
  const tradedAt = raw?.tradedAt ? String(raw.tradedAt) : null;
  const clientTradeId = String(raw?.clientTradeId || '').trim();
  const note = String(raw?.note || '').trim();

  if (!playerId) throw new Error('Missing player id.');
  if (!symbol) throw new Error('Missing symbol.');
  if (tradeType !== 'BUY' && tradeType !== 'SELL') throw new Error('Trade type must be BUY or SELL.');
  if (!(shares > 0) || !(price > 0)) throw new Error('Shares and price must be greater than zero.');

  const marker = clientTradeId ? tradeClientMarker(clientTradeId) : '';
  const noteWithMarker = marker && !note.includes(marker) ? `${note ? `${note} ` : ''}${marker}` : note;
  return { playerId, symbol, exchange, tradeType, shares, price, total: shares * price, tradedAt, clientTradeId, note: noteWithMarker || null };
}

async function executeTradeOnServer(input) {
  if (!serverSupabase) throw new Error('Server trade execution is not configured.');

  if (input.clientTradeId) {
    const { data, error } = await serverSupabase
      .from('trades')
      .select('*')
      .eq('player_id', input.playerId)
      .like('note', `%${tradeClientMarker(input.clientTradeId)}%`)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data) return { duplicate: true, trade: data };
  }

  const { data: holding, error: holdingError } = await serverSupabase
    .from('holdings')
    .select('*')
    .eq('player_id', input.playerId)
    .eq('symbol', input.symbol)
    .maybeSingle();
  if (holdingError) throw holdingError;

  if (input.tradeType === 'BUY') {
    if (holding) {
      const nextShares = Number(holding.shares) + input.shares;
      const nextAvgCost = ((Number(holding.shares) * Number(holding.avg_cost)) + (input.shares * input.price)) / nextShares;
      const { error } = await serverSupabase
        .from('holdings')
        .update({ shares: nextShares, avg_cost: nextAvgCost, updated_at: new Date().toISOString() })
        .eq('id', holding.id);
      if (error) throw error;
    } else {
      const { error } = await serverSupabase
        .from('holdings')
        .insert({ player_id: input.playerId, symbol: input.symbol, exchange: input.exchange, shares: input.shares, avg_cost: input.price });
      if (error) throw error;
    }
  } else {
    if (!holding || Number(holding.shares) < input.shares) {
      throw new Error(`Not enough shares. Have ${holding?.shares ?? 0}, trying to sell ${input.shares}`);
    }
    const nextShares = Number(holding.shares) - input.shares;
    if (nextShares < 0.0001) {
      const { error } = await serverSupabase.from('holdings').delete().eq('id', holding.id);
      if (error) throw error;
    } else {
      const { error } = await serverSupabase
        .from('holdings')
        .update({ shares: nextShares, updated_at: new Date().toISOString() })
        .eq('id', holding.id);
      if (error) throw error;
    }
  }

  const tradeRow = {
    player_id: input.playerId,
    symbol: input.symbol,
    exchange: input.exchange,
    trade_type: input.tradeType,
    shares: input.shares,
    price: input.price,
    total: input.total,
  };
  if (input.tradedAt) tradeRow.traded_at = input.tradedAt;
  if (input.note) tradeRow.note = input.note;

  const { data: trade, error: tradeError } = await serverSupabase
    .from('trades')
    .insert(tradeRow)
    .select('*')
    .single();
  if (tradeError) throw tradeError;
  return { duplicate: false, trade };
}

app.post('/api/trade-execute', async (req, res) => {
  try {
    const input = normalizeTradeInput(req.body);
    const result = await executeTradeOnServer(input);
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Trade failed';
    const status = /not enough shares|greater than zero|missing|must be/i.test(message) ? 400 : 502;
    console.error('[trade-execute]', message);
    res.status(status).json({ success: false, error: message });
  }
});

async function buildConvergenceSignals(playerId, days = 14) {
  if (!serverSupabase || !playerId) {
    return [];
  }

  const [{ data: holdings }, { data: watchlists }] = await Promise.all([
    serverSupabase.from('holdings').select('symbol').eq('player_id', playerId),
    serverSupabase.from('watchlists').select('symbol').eq('player_id', playerId),
  ]);

  const portfolioSymbols = new Set((holdings || []).map((row) => normalizeSymbol(row.symbol)).filter(Boolean));
  const watchlistSymbols = new Set((watchlists || []).map((row) => normalizeSymbol(row.symbol)).filter(Boolean));
  const symbols = [...new Set([...portfolioSymbols, ...watchlistSymbols])].slice(0, 60);
  if (!symbols.length) return [];

  const baseSymbols = symbols.map(baseTicker);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [usInsiders, caInsiders, congressResult] = await Promise.all([
    readUsInsiderTradesFromDb(days).catch(() => []),
    readCaInsiderTradesFromDb(days, 'insiders').catch(() => []),
    ensureCongressTrades({ tickers: baseSymbols, days }).catch(() => ({ trades: [] })),
  ]);

  const ownershipBySymbol = new Map();
  await Promise.all(baseSymbols.slice(0, 20).map(async (symbol) => {
    try {
      const filings = await fetchCompanyOwnershipFilings(symbol);
      const recent = filings.filter((filing) => !filing.filedDate || filing.filedDate >= since).slice(0, 3);
      if (recent.length) ownershipBySymbol.set(symbol, recent);
    } catch (err) {
      console.warn(`[convergence/ownership:${symbol}]`, err.message);
    }
  }));

  const rows = symbols.map((symbol) => {
    const base = baseTicker(symbol);
    const insiderRows = [...usInsiders, ...caInsiders]
      .filter((trade) => baseTicker(normalizeSymbol(trade.symbol)) === base)
      .slice(0, 6);
    const congressRows = (congressResult.trades || [])
      .filter((trade) => baseTicker(normalizeSymbol(trade.ticker || trade.symbol)) === base)
      .slice(0, 6);
    const ownershipRows = ownershipBySymbol.get(base) || [];
    const sourceCount = [
      insiderRows.length > 0,
      congressRows.length > 0,
      ownershipRows.length > 0,
      portfolioSymbols.has(symbol),
      watchlistSymbols.has(symbol),
    ].filter(Boolean).length;

    const reasons = [];
    if (portfolioSymbols.has(symbol)) reasons.push('In portfolio');
    if (watchlistSymbols.has(symbol)) reasons.push('On watchlist');
    if (insiderRows.length) reasons.push(`${insiderRows.length} insider filing${insiderRows.length === 1 ? '' : 's'}`);
    if (congressRows.length) reasons.push(`${congressRows.length} congress disclosure${congressRows.length === 1 ? '' : 's'}`);
    if (ownershipRows.length) reasons.push(`${ownershipRows.length} 13D/13G filing${ownershipRows.length === 1 ? '' : 's'}`);

    return {
      symbol,
      score: sourceCount * 20 + Math.min(20, insiderRows.length * 4 + congressRows.length * 4 + ownershipRows.length * 6),
      reasons,
      inPortfolio: portfolioSymbols.has(symbol),
      inWatchlist: watchlistSymbols.has(symbol),
      insiders: insiderRows,
      congress: congressRows,
      ownershipFilings: ownershipRows,
    };
  })
    .filter((row) => row.score >= 40 && (row.insiders.length || row.congress.length || row.ownershipFilings.length))
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  return rows;
}

app.get('/api/alerts/convergence', async (req, res) => {
  try {
    const playerId = String(req.query.playerId || '').trim();
    const days = Math.min(Math.max(parseInt(req.query.days || '14', 10), 1), 90);
    const signals = await buildConvergenceSignals(playerId, days);
    res.json({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      days,
      signals,
      note: signals.length ? undefined : 'No portfolio/watchlist convergence found in the current window.',
    });
  } catch (err) {
    console.error('[alerts/convergence]', err.message);
    res.status(502).json({ schemaVersion: 1, generatedAt: new Date().toISOString(), signals: [], error: err.message });
  }
});

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
      funds: intel.funds,
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

RESPONSE FORMAT:
- Lead with a one-line verdict that actually answers the question
- For analytical questions, use markdown sections in this order when relevant:
  **What matters most right now**
  **Trend / Regime**
  **Key Levels**
  **What the fundamentals say**
  **What insiders / news say**
  **Bull case**
  **Bear case**
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
- Use the SYMBOL INTELLIGENCE block first when present; it is the server-normalized source for trend, signals, filings, funds, and data availability
- Tie the technical read to the fundamental read when both are present — do they agree or conflict?
- Comment explicitly on whether insider flow confirms or contradicts the price action
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

const FUND_HOLDINGS_TTL = 24 * 60 * 60 * 1000;
const fundHoldingsCache = new Map();
const fundHoldingsInFlight = new Map();
const fundOwnershipByStockCache = new Map();
const fundOwnershipByStockInFlight = new Map();

function normalizeIssuerName(value) {
  if (!value) return '';
  return value
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .replace(/\b(CLASS|CL|SERIES)\s+[A-Z0-9]+\b/g, ' ')
    .replace(/\b(INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|HOLDINGS|HOLDING|GROUP|PLC|LTD|LIMITED|SA|NV|AG|LLC|LP)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function issuerNamesLookLikeMatch(companyName, holdingName) {
  const a = normalizeIssuerName(companyName);
  const b = normalizeIssuerName(holdingName);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 6 && b.startsWith(a)) return true;
  if (b.length >= 6 && a.startsWith(b)) return true;

  const aTokens = a.split(' ').filter((token) => token.length > 2);
  const bTokens = b.split(' ').filter((token) => token.length > 2);
  if (!aTokens.length || !bTokens.length) return false;
  if (aTokens[0] !== bTokens[0]) return false;

  const overlap = aTokens.filter((token) => bTokens.includes(token));
  return overlap.length >= Math.min(2, aTokens.length, bTokens.length);
}

async function getLatestFundHoldingsCached(fund) {
  const cached = fundHoldingsCache.get(fund.cik);
  if (cached && isCacheFresh(cached.ts, FUND_HOLDINGS_TTL)) {
    return cached.payload;
  }
  if (fundHoldingsInFlight.has(fund.cik)) {
    return fundHoldingsInFlight.get(fund.cik);
  }

  const build = (async () => {
    const { results: filings } = await get13FFilings(fund.cik);
    if (!filings.length) {
      const empty = {
        fund: fund.name,
        cik: fund.cik,
        filingDate: null,
        period: null,
        totalValue: 0,
        holdings: [],
      };
      fundHoldingsCache.set(fund.cik, { ts: Date.now(), payload: empty });
      return empty;
    }

    const latest = filings[0];
    const holdings = await fetchHoldings(fund.cik, latest.accession);
    const totalValue = holdings.reduce((sum, holding) => sum + (finiteNumber(holding.value) || 0), 0);
    const payload = {
      fund: fund.name,
      cik: fund.cik,
      filingDate: latest.filingDate || null,
      period: latest.period || null,
      totalValue,
      holdings,
    };
    fundHoldingsCache.set(fund.cik, { ts: Date.now(), payload });
    return payload;
  })().finally(() => {
    fundHoldingsInFlight.delete(fund.cik);
  });

  fundHoldingsInFlight.set(fund.cik, build);
  return build;
}

async function buildFundOwnershipByStock(symbol, companyName) {
  const normalized = normalizeSymbol(symbol);
  const cacheKey = `${normalized}::${normalizeIssuerName(companyName)}`;
  const cached = fundOwnershipByStockCache.get(cacheKey);
  if (cached && isCacheFresh(cached.ts, FUND_HOLDINGS_TTL)) {
    return cached.payload;
  }
  if (fundOwnershipByStockInFlight.has(cacheKey)) {
    return fundOwnershipByStockInFlight.get(cacheKey);
  }

  const build = (async () => {
    const holders = [];
    const batchSize = 4;
    for (let i = 0; i < KNOWN_FUNDS.length; i += batchSize) {
      const batch = KNOWN_FUNDS.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map((fund) => getLatestFundHoldingsCached(fund)));
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const fundData = result.value;
        const matched = fundData.holdings.find((holding) => issuerNamesLookLikeMatch(companyName, holding.name));
        if (!matched) continue;
        const value = finiteNumber(matched.value) || 0;
        const shares = finiteNumber(matched.shares);
        holders.push({
          fund: fundData.fund,
          cik: fundData.cik,
          filedAt: fundData.filingDate,
          period: fundData.period,
          issuer: matched.name,
          value,
          shares,
          pctOfFund: fundData.totalValue > 0 ? (value / fundData.totalValue) * 100 : null,
          sector: matched.sector || null,
        });
      }
    }

    holders.sort((a, b) => b.value - a.value);
    const payload = {
      heldByTrackedFunds: holders.length,
      trackedFundUniverse: KNOWN_FUNDS.length,
      matchingMethod: 'issuer_name',
      totalTrackedValue: holders.reduce((sum, holder) => sum + (finiteNumber(holder.value) || 0), 0),
      totalTrackedShares: holders.reduce((sum, holder) => sum + (finiteNumber(holder.shares) || 0), 0),
      latestFiledAt: holders
        .map((holder) => holder.filedAt)
        .filter(Boolean)
        .sort((a, b) => b.localeCompare(a))[0] || null,
      topHolders: holders.slice(0, 10),
    };
    fundOwnershipByStockCache.set(cacheKey, { ts: Date.now(), payload });
    return payload;
  })().finally(() => {
    fundOwnershipByStockInFlight.delete(cacheKey);
  });

  fundOwnershipByStockInFlight.set(cacheKey, build);
  return build;
}

// Cached recent-filers response
let recentFilersCache = null;
let recentFilersFetch = 0;
let recentFilersInFlight = null;
const RECENT_FILERS_TTL = 6 * 60 * 60 * 1000; // 6h

function isCacheFresh(lastFetch, ttl) {
  return Boolean(lastFetch) && Date.now() - lastFetch < ttl;
}

async function buildRecentFilersCache() {
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

  results.sort((a, b) => b.lastFiled.localeCompare(a.lastFiled));
  recentFilersCache = { funds: results };
  recentFilersFetch = Date.now();
  return recentFilersCache;
}

function ensureRecentFilersCache(force = false) {
  if (!force && recentFilersCache && isCacheFresh(recentFilersFetch, RECENT_FILERS_TTL)) {
    return Promise.resolve(recentFilersCache);
  }
  if (recentFilersInFlight) return recentFilersInFlight;
  recentFilersInFlight = buildRecentFilersCache()
    .catch((err) => {
      if (recentFilersCache) return recentFilersCache;
      throw err;
    })
    .finally(() => {
      recentFilersInFlight = null;
    });
  return recentFilersInFlight;
}

app.get('/api/13f/recent-filers', async (req, res) => {
  try {
    if (recentFilersCache && isCacheFresh(recentFilersFetch, RECENT_FILERS_TTL)) {
      return res.json(recentFilersCache);
    }
    if (recentFilersCache) {
      void ensureRecentFilersCache(true);
      return res.json(recentFilersCache);
    }
    res.json(await ensureRecentFilersCache(true));
  } catch (err) {
    console.error('[13f/recent-filers]', err.message);
    res.status(502).json({ error: err.message, funds: [] });
  }
});

// ── Recent 13F-HR filings via EDGAR daily index (cloud-safe) ─────────────────
// Scans last 60 days of daily-index .idx files for 13F-HR entries.
// Deduplicates by CIK so each fund appears once (most recent filing).
// recent13FCaches and recent13FFetchTimes declared in the route handler below
const RECENT_13F_TTL = 24 * 60 * 60 * 1000; // 24h

async function fetchRecent13FFilings(daysBack = 60) {
  const entries = [];
  const seenCik = new Set();

  for (let i = 0; i < daysBack; i++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - i);
    const { y, ymd, qtr } = formatIndexDate(date);
    const url = `https://www.sec.gov/Archives/edgar/daily-index/${y}/QTR${qtr}/company.${ymd}.idx`;

    try {
      const idx = await httpsGet(url, { 'User-Agent': SEC_UA, Accept: 'text/plain' });
      const lines = idx.split(/\r?\n/);
      for (const line of lines) {
        if (line.length < 100) continue;
        const m = line.match(/^(.{62})(.*?)\s+(\d{6,10})\s+(\d{8})\s+(edgar\/\S+)/);
        if (!m) continue;
        const companyName = m[1].trim();
        const formType = m[2].trim();
        const cik = m[3];
        const dateRaw = m[4];
        if (formType !== '13F-HR' && formType !== '13F-HR/A') continue;
        if (seenCik.has(cik)) continue; // keep only most recent per fund
        seenCik.add(cik);
        const filedDate = `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}`;
        entries.push({ name: companyName, cik, filedDate });
      }
    } catch {
      // Non-trading days simply won't have an index file.
    }
  }

  return entries;
}

const recent13FCaches = {};  // keyed by daysBack
const recent13FFetchTimes = {};
const recent13FInFlight = {};

async function ensureRecent13FCache(daysBack, force = false) {
  if (!force && recent13FCaches[daysBack] && isCacheFresh(recent13FFetchTimes[daysBack], RECENT_13F_TTL)) {
    return recent13FCaches[daysBack];
  }
  if (recent13FInFlight[daysBack]) return recent13FInFlight[daysBack];
  recent13FInFlight[daysBack] = fetchRecent13FFilings(daysBack)
    .then((filings) => {
      recent13FCaches[daysBack] = filings;
      recent13FFetchTimes[daysBack] = Date.now();
      return filings;
    })
    .catch((err) => {
      if (recent13FCaches[daysBack]) return recent13FCaches[daysBack];
      throw err;
    })
    .finally(() => {
      delete recent13FInFlight[daysBack];
    });
  return recent13FInFlight[daysBack];
}

app.get('/api/13f/recent-filings', async (req, res) => {
  const daysBack = Math.min(60, Math.max(7, Number(req.query.days) || 14));
  try {
    if (recent13FCaches[daysBack] && isCacheFresh(recent13FFetchTimes[daysBack], RECENT_13F_TTL)) {
      return res.json({ filings: recent13FCaches[daysBack] });
    }
    if (recent13FCaches[daysBack]) {
      void ensureRecent13FCache(daysBack, true);
      return res.json({ filings: recent13FCaches[daysBack] });
    }
    res.json({ filings: await ensureRecent13FCache(daysBack, true) });
  } catch (err) {
    console.error('[13f/recent-filings]', err.message);
    res.status(502).json({ error: err.message, filings: [] });
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

  const cacheKey = aiCacheKey({ route: 'ask-fund', fund, period: meta?.period, positions: meta?.positionCount, question });
  const cached = aiCacheGet(cacheKey);
  if (cached) return res.json({ answer: cached, cached: true });

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
    aiCacheSet(cacheKey, answer);
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

const NEWS_AGENT_ENABLED = process.env.NEWS_AGENT_ENABLED !== '0';
const NEWS_SCHEMA_VERSION = 1;
const REDDIT_TRENDS_SCHEMA_VERSION = 1;
const REDDIT_TRENDS_TTL = 10 * 60 * 1000;
const REDDIT_SUPPORTED_FILTERS = new Set([
  'all',
  'all-stocks',
  'all-crypto',
  '4chan',
  'CryptoCurrency',
  'CryptoCurrencies',
  'Bitcoin',
  'SatoshiStreetBets',
  'CryptoMoonShots',
  'CryptoMarkets',
  'stocks',
  'wallstreetbets',
  'options',
  'WallStreetbetsELITE',
  'Wallstreetbetsnew',
  'SPACs',
  'investing',
  'Daytrading',
]);
const redditTrendCache = new Map();

// ── Supabase helpers ─────────────────────────────────────────────────────────

function hasNewsDb() {
  return Boolean(serverSupabase);
}

function normalizeApeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeApeTrend(item) {
  const ticker = String(item?.ticker || '').trim().toUpperCase();
  const mentions = normalizeApeNumber(item?.mentions);
  const upvotes = normalizeApeNumber(item?.upvotes);
  const mentions24hAgo = item?.mentions_24h_ago == null ? null : normalizeApeNumber(item.mentions_24h_ago);
  const rank24hAgo = item?.rank_24h_ago == null ? null : normalizeApeNumber(item.rank_24h_ago);
  const mentionChange = mentions24hAgo == null ? null : mentions - mentions24hAgo;
  const mentionChangePct = mentions24hAgo && mentions24hAgo > 0 ? (mentionChange / mentions24hAgo) * 100 : null;
  const mentionChange7dPct = null;
  const velocityScore = Math.max(0, Math.min(100, Math.round(
    Math.log10(Math.max(mentions, 1)) * 24
    + Math.log10(Math.max(upvotes, 1)) * 10
    + Math.max(0, Math.min(60, mentionChangePct ?? 0)) * 0.55
  )));

  return {
    rank: normalizeApeNumber(item?.rank),
    ticker,
    name: String(item?.name || ticker),
    mentions,
    upvotes,
    rank24hAgo,
    mentions24hAgo,
    mentionChange,
    mentionChangePct,
    mentionChange7dPct,
    velocityScore,
  };
}

async function fetchYahooQuoteBatch(symbols) {
  const unique = [...new Set((symbols || []).map((symbol) => normalizeSymbol(symbol)).filter(Boolean))].slice(0, 50);
  if (unique.length === 0) return new Map();
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(unique.join(','))}`;
    // Do not use the retry wrapper here: Yahoo quote throttling should fail
    // fast so Reddit trends still load from ApeWisdom/social data.
    const raw = await httpsGetOnce(url, { Accept: 'application/json' });
    const json = JSON.parse(raw);
    const quotes = Array.isArray(json?.quoteResponse?.result) ? json.quoteResponse.result : [];
    const map = new Map();
    for (const quote of quotes) {
      const symbol = normalizeSymbol(quote?.symbol || '');
      if (!symbol) continue;
      map.set(symbol, {
        last: finiteNumber(quote.regularMarketPrice),
        changePct1d: finiteNumber(quote.regularMarketChangePercent),
      });
    }
    return map;
  } catch (err) {
    console.warn('[reddit-trends/yahoo-batch]', err.message);
    return new Map();
  }
}

async function fetchTickerNewsCatalyst(symbol) {
  if (!hasNewsDb()) return null;
  try {
    const { data, error } = await serverSupabase
      .from('news_items')
      .select('headline, source, published_at, impact_score, url')
      .contains('affected_tickers', [symbol])
      .order('impact_score', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    return {
      headline: row.headline,
      source: row.source,
      publishedAt: row.published_at,
      impactScore: finiteNumber(row.impact_score),
      url: row.url || null,
    };
  } catch (err) {
    console.warn('[reddit-trends/news]', symbol, err.message);
    return null;
  }
}

function buildBuyPressureMap() {
  const map = new Map();
  const trades = Array.isArray(insiderActivityCaches?.[7]) ? insiderActivityCaches[7] : [];
  for (const trade of trades) {
    const symbol = normalizeSymbol(trade.symbol || '');
    if (!symbol) continue;
    const current = map.get(symbol) || { buyValue: 0, sellValue: 0, tradeCount: 0 };
    const value = finiteNumber(trade.totalValue) || 0;
    if (trade.type === 'BUY') current.buyValue += value;
    if (trade.type === 'SELL') current.sellValue += value;
    if (trade.type === 'BUY' || trade.type === 'SELL') current.tradeCount += 1;
    map.set(symbol, current);
  }
  return map;
}

function classifyBuyPressure(summary) {
  if (!summary || summary.tradeCount === 0) return { net: 'none', buyValue: 0, sellValue: 0, tradeCount: 0 };
  const buyValue = Math.round(summary.buyValue || 0);
  const sellValue = Math.round(summary.sellValue || 0);
  let net = 'mixed';
  if (buyValue > sellValue * 1.25) net = 'buy';
  else if (sellValue > buyValue * 1.25) net = 'sell';
  return { net, buyValue, sellValue, tradeCount: summary.tradeCount || 0 };
}

function emptyRedditConfirmation() {
  return {
    score: 0,
    reasons: [],
    inPortfolio: false,
    inWatchlist: false,
    ownershipFilings: [],
    congressTrades: [],
  };
}

async function fetchPlayerSymbolSets(playerId) {
  if (!serverSupabase || !playerId) {
    return { portfolioSymbols: new Set(), watchlistSymbols: new Set() };
  }

  try {
    const [{ data: holdings }, { data: watchlists }] = await Promise.all([
      serverSupabase.from('holdings').select('symbol').eq('player_id', playerId),
      serverSupabase.from('watchlists').select('symbol').eq('player_id', playerId),
    ]);
    return {
      portfolioSymbols: new Set((holdings || []).map((row) => normalizeSymbol(row.symbol)).filter(Boolean)),
      watchlistSymbols: new Set((watchlists || []).map((row) => normalizeSymbol(row.symbol)).filter(Boolean)),
    };
  } catch (err) {
    console.warn('[reddit-trends/player-context]', err.message);
    return { portfolioSymbols: new Set(), watchlistSymbols: new Set() };
  }
}

async function buildCachedOwnershipMapForSymbols(symbols) {
  const bases = new Set((symbols || []).map((symbol) => baseTicker(normalizeSymbol(symbol))).filter(Boolean));
  const map = new Map();
  if (bases.size === 0) return map;

  try {
    let filings = marketFilingsCache.get('30')?.payload?.filings
      || marketFilingsCache.get('14')?.payload?.filings
      || marketFilingsCache.get('7')?.payload?.filings
      || null;

    if (!filings) {
      ensureMarketFilingsCache('30', 30, false).catch((err) => {
        console.warn('[reddit-trends/ownership-background]', err.message);
      });
      filings = [];
    }

    for (const filing of filings || []) {
      const symbol = baseTicker(normalizeSymbol(filing.symbol || ''));
      if (!symbol || !bases.has(symbol)) continue;
      const rows = map.get(symbol) || [];
      if (rows.length < 3) rows.push(filing);
      map.set(symbol, rows);
    }
  } catch (err) {
    console.warn('[reddit-trends/ownership-cache]', err.message);
  }

  return map;
}

async function readCachedCongressTradesForSymbols(baseSymbols, days = 90) {
  const tickers = [...new Set((baseSymbols || []).map((symbol) => baseTicker(normalizeSymbol(symbol))).filter(Boolean))];
  if (tickers.length === 0) return [];

  const cutoffDate = new Date();
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  if (hasMarketDataDb()) {
    try {
      const rows = await readCongressTradesFromDb({ tickers, cutoff, limit: 200 });
      if (rows.length) return rows;
    } catch (err) {
      console.warn('[reddit-trends/congress-db]', err.message);
    }
  }

  if (!Array.isArray(congressCache)) return [];
  return congressCache
    .map(mapQuiverCongressTrade)
    .filter(Boolean)
    .filter((trade) => tickers.includes(trade.ticker) && (!cutoff || trade.transactionDate >= cutoff))
    .slice(0, 200);
}

async function buildRedditConfirmationMap(symbols, playerId) {
  const normalized = [...new Set((symbols || []).map((symbol) => normalizeSymbol(symbol)).filter(Boolean))].slice(0, 40);
  const baseSymbols = normalized.map(baseTicker);

  const [{ portfolioSymbols, watchlistSymbols }, congressTrades, ownershipBySymbol] = await Promise.all([
    fetchPlayerSymbolSets(playerId),
    readCachedCongressTradesForSymbols(baseSymbols, 90),
    buildCachedOwnershipMapForSymbols(baseSymbols),
  ]);

  const congressBySymbol = new Map();
  for (const trade of congressTrades || []) {
    const symbol = baseTicker(normalizeSymbol(trade.ticker || trade.symbol || ''));
    if (!symbol) continue;
    const rows = congressBySymbol.get(symbol) || [];
    if (rows.length < 4) rows.push(trade);
    congressBySymbol.set(symbol, rows);
  }

  const map = new Map();
  for (const symbol of normalized) {
    const base = baseTicker(symbol);
    const ownershipFilings = ownershipBySymbol.get(base) || [];
    const congressTrades = congressBySymbol.get(base) || [];
    const inPortfolio = portfolioSymbols.has(symbol) || portfolioSymbols.has(base);
    const inWatchlist = watchlistSymbols.has(symbol) || watchlistSymbols.has(base);
    const reasons = [];
    if (inPortfolio) reasons.push('In portfolio');
    if (inWatchlist) reasons.push('On watchlist');
    if (ownershipFilings.length) reasons.push(`${ownershipFilings.length} 13D/13G`);
    if (congressTrades.length) reasons.push(`${congressTrades.length} congress`);

    const score = Math.min(100,
      (inPortfolio ? 28 : 0)
      + (inWatchlist ? 22 : 0)
      + Math.min(30, ownershipFilings.length * 16)
      + Math.min(24, congressTrades.length * 8)
    );

    map.set(symbol, {
      score,
      reasons,
      inPortfolio,
      inWatchlist,
      ownershipFilings: ownershipFilings.map((filing) => ({
        formType: filing.formType,
        filedDate: filing.filedDate,
        filerName: filing.filerName || '',
        subjectCompany: filing.subjectCompany || '',
        edgarUrl: filing.edgarUrl || '',
      })),
      congressTrades: congressTrades.map((trade) => ({
        member: trade.member,
        type: trade.type,
        amount: trade.amount || null,
        amountMin: finiteNumber(trade.amountMin),
        transactionDate: trade.transactionDate || '',
        disclosureDate: trade.disclosureDate || '',
        filingUrl: trade.filingUrl || '',
      })),
    });
  }
  return map;
}

async function buildRedditTrendsPayload(filter, page, limit, playerId = '') {
  const safeFilter = REDDIT_SUPPORTED_FILTERS.has(filter) ? filter : 'all-stocks';
  const safePage = Math.min(20, Math.max(1, page));
  const safeLimit = Math.min(100, Math.max(10, limit));
  const url = `https://apewisdom.io/api/v1.0/filter/${encodeURIComponent(safeFilter)}/page/${safePage}`;
  const raw = await httpsGet(url, { Accept: 'application/json' });
  const json = JSON.parse(raw);
  const baseResults = (Array.isArray(json?.results) ? json.results : [])
    .map(normalizeApeTrend)
    .filter((item) => item.ticker && /^[A-Z][A-Z0-9.-]{0,9}$/.test(item.ticker))
    .slice(0, safeLimit);

  const topForContext = baseResults.slice(0, Math.min(25, safeLimit));
  const buyPressureMap = buildBuyPressureMap();
  const priceMap = await fetchYahooQuoteBatch(topForContext.map((item) => item.ticker));
  const confirmationMap = await buildRedditConfirmationMap(topForContext.map((item) => item.ticker), playerId);
  const enrichedTop = await Promise.all(topForContext.map(async (item) => {
    const latestNews = await fetchTickerNewsCatalyst(item.ticker);
    return {
      ...item,
      price: priceMap.get(item.ticker) || { last: null, changePct1d: null },
      latestNews,
      buyPressure: classifyBuyPressure(buyPressureMap.get(item.ticker)),
      confirmation: confirmationMap.get(item.ticker) || emptyRedditConfirmation(),
    };
  }));

  const enrichedMap = new Map(enrichedTop.map((item) => [item.ticker, item]));
  const results = baseResults.map((item) => enrichedMap.get(item.ticker) || {
    ...item,
    price: { last: null, changePct1d: null },
    latestNews: null,
    buyPressure: classifyBuyPressure(buyPressureMap.get(item.ticker)),
    confirmation: emptyRedditConfirmation(),
  });

  return {
    schemaVersion: REDDIT_TRENDS_SCHEMA_VERSION,
    filter: safeFilter,
    count: normalizeApeNumber(json?.count),
    pages: normalizeApeNumber(json?.pages),
    currentPage: normalizeApeNumber(json?.current_page) || safePage,
    generatedAt: new Date().toISOString(),
    source: 'ApeWisdom',
    results,
    note: 'Velocity score blends mention count, upvotes, and 24h mention acceleration. Confirmation uses TARS news, insider, 13D/13G, congress, portfolio, and watchlist data.',
  };
}

async function insertNewsItem(item) {
  if (!hasNewsDb()) return null;
  const { data, error } = await serverSupabase
    .from('news_items')
    .upsert(item, { onConflict: 'dedup_key', ignoreDuplicates: true })
    .select('id')
    .maybeSingle();
  if (error) { console.error('[news-items insert]', error.message); return null; }
  return data?.id ?? null;
}

async function getUnseenNewsItems({ limit = 50 } = {}) {
  if (!hasNewsDb()) return [];
  const { data, error } = await serverSupabase
    .from('news_items')
    .select('id, headline, source, published_at, impact_score, category, summary, affected_tickers')
    .eq('seen_by_agent', false)
    .order('impact_score', { ascending: false })
    .limit(limit);
  if (error) { console.error('[news-items unseen]', error.message); return []; }
  return data ?? [];
}

async function markNewsItemsSeen(ids) {
  if (!hasNewsDb() || !ids.length) return;
  const { error } = await serverSupabase
    .from('news_items')
    .update({ seen_by_agent: true })
    .in('id', ids);
  if (error) console.error('[news-items mark-seen]', error.message);
}

async function insertAgentAlert(alert) {
  if (!hasNewsDb()) return null;
  const { data, error } = await serverSupabase
    .from('agent_alerts')
    .insert(alert)
    .select('id')
    .maybeSingle();
  if (error) { console.error('[agent-alerts insert]', error.message); return null; }
  return data?.id ?? null;
}

async function getLatestAgentAlert(playerId) {
  if (!hasNewsDb()) return null;
  let query = serverSupabase
    .from('agent_alerts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);
  if (playerId) {
    // prefer per-player, fall back to global
    const { data: playerAlert } = await query.eq('player_id', playerId).maybeSingle();
    if (playerAlert) return playerAlert;
  }
  const { data, error } = await serverSupabase
    .from('agent_alerts')
    .select('*')
    .is('player_id', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) { console.error('[agent-alerts latest]', error.message); return null; }
  return data ?? null;
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

async function getAppSetting(key) {
  if (!hasNewsDb()) return null;
  const { data } = await serverSupabase
    .from('app_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function setAppSetting(key, value) {
  if (!hasNewsDb()) return;
  const { error } = await serverSupabase
    .from('app_settings')
    .upsert({ key, value }, { onConflict: 'key' });
  if (error) throw error;
}

// ── Stub endpoints (Phase 1) — return correct shape, empty data ───────────────
// Real ingestion wired in Phase 2. Codex can build against these immediately.

// ── Phase 2: Headline fetchers + dedup + Claude scoring + job ────────────────

const NEWSAPI_KEY = process.env.NEWSAPI_KEY || '';
const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || '';
const X_ACCOUNT_USERNAMES = (process.env.X_ACCOUNT_USERNAMES || process.env.TWITTER_ACCOUNT_USERNAMES || '')
  .split(',')
  .map((username) => username.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);
const NEWS_SCORING_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — same headline scored at most once/day
const FINNHUB_NEWS_CATEGORIES = ['general'];
const MACRO_SCHEMA_VERSION = 1;
const X_SOCIAL_SCHEMA_VERSION = 1;
const X_POST_LOOKBACK_HOURS = Math.min(168, Math.max(1, parseInt(process.env.X_POST_LOOKBACK_HOURS || '72', 10) || 72));
const X_MAX_POSTS_PER_ACCOUNT = Math.min(10, Math.max(5, parseInt(process.env.X_MAX_POSTS_PER_ACCOUNT || '5', 10) || 5));
const X_MAX_ACCOUNTS_PER_POLL = Math.min(300, Math.max(1, parseInt(process.env.X_MAX_ACCOUNTS_PER_POLL || '300', 10) || 300));
const X_LIST_ID = String(process.env.X_LIST_ID || process.env.TWITTER_LIST_ID || '').trim();
const X_LIST_MAX_POSTS = Math.min(100, Math.max(5, parseInt(process.env.X_LIST_MAX_POSTS || '25', 10) || 25));
const X_LIST_SINCE_SETTING_KEY = X_LIST_ID ? `x_list_since_id_${X_LIST_ID}` : 'x_list_since_id';
const X_RESOLVE_USERS_ON_POLL = isXEnabledValue(process.env.X_RESOLVE_USERS_ON_POLL ?? 'false');
const DEFAULT_X_ANALYST_ACCOUNTS = [
  { username: 'lizannsonders', displayName: 'Liz Ann Sonders', priority: 98, notes: 'seed: market strategist' },
  { username: '10kdiver', displayName: '10-K Diver', priority: 96, notes: 'seed: investing analysis' },
  { username: 'aswathdamodaran', displayName: 'Aswath Damodaran', priority: 95, notes: 'seed: valuation analysis' },
  { username: 'brianferoldi', displayName: 'Brian Feroldi', priority: 93, notes: 'seed: stock analysis' },
  { username: 'investorslive', displayName: 'InvestorsLive', priority: 92, notes: 'seed: trading analysis' },
  { username: 'reddogt3', displayName: 'Scott Redler', priority: 92, notes: 'seed: technical trading' },
  { username: 'optionshawk', displayName: 'OptionsHawk', priority: 90, notes: 'seed: options analysis' },
  { username: 'peterlbrandt', displayName: 'Peter Brandt', priority: 90, notes: 'seed: chart analysis' },
  { username: 'sjosephburns', displayName: 'Steve Burns', priority: 88, notes: 'seed: trading education' },
  { username: 'harmongreg', displayName: 'Greg Harmon', priority: 88, notes: 'seed: technical analysis' },
  { username: 'lynaldencontact', displayName: 'Lyn Alden', priority: 88, notes: 'seed: macro analysis' },
  { username: 'macroalf', displayName: 'Macro Alf', priority: 86, notes: 'seed: macro trading analysis' },
  { username: 'northmantrader', displayName: 'Sven Henrich', priority: 86, notes: 'seed: market technicals' },
  { username: 'mebfaber', displayName: 'Meb Faber', priority: 85, notes: 'seed: investing analysis' },
  { username: 'michaelbatnick', displayName: 'Michael Batnick', priority: 84, notes: 'seed: market analysis' },
  { username: 'awealthofcs', displayName: 'Ben Carlson', priority: 84, notes: 'seed: market analysis' },
  { username: 'reformedbroker', displayName: 'Josh Brown', priority: 84, notes: 'seed: market analysis' },
  { username: 'doombergt', displayName: 'Doomberg', priority: 83, notes: 'seed: energy and macro analysis' },
  { username: 'raoulgmi', displayName: 'Raoul Pal', priority: 83, notes: 'seed: macro analysis' },
  { username: 'dividendgrowth', displayName: 'Dividend Growth Investor', priority: 82, notes: 'seed: dividend analysis' },
  { username: 'chrisbloomstran', displayName: 'Chris Bloomstran', priority: 82, notes: 'seed: value analysis' },
  { username: 'cullenroche', displayName: 'Cullen Roche', priority: 81, notes: 'seed: macro analysis' },
  { username: 'callieabost', displayName: 'Callie Cox', priority: 80, notes: 'seed: market analysis' },
  { username: 'samro', displayName: 'Sam Ro', priority: 80, notes: 'seed: market analysis' },
  { username: 'claudia_sahm', displayName: 'Claudia Sahm', priority: 78, notes: 'seed: macro analysis' },
  { username: 'ericbalchunas', displayName: 'Eric Balchunas', priority: 78, notes: 'seed: ETF analysis' },
  { username: 'nategeraci', displayName: 'Nate Geraci', priority: 77, notes: 'seed: ETF analysis' },
  { username: 'danniles', displayName: 'Dan Niles', priority: 77, notes: 'seed: tech and market analysis' },
  { username: 'mohnishpabrai', displayName: 'Mohnish Pabrai', priority: 76, notes: 'seed: value investing' },
  { username: 'raydalio', displayName: 'Ray Dalio', priority: 76, notes: 'seed: macro investing' },
  { username: 'patrickboyle', displayName: 'Patrick Boyle', priority: 74, notes: 'seed: market analysis' },
  { username: 'jesse_livermore', displayName: 'Jesse Livermore', priority: 74, notes: 'seed: investing analysis' },
  { username: 'kashflowtrades', displayName: 'KashFlowTrades', priority: 72, notes: 'seed: trading analysis' },
  { username: 'traderstewie', displayName: 'Trader Stewie', priority: 72, notes: 'seed: swing trading' },
  { username: 'ivanhoff2', displayName: 'Ivanhoff', priority: 72, notes: 'seed: momentum trading' },
  { username: 'markflowchatter', displayName: 'Mark Flowchatter', priority: 70, notes: 'seed: market flow analysis' },
  { username: 'the_real_fly', displayName: 'The Fly', priority: 70, notes: 'seed: trader commentary' },
  { username: 'wifeyalpha', displayName: 'Wifey Alpha', priority: 70, notes: 'seed: market analysis' },
  { username: 'wallstjesus', displayName: 'Wall Street Jesus', priority: 68, notes: 'seed: trader commentary' },
  { username: 'peterschiff', displayName: 'Peter Schiff', priority: 66, notes: 'seed: macro and market commentary' },
].map((account) => ({ ...account, username: account.username.toLowerCase(), userId: null }));

const NEWS_QUERIES = [
  {
    label: 'financial',
    q: 'stock market OR earnings OR Federal Reserve OR interest rates OR inflation OR GDP OR recession OR IPO OR merger OR acquisition OR bankruptcy OR creditors OR restructuring OR debt OR distressed OR "equity wiped out" OR "chapter 11" OR "liability management" OR "debt restructuring" OR "private equity"',
    sources: '',
    language: 'en',
  },
  {
    label: 'company',
    q: 'earnings OR guidance OR outlook OR revenue OR profit warning OR "beats estimates" OR "misses estimates" OR "share buyback" OR layoff OR layoffs OR "strategic review" OR "activist investor" OR "stake in" OR "raises forecast" OR "cuts forecast"',
    sources: 'reuters,associated-press,bloomberg,cnbc,financial-times,the-wall-street-journal',
    language: 'en',
  },
  {
    label: 'sector',
    q: 'semiconductor OR chipmaker OR AI infrastructure OR datacenter OR cloud software OR cybersecurity OR EV OR electric vehicle OR biotech OR pharma OR oil OR gas OR uranium OR copper OR gold miners OR banks OR insurers',
    sources: 'reuters,associated-press,bloomberg,cnbc,financial-times',
    language: 'en',
  },
  {
    label: 'company',
    q: 'Apple OR Microsoft OR Nvidia OR AMD OR Amazon OR Alphabet OR Google OR Meta OR Tesla OR Broadcom OR Palantir OR Oracle OR Salesforce OR ServiceNow OR CrowdStrike OR Snowflake OR Shopify',
    sources: 'reuters,associated-press,bloomberg,cnbc,financial-times,the-wall-street-journal',
    language: 'en',
  },
  {
    label: 'company',
    q: 'IPO OR "initial public offering" OR "direct listing" OR SPAC OR merger OR acquisition OR takeover OR buyout OR "private equity" OR "strategic alternatives" OR "goes public" OR "deal talks" OR "deal valued at"',
    sources: 'reuters,associated-press,bloomberg,cnbc,financial-times,the-wall-street-journal',
    language: 'en',
  },
  {
    label: 'us_politics',
    q: 'Trump OR "White House" OR tariffs OR tariff OR "executive order" OR sanctions OR "Treasury Department" OR "Commerce Department" OR briefing',
    sources: 'reuters,associated-press,bloomberg,cnbc',
    language: 'en',
  },
  {
    label: 'policy',
    q: '"White House" OR "U.S. Treasury" OR "Federal Reserve" OR tariffs OR tariff OR sanctions OR "export controls" OR "trade restrictions" OR "industrial policy" OR "tax policy"',
    sources: 'reuters,associated-press,bloomberg,cnbc,financial-times',
    language: 'en',
  },
  {
    label: 'canada_macro',
    q: 'Canada OR "Canadian economy" OR tariffs OR "Bank of Canada" OR Carney',
    sources: 'reuters,associated-press,the-globe-and-mail,cbc-news',
    language: 'en',
  },
  {
    label: 'geopolitical',
    q: 'political OR policy OR sanctions OR "trade war" OR "executive order"',
    sources: 'reuters,associated-press,financial-times',
    language: 'en',
  },
];

const NEWS_SCORING_SYSTEM_PROMPT = `You are a financial analyst. Does this headline have market impact in the next 30 days? Categories: macro, sector, company, policy, us_politics, canada_macro, trade_policy, geopolitical. For political news, only flag if it plausibly affects interest rates, trade, specific sectors, or currency — otherwise return null. If yes, return ONLY a valid JSON object: {"impact_score":1-10,"category":"...","why":"one sentence","affected_tickers":["..."]}. If no market impact, return the single word null. Be strict — only flag genuinely material news. Never wrap the JSON in markdown.`;

function headlineDedupKey(headline, publishedAt) {
  return crypto.createHash('sha1').update(`${headline}||${publishedAt || ''}`).digest('hex');
}

async function fetchNewsApiHeadlines(query) {
  if (!NEWSAPI_KEY) return [];
  const params = new URLSearchParams({
    q: query.q,
    language: query.language || 'en',
    pageSize: '50',
    sortBy: 'publishedAt',
    apiKey: NEWSAPI_KEY,
  });
  if (query.sources) params.set('sources', query.sources);

  try {
    const raw = await httpsGet(`https://newsapi.org/v2/everything?${params.toString()}`, {
      'User-Agent': 'TARS-news-agent/1.0',
      'X-Api-Key': NEWSAPI_KEY,
    });
    const json = JSON.parse(raw);
    if (json.status !== 'ok') {
      console.warn(`[news-fetch:${query.label}] NewsAPI status=${json.status} code=${json.code}`);
      return [];
    }
    return (json.articles || []).map(a => ({
      headline: a.title || '',
      source: a.source?.name || query.label,
      publishedAt: a.publishedAt || new Date().toISOString(),
      url: a.url || null,
      rawQuery: query.label,
    })).filter(a => a.headline && a.headline !== '[Removed]');
  } catch (err) {
    console.warn(`[news-fetch:${query.label}]`, err.message);
    return [];
  }
}

async function fetchFinnhubNewsHeadlines(category) {
  if (!FINNHUB_KEY) return [];
  try {
    const json = await fetchFinnhubJson('/news', { category });
    if (!Array.isArray(json)) return [];
    return json.map((item) => ({
      headline: String(item?.headline || '').trim(),
      source: item?.source || 'Finnhub',
      publishedAt: item?.datetime
        ? new Date(Number(item.datetime) * 1000).toISOString()
        : new Date().toISOString(),
      url: item?.url || null,
      rawQuery: `finnhub:${category}`,
    })).filter((item) => item.headline);
  } catch (err) {
    console.warn(`[news-fetch:finnhub:${category}]`, err.message);
    return [];
  }
}

async function fetchFinvizHeadlines() {
  try {
    const raw = await httpsGet('https://finviz.com/news.ashx', {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://finviz.com/',
    });
    const items = [];
    // Headline links: external URLs with class="tab-link", text 8–200 chars
    const headlineRe = /<a[^>]+href="(https?:\/\/(?!(?:www\.)?finviz\.com)[^"]+)"[^>]*class="[^"]*tab-link[^"]*"[^>]*>([^<]{8,200})<\/a>/gi;
    // Source links: href points back to finviz news with a sourceId
    const sourceRe = /<a[^>]+href="[^"]*finviz\.com\/news\.ashx[^"]*"[^>]*class="[^"]*tab-link[^"]*"[^>]*>([^<]{1,50})<\/a>/gi;
    let m;
    while ((m = headlineRe.exec(raw)) !== null && items.length < 60) {
      const headline = m[2].trim();
      if (headline && headline !== '[Removed]') {
        items.push({ headline, source: 'Finviz', publishedAt: new Date().toISOString(), url: m[1], rawQuery: 'finviz:news' });
      }
    }
    // Back-fill source names from adjacent source links
    const srcs = [];
    while ((m = sourceRe.exec(raw)) !== null) srcs.push(m[1].trim());
    items.forEach((item, i) => { if (srcs[i]) item.source = srcs[i]; });
    console.log(`[news-fetch:finviz] fetched ${items.length} headlines`);
    return items;
  } catch (err) {
    console.warn('[news-fetch:finviz]', err.message);
    return [];
  }
}

async function fetchAllHeadlines() {
  const sourceJobs = [
    ...NEWS_QUERIES.map((q) => fetchNewsApiHeadlines(q)),
    ...FINNHUB_NEWS_CATEGORIES.map((category) => fetchFinnhubNewsHeadlines(category)),
    fetchFinvizHeadlines(),
  ];
  const results = await Promise.allSettled(sourceJobs);
  const all = [];
  for (const r of results) {
    if (r.status === 'fulfilled') all.push(...r.value);
  }
  // dedup by headline text within this batch
  const seen = new Set();
  return all.filter(a => {
    const k = a.headline.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function buildNewsFeedNote({ minScore, category, days, showAll }) {
  const windowLabel = days === 1 ? '24H' : `${days}D`;
  const scoreLabel = showAll ? 'all scored stories' : `${minScore}+ impact only`;
  const categoryLabel = category && category !== 'all' ? `, ${String(category).replace(/_/g, ' ')}` : '';
  return `Showing ${windowLabel}, ${scoreLabel}${categoryLabel}. Stories only appear after NewsAPI/Finnhub ingestion, query matching, and Claude market-impact scoring.`;
}

function macroIsoDate(month, day) {
  return `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildMacroCalendarEvents() {
  const events = [
    {
      id: 'bea-gdp-2026-04-30',
      kind: 'gdp',
      title: 'U.S. GDP (Advance Estimate)',
      scheduledAt: `${macroIsoDate(4, 30)}T08:30:00-04:00`,
      source: 'BEA',
      sourceUrl: 'https://www.bea.gov/news/schedule',
      importance: 'high',
      whyImportant: 'GDP is the broadest read on U.S. growth and shapes recession risk, earnings expectations, and rate-cut odds.',
      implications: [
        'Hotter-than-expected growth can push yields up and reduce near-term rate-cut hopes.',
        'Weak growth can pressure cyclicals, but may help duration if traders expect a softer Fed path.',
      ],
    },
    {
      id: 'bea-pce-2026-04-30',
      kind: 'pce',
      title: 'PCE Inflation / Personal Income & Outlays',
      scheduledAt: `${macroIsoDate(4, 30)}T08:30:00-04:00`,
      source: 'BEA',
      sourceUrl: 'https://www.bea.gov/products/personal-income-outlays',
      importance: 'high',
      whyImportant: 'PCE is the Fed’s preferred inflation gauge, so it directly affects policy expectations, yields, and growth-stock valuations.',
      implications: [
        'Hot core PCE can lift yields and pressure long-duration tech.',
        'Cooler PCE can support equities if it improves the odds of easier policy.',
      ],
    },
    {
      id: 'bls-jolts-2026-05-05',
      kind: 'labor',
      title: 'JOLTS Job Openings',
      scheduledAt: `${macroIsoDate(5, 5)}T10:00:00-04:00`,
      source: 'BLS',
      sourceUrl: 'https://www.bls.gov/schedule/2026/05_sched_list.htm',
      importance: 'medium',
      whyImportant: 'JOLTS is an early read on labor-market tightness and helps frame how sticky wage and services inflation may be.',
      implications: [
        'A still-tight labor market can keep the Fed cautious.',
        'A cooling openings trend can ease inflation fears and support rate-sensitive assets.',
      ],
    },
    {
      id: 'bls-nfp-2026-05-08',
      kind: 'employment',
      title: 'Employment Situation (Nonfarm Payrolls)',
      scheduledAt: `${macroIsoDate(5, 8)}T08:30:00-04:00`,
      source: 'BLS',
      sourceUrl: 'https://www.bls.gov/schedule/news_release/empsit.htm',
      importance: 'high',
      whyImportant: 'Payrolls, unemployment, and wage growth often move rates, the dollar, and broad equity sentiment within minutes.',
      implications: [
        'Strong payrolls and wages can push yields up and delay rate-cut pricing.',
        'A softer report can help bonds and growth stocks if recession fears do not dominate.',
      ],
    },
    {
      id: 'bls-cpi-2026-05-12',
      kind: 'inflation',
      title: 'Consumer Price Index (CPI)',
      scheduledAt: `${macroIsoDate(5, 12)}T08:30:00-04:00`,
      source: 'BLS',
      sourceUrl: 'https://www.bls.gov/schedule/news_release/cpi.htm',
      importance: 'high',
      whyImportant: 'CPI is one of the fastest market-moving inflation reports and resets expectations for Fed policy and sector leadership.',
      implications: [
        'Hot CPI can hit rate-sensitive sectors and raise real-yield pressure.',
        'Cool CPI can help duration, small caps, and multiple expansion if disinflation looks credible.',
      ],
    },
    {
      id: 'bls-ppi-2026-05-13',
      kind: 'inflation',
      title: 'Producer Price Index (PPI)',
      scheduledAt: `${macroIsoDate(5, 13)}T08:30:00-04:00`,
      source: 'BLS',
      sourceUrl: 'https://www.bls.gov/schedule/2026/05_sched_list.htm',
      importance: 'medium',
      whyImportant: 'PPI can reinforce or challenge the CPI signal by showing pipeline inflation and margin pressure building upstream.',
      implications: [
        'Rising producer prices can revive inflation worries after a benign CPI.',
        'Soft PPI can support the case that upstream price pressure is easing.',
      ],
    },
    {
      id: 'bea-gdp-2026-05-28',
      kind: 'gdp',
      title: 'U.S. GDP (Second Estimate)',
      scheduledAt: `${macroIsoDate(5, 28)}T08:30:00-04:00`,
      source: 'BEA',
      sourceUrl: 'https://www.bea.gov/news/schedule',
      importance: 'medium',
      whyImportant: 'The second GDP estimate can materially revise the growth narrative if consumption, inventories, or trade are re-estimated.',
      implications: [
        'Upward revisions can support cyclicals but keep rates elevated.',
        'Downward revisions can hurt growth confidence and pull yields lower.',
      ],
    },
    {
      id: 'bea-pce-2026-05-28',
      kind: 'pce',
      title: 'PCE Inflation / Personal Income & Outlays',
      scheduledAt: `${macroIsoDate(5, 28)}T08:30:00-04:00`,
      source: 'BEA',
      sourceUrl: 'https://www.bea.gov/news/schedule',
      importance: 'high',
      whyImportant: 'This refreshes the Fed’s preferred inflation gauge and consumer-spending picture heading into the next policy meeting.',
      implications: [
        'Sticky core PCE can harden hawkish expectations into the next FOMC.',
        'Cooling inflation plus weaker spending can strengthen the easing narrative.',
      ],
    },
    {
      id: 'fomc-2026-06-16',
      kind: 'fomc',
      title: 'FOMC Rate Decision and SEP',
      scheduledAt: `${macroIsoDate(6, 17)}T14:00:00-04:00`,
      source: 'Federal Reserve',
      sourceUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm',
      importance: 'high',
      whyImportant: 'FOMC decisions and projections drive the policy-rate path, liquidity expectations, and the relative winners across equities, bonds, and FX.',
      implications: [
        'A hawkish dot-plot or firm inflation language can pressure multiples and lift the dollar.',
        'A dovish shift can help duration, rate-sensitive sectors, and risk appetite broadly.',
      ],
    },
    {
      id: 'bea-gdp-2026-06-25',
      kind: 'gdp',
      title: 'U.S. GDP (Third Estimate)',
      scheduledAt: `${macroIsoDate(6, 25)}T08:30:00-04:00`,
      source: 'BEA',
      sourceUrl: 'https://www.bea.gov/news/schedule',
      importance: 'medium',
      whyImportant: 'The third GDP print is less market-moving than the advance estimate, but can still revise corporate-profit and final-demand trends.',
      implications: [
        'Big revisions can reframe the quarter for cyclicals and margins.',
        'A weak final print can deepen concern about late-cycle slowing.',
      ],
    },
    {
      id: 'bea-pce-2026-06-25',
      kind: 'pce',
      title: 'PCE Inflation / Personal Income & Outlays',
      scheduledAt: `${macroIsoDate(6, 25)}T08:30:00-04:00`,
      source: 'BEA',
      sourceUrl: 'https://www.bea.gov/news/schedule',
      importance: 'high',
      whyImportant: 'This report updates both inflation and the health of the consumer, which is central to the U.S. growth outlook.',
      implications: [
        'Hot inflation with firm spending can keep the Fed restrictive for longer.',
        'Cooling prices or spending can shift market focus toward slower growth and easier policy.',
      ],
    },
  ];

  return events;
}

function getUpcomingMacroEvents(limit = 8) {
  const now = new Date();
  return buildMacroCalendarEvents()
    .map((event) => {
      const scheduledMs = Date.parse(event.scheduledAt);
      const daysUntil = Number.isFinite(scheduledMs)
        ? Math.ceil((scheduledMs - now.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      return { ...event, daysUntil };
    })
    .filter((event) => event.daysUntil == null || event.daysUntil >= 0)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, limit);
}

async function scoreHeadlineWithClaude(headline, source, publishedAt) {
  const cacheKey = aiCacheKey({ type: 'news-score', headline, publishedAt });
  const cached = aiCacheGet(cacheKey);
  if (cached) {
    try { return typeof cached === 'string' ? JSON.parse(cached) : cached; } catch { return null; }
  }

  const userPrompt = `Headline: "${headline}"\nSource: ${source}\nPublished: ${publishedAt}`;
  let tokensUsed = 0;
  try {
    const { answer, usage } = await callClaudeRaw(NEWS_SCORING_SYSTEM_PROMPT, userPrompt, {
      model: CLAUDE_MODEL_PRESET,
      maxTokens: 200,
      temperature: 0.1,
    });
    tokensUsed = (usage?.input_tokens || 0) + (usage?.output_tokens || 0);
    const text = (answer || '').trim();
    if (!text || text === 'null') {
      aiCacheSet(cacheKey, 'null');
      return { result: null, tokensUsed };
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      aiCacheSet(cacheKey, 'null');
      return { result: null, tokensUsed };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.impact_score || !parsed.category) {
      aiCacheSet(cacheKey, 'null');
      return { result: null, tokensUsed };
    }
    const result = {
      impactScore: Math.min(10, Math.max(1, parseInt(parsed.impact_score, 10))),
      category: String(parsed.category).toLowerCase(),
      summary: String(parsed.why || '').slice(0, 500),
      affectedTickers: Array.isArray(parsed.affected_tickers)
        ? parsed.affected_tickers.map(t => String(t).toUpperCase().trim()).filter(Boolean).slice(0, 10)
        : [],
    };
    aiCacheSet(cacheKey, JSON.stringify(result));
    return { result, tokensUsed };
  } catch (err) {
    console.warn('[news-score]', err.message);
    return { result: null, tokensUsed };
  }
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

let newsImpactJobRunning = false;

async function runNewsImpactJob() {
  if (!NEWS_AGENT_ENABLED) return { written: 0, skipped: 0, tokensUsed: 0 };
  if (!NEWSAPI_KEY && !FINNHUB_KEY) {
    console.warn('[news-impact-job] NEWSAPI_KEY and FINNHUB_KEY not set — skipping');
    return { written: 0, skipped: 0, tokensUsed: 0 };
  }
  if (newsImpactJobRunning) {
    console.log('[news-impact-job] already running, skipping');
    return { written: 0, skipped: 0, tokensUsed: 0 };
  }
  newsImpactJobRunning = true;
  const startMs = Date.now();
  let written = 0;
  let skipped = 0;
  let totalTokens = 0;
  let jobError = null;

  try {
    const headlines = await fetchAllHeadlines();
    console.log(`[news-impact-job] fetched ${headlines.length} headlines`);

    for (const h of headlines) {
      const dedupKey = headlineDedupKey(h.headline, h.publishedAt);
      const { result, tokensUsed } = await scoreHeadlineWithClaude(h.headline, h.source, h.publishedAt);
      totalTokens += tokensUsed || 0;

      if (!result) { skipped += 1; continue; }

      const row = {
        headline: h.headline,
        source: h.source,
        published_at: h.publishedAt,
        url: h.url || null,
        impact_score: result.impactScore,
        category: result.category,
        summary: result.summary,
        affected_tickers: result.affectedTickers,
        seen_by_agent: false,
        raw_query: h.rawQuery || null,
        dedup_key: dedupKey,
      };

      const id = await insertNewsItem(row);
      if (id) written += 1; else skipped += 1;
    }
  } catch (err) {
    jobError = err.message;
    console.error('[news-impact-job] unexpected error:', err.message);
  } finally {
    newsImpactJobRunning = false;
  }

  const msElapsed = Date.now() - startMs;
  await logAgentRun({ job: 'news-impact', itemsProcessed: written + skipped, tokensUsed: totalTokens, msElapsed, error: jobError });
  console.log(`[news-impact-job] done — written=${written} skipped=${skipped} tokens=${totalTokens} ms=${msElapsed}`);
  return { written, skipped, tokensUsed: totalTokens };
}

// ── Phase 3: Material Form 4 filter + Agent Briefing job ─────────────────────

const MATERIAL_BUY_THRESHOLD = 100000; // $100k
const CLUSTER_BUY_MIN_INSIDERS = 3;
const AGENT_BRIEFING_MAX_NEWS = 50;
const AGENT_BRIEFING_MAX_FILINGS = 25;

const AGENT_BRIEFING_SYSTEM_PROMPT = `You are a portfolio analyst. Given these news items and insider filings, generate a briefing for a user holding these watchlist tickers. Return ONLY a JSON array of max 5 bullet strings, each covering: what happened, which ticker it affects, and why it matters. Only include bullets directly relevant to the watchlist tickers. Be concise. Format: ["bullet 1", "bullet 2", ...]. Return an empty array if nothing is directly relevant.`;

async function fetchRecentMaterialForm4Entries({ days = 7 } = {}) {
  const daysBack = days + Math.ceil(days / 5) * 2 + 1;
  const entries = await fetchRecentForm4Entries(daysBack);

  // Sample up to 120 entries to bound EDGAR load (most relevant for material filter)
  const sampled = entries.slice(0, 120);
  const concurrency = 8;
  const results = [];

  for (let i = 0; i < sampled.length; i += concurrency) {
    const batch = sampled.slice(i, i + concurrency);
    const parsed = await Promise.allSettled(batch.map(e => fetchSecInsiderActivityItem(e)));
    for (const r of parsed) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }
  }

  // Filter: ≥$100k buy OR cluster buy (≥3 distinct insiders at same ticker within window)
  const buys = results.filter(r => r.type === 'BUY' && r.totalValue >= MATERIAL_BUY_THRESHOLD);

  // Cluster detection: group by ticker, count distinct insiders
  const clusterMap = new Map();
  for (const r of results.filter(t => t.type === 'BUY')) {
    const key = r.symbol;
    if (!clusterMap.has(key)) clusterMap.set(key, new Set());
    clusterMap.get(key).add(r.insiderName);
  }
  const clusterTickers = new Set(
    [...clusterMap.entries()]
      .filter(([, insiders]) => insiders.size >= CLUSTER_BUY_MIN_INSIDERS)
      .map(([ticker]) => ticker)
  );

  // Merge: include material buys + all buys from cluster tickers
  const materialSet = new Map();
  for (const r of results) {
    if (r.type !== 'BUY') continue;
    const isMaterial = r.totalValue >= MATERIAL_BUY_THRESHOLD || clusterTickers.has(r.symbol);
    if (!isMaterial) continue;
    const key = `${r.symbol}-${r.insiderName}-${r.transactionDate}`;
    if (!materialSet.has(key)) materialSet.set(key, r);
  }

  return Array.from(materialSet.values()).map(r => ({
    ticker: r.symbol,
    insiderName: r.insiderName,
    type: 'BUY',
    amount: Math.round(r.totalValue || 0),
    filedDate: r.filingDate,
    accessionNo: r.id?.split('-').slice(0, 3).join('-') || '',
  }));
}

let agentBriefingJobRunning = false;

async function runAgentBriefingJob() {
  if (!NEWS_AGENT_ENABLED) return { alertsCreated: 0, newsMarked: 0, tokensUsed: 0 };
  if (agentBriefingJobRunning) {
    console.log('[agent-briefing-job] already running, skipping');
    return { alertsCreated: 0, newsMarked: 0, tokensUsed: 0 };
  }
  agentBriefingJobRunning = true;
  const startMs = Date.now();
  let alertsCreated = 0;
  let newsMarked = 0;
  let totalTokens = 0;
  let jobError = null;
  let unseenNews = [];

  try {
    unseenNews = await getUnseenNewsItems({ limit: AGENT_BRIEFING_MAX_NEWS });
    const materialFilings = await fetchRecentMaterialForm4Entries({ days: 7 })
      .catch(err => { console.warn('[agent-briefing-job] filings fetch failed:', err.message); return []; });

    const filingsSample = materialFilings.slice(0, AGENT_BRIEFING_MAX_FILINGS);

    if (unseenNews.length === 0 && filingsSample.length === 0) {
      console.log('[agent-briefing-job] nothing new to process');
      await logAgentRun({ job: 'agent-briefing', itemsProcessed: 0, tokensUsed: 0, msElapsed: Date.now() - startMs });
      return { alertsCreated: 0, newsMarked: 0, tokensUsed: 0 };
    }

    // Get all player watchlists that are non-empty
    let watchlists = [];
    if (hasNewsDb()) {
      const { data } = await serverSupabase
        .from('watchlists')
        .select('player_id, symbol');
      if (data?.length) {
        const grouped = new Map();
        for (const row of data) {
          if (!grouped.has(row.player_id)) grouped.set(row.player_id, []);
          grouped.get(row.player_id).push(row.symbol.toUpperCase());
        }
        watchlists = [...grouped.entries()].map(([playerId, symbols]) => ({ playerId, symbols }));
      }
    }

    // Also generate a global briefing (no player_id)
    watchlists.unshift({ playerId: null, symbols: [] });

    const newsContext = unseenNews.map((n, i) =>
      `${i + 1}. [${n.category}] ${n.headline} — ${n.summary} (score: ${n.impact_score})`
    ).join('\n');

    const filingsContext = filingsSample.length > 0
      ? '\n\nMaterial insider filings:\n' + filingsSample.map((f, i) =>
          `${i + 1}. ${f.ticker}: ${f.insiderName} BUY $${f.amount.toLocaleString()} filed ${f.filedDate}`
        ).join('\n')
      : '';

    for (const { playerId, symbols } of watchlists) {
      const watchlistLine = symbols.length > 0
        ? `\n\nUser's watchlist tickers: ${symbols.join(', ')}`
        : '\n\n(No personal watchlist — produce a general briefing for the market-moving items above.)';

      const userPrompt = `News items:\n${newsContext}${filingsContext}${watchlistLine}`;

      try {
        const { answer, usage } = await callClaudeRaw(AGENT_BRIEFING_SYSTEM_PROMPT, userPrompt, {
          model: CLAUDE_MODEL_PRESET,
          maxTokens: 600,
          temperature: 0.3,
        });
        totalTokens += (usage?.input_tokens || 0) + (usage?.output_tokens || 0);

        let bullets = [];
        const jsonMatch = (answer || '').match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          try { bullets = JSON.parse(jsonMatch[0]).slice(0, 5).map(String); } catch { /* ignore */ }
        }

        const alertId = await insertAgentAlert({
          player_id: playerId,
          briefing_text: answer || '',
          bullets,
          source_news_ids: unseenNews.map(n => n.id),
          source_filings: filingsSample,
          watchlist_snapshot: symbols,
          delivered: false,
        });
        if (alertId) alertsCreated += 1;
      } catch (err) {
        console.warn(`[agent-briefing-job] briefing for player ${playerId} failed:`, err.message);
      }
    }

    // Flip seen_by_agent only after all briefings succeed
    if (alertsCreated > 0) {
      await markNewsItemsSeen(unseenNews.map(n => n.id));
      newsMarked = unseenNews.length;
    }
  } catch (err) {
    jobError = err.message;
    console.error('[agent-briefing-job] unexpected error:', err.message);
  } finally {
    agentBriefingJobRunning = false;
  }

  const msElapsed = Date.now() - startMs;
  await logAgentRun({ job: 'agent-briefing', itemsProcessed: unseenNews?.length || 0, tokensUsed: totalTokens, msElapsed, error: jobError });
  console.log(`[agent-briefing-job] done — alertsCreated=${alertsCreated} newsMarked=${newsMarked} tokens=${totalTokens} ms=${msElapsed}`);
  return { alertsCreated, newsMarked, tokensUsed: totalTokens };
}

// Admin-only run-now endpoint (triggers one job cycle on demand for verification)
app.post('/api/news/run-now', async (req, res) => {
  const adminEmails = (process.env.VITE_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const callerEmail = (req.headers['x-admin-email'] || '').toLowerCase().trim();
  if (adminEmails.length > 0 && !adminEmails.includes(callerEmail)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const result = await runNewsImpactJob();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/reddit-trends', async (req, res) => {
  try {
    const filter = String(req.query.filter || 'all-stocks');
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const playerId = String(req.query.playerId || '').trim();
    const cacheKey = `${filter}:${page}:${limit}:${playerId || 'anon'}`;
    const cached = redditTrendCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < REDDIT_TRENDS_TTL) {
      return res.json(cached.payload);
    }

    const payload = await buildRedditTrendsPayload(filter, page, limit, playerId);
    redditTrendCache.set(cacheKey, { ts: Date.now(), payload });
    if (redditTrendCache.size > 25) {
      const firstKey = redditTrendCache.keys().next().value;
      redditTrendCache.delete(firstKey);
    }
    res.json(payload);
  } catch (err) {
    console.error('[api/reddit-trends]', err.message);
    res.status(502).json({
      schemaVersion: REDDIT_TRENDS_SCHEMA_VERSION,
      filter: String(req.query.filter || 'all-stocks'),
      count: 0,
      pages: 0,
      currentPage: 1,
      generatedAt: new Date().toISOString(),
      source: 'ApeWisdom',
      results: [],
      error: err.message,
    });
  }
});

app.get('/api/news/impact', async (req, res) => {
  try {
    const minScore = Math.min(10, Math.max(1, parseInt(req.query.minScore ?? '7', 10)));
    const category = req.query.category ?? null;
    const days = Math.min(30, Math.max(1, parseInt(req.query.days ?? '1', 10)));
    const showAll = req.query.all === '1';

    if (!hasNewsDb()) {
      return res.json({ schemaVersion: NEWS_SCHEMA_VERSION, items: [], generatedAt: new Date().toISOString(), note: 'Database not configured' });
    }

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    let query = serverSupabase
      .from('news_items')
      .select('id, headline, source, published_at, url, impact_score, category, summary, affected_tickers')
      .gte('published_at', cutoff)
      .order('impact_score', { ascending: false })
      .order('published_at', { ascending: false })
      .limit(200);

    if (!showAll) query = query.gte('impact_score', minScore);
    if (category && category !== 'all') query = query.eq('category', category);

    const { data, error } = await query;
    if (error) throw error;

    const items = (data ?? []).map(r => ({
      id: r.id,
      headline: r.headline,
      source: r.source,
      publishedAt: r.published_at,
      url: r.url ?? null,
      impactScore: r.impact_score,
      category: r.category,
      summary: r.summary,
      affectedTickers: r.affected_tickers ?? [],
    }));

    res.json({
      schemaVersion: NEWS_SCHEMA_VERSION,
      items,
      generatedAt: new Date().toISOString(),
      note: buildNewsFeedNote({ minScore, category, days, showAll }),
    });
  } catch (err) {
    console.error('[api/news/impact]', err.message);
    res.status(502).json({ schemaVersion: NEWS_SCHEMA_VERSION, items: [], error: err.message, generatedAt: new Date().toISOString() });
  }
});

app.get('/api/alerts/latest', async (req, res) => {
  try {
    const playerId = req.query.playerId ?? null;
    if (!hasNewsDb()) {
      return res.json({ schemaVersion: NEWS_SCHEMA_VERSION, alert: null, generatedAt: new Date().toISOString(), note: 'Database not configured' });
    }
    const row = await getLatestAgentAlert(playerId);
    const alert = row ? {
      id: row.id,
      createdAt: row.created_at,
      bullets: row.bullets ?? [],
      sourceNewsIds: row.source_news_ids ?? [],
      sourceFilings: row.source_filings ?? [],
      watchlistSnapshot: row.watchlist_snapshot ?? [],
    } : null;
    res.json({ schemaVersion: NEWS_SCHEMA_VERSION, alert, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[api/alerts/latest]', err.message);
    res.status(502).json({ schemaVersion: NEWS_SCHEMA_VERSION, alert: null, error: err.message, generatedAt: new Date().toISOString() });
  }
});

app.get('/api/alerts/insider-filings', async (req, res) => {
  const days = Math.min(30, Math.max(1, parseInt(req.query.days ?? '7', 10)));
  try {
    const filings = await fetchRecentMaterialForm4Entries({ days });
    res.json({ schemaVersion: NEWS_SCHEMA_VERSION, filings, generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[api/alerts/insider-filings]', err.message);
    res.status(502).json({ schemaVersion: NEWS_SCHEMA_VERSION, filings: [], error: err.message, generatedAt: new Date().toISOString() });
  }
});

app.get('/api/alerts/macro-calendar', async (req, res) => {
  try {
    const limit = Math.min(12, Math.max(3, parseInt(req.query.limit ?? '8', 10)));
    const events = getUpcomingMacroEvents(limit);
    res.json({
      schemaVersion: MACRO_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      note: 'Upcoming official macro events from BLS, BEA, and the Federal Reserve, limited to high-signal business and policy releases.',
      events,
    });
  } catch (err) {
    console.error('[api/alerts/macro-calendar]', err.message);
    res.status(502).json({
      schemaVersion: MACRO_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      events: [],
      error: err.message,
    });
  }
});

app.post('/api/alerts/run-now', async (req, res) => {
  const adminEmails = (process.env.VITE_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  const callerEmail = (req.headers['x-admin-email'] || '').toLowerCase().trim();
  if (adminEmails.length > 0 && !adminEmails.includes(callerEmail)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    const result = await runAgentBriefingJob();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── X / Twitter social trend poller ──────────────────────────────────────────
// Controlled by app_settings.twitter_enabled (default false). Polls a curated
// account basket every 8 hours and stores cashtag/ticker mentions for trend UI.

function isXEnabledValue(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeXUsername(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?#\s]/)[0]
    .toLowerCase();
}

function adminEmails() {
  return (process.env.VITE_ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

function isAdminRequest(req) {
  const emails = adminEmails();
  const callerEmail = (req.headers['x-admin-email'] || '').toLowerCase().trim();
  return emails.length === 0 || emails.includes(callerEmail);
}

function xApiGet(path, params = {}) {
  if (!X_BEARER_TOKEN) throw new Error('X_BEARER_TOKEN is not configured');
  const url = new URL(`https://api.x.com/2${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }
  return httpsGet(url.toString(), {
    Accept: 'application/json',
    Authorization: `Bearer ${X_BEARER_TOKEN}`,
  }).then((raw) => JSON.parse(raw));
}

function extractCashtags(text) {
  const tags = new Set();
  const re = /(^|[^A-Z0-9_])\$([A-Z][A-Z0-9]{0,9}(?:\.[A-Z]{1,3})?)(?![A-Z0-9_])/gi;
  let match;
  while ((match = re.exec(text || '')) !== null) {
    const symbol = normalizeSymbol(match[2]);
    if (symbol && /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) tags.add(symbol);
  }
  return [...tags];
}

function engagementScore(metrics = {}) {
  const likes = finiteNumber(metrics.like_count) || 0;
  const reposts = finiteNumber(metrics.retweet_count) || 0;
  const replies = finiteNumber(metrics.reply_count) || 0;
  const quotes = finiteNumber(metrics.quote_count) || 0;
  return Math.round(likes + reposts * 2 + replies * 1.5 + quotes * 2);
}

async function readXAccounts() {
  const defaultAccounts = DEFAULT_X_ANALYST_ACCOUNTS.map((account) => ({ ...account }));
  const envAccounts = X_ACCOUNT_USERNAMES.map((username) => ({
    username,
    userId: null,
    displayName: '',
    priority: 50,
  }));

  if (!hasNewsDb()) {
    const merged = [...envAccounts, ...defaultAccounts];
    const byUsername = new Map();
    for (const account of merged) byUsername.set(account.username, { ...byUsername.get(account.username), ...account });
    return [...byUsername.values()].slice(0, X_MAX_ACCOUNTS_PER_POLL);
  }

  try {
    const { data, error } = await serverSupabase
      .from('x_accounts')
      .select('username,user_id,display_name,enabled,priority')
      .order('priority', { ascending: false })
      .limit(X_MAX_ACCOUNTS_PER_POLL);
    if (error) throw error;

    const rows = (data || []).map((row) => ({
      username: String(row.username || '').toLowerCase(),
      userId: row.user_id || null,
      displayName: row.display_name || '',
      enabled: row.enabled !== false,
      priority: finiteNumber(row.priority) || 50,
    })).filter((row) => row.username);

    const activeRows = rows.filter((row) => row.enabled);
    const seen = new Set(rows.map((row) => row.username));
    for (const account of [...envAccounts, ...defaultAccounts]) {
      if (!seen.has(account.username)) activeRows.push(account);
    }
    return activeRows.slice(0, X_MAX_ACCOUNTS_PER_POLL);
  } catch (err) {
    console.warn('[x-social/accounts]', err.message);
    return envAccounts.slice(0, X_MAX_ACCOUNTS_PER_POLL);
  }
}

async function resolveXUsers(accounts) {
  const unresolved = accounts.filter((account) => !account.userId).map((account) => account.username);
  const byUsername = new Map(accounts.map((account) => [account.username, { ...account }]));
  if (unresolved.length === 0) return [...byUsername.values()].filter((account) => account.userId);
  if (!X_RESOLVE_USERS_ON_POLL) {
    return [...byUsername.values()].filter((account) => account.userId);
  }

  for (let i = 0; i < unresolved.length; i += 100) {
    const batch = unresolved.slice(i, i + 100);
    const json = await xApiGet('/users/by', {
      usernames: batch.join(','),
      'user.fields': 'id,name,username,verified,public_metrics',
    });
    for (const user of json?.data || []) {
      const username = String(user.username || '').toLowerCase();
      const current = byUsername.get(username) || { username };
      byUsername.set(username, {
        ...current,
        userId: user.id,
        displayName: user.name || current.displayName || username,
      });
    }
  }

  if (hasNewsDb()) {
    const rows = [...byUsername.values()]
      .filter((account) => account.username && account.userId)
      .map((account) => ({
        username: account.username,
        user_id: account.userId,
        display_name: account.displayName || account.username,
        enabled: true,
        priority: account.priority || 50,
        updated_at: new Date().toISOString(),
      }));
    if (rows.length) {
      await serverSupabase.from('x_accounts').upsert(rows, { onConflict: 'username' });
    }
  }

  return [...byUsername.values()].filter((account) => account.userId);
}

async function fetchXUserPosts(account) {
  const json = await xApiGet(`/users/${encodeURIComponent(account.userId)}/tweets`, {
    max_results: X_MAX_POSTS_PER_ACCOUNT,
    exclude: 'retweets,replies',
    'tweet.fields': 'created_at,public_metrics,entities,lang',
  });
  return (json?.data || []).map((post) => ({
    ...post,
    accountUsername: account.username,
    accountDisplayName: account.displayName || account.username,
    authorId: account.userId,
  }));
}

function newestXPostId(posts) {
  let newest = null;
  for (const post of posts || []) {
    const id = String(post?.id || '');
    if (!/^\d+$/.test(id)) continue;
    if (!newest || BigInt(id) > BigInt(newest)) newest = id;
  }
  return newest;
}

async function fetchXListPosts() {
  if (!X_LIST_ID) return { posts: [], newestId: null };
  const sinceId = await getAppSetting(X_LIST_SINCE_SETTING_KEY).catch(() => null);
  const params = {
    max_results: X_LIST_MAX_POSTS,
    exclude: 'retweets,replies',
    'tweet.fields': 'created_at,public_metrics,entities,lang,author_id',
    expansions: 'author_id',
    'user.fields': 'id,name,username',
  };
  if (sinceId && /^\d+$/.test(String(sinceId))) params.since_id = String(sinceId);

  const json = await xApiGet(`/lists/${encodeURIComponent(X_LIST_ID)}/tweets`, params);
  const usersById = new Map((json?.includes?.users || []).map((user) => [String(user.id), user]));
  const posts = (json?.data || []).map((post) => {
    const user = usersById.get(String(post.author_id)) || {};
    const username = String(user.username || '').toLowerCase();
    return {
      ...post,
      accountUsername: username || null,
      accountDisplayName: user.name || username || '',
      authorId: post.author_id || user.id || null,
    };
  });

  return { posts, newestId: newestXPostId(posts) };
}

async function writeXPostsAndMentions(posts) {
  if (!hasNewsDb() || !Array.isArray(posts) || posts.length === 0) {
    return { postsWritten: 0, mentionsWritten: 0 };
  }

  const nowIso = new Date().toISOString();
  const postRows = [];
  const mentionRows = [];
  const accountPollRows = new Map();

  for (const post of posts) {
    const postedAt = post.created_at || nowIso;
    const metrics = post.public_metrics || {};
    const score = engagementScore(metrics);
    const username = String(post.accountUsername || '').toLowerCase();
    const symbols = extractCashtags(post.text);
    postRows.push({
      id: String(post.id),
      author_id: post.authorId || null,
      account_username: username || null,
      text: post.text || '',
      posted_at: postedAt,
      url: username && post.id ? `https://x.com/${username}/status/${post.id}` : null,
      public_metrics: metrics,
      raw: post,
      fetched_at: nowIso,
    });
    if (username) accountPollRows.set(username, { username, last_polled_at: nowIso, updated_at: nowIso });
    for (const symbol of symbols) {
      mentionRows.push({
        post_id: String(post.id),
        symbol,
        cashtag: `$${symbol}`,
        account_username: username || null,
        posted_at: postedAt,
        engagement_score: score,
      });
    }
  }

  if (postRows.length) {
    const { error } = await serverSupabase.from('x_posts').upsert(postRows, { onConflict: 'id' });
    if (error) throw error;
  }
  if (mentionRows.length) {
    const { error } = await serverSupabase.from('x_symbol_mentions').upsert(mentionRows, { onConflict: 'post_id,symbol' });
    if (error) throw error;
  }
  if (accountPollRows.size) {
    await serverSupabase.from('x_accounts').upsert([...accountPollRows.values()], { onConflict: 'username' });
  }

  return { postsWritten: postRows.length, mentionsWritten: mentionRows.length };
}

async function runXSocialPoll({ force = false } = {}) {
  const startMs = Date.now();
  const enabled = isXEnabledValue(await getAppSetting('twitter_enabled').catch(() => false));
  if (!enabled && !force) {
    console.log('[x-social] disabled by app_settings.twitter_enabled');
    return { ok: true, enabled: false, postsFetched: 0, mentionsWritten: 0, msElapsed: Date.now() - startMs };
  }
  if (!X_BEARER_TOKEN) {
    return { ok: false, enabled, error: 'X_BEARER_TOKEN is not configured', postsFetched: 0, mentionsWritten: 0, msElapsed: Date.now() - startMs };
  }
  if (!hasNewsDb()) {
    return { ok: false, enabled, error: 'Supabase service DB is not configured', postsFetched: 0, mentionsWritten: 0, msElapsed: Date.now() - startMs };
  }

  let source = 'accounts';
  let accounts = [];
  const posts = [];

  if (X_LIST_ID) {
    try {
      const listResult = await fetchXListPosts();
      posts.push(...listResult.posts);
      source = 'list';
      if (listResult.newestId) {
        await setAppSetting(X_LIST_SINCE_SETTING_KEY, listResult.newestId).catch((err) => {
          console.warn('[x-social/list-since]', err.message);
        });
      }
    } catch (err) {
      console.warn(`[x-social/list:${X_LIST_ID}]`, err.message);
      return { ok: false, enabled, source, listId: X_LIST_ID, error: err.message, postsFetched: 0, mentionsWritten: 0, msElapsed: Date.now() - startMs };
    }
  } else {
    accounts = await resolveXUsers(await readXAccounts());
    for (const account of accounts) {
      try {
        posts.push(...await fetchXUserPosts(account));
      } catch (err) {
        console.warn(`[x-social/posts:${account.username}]`, err.message);
      }
    }
  }

  const cutoff = Date.now() - X_POST_LOOKBACK_HOURS * 60 * 60 * 1000;
  const freshPosts = posts.filter((post) => {
    const ts = new Date(post.created_at || 0).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const writeResult = await writeXPostsAndMentions(freshPosts);
  const msElapsed = Date.now() - startMs;
  await logAgentRun({ job: 'x-social', itemsProcessed: freshPosts.length, tokensUsed: 0, msElapsed, error: null });
  return {
    ok: true,
    enabled,
    source,
    listId: X_LIST_ID || null,
    accounts: accounts.length,
    postsFetched: freshPosts.length,
    ...writeResult,
    msElapsed,
  };
}

function summarizeMentionRows(rows, hours) {
  const now = Date.now();
  const currentCutoff = now - hours * 60 * 60 * 1000;
  const previousCutoff = now - hours * 2 * 60 * 60 * 1000;
  const bySymbol = new Map();

  for (const row of rows || []) {
    const symbol = normalizeSymbol(row.symbol || '');
    if (!symbol) continue;
    const ts = new Date(row.posted_at).getTime();
    if (!Number.isFinite(ts)) continue;
    const bucket = bySymbol.get(symbol) || {
      symbol,
      mentions: 0,
      previousMentions: 0,
      uniqueAccounts: new Set(),
      engagementScore: 0,
      latestPostAt: null,
    };
    if (ts >= currentCutoff) {
      bucket.mentions += 1;
      if (row.account_username) bucket.uniqueAccounts.add(row.account_username);
      bucket.engagementScore += Number(row.engagement_score || 0);
      if (!bucket.latestPostAt || row.posted_at > bucket.latestPostAt) bucket.latestPostAt = row.posted_at;
    } else if (ts >= previousCutoff) {
      bucket.previousMentions += 1;
    }
    bySymbol.set(symbol, bucket);
  }

  return [...bySymbol.values()]
    .filter((row) => row.mentions > 0)
    .map((row) => {
      const mentionChange = row.mentions - row.previousMentions;
      const mentionChangePct = row.previousMentions > 0 ? (mentionChange / row.previousMentions) * 100 : null;
      return {
        symbol: row.symbol,
        mentions: row.mentions,
        previousMentions: row.previousMentions,
        mentionChange,
        mentionChangePct,
        uniqueAccounts: row.uniqueAccounts.size,
        engagementScore: Math.round(row.engagementScore),
        latestPostAt: row.latestPostAt,
      };
    })
    .sort((a, b) =>
      b.mentions - a.mentions
      || b.uniqueAccounts - a.uniqueAccounts
      || b.engagementScore - a.engagementScore
    );
}

async function getXSocialTrends({ hours = 24, limit = 100 } = {}) {
  if (!hasNewsDb()) {
    return { schemaVersion: X_SOCIAL_SCHEMA_VERSION, generatedAt: new Date().toISOString(), hours, results: [], note: 'Database not configured' };
  }
  const safeHours = Math.min(168, Math.max(1, hours));
  const since = new Date(Date.now() - safeHours * 2 * 60 * 60 * 1000).toISOString();
  const { data, error } = await serverSupabase
    .from('x_symbol_mentions')
    .select('symbol,account_username,posted_at,engagement_score')
    .gte('posted_at', since)
    .order('posted_at', { ascending: false })
    .limit(5000);
  if (error) throw error;
  return {
    schemaVersion: X_SOCIAL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    hours: safeHours,
    source: 'X curated accounts',
    results: summarizeMentionRows(data || [], safeHours).slice(0, limit),
  };
}

app.get('/api/x-social/accounts', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  try {
    if (!hasNewsDb()) {
      return res.json({ accounts: DEFAULT_X_ANALYST_ACCOUNTS, source: 'default-seed' });
    }
    const { data, error } = await serverSupabase
      .from('x_accounts')
      .select('username,user_id,display_name,enabled,priority,notes,last_polled_at,updated_at')
      .order('priority', { ascending: false })
      .order('username', { ascending: true });
    if (error) throw error;
    const byUsername = new Map();
    for (const account of DEFAULT_X_ANALYST_ACCOUNTS) {
      byUsername.set(account.username, {
        username: account.username,
        user_id: null,
        display_name: account.displayName,
        enabled: true,
        priority: account.priority,
        notes: account.notes,
        last_polled_at: null,
        updated_at: null,
      });
    }
    for (const row of data || []) byUsername.set(String(row.username || '').toLowerCase(), row);
    const accounts = [...byUsername.values()].sort((a, b) =>
      (Number(b.priority || 0) - Number(a.priority || 0)) || String(a.username).localeCompare(String(b.username))
    );
    res.json({ accounts, source: 'database' });
  } catch (err) {
    console.error('[api/x-social/accounts]', err.message);
    res.status(502).json({ accounts: [], error: err.message });
  }
});

app.post('/api/x-social/accounts', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  if (!hasNewsDb()) return res.status(503).json({ error: 'Supabase service DB is not configured' });
  try {
    const username = normalizeXUsername(req.body?.username);
    if (!/^[a-z0-9_]{2,15}$/.test(username)) {
      return res.status(400).json({ error: 'Enter a valid X username' });
    }
    const row = {
      username,
      display_name: String(req.body?.displayName || '').trim() || username,
      enabled: req.body?.enabled !== false,
      priority: Math.min(100, Math.max(1, Number.parseInt(req.body?.priority || '60', 10) || 60)),
      notes: String(req.body?.notes || 'manual analyst account').trim(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await serverSupabase
      .from('x_accounts')
      .upsert(row, { onConflict: 'username' })
      .select('username,user_id,display_name,enabled,priority,notes,last_polled_at,updated_at')
      .single();
    if (error) throw error;
    res.json({ account: data });
  } catch (err) {
    console.error('[api/x-social/accounts:add]', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.patch('/api/x-social/accounts/:username', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  if (!hasNewsDb()) return res.status(503).json({ error: 'Supabase service DB is not configured' });
  try {
    const username = normalizeXUsername(req.params.username);
    const patch = { updated_at: new Date().toISOString() };
    if (typeof req.body?.enabled === 'boolean') patch.enabled = req.body.enabled;
    if (req.body?.priority != null) patch.priority = Math.min(100, Math.max(1, Number.parseInt(req.body.priority, 10) || 50));
    if (req.body?.displayName != null) patch.display_name = String(req.body.displayName || '').trim();
    if (req.body?.notes != null) patch.notes = String(req.body.notes || '').trim();
    const { data, error } = await serverSupabase
      .from('x_accounts')
      .update(patch)
      .eq('username', username)
      .select('username,user_id,display_name,enabled,priority,notes,last_polled_at,updated_at')
      .single();
    if (error) throw error;
    res.json({ account: data });
  } catch (err) {
    console.error('[api/x-social/accounts:update]', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.delete('/api/x-social/accounts/:username', async (req, res) => {
  if (!isAdminRequest(req)) return res.status(403).json({ error: 'Admin access required' });
  if (!hasNewsDb()) return res.status(503).json({ error: 'Supabase service DB is not configured' });
  try {
    const username = normalizeXUsername(req.params.username);
    const seedAccount = DEFAULT_X_ANALYST_ACCOUNTS.find((account) => account.username === username);
    if (seedAccount) {
      const { error } = await serverSupabase.from('x_accounts').upsert({
        username,
        display_name: seedAccount.displayName,
        enabled: false,
        priority: seedAccount.priority,
        notes: `${seedAccount.notes}; removed from active analyst list`,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'username' });
      if (error) throw error;
      return res.json({ ok: true, disabled: true });
    }
    const { error } = await serverSupabase.from('x_accounts').delete().eq('username', username);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[api/x-social/accounts:delete]', err.message);
    res.status(502).json({ error: err.message });
  }
});

async function fetchTwitterHeadlines() {
  const result = await runXSocialPoll().catch((err) => ({ ok: false, error: err.message }));
  if (!result.ok && result.error) console.warn('[x-social]', result.error);
  return [];
}

app.get('/api/x-social/trends', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours || '24', 10);
    const limit = Math.min(250, Math.max(10, parseInt(req.query.limit || '100', 10)));
    res.json(await getXSocialTrends({ hours, limit }));
  } catch (err) {
    console.error('[api/x-social/trends]', err.message);
    res.status(502).json({ schemaVersion: X_SOCIAL_SCHEMA_VERSION, generatedAt: new Date().toISOString(), results: [], error: err.message });
  }
});

app.post('/api/x-social/run-now', async (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  try {
    res.json(await runXSocialPoll({ force: req.query.force === '1' }));
  } catch (err) {
    console.error('[api/x-social/run-now]', err.message);
    res.status(502).json({ ok: false, error: err.message });
  }
});

// ── Phase 4: Wire news + briefing jobs into background scheduler ──────────────

const NEWS_BACKGROUND_SYNC_MS = 60 * 60 * 1000; // 1 hour
const X_SOCIAL_BACKGROUND_SYNC_MS =
  Math.min(168, Math.max(1, parseInt(process.env.X_SOCIAL_BACKGROUND_SYNC_HOURS || '24', 10) || 24)) * 60 * 60 * 1000;

function startBackgroundSync() {
  if (!BACKGROUND_SYNC_ENABLED) {
    console.log('[background-sync] disabled');
    return;
  }

  setTimeout(() => buildOptionsScan().catch(e => console.error('[options-scan init]', e.message)), 8000);

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

  scheduleRepeatingTask('x-social', X_SOCIAL_BACKGROUND_SYNC_MS, async () => {
    const result = await runXSocialPoll();
    if (result?.enabled) {
      console.log(`[x-social sync] source=${result.source || 'accounts'} accounts=${result.accounts || 0} posts=${result.postsFetched || 0} mentions=${result.mentionsWritten || 0}`);
    }
  });

  if (NEWS_AGENT_ENABLED) {
    scheduleRepeatingTask('news-impact', NEWS_BACKGROUND_SYNC_MS, async () => {
      await runNewsImpactJob();
      // Chain: run briefing job after news ingest completes
      await runAgentBriefingJob();
    });
    console.log('[background-sync] news-impact + agent-briefing scheduled at 60-min cadence');
  } else {
    console.log('[background-sync] news agent disabled (NEWS_AGENT_ENABLED=0)');
  }
}

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
