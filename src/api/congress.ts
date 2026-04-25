// Congress trading data via two public sources:
// Senate: Senate Stock Watcher (GitHub) — historical pre-2022
// House:  House Stock Watcher (S3)      — actively maintained, includes 2024-2025
// Both sources use CORS-open endpoints (no proxy needed)

export interface CongressTrade {
  chamber: 'house' | 'senate';
  member: string;
  party: string;       // 'D' | 'R' | 'I' | '' (senate source has no party data)
  state: string;
  district?: string;
  ticker: string;
  assetDescription: string;
  type: 'purchase' | 'sale' | 'exchange' | 'other';
  amount: string;      // raw string e.g. "$1,001 - $15,000"
  amountMin: number;   // parsed lower bound for sorting
  transactionDate: string;
  disclosureDate: string;
  filingUrl: string;
}

export interface CongressTickerActivity {
  ticker: string;
  tradeCount: number;
  purchaseCount: number;
  saleCount: number;
  estimatedGrossAmountMin: number;
  estimatedNetAmountMin: number;
  averageReturnPct: number | null;
  latestTradeDate: string;
}

export interface CongressMemberActivity {
  memberId: string;
  member: string;
  party: string;
  state: string;
  chamber: 'house' | 'senate';
  totalTrades: number;
  purchaseCount: number;
  saleCount: number;
  exchangeCount: number;
  buyAmountMin: number;
  sellAmountMin: number;
  netAmountMin: number;
  totalAmountMin: number;
  averageReturnPct: number | null;
  latestTradeDate: string;
  topTickers: CongressTickerActivity[];
  recentTrades: CongressTrade[];
}

// ── Module-level caches ───────────────────────────────────────────────────────

interface SenateEntry {
  ticker: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transactions: any[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HouseEntry = any;

let senateCache: SenateEntry[] | null = null;
let senateFetchPromise: Promise<void> | null = null;
let houseCache: HouseEntry[] | null = null;
let houseFetchPromise: Promise<void> | null = null;

const SENATE_URL =
  'https://raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/master/aggregate/all_ticker_transactions.json';

// House data now fetched server-side via /api/latest-congress
// (avoids S3 CORS/403 — GitHub raw fetch happens in Node)

async function ensureSenateData(): Promise<void> {
  if (senateCache) return;
  if (!senateFetchPromise) {
    senateFetchPromise = fetch(SENATE_URL)
      .then(r => {
        if (!r.ok) throw new Error(`Senate data ${r.status}`);
        return r.json();
      })
      .then((data: SenateEntry[]) => {
        senateCache = Array.isArray(data) ? data : [];
      })
      .catch(() => {
        senateCache = [];
        senateFetchPromise = null;
      });
  }
  await senateFetchPromise;
}

// House data is now fetched server-side via /api/latest-congress
// ensureHouseData kept for fetchHouse (ticker-specific) fallback only
async function ensureHouseData(): Promise<void> {
  // No-op — server-side fetch handles house data
  houseCache = houseCache ?? [];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseAmountMin(amount: string): number {
  if (!amount) return 0;
  const clean = amount.replace(/[,$]/g, '').toLowerCase();
  const m = clean.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function normalizeType(t: string): CongressTrade['type'] {
  const lower = t.toLowerCase();
  if (lower.includes('purchase') || lower === 'buy') return 'purchase';
  if (lower.includes('sale') || lower.includes('sell')) return 'sale';
  if (lower.includes('exchange')) return 'exchange';
  return 'other';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeDate(d: any): string {
  if (!d) return '';
  // Senate uses MM/DD/YYYY
  if (typeof d === 'string' && d.includes('/')) {
    const [m, dd, yyyy] = d.split('/');
    return `${yyyy}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

// ── Fetchers ──────────────────────────────────────────────────────────────────

async function fetchSenate(ticker: string): Promise<CongressTrade[]> {
  await ensureSenateData();
  if (!senateCache) return [];

  const clean = ticker.replace(/\.(TO|TSX)$/i, '').toUpperCase();
  const entry = senateCache.find(e => e.ticker?.toUpperCase() === clean);
  if (!entry || !Array.isArray(entry.transactions)) return [];

  const trades: CongressTrade[] = [];
  for (const r of entry.transactions) {
    const type = normalizeType(r.type ?? '');
    if (type === 'other') continue;

    const txDate = normalizeDate(r.transaction_date);
    if (!txDate) continue;

    const member = (r.senator ?? '').replace(/^Sen\.\s*/i, '').trim();
    if (!member) continue;

    trades.push({
      chamber:          'senate',
      member,
      party:            '',           // senate source doesn't include party
      state:            '',
      ticker:           clean,
      assetDescription: r.asset_description ?? '',
      type,
      amount:           r.amount ?? '',
      amountMin:        parseAmountMin(r.amount ?? ''),
      transactionDate:  txDate,
      disclosureDate:   normalizeDate(r.disclosure_date ?? ''),
      filingUrl:        r.ptr_link ?? r.link ?? '',
    });
  }

  return trades;
}

// ── House helpers ─────────────────────────────────────────────────────────────

function normalizeHouseType(t: string): CongressTrade['type'] {
  const lower = (t ?? '').toLowerCase();
  if (lower.includes('purchase') || lower === 'buy') return 'purchase';
  if (lower.includes('sale') || lower.includes('sell')) return 'sale';
  if (lower.includes('exchange')) return 'exchange';
  return 'other';
}

function mapHouseEntry(r: HouseEntry): CongressTrade | null {
  const type = normalizeHouseType(r.type ?? '');
  if (type === 'other') return null;
  const ticker = (r.ticker ?? '').replace(/^--$/, '').trim().toUpperCase();
  if (!ticker || ticker.length > 8) return null;
  const txDate = normalizeDate(r.transaction_date);
  if (!txDate) return null;

  // Parse representative name — may include district like "Jane Smith (CA-11)"
  const repRaw: string = r.representative ?? '';
  const nameMatch = repRaw.match(/^(.*?)\s*\(/);
  const member = nameMatch ? nameMatch[1].trim() : repRaw.trim();
  if (!member) return null;

  return {
    chamber:          'house',
    member,
    party:            r.party ?? '',
    state:            r.state ?? (r.district ? r.district.split('-')[0] : ''),
    district:         r.district ?? '',
    ticker,
    assetDescription: r.asset_description ?? '',
    type,
    amount:           r.amount ?? '',
    amountMin:        parseAmountMin(r.amount ?? ''),
    transactionDate:  txDate,
    disclosureDate:   normalizeDate(r.disclosure_date ?? r.disclosure_year ?? ''),
    filingUrl:        r.link ?? '',
  };
}

async function fetchHouse(ticker: string): Promise<CongressTrade[]> {
  await ensureHouseData();
  if (!houseCache) return [];
  const clean = ticker.replace(/\.(TO|TSX)$/i, '').toUpperCase();
  const results: CongressTrade[] = [];
  for (const r of houseCache) {
    const t = (r.ticker ?? '').toUpperCase();
    if (t !== clean) continue;
    const mapped = mapHouseEntry(r);
    if (mapped) results.push(mapped);
  }
  return results;
}

/** Latest N trades across ALL house members — for the market-wide feed */
async function fetchHouseLatest(limit = 50): Promise<CongressTrade[]> {
  await ensureHouseData();
  if (!houseCache) return [];
  const results: CongressTrade[] = [];
  for (const r of houseCache) {
    const mapped = mapHouseEntry(r);
    if (mapped) results.push(mapped);
  }
  results.sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  return results.slice(0, limit);
}

async function fetchServerTradesForTickers(tickers: string[], days = 90): Promise<CongressTrade[]> {
  const cleaned = [...new Set(
    tickers
      .map((ticker) => ticker.replace(/\.(TO|TSX)$/i, '').toUpperCase())
      .filter(Boolean)
  )];

  if (cleaned.length === 0) return [];

  const params = new URLSearchParams({
    tickers: cleaned.join(','),
    days: String(days),
  });
  const res = await fetch(`/api/congress-trades?${params.toString()}`);
  if (!res.ok) throw new Error(`Congress data ${res.status}`);
  const json = await res.json();
  return (json.trades ?? []) as CongressTrade[];
}

// ── Public API ────────────────────────────────────────────────────────────────

export const congress = {
  /** All trades for a single ticker (house + senate combined) */
  getTradesForTicker: async (ticker: string): Promise<CongressTrade[]> => {
    try {
      return await fetchServerTradesForTickers([ticker], 365);
    } catch {
      const [house, senate] = await Promise.all([
        fetchHouse(ticker),
        fetchSenate(ticker),
      ]);
      return [...house, ...senate].sort((a, b) =>
        b.transactionDate.localeCompare(a.transactionDate)
      );
    }
  },

  /** Recent trades across multiple tickers — used on the Market Signals page */
  getTradesForTickers: async (
    tickers: string[],
    days = 90
  ): Promise<CongressTrade[]> => {
    try {
      return await fetchServerTradesForTickers(tickers, days);
    } catch {
      if (tickers.length === 0) return [];
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const all = await Promise.all(
        tickers.map(t => congress.getTradesForTicker(t))
      );

      return all
        .flat()
        .filter(t => t.transactionDate && new Date(t.transactionDate) >= cutoff)
        .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
    }
  },

  /**
   * Latest N trades across ALL house members — fetched server-side.
   * Server handles GitHub raw fetch (no CORS/403 issue).
   */
  getLatestTrades: async (limit = 60): Promise<CongressTrade[]> => {
    const res = await fetch(`/api/latest-congress?limit=${limit}`);
    if (!res.ok) throw new Error(`Congress data ${res.status}`);
    const json = await res.json();
    return (json.trades ?? []) as CongressTrade[];
  },

  getMemberActivity: async (days = 180): Promise<{ asOf: string; days: number; memberCount: number; members: CongressMemberActivity[] }> => {
    const res = await fetch(`/api/congress-members?days=${days}`);
    if (!res.ok) throw new Error(`Congress member data ${res.status}`);
    return res.json();
  },
};
