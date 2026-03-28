import type { OHLCVBar, Quote, InsiderTransaction } from '../api/types';
import type { TimeRange } from '../api/types';
import { getUnixTime, subDays, subMonths, subYears, addDays, format } from 'date-fns';

const BASE_PRICES: Record<string, number> = {
  'AAPL': 189.30,
  'SHOP.TO': 89.42,
  'TD.TO': 78.15,
  'MSFT': 415.20,
  'NVDA': 875.40,
  'GOOGL': 175.30,
  'AMZN': 185.20,
  'META': 480.10,
  'TSLA': 248.50,
  'RY.TO': 132.80,
};

function getBasePrice(symbol: string): number {
  return BASE_PRICES[symbol] || 100 + Math.random() * 200;
}

export function generateMockCandles(symbol: string, range: TimeRange): OHLCVBar[] {
  const basePrice = getBasePrice(symbol);
  const now = new Date();
  let startDate: Date;
  let bars: number;

  switch (range) {
    case '1D': startDate = subDays(now, 1); bars = 78; break;
    case '1W': startDate = subDays(now, 7); bars = 42; break;
    case '1M': startDate = subMonths(now, 1); bars = 30; break;
    case '3M': startDate = subMonths(now, 3); bars = 90; break;
    case '1Y': startDate = subYears(now, 1); bars = 252; break;
    case 'ALL': startDate = subYears(now, 5); bars = 1260; break;
    default: startDate = subMonths(now, 3); bars = 90;
  }

  const result: OHLCVBar[] = [];
  let price = basePrice * 0.8;
  const step = (now.getTime() - startDate.getTime()) / bars;

  const isIntraday = range === '1D' || range === '1W';

  for (let i = 0; i < bars; i++) {
    const date = new Date(startDate.getTime() + step * i);
    const time = isIntraday
      ? Math.floor(date.getTime() / 1000)
      : format(date, 'yyyy-MM-dd');
    const volatility = price * 0.02;
    const change = (Math.random() - 0.48) * volatility;
    const open = price;
    price = Math.max(price + change, 1);
    const high = Math.max(open, price) + Math.random() * volatility * 0.5;
    const low = Math.min(open, price) - Math.random() * volatility * 0.5;
    const volume = Math.floor(1000000 + Math.random() * 5000000);

    result.push({ time, open, high, low, close: price, volume });
  }

  return result;
}

export function generateMockQuote(symbol: string): Quote {
  const basePrice = getBasePrice(symbol);
  const change = (Math.random() - 0.48) * basePrice * 0.025;
  const prevClose = basePrice - change;
  return {
    c: basePrice,
    d: change,
    dp: (change / prevClose) * 100,
    h: basePrice * 1.01,
    l: basePrice * 0.99,
    o: prevClose * 1.002,
    pc: prevClose,
    t: Math.floor(Date.now() / 1000),
  };
}

export function generateMockProfile(symbol: string) {
  const profiles: Record<string, any> = {
    'AAPL': { name: 'Apple Inc.', ticker: 'AAPL', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 2950000, shareOutstanding: 15441.88, finnhubIndustry: 'Technology', country: 'US', logo: '' },
    'SHOP.TO': { name: 'Shopify Inc.', ticker: 'SHOP', exchange: 'TSX', currency: 'CAD', marketCapitalization: 114200, shareOutstanding: 1271.5, finnhubIndustry: 'Technology', country: 'CA', logo: '' },
    'TD.TO': { name: 'Toronto-Dominion Bank', ticker: 'TD', exchange: 'TSX', currency: 'CAD', marketCapitalization: 142000, shareOutstanding: 1820.3, finnhubIndustry: 'Finance', country: 'CA', logo: '' },
    'MSFT': { name: 'Microsoft Corporation', ticker: 'MSFT', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 3080000, shareOutstanding: 7430.2, finnhubIndustry: 'Technology', country: 'US', logo: '' },
    'NVDA': { name: 'NVIDIA Corporation', ticker: 'NVDA', exchange: 'NASDAQ', currency: 'USD', marketCapitalization: 2150000, shareOutstanding: 2460.8, finnhubIndustry: 'Technology', country: 'US', logo: '' },
  };
  return profiles[symbol] || {
    name: symbol,
    ticker: symbol,
    exchange: 'NASDAQ',
    currency: 'USD',
    marketCapitalization: 50000 + Math.random() * 500000,
    shareOutstanding: 1000 + Math.random() * 5000,
    finnhubIndustry: 'Technology',
    country: 'US',
    logo: '',
  };
}

const INSIDER_NAMES = [
  { name: 'Timothy D. Cook', role: 'CEO' },
  { name: 'Luca Maestri', role: 'CFO' },
  { name: 'Katherine Adams', role: 'SVP General Counsel' },
  { name: 'Deirdre O\'Brien', role: 'SVP Retail' },
  { name: 'Craig Federighi', role: 'SVP Software Engineering' },
];

export function generateMockInsiders(symbol: string): InsiderTransaction[] {
  const result: InsiderTransaction[] = [];
  const basePrice = getBasePrice(symbol);
  const now = new Date();

  for (let i = 0; i < 15; i++) {
    const daysAgo = Math.floor(Math.random() * 180);
    const date = subDays(now, daysAgo);
    const insider = INSIDER_NAMES[Math.floor(Math.random() * INSIDER_NAMES.length)];
    const isBuy = Math.random() > 0.6;
    const shares = Math.floor(1000 + Math.random() * 50000);
    const price = basePrice * (0.9 + Math.random() * 0.2);

    result.push({
      name: insider.name,
      title: insider.role,
      share: isBuy ? shares : -shares,
      change: isBuy ? shares : -shares,
      filingDate: format(date, 'yyyy-MM-dd'),
      transactionDate: format(subDays(date, Math.floor(Math.random() * 3)), 'yyyy-MM-dd'),
      transactionCode: isBuy ? 'P' : 'S',
      transactionPrice: price,
    });
  }

  return result.sort((a, b) => new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime());
}
