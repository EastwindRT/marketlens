import type { Edgar13DFiling } from './types';

export interface MarketFiling extends Edgar13DFiling {
  subjectCompany?: string;
}

// ── EFTS (efts.sec.gov) — market-wide filings feed ───────────────────────────

interface EftsSource {
  entity_name?: string;
  file_date?: string;
  form_type?: string;
  accession_no?: string;
  display_names?: string[];
  period_of_report?: string;
}

interface EftsHit { _id: string; _source: EftsSource }
interface EftsResponse { hits?: { total?: { value: number }; hits?: EftsHit[] } }

function eftsToFiling(hit: EftsHit): MarketFiling {
  const s = hit._source;
  const accNo = s.accession_no ?? hit._id ?? '';

  // Build direct link to filing index
  let edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(s.form_type ?? 'SC+13')}&dateb=&owner=include&count=40`;
  if (accNo) {
    const clean = accNo.replace(/-/g, '');
    const cik   = parseInt(clean.slice(0, 10), 10).toString();
    edgarUrl = `https://www.sec.gov/Archives/edgar/data/${cik}/${clean}/`;
  }

  // display_names[0] typically = "Subject Company Inc. (CIK 0000NNNNNN)"
  const rawDisplay = s.display_names?.[0] ?? '';
  const subjectCompany = rawDisplay.replace(/\s*\(CIK\s*[\d]+\)/i, '').trim() || undefined;

  return {
    accessionNo: accNo,
    filerName:   s.entity_name ?? 'Unknown',
    formType:    s.form_type   ?? 'SC 13',
    filedDate:   s.file_date   ?? '',
    periodOfReport: s.period_of_report,
    edgarUrl,
    subjectCompany,
  };
}

// ── SEC Atom feed (www.sec.gov) — per-stock subject-company search ────────────

const SEC_NS  = 'https://www.sec.gov/';
const SEC_NS2 = 'http://www.sec.gov/';

function getEl(entry: Element, tag: string): string {
  return (
    entry.getElementsByTagNameNS(SEC_NS,  tag)[0]?.textContent?.trim() ||
    entry.getElementsByTagNameNS(SEC_NS2, tag)[0]?.textContent?.trim() ||
    entry.getElementsByTagNameNS('*',     tag)[0]?.textContent?.trim() ||
    entry.getElementsByTagName(tag)[0]?.textContent?.trim() ||
    ''
  );
}

function parseAtom(xml: string): MarketFiling[] {
  const doc     = new DOMParser().parseFromString(xml, 'text/xml');
  const entries = Array.from(doc.querySelectorAll('entry'));

  return entries.flatMap(e => {
    const formType  = getEl(e, 'filing-type') || getEl(e, 'form-type');
    const filedDate = getEl(e, 'filing-date');
    const href      = getEl(e, 'filing-href');
    const accNo     = getEl(e, 'accession-number');
    const company   = getEl(e, 'company-name');

    // Fallback: parse title "SC 13D - COMPANY NAME (0000NNN)"
    const title        = e.querySelector('title')?.textContent?.trim() ?? '';
    const titleCompany = title.replace(/^SC\s+\S+\s+-\s+/i, '').replace(/\s*\(\d+\)\s*$/, '').trim();

    const subjectCompany = company || titleCompany || undefined;
    const edgarUrl       = href || `https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=SC+13&dateb=&owner=include&count=40`;

    if (!filedDate && !subjectCompany) return [];
    return [{ accessionNo: accNo, filerName: subjectCompany ?? 'Unknown', formType: formType || 'SC 13', filedDate, edgarUrl, subjectCompany }];
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const edgar = {

  // Market-wide: recent SC 13D/13G filings via EFTS full-text search.
  // "beneficial ownership" appears in every 13D/13G — used as the mandatory q param.
  getRecentFilings: async (days = 7): Promise<MarketFiling[]> => {
    const to   = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const forms = 'SC+13D%2CSC+13G%2CSC+13D%2FA%2CSC+13G%2FA';
    const url = `/api/edgar/LATEST/search-index?q=%22beneficial+ownership%22&forms=${forms}&dateRange=custom&startdt=${from}&enddt=${to}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`EDGAR ${res.status}`);

    const data: EftsResponse = await res.json();
    const hits = data.hits?.hits ?? [];
    if (hits.length === 0 && (data.hits?.total?.value ?? 0) === 0) {
      // Surface as empty (not error) — might just be a quiet filing week
      return [];
    }

    return hits
      .map(eftsToFiling)
      .filter(f => f.filedDate)
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  },

  // Per-stock: filings where this ticker is the subject company (via SEC Atom browse)
  get13DFilings: async (ticker: string): Promise<Edgar13DFiling[]> => {
    const clean = ticker.replace(/\.(TO|TSX)$/i, '');
    const url   = `/api/sec/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(clean)}&type=SC+13&dateb=&owner=include&count=20&output=atom`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      return parseAtom(await res.text());
    } catch {
      return [];
    }
  },
};
