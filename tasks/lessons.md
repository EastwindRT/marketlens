## Lesson: 2026-04-11 — EDGAR index.json does not exist for all filings

**Mistake:** Used `{accession}-index.json` URL pattern to discover XML files within an EDGAR 13F filing.
**Root cause:** This file does not exist on EDGAR S3 for many/most filers. The error is silently caught, docs stays empty, returns [].
**Rule:** Always use the HTML directory listing at `https://www.sec.gov/Archives/edgar/data/{cik}/{accClean}/` to discover filing documents. Parse `href="...\.xml"` links from the HTML. Exclude `primary_doc.xml` (cover page) — the info table is the other XML file.

---

## Lesson: 2026-04-11 — Senate Stock Watcher data is frozen at 2021

**Mistake:** Used `raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/...` as congress trade source.
**Root cause:** That repo was last updated ~2021. The Senate Stock Watcher site is now offline (domain expired 2026-04-08).
**Rule:** For congress trade data, use Quiver Quant `Bearer public` token at `https://api.quiverquant.com/beta/live/congresstrading`. Confirmed live with 2026-04-08 records. Set `Authorization: Bearer public` header. No signup required.

---

## Lesson: 2026-04-11 — 13f.info has no API

**Mistake:** Considered integrating 13f.info as a data enrichment source.
**Root cause:** 13f.info is a Rails web app (open source: github.com/toddwschneider/sec-13f-filings) with no public REST API. All endpoints return 404 or 406 for JSON requests.
**Rule:** For 13F holdings data, use EDGAR directly (`data.sec.gov` + `www.sec.gov/Archives/`). It's free, no rate limits with proper User-Agent, and 13f.info itself uses the same source.

---

## Lesson: 2026-04-13 — EDGAR daily company index is fixed-width, not pipe-delimited

**Mistake:** Filtered EDGAR daily index lines with `.includes('|')` and split by `|` to parse them.
**Root cause:** `www.sec.gov/Archives/edgar/daily-index/{year}/QTR{n}/company.{YYYYMMDD}.idx` uses a fixed-width format (company name = 62 chars, then form type, CIK, date, file path). It contains zero pipe characters. The full quarterly index (`full-index/`) uses the same format. Result: 0 entries parsed, endpoint silently returned `{trades:[]}`.
**Rule:** Parse EDGAR daily company index with a fixed-width regex: `/^(.{62})(.*?)\s+(\d{6,10})\s+(\d{8})\s+(edgar\/\S+)/`. Skip lines under 100 chars (header/blank). The URL format with a dot IS correct: `company.20260410.idx`.

---

## Lesson: 2026-04-13 — xmlMatch requires capture groups; use .test() for boolean XML flag checks

**Mistake:** Called `xmlMatch(xml, /<isDirector>\s*1\s*<\/isDirector>/i)` — a regex with no capture group — inside `inferOwnerTitle`.
**Root cause:** `xmlMatch` calls `match[1].trim()` on any truthy match. When the regex has no capture group, `match[1]` is `undefined` and `.trim()` throws. The bug was latent because `inferOwnerTitle` was only reached after fixing the index parser; 0 entries meant it was never called before.
**Rule:** For boolean XML presence checks (does tag contain value "1"?), use `.test()` directly: `/<isDirector>\s*1\s*<\/isDirector>/i.test(xml)`. Reserve `xmlMatch` for extracting capture group values.

---

## Lesson: 2026-04-11 — EDGAR CGI (www.sec.gov/cgi-bin) is IP-blocked from cloud providers

**Mistake:** Used `www.sec.gov/cgi-bin/browse-edgar` EDGAR company search endpoint from server-side.
**Root cause:** EDGAR CGI endpoints block AWS/Render IP ranges. Returns connection refused or a "Undeclared Automated Tool" HTML page.
**Rule:** Never use `www.sec.gov/cgi-bin/` endpoints from cloud-hosted servers. Use `data.sec.gov/submissions/CIK{padded}.json` for filing history (works fine) and `www.sec.gov/files/company_tickers.json` for ticker-to-name lookup (static file, works). HTML directory listings at `www.sec.gov/Archives/` also work.
