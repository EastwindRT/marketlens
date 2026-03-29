import type { Edgar13DFiling } from './types';

const SEC = '/api/sec';

export interface MarketFiling extends Edgar13DFiling {
  subjectCompany?: string;
}

// ── XML parsing helpers ───────────────────────────────────────────────────────

const SEC_NS = 'https://www.sec.gov/';

function getSecEl(entry: Element, tag: string): string {
  return (
    entry.getElementsByTagNameNS(SEC_NS, tag)[0]?.textContent?.trim() ??
    entry.getElementsByTagName(tag)[0]?.textContent?.trim() ??
    ''
  );
}

function parseAtom(xml: string): MarketFiling[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entries = Array.from(doc.querySelectorAll('entry'));

  return entries.flatMap(entry => {
    const formType   = getSecEl(entry, 'filing-type')  || getSecEl(entry, 'form-type');
    const filedDate  = getSecEl(entry, 'filing-date');
    const filingHref = getSecEl(entry, 'filing-href');
    const accNo      = getSecEl(entry, 'accession-number');
    // In EDGAR browse feeds, company-name is the SUBJECT company (whose shares were acquired)
    const companyName = getSecEl(entry, 'company-name');

    // Also try parsing filer info from the <title> e.g. "SC 13D - APPLE INC (0000320193)"
    const titleText = entry.querySelector('title')?.textContent?.trim() ?? '';
    // Title format: "FORM_TYPE - COMPANY NAME (CIK)" or "FORM_TYPE - COMPANY NAME"
    const titleMatch = titleText.match(/^(?:SC\s+13\w+\/?\w*)\s+-\s+(.+?)(?:\s+\(\d+\))?$/i);
    const titleCompany = titleMatch?.[1]?.trim();

    const subjectCompany = companyName || titleCompany || undefined;
    const edgarUrl = filingHref ||
      (accNo ? `https://www.sec.gov/Archives/edgar/data/${parseInt(accNo.replace(/-/g, '').slice(0, 10), 10)}/${accNo.replace(/-/g, '')}/` : '#');

    if (!filedDate && !subjectCompany) return [];

    return [{
      accessionNo: accNo,
      filerName: subjectCompany ?? 'Unknown',   // in current-feed context company = subject
      formType: formType || 'SC 13',
      filedDate,
      periodOfReport: undefined,
      edgarUrl,
      subjectCompany,
    }];
  });
}

async function fetchAtom(url: string): Promise<MarketFiling[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SEC ${res.status}`);
  const text = await res.text();
  return parseAtom(text);
}

// ── Public API ────────────────────────────────────────────────────────────────

export const edgar = {
  // Market-wide: recent 13D, 13G and amendments — merged and sorted newest first
  getRecentFilings: async (days = 7): Promise<MarketFiling[]> => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // Fetch 13D, 13G, and amendment variants in parallel
    const base = `${SEC}/cgi-bin/browse-edgar?action=getcurrent&dateb=&owner=include&count=40&output=atom`;
    const [d, g, da, ga] = await Promise.allSettled([
      fetchAtom(`${base}&type=SC+13D`),
      fetchAtom(`${base}&type=SC+13G`),
      fetchAtom(`${base}&type=SC+13D%2FA`),
      fetchAtom(`${base}&type=SC+13G%2FA`),
    ]);

    const all: MarketFiling[] = [
      ...(d.status  === 'fulfilled' ? d.value  : []),
      ...(g.status  === 'fulfilled' ? g.value  : []),
      ...(da.status === 'fulfilled' ? da.value : []),
      ...(ga.status === 'fulfilled' ? ga.value : []),
    ];

    // Deduplicate by accession number, filter by date window, sort newest first
    const seen = new Set<string>();
    return all
      .filter(f => {
        if (!f.filedDate) return false;
        if (new Date(f.filedDate) < cutoff) return false;
        const key = f.accessionNo || `${f.filerName}-${f.filedDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  },

  // Per-stock: 13D/13G filings where this ticker is the subject company
  get13DFilings: async (ticker: string): Promise<Edgar13DFiling[]> => {
    const clean = ticker.replace('.TO', '').replace('.TSX', '');
    const url = `${SEC}/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(clean)}&type=SC+13&dateb=&owner=include&count=20&output=atom`;
    try {
      return await fetchAtom(url);
    } catch {
      return [];
    }
  },
};
