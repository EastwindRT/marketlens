/**
 * Maps TSX tickers (.TO suffix) to their US-listed equivalents.
 * Used to fetch SEC insider data for dual-listed Canadian companies
 * since Finnhub's insider endpoint only covers US filings.
 */
export const TSX_TO_US: Record<string, string> = {
  // Tech
  'SHOP.TO': 'SHOP',   // Shopify → Nasdaq
  'OTEX.TO': 'OTEX',   // Open Text → Nasdaq
  'BB.TO':   'BB',     // BlackBerry → NYSE
  'LSPD.TO': 'LSPD',   // Lightspeed → NYSE
  'DCBO.TO': 'DCBO',   // Docebo → Nasdaq
  'CDAY.TO': 'DAY',    // Dayforce (Ceridian) → NYSE
  'CLS.TO':  'CLS',    // Celestica → NYSE
  'CAE.TO':  'CAE',    // CAE → NYSE
  'GIB-A.TO':'GIB',    // CGI → NYSE

  // Banks & Finance
  'TD.TO':   'TD',     // TD Bank → NYSE
  'RY.TO':   'RY',     // Royal Bank → NYSE
  'BMO.TO':  'BMO',    // Bank of Montreal → NYSE
  'BNS.TO':  'BNS',    // Scotiabank → NYSE
  'CM.TO':   'CM',     // CIBC → NYSE
  'MFC.TO':  'MFC',    // Manulife → NYSE
  'SLF.TO':  'SLF',    // Sun Life → NYSE

  // Energy
  'ENB.TO':  'ENB',    // Enbridge → NYSE
  'TRP.TO':  'TRP',    // TC Energy → NYSE
  'CNQ.TO':  'CNQ',    // Canadian Natural → NYSE
  'SU.TO':   'SU',     // Suncor → NYSE
  'CVE.TO':  'CVE',    // Cenovus → NYSE

  // Rail & Infrastructure
  'CP.TO':   'CP',     // Canadian Pacific Kansas City → NYSE
  'CNR.TO':  'CNI',    // Canadian National Railway → NYSE

  // Utilities & Telecom
  'FTS.TO':  'FTS',    // Fortis → NYSE
  'EMA.TO':  'EMA',    // Emera → NYSE
  'BCE.TO':  'BCE',    // BCE → NYSE
  'T.TO':    'TU',     // TELUS → NYSE
  'RCI-B.TO':'RCI',    // Rogers → NYSE

  // Mining & Materials
  'ABX.TO':  'GOLD',   // Barrick Gold → NYSE
  'WPM.TO':  'WPM',    // Wheaton Precious Metals → NYSE
  'AEM.TO':  'AEM',    // Agnico Eagle → NYSE
  'K.TO':    'KGC',    // Kinross Gold → NYSE
  'FNV.TO':  'FNV',    // Franco-Nevada → NYSE
  'CCO.TO':  'CCJ',    // Cameco → NYSE
  'TECK-B.TO':'TECK',  // Teck Resources → NYSE
  'HBM.TO':  'HBM',    // HudBay Minerals → NYSE
  'PAAS.TO': 'PAAS',   // Pan American Silver → NYSE
  'NTR.TO':  'NTR',    // Nutrien → NYSE

  // Other
  'GFL.TO':  'GFL',    // GFL Environmental → NYSE
  'WCN.TO':  'WCN',    // Waste Connections → NYSE
  'QSR.TO':  'QSR',    // Restaurant Brands → NYSE
  'MG.TO':   'MGA',    // Magna International → NYSE
  'GIL.TO':  'GIL',    // Gildan Activewear → NYSE
  'GOOS.TO': 'GOOS',   // Canada Goose → NYSE
  'TRI.TO':  'TRI',    // Thomson Reuters → Nasdaq
  'DOO.TO':  'DOOO',   // BRP → Nasdaq
  'STN.TO':  'STN',    // Stantec → NYSE
  'BN.TO':   'BN',     // Brookfield Corp → NYSE
  'BAM.TO':  'BAM',    // Brookfield Asset Mgmt → NYSE
};

/**
 * Returns the Finnhub-compatible symbol for any ticker.
 * For Canadian .TO tickers: uses the mapped US ticker if known,
 * otherwise strips .TO (works for most dual-listed CA stocks).
 * For US tickers: returns as-is.
 */
export function getApiSymbol(symbol: string): string {
  if (!symbol.endsWith('.TO')) return symbol;
  // Use explicit mapping first (handles CNR→CNI, ABX→GOLD, etc.)
  if (TSX_TO_US[symbol]) return TSX_TO_US[symbol];
  // Fallback: strip .TO (works when TSX ticker = US ticker, e.g. TD, RY, BMO)
  return symbol.replace('.TO', '');
}

/**
 * Returns the US ticker to use for Finnhub insider data.
 * For dual-listed stocks, returns the US ticker.
 * For TSX-only stocks, returns null (no SEC data available).
 */
export function getInsiderTicker(symbol: string): string | null {
  if (TSX_TO_US[symbol]) return TSX_TO_US[symbol];
  if (symbol.endsWith('.TO')) return symbol.replace('.TO', '');
  return null;
}
