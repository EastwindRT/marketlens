## Plan: 13F Fund Holdings — Bug Fix + Enhanced UI

### Context
- Market Signals: ✅ working
- Congress Trades: ✅ fixed (Quiver Quant live data, 2026-04-11)
- 13F Fund Holdings: name search works; portfolio/values return empty

---

### Root Cause Diagnosis (confirmed)

`fetchHoldings(cik, accession)` in `server.cjs` constructs:
```
https://www.sec.gov/Archives/edgar/data/{cik}/{accClean}/{accession}-index.json
```
This file does NOT exist on EDGAR's S3 for many/most filers (tested Berkshire CIK 1067983 — returns `NoSuchKey`).
The catch block fires, `docs = []`, no XML is found, `infoTableUrl = null`, returns `[]`.

The HTML directory listing at:
```
https://www.sec.gov/Archives/edgar/data/{cik}/{accClean}/
```
DOES work and contains `href` links to both XML files (e.g. `50240.xml`, `primary_doc.xml`).

The info table XML uses plain `<infoTable>` tags (no namespace prefix) — existing parser is correct.
Values in XML are in thousands of USD — existing `* 1000` multiplication is correct.

---

### Step 1 — Fix `fetchHoldings` in `server.cjs` [ ]

Replace index.json approach with HTML directory scrape:

```javascript
async function fetchHoldings(cik, accession) {
  const cikClean = cik.toString().replace(/^0+/, '');
  const accClean = accession.replace(/-/g, '');
  const dirUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/`;
  
  let infoTableUrl = null;
  try {
    const html = await httpsGet(dirUrl, { 'User-Agent': 'TARS admin@tars.app' });
    // Extract all XML hrefs, exclude primary_doc.xml (cover page, not holdings)
    const matches = [...html.matchAll(/href="([^"]+\.xml)"/gi)].map(m => m[1]);
    const infoFile = matches.find(href => !href.toLowerCase().includes('primary_doc'));
    if (infoFile) {
      const filename = infoFile.split('/').pop();
      infoTableUrl = `https://www.sec.gov/Archives/edgar/data/${cikClean}/${accClean}/${filename}`;
    }
  } catch (e) {
    console.error('[13f/dir]', e.message);
  }
  
  if (!infoTableUrl) return [];
  const xml = await httpsGet(infoTableUrl, { 'User-Agent': 'TARS admin@tars.app' });
  return parse13FXml(xml);
}
```

Verify: curl test against Berkshire (CIK 1067983) should return Apple, Coca-Cola, etc. with non-zero values.

---

### Step 2 — Add quarter-over-quarter change field to server response [ ]

Currently: `isNew: true/false` (boolean — new position vs not)
Need: `changeType: 'new' | 'increased' | 'decreased' | 'unchanged' | 'exited'` + `changePct: number`

In the `withFlags` map in `/api/13f/holdings`:
```javascript
const prevMap = new Map((previous ?? []).map(h => [h.cusip || h.name.toUpperCase(), h]));

const withFlags = current.map(h => {
  const key = h.cusip || h.name.toUpperCase();
  const prev = prevMap.get(key);
  let changeType = 'unchanged';
  let changePct = 0;
  if (!previous) { changeType = 'unknown'; }
  else if (!prev) { changeType = 'new'; }
  else {
    changePct = prev.shares > 0 ? ((h.shares - prev.shares) / prev.shares) * 100 : 0;
    if (changePct > 1) changeType = 'increased';
    else if (changePct < -1) changeType = 'decreased';
    else changeType = 'unchanged';
  }
  return { ...h, isNew: changeType === 'new', changeType, changePct, pctOfPortfolio: totalValue > 0 ? (h.value / totalValue) * 100 : 0 };
});
```

Also add to response: list of `exited` positions (in previous but not in current):
```javascript
const currentCusips = new Set(current.map(h => h.cusip).filter(Boolean));
const exited = (previous ?? []).filter(h => h.cusip && !currentCusips.has(h.cusip))
  .map(h => ({ ...h, changeType: 'exited' }));
// Add to response as separate array
```

---

### Step 3 — Update `Funds.tsx` — UI improvements [ ]

**3a. Holding row: add change indicator column**
- Show `▲ +12%` in green or `▼ -8%` in red next to shares
- `NEW` badge stays; add `EXITED` section at bottom of table

**3b. Options section redesign**
Currently: single "Options" tab mixing calls and puts
New: within Options tab, split into two sub-sections:
```
CALLS (23)          PUTS (15)
NVDA Call $45M      SPY Put $120M
MSFT Call $12M      QQQ Put $80M
...                 ...
```
Each row shows: ticker name, value, shares, % of portfolio

**3c. Sector breakdown — make it richer**
Currently: horizontal bar chart with % labels
Add below each sector bar: top 2-3 holdings in that sector as small chips
e.g.  `Technology  ████████  42.1%   [AAPL] [MSFT] [NVDA]`

**3d. Summary stat cards — add QoQ change card**
Add: `New Positions`, `Increased`, `Decreased`, `Exited` as 4 stat cards
(already have New count; add the others from changeType counts)

---

### Step 4 — Verify end-to-end and push [ ]

1. Locally test: `npm run build && node server.cjs` → hit `/api/13f/holdings?cik=1067983`
2. Confirm response has non-empty `current` array with `value > 0` for Apple, Coke, etc.
3. Check options parsing — Berkshire has no options, try a fund that does (e.g. Citadel CIK 1423053)
4. Push to GitHub → verify Render deploy succeeds

---

### Step 5 — Note on 13f.info integration [ ]
**Decision: Not applicable.** 13f.info has no public API (confirmed). It's a Rails web app
backed by EDGAR — same source we already use directly. No integration needed.

---

## Review
- What worked:
- What to improve:
