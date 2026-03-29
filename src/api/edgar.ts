import type { Edgar13DFiling } from './types';

const EFTS = '/api/edgar';

interface EftsHit {
  _id: string;
  _source: {
    period_of_report?: string;
    entity_name?: string;
    file_date: string;
    form_type: string;
    accession_no?: string;
    display_names?: string[];
  };
}

interface EftsResponse {
  hits?: {
    total?: { value: number };
    hits?: EftsHit[];
  };
}

export interface MarketFiling extends Edgar13DFiling {
  subjectCompany?: string;   // extracted from display_names
}

function parseHit(hit: EftsHit): MarketFiling {
  const s = hit._source;
  const accNo = s.accession_no ?? '';
  let edgarUrl: string;
  if (accNo) {
    const accClean = accNo.replace(/-/g, '');
    const filerCik = parseInt(accClean.slice(0, 10), 10).toString();
    edgarUrl = `https://www.sec.gov/Archives/edgar/data/${filerCik}/${accClean}/`;
  } else {
    edgarUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&type=SC+13&dateb=&owner=include&count=10`;
  }
  // display_names contains subject company e.g. "Apple Inc. (CIK 0000320193)"
  const raw = s.display_names?.[0] ?? '';
  const subjectCompany = raw.replace(/\s*\(CIK\s*\d+\)/i, '').trim() || undefined;

  return {
    accessionNo: accNo,
    filerName: s.entity_name ?? 'Unknown',
    formType: s.form_type ?? 'SC 13D',
    filedDate: s.file_date ?? '',
    periodOfReport: s.period_of_report,
    edgarUrl,
    subjectCompany,
  };
}

export const edgar = {
  // Market-wide: all 13D/13G in the last N days (default 7)
  getRecentFilings: async (days = 7): Promise<MarketFiling[]> => {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const forms = 'SC+13D%2CSC+13G%2CSC+13D%2FA%2CSC+13G%2FA';
    const url = `${EFTS}/LATEST/search-index?forms=${forms}&dateRange=custom&startdt=${from}&enddt=${to}&hits.hits._source=entity_name,file_date,form_type,period_of_report,accession_no,display_names`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`EDGAR ${res.status}`);
    const data: EftsResponse = await res.json();
    return (data.hits?.hits ?? []).map(parseHit);
  },

  get13DFilings: async (ticker: string): Promise<Edgar13DFiling[]> => {
    const cleanTicker = ticker.replace('.TO', '').replace('.TSX', '');
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const forms = 'SC+13D%2CSC+13G%2CSC+13D%2FA%2CSC+13G%2FA';
    const url = `${EFTS}/LATEST/search-index?q=%22${encodeURIComponent(cleanTicker)}%22&forms=${forms}&dateRange=custom&startdt=${from}&enddt=${to}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`EDGAR ${res.status}`);
    const data: EftsResponse = await res.json();

    return (data.hits?.hits ?? []).map(parseHit);
  },
};
