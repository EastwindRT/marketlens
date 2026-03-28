export function isMarketOpen(): boolean {
  const now = new Date();
  const nyTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = nyTime.getDay();
  const hours = nyTime.getHours();
  const minutes = nyTime.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // Monday-Friday, 9:30 AM - 4:00 PM ET
  if (day === 0 || day === 6) return false;
  return timeInMinutes >= 570 && timeInMinutes < 960;
}

export function getMarketStatus(): { open: boolean; label: string } {
  const open = isMarketOpen();
  return { open, label: open ? 'Market Open' : 'Market Closed' };
}

export function isTSXTicker(symbol: string): boolean {
  return symbol.endsWith('.TO') || symbol.endsWith('.TSX');
}

export function formatTicker(symbol: string): string {
  if (symbol.endsWith('.TO')) return symbol.replace('.TO', '');
  return symbol;
}
