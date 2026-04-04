// Congress trading data via Senate Stock Watcher (GitHub-hosted aggregate)
// Senate: https://github.com/timothycarambat/senate-stock-watcher-data
// House: No reliable public data source — returns empty for now
// Direct fetch from GitHub raw (no proxy needed — CORS open on raw.githubusercontent.com)

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

// ── Module-level cache ────────────────────────────────────────────────────────
// Fetch the senate aggregate once per session (~3MB), then filter client-side.

interface SenateEntry {
  ticker: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transactions: any[];
}

let senateCache: SenateEntry[] | null = null;
let senateFetchPromise: Promise<void> | null = null;

const SENATE_URL =
  'https://raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/master/aggregate/all_ticker_transactions.json';

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
        senateCache = [];  // on error cache empty so we don't retry forever
        senateFetchPromise = null;
      });
  }
  await senateFetchPromise;
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

// House data: no reliable public source currently available
async function fetchHouse(_ticker: string): Promise<CongressTrade[]> {
  return [];
}

// ── Public API ────────────────────────────────────────────────────────────────

export const congress = {
  /** All trades for a single ticker (house + senate combined) */
  getTradesForTicker: async (ticker: string): Promise<CongressTrade[]> => {
    const [house, senate] = await Promise.all([
      fetchHouse(ticker),
      fetchSenate(ticker),
    ]);
    return [...house, ...senate].sort((a, b) =>
      b.transactionDate.localeCompare(a.transactionDate)
    );
  },

  /** Recent trades across multiple tickers — used on the Market Signals page */
  getTradesForTickers: async (
    tickers: string[],
    days = 90
  ): Promise<CongressTrade[]> => {
    if (tickers.length === 0) return [];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const all = await Promise.all(
      tickers.map(t => congress.getTradesForTicker(t))
    );

    return all
      .flat()
      .filter(t => t.transactionDate && new Date(t.transactionDate) >= cutoff)
      .sort((a, b) => b.transactionDate.localeCompare(a.transactionDate));
  },
};
