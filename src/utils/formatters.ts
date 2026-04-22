export const formatPrice = (n: number | null | undefined, currency = 'USD'): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
};

export const formatChange = (n: number): string =>
  `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

export const formatLargeNumber = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  return `$${n.toLocaleString()}`;
};

export const formatVolume = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toString();
};

export const formatDate = (dateStr: string): string => {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' });
};

export const formatDateTime = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  return date.toLocaleString('en-CA', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const formatPE = (pe: number | null | undefined): string => {
  if (!pe || pe <= 0) return 'N/A';
  return `${pe.toFixed(1)}x`;
};

export const formatInsiderValue = (shares: number, price: number): string => {
  return formatLargeNumber(Math.abs(shares * price));
};
