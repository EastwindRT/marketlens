export interface OHLCVBar {
  time: number | string; // Unix timestamp (intraday) or YYYY-MM-DD (daily+)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  c: number;   // current price
  d: number;   // change
  dp: number;  // change percent
  h: number;   // high
  l: number;   // low
  o: number;   // open
  pc: number;  // previous close
  t?: number;  // timestamp (optional — TMX doesn't provide this)
  v?: number;  // volume (not always present)
  // TMX extras (Canadian stocks only)
  _volume?:    number;
  _marketCap?: number;
  _exchange?:  string;
  _name?:      string;
}

export interface InsiderTransaction {
  name: string;
  title?: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string;  // normalised: 'P' | 'S' | 'A' | 'M' | 'F' | 'G' | …
  transactionPrice: number;
  rawCode?: string;         // original source code: SEC letter OR SEDI number string
  rawReason?: string;       // human-readable description from source
  isDerivative?: boolean;   // SEC: true = options/RSUs
}

export interface CompanyProfile {
  country: string;
  currency: string;
  exchange: string;
  ipo: string;
  marketCapitalization: number;
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
  logo: string;
  finnhubIndustry: string;
}

export interface SearchResult {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

export interface FinnhubCandleResponse {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  s: string;
  t: number[];
  v: number[];
}

export type TimeRange = '1D' | '1W' | '1M' | '3M' | '1Y' | 'ALL';
export type ChartType = 'area' | 'candlestick' | 'line';
export type InsiderFilter = 'all' | 'buy' | 'sell';

export interface NewsItem {
  id: string;
  headline: string;
  summary: string;
  source: string;
  url: string;
  datetime: number;   // unix timestamp (seconds)
  image?: string;
  category: string;
}

export interface AnalystRecommendation {
  buy: number;
  hold: number;
  period: string;
  sell: number;
  strongBuy: number;
  strongSell: number;
  symbol: string;
}

export interface PriceTarget {
  lastUpdated: string;
  targetHigh: number;
  targetLow: number;
  targetMean: number;
  targetMedian: number;
  symbol: string;
}

export interface EarningsSurprise {
  actual: number | null;
  estimate: number | null;
  period: string;
  surprise: number | null;
  surprisePercent: number | null;
  symbol: string;
}

export interface Edgar13DFiling {
  accessionNo: string;
  filerName: string;
  formType: string;
  filedDate: string;
  periodOfReport?: string;
  edgarUrl: string;
}

export interface InsiderFeedItem {
  id: string;
  symbol: string;
  companyName: string;
  insiderName: string;
  title?: string;
  type: 'BUY' | 'SELL' | 'OTHER';
  transactionDate: string;
  filingDate?: string;
  shares: number;
  pricePerShare: number;
  totalValue: number;
  market: 'US' | 'CA';
  exchange: string;
  source: string;
  filingUrl?: string;
}
