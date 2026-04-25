import type { Edgar13DFiling } from './types';

export interface MarketFiling extends Edgar13DFiling {
  subjectCompany?: string; // the company whose shares are being reported on
  symbol?: string | null;
  sector?: string | null;
  industry?: string | null;
}

// ── Atom feed parsing ─────────────────────────────────────────────────────────
// Each filing appears twice: once "(Filed by)" = investor, once "(Subject)" = target company.
// Title format: "SCHEDULE 13D/A - Company Name (CIK) (Filed by|Subject)"
// Summary format: "Filed: 2026-03-27 AccNo: 0001104659-26-036346 Size: 32 KB"

interface AtomEntry {
  formType: string;       // "13D" | "13D/A" | "13G" | "13G/A"
  companyName: string;
  role: 'filer' | 'subject';
  filedDate: string;
  accNo: string;
  edgarUrl: string;
}

function parseAtomFeed(xml: string): MarketFiling[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const entries = Array.from(doc.querySelectorAll('entry'));

  const parsed: AtomEntry[] = [];

  for (const entry of entries) {
    const title      = entry.querySelector('title')?.textContent?.trim() ?? '';
    // summary type="html" — textContent contains literal HTML tags like <b>Filed:</b>
    // Strip them before applying regexes
    const summaryRaw = entry.querySelector('summary')?.textContent?.trim() ?? '';
    const summary    = summaryRaw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const href       = entry.querySelector('link')?.getAttribute('href') ?? '';

    // Parse title: "SCHEDULE 13D/A - Battalion Oil Corp (0001282648) (Subject)"
    const tm = title.match(/^SCHEDULE\s+(13[DG](?:\/A)?)\s+-\s+(.+?)\s+\(\d+\)\s+\((Filed by|Subject)\)$/i);
    if (!tm) continue;

    const dateMatch = summary.match(/Filed:\s*(\d{4}-\d{2}-\d{2})/i);
    const accMatch  = summary.match(/AccNo:\s*([\d]+-[\d]+-[\d]+)/i);

    parsed.push({
      formType:    tm[1].toUpperCase(),                        // "13D/A"
      companyName: tm[2].trim(),
      role:        tm[3].toLowerCase() === 'subject' ? 'subject' : 'filer',
      filedDate:   dateMatch?.[1] ?? '',
      accNo:       accMatch?.[1]  ?? '',
      edgarUrl:    href,
    });
  }

  // Group filer + subject by accession number, produce one MarketFiling per pair
  const byAcc = new Map<string, { filer?: AtomEntry; subject?: AtomEntry }>();
  for (const e of parsed) {
    if (!byAcc.has(e.accNo)) byAcc.set(e.accNo, {});
    const g = byAcc.get(e.accNo)!;
    if (e.role === 'subject') g.subject = e;
    else                      g.filer   = e;
  }

  const filings: MarketFiling[] = [];
  for (const [, g] of byAcc) {
    const base = g.subject ?? g.filer;
    if (!base) continue;
    filings.push({
      accessionNo:    base.accNo,
      formType:       base.formType,
      filedDate:      base.filedDate,
      edgarUrl:       base.edgarUrl,
      filerName:      g.filer?.companyName   ?? '—',
      subjectCompany: g.subject?.companyName,
      periodOfReport: undefined,
    });
  }

  return filings.filter(f => f.filedDate).sort((a, b) => b.filedDate.localeCompare(a.filedDate));
}

function parseCompanyFeed(xml: string): MarketFiling[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const subjectCompany = doc.querySelector('company-info > conformed-name')?.textContent?.trim() ?? '';
  const entries = Array.from(doc.querySelectorAll('entry'));

  return entries
    .map((entry) => {
      const filingType = entry.querySelector('content > filing-type')?.textContent?.trim() ?? '';
      const filingDate = entry.querySelector('content > filing-date')?.textContent?.trim() ?? '';
      const accessionNo = entry.querySelector('content > accession-number')?.textContent?.trim() ?? '';
      const edgarUrl =
        entry.querySelector('content > filing-href')?.textContent?.trim()
        || entry.querySelector('link')?.getAttribute('href')
        || '';

      if (!/^SCHEDULE\s+13[DG](?:\/A)?$/i.test(filingType)) return null;

      return {
        accessionNo,
        formType: filingType.replace(/^SCHEDULE\s+/i, '').toUpperCase(),
        filedDate: filingDate,
        edgarUrl,
        filerName: '',
        subjectCompany,
        periodOfReport: undefined,
      } as MarketFiling;
    })
    .filter((filing): filing is MarketFiling => Boolean(filing?.filedDate))
    .sort((a, b) => b.filedDate.localeCompare(a.filedDate));
}

async function fetchFiledByName(edgarUrl: string): Promise<string> {
  if (!edgarUrl) return '';

  try {
    const url = edgarUrl.startsWith('http')
      ? edgarUrl.replace('https://www.sec.gov', '/api/sec')
      : edgarUrl;
    const res = await fetch(url);
    if (!res.ok) return '';
    const html = await res.text();
    const match = html.match(/<span class="companyName">\s*([^<]+?)\s+\(Filed by\)/i);
    return match?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  } catch {
    return '';
  }
}

async function fetchFeed(formType: string, count = 80): Promise<MarketFiling[]> {
  const url = `/api/sec/cgi-bin/browse-edgar?action=getcurrent&type=${encodeURIComponent(formType)}&dateb=&owner=include&count=${count}&output=atom`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`SEC ${res.status}`);
  return parseAtomFeed(await res.text());
}

// ── Public API ────────────────────────────────────────────────────────────────

export const edgar = {
  /** Market-wide: all SCHEDULE 13D/G filings in the last N days */
  getRecentFilings: async (days = 7): Promise<MarketFiling[]> => {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [d, g, da, ga] = await Promise.allSettled([
      fetchFeed('SCHEDULE 13D'),
      fetchFeed('SCHEDULE 13G'),
      fetchFeed('SCHEDULE 13D/A'),
      fetchFeed('SCHEDULE 13G/A'),
    ]);

    const all: MarketFiling[] = [
      ...(d.status  === 'fulfilled' ? d.value  : []),
      ...(g.status  === 'fulfilled' ? g.value  : []),
      ...(da.status === 'fulfilled' ? da.value : []),
      ...(ga.status === 'fulfilled' ? ga.value : []),
    ];

    if (all.length === 0) throw new Error('No data from SEC EDGAR');

    // Deduplicate by accession number, filter to date window
    const seen = new Set<string>();
    return all
      .filter(f => {
        const key = f.accessionNo || `${f.filerName}-${f.filedDate}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return f.filedDate ? new Date(f.filedDate) >= cutoff : false;
      })
      .sort((a, b) => b.filedDate.localeCompare(a.filedDate));
  },

  /** Per-stock: 13D/G filings where this ticker is the subject company */
  get13DFilings: async (ticker: string): Promise<Edgar13DFiling[]> => {
    const clean = ticker.replace(/\.(TO|TSX)$/i, '');
    const url = `/api/sec/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(clean)}&type=SCHEDULE+13&dateb=&owner=include&count=20&output=atom`;
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const filings = parseCompanyFeed(await res.text());
      const enriched = await Promise.all(
        filings.map(async (filing) => ({
          ...filing,
          filerName: filing.filerName || await fetchFiledByName(filing.edgarUrl),
        }))
      );
      return enriched;
    } catch {
      return [];
    }
  },
};
