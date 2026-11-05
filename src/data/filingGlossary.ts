// Plain-English reference for the filing types TARS covers (and the common ones it does not).
// Deadlines and thresholds are the general rules; check the SEC / CSA rule text for edge cases.

export type Coverage = 'triaged' | 'shown' | 'not_covered';
export type Market = 'US' | 'CA';

export interface GlossaryEntry {
  id: string;
  form: string;
  name: string;
  market: Market;
  coverage: Coverage;
  summary: string;
  whoFiles: string;
  deadline: string;
  whyItMatters: string;
  lookFor?: string[];
  tarsNote: string;
}

export const COVERAGE_META: Record<Coverage, { label: string; description: string }> = {
  triaged: { label: 'Scored by TARS', description: 'Discovered automatically, scored 0-100 by Jev, and appears in the Filings feed.' },
  shown: { label: 'Shown, not scored', description: 'Has its own page, but is not scored or ranked in the Filings feed.' },
  not_covered: { label: 'Not covered', description: 'Common filing TARS does not read yet. Listed so you know what you are not seeing.' },
};

export const GLOSSARY: GlossaryEntry[] = [
  // ── Scored by TARS (US) ────────────────────────────────────────────────────
  {
    id: 'sch-13d',
    form: 'Schedule 13D (and 13D/A)',
    name: 'Beneficial ownership report - active holder',
    market: 'US',
    coverage: 'triaged',
    summary:
      'Filed when a person or group acquires more than 5% of a company\'s voting shares and may want to influence it. The 13D/A is the amendment filed when something material changes (a bigger stake, a new plan, a deal).',
    whoFiles: 'Activist funds, acquirers, founders, and any holder above 5% who is not eligible for the passive 13G.',
    deadline: 'Within 5 business days of crossing 5%. Amendments within 2 business days of a material change.',
    whyItMatters:
      'It is the clearest public signal that someone is building a stake for a reason. Item 4, "Purpose of Transaction", is the section to read: it says whether the holder plans to seek board seats, push a sale, or just invest.',
    lookFor: [
      'Item 4 language about board representation, a sale of the company, or "strategic alternatives"',
      'A brand-new filing (new position) rather than an amendment',
      'Known activists as the filer',
      'Stake size and how fast it grew between amendments',
    ],
    tarsNote:
      'Scored on investor type (activist / passive / strategic), board or strategic intent, new vs. routine, and mechanical index crossings. Signalled intent lifts the priority to at least 85. Written AI read for the material ones.',
  },
  {
    id: 'sch-13g',
    form: 'Schedule 13G (and 13G/A)',
    name: 'Beneficial ownership report - passive holder',
    market: 'US',
    coverage: 'triaged',
    summary:
      'The short-form version of the 13D, for investors above 5% who are passive: index funds, asset managers and other institutions with no plan to influence the company.',
    whoFiles: 'BlackRock, Vanguard, State Street and similar institutions; passive individual holders under 20%.',
    deadline:
      'Institutional filers: within 45 days after the end of the calendar quarter in which they crossed 5%. Other passive holders: within 5 business days. Amendments for material changes are due 45 days after quarter end.',
    whyItMatters:
      'Mostly routine. It becomes interesting when a 13G filer switches to a 13D (the investor has stopped being passive), when a well-known concentrated fund appears, or when a stake changes sharply.',
    lookFor: ['A 13G followed soon after by a 13D from the same filer', 'Large jumps or drops in stake', 'Concentrated, non-index funds as filers'],
    tarsNote:
      'Most routine passive crossings score low and are hidden by default. The classifier flags "mechanical crossing" so index-fund noise sinks.',
  },
  {
    id: 'form-4',
    form: 'Form 4',
    name: 'Statement of changes in beneficial ownership (insider trades)',
    market: 'US',
    coverage: 'triaged',
    summary:
      'Reports a trade or other change in the holdings of a company insider: an officer, a director, or an owner of more than 10% of the shares.',
    whoFiles: 'Officers, directors and 10% owners of US-listed companies.',
    deadline: 'Within 2 business days of the transaction.',
    whyItMatters:
      'Insiders sell for many reasons (taxes, diversification, scheduled plans) but usually buy for one: they expect the stock to go up. Open-market purchases, especially several insiders at once, are the strongest signal. Most Form 4s are routine and carry no signal.',
    lookFor: [
      'Transaction code P (open-market purchase), especially by the CEO or CFO',
      'Cluster buying: three or more insiders buying within a short window',
      'Large purchases relative to the insider\'s existing holdings',
      'Sales NOT under a pre-arranged 10b5-1 plan, or unusually large sales by the CEO',
    ],
    tarsNote:
      'Filings with no discretionary buy or sell (grants, tax withholding, option exercises only) are skipped as mechanical. The rest are scored on role, conviction, and 10b5-1 plan. Cluster buys get a priority floor of 70.',
  },
  {
    id: 'form-8k',
    form: 'Form 8-K (and 8-K/A)',
    name: 'Current report',
    market: 'US',
    coverage: 'triaged',
    summary:
      'The way US public companies announce events that could matter to shareholders, between their regular quarterly and annual reports. Each 8-K lists one or more numbered "Items" saying what happened (see the Item table below).',
    whoFiles: 'Any SEC-registered US company (Canadian cross-listed companies usually file 6-K instead).',
    deadline: 'Within 4 business days of the event.',
    whyItMatters:
      'It is where bad news and deal news first appear in a filing: bankruptcy, a restatement, an executive resigning, an acquisition, a delisting notice. The Item numbers tell you quickly which kind it is.',
    lookFor: [
      'Item 1.03 (bankruptcy), 2.04 (debt acceleration), 3.01 (delisting notice), 4.02 (restatement)',
      'Item 1.01 or 2.01 (deal signed or completed), 5.01 (change in control)',
      'Item 5.02 (executive or director leaving), especially a sudden CEO or CFO exit',
      'Item 2.02 results are usually pre-announced; the surprise is in the guidance',
    ],
    tarsNote:
      'Atom entries whose items are all routine (9.01 exhibits, 7.01 Reg FD, 5.07 vote results) are skipped. The rest are classified into an event type, with distress events (bankruptcy, going concern, delisting, restatement) given a priority floor of 80.',
  },

  // ── Shown, not scored ──────────────────────────────────────────────────────
  {
    id: 'congress-ptr',
    form: 'Periodic Transaction Report',
    name: 'US Congress trade disclosure (STOCK Act)',
    market: 'US',
    coverage: 'shown',
    summary:
      'Members of the US House and Senate must publicly report stock trades made by themselves, their spouses and dependent children.',
    whoFiles: 'Members of Congress (and certain senior staff).',
    deadline: 'Within 30 days of learning of the trade, and no later than 45 days after it happened.',
    whyItMatters:
      'It can show lawmakers trading in sectors they oversee. The delay, and the fact that amounts are reported only as ranges, make it a slow and imprecise signal rather than a timing tool.',
    lookFor: ['Several members trading the same name', 'Trades in the sector of a member\'s committee', 'Large purchase ranges'],
    tarsNote: 'Has its own Congress Trades page, with estimated returns. It is not scored by Jev and is not in the Filings feed.',
  },
  {
    id: 'sedi',
    form: 'SEDI insider report',
    name: 'Canadian insider trading report',
    market: 'CA',
    coverage: 'shown',
    summary:
      'Canada\'s equivalent of the Form 4. Insiders of Canadian reporting issuers report trades through SEDI (the System for Electronic Disclosure by Insiders).',
    whoFiles: 'Officers, directors and 10% holders of Canadian reporting issuers.',
    deadline: 'Within 5 calendar days of the trade (initial reports within 10 days of becoming an insider).',
    whyItMatters:
      'Same logic as Form 4: open-market buying by insiders is the signal. SEDI uses transaction codes (for example, 10 is an acquisition in the public market and 51 is an exercise of options); the trade direction is given by the sign of the amount.',
    lookFor: ['Open-market purchases by executives', 'Clusters of buys', 'Large sales outside normal option-exercise patterns'],
    tarsNote:
      'Shown on the Insider $ page ("CA Insiders" open-market trades, "CA Filings" all transaction types) for a curated list of TSX stocks. Not scored by Jev and not in the Filings feed.',
  },

  // ── Not covered (US) ───────────────────────────────────────────────────────
  {
    id: 'form-3',
    form: 'Form 3',
    name: 'Initial statement of beneficial ownership',
    market: 'US',
    coverage: 'not_covered',
    summary: 'The first filing an insider makes, listing everything they own when they become an officer, director or 10% owner.',
    whoFiles: 'New insiders.',
    deadline: 'Within 10 days of becoming an insider (on the day of an IPO for new public companies).',
    whyItMatters: 'Shows a new insider\'s starting position, and a sudden appointment of an experienced executive or director.',
    tarsNote: 'Not read yet.',
  },
  {
    id: 'form-5',
    form: 'Form 5',
    name: 'Annual statement of changes in beneficial ownership',
    market: 'US',
    coverage: 'not_covered',
    summary: 'Catches insider transactions that were exempt from earlier reporting, such as small gifts, once a year.',
    whoFiles: 'Insiders with unreported items.',
    deadline: 'Within 45 days after the company\'s fiscal year end.',
    whyItMatters: 'Rarely a trading signal; mostly housekeeping.',
    tarsNote: 'Not read yet.',
  },
  {
    id: 'form-144',
    form: 'Form 144',
    name: 'Notice of proposed sale of restricted securities',
    market: 'US',
    coverage: 'not_covered',
    summary: 'A heads-up that an insider or affiliate intends to sell restricted or control shares under Rule 144.',
    whoFiles: 'Affiliates and holders of restricted stock before selling.',
    deadline: 'At the time the sale order is placed.',
    whyItMatters: 'It arrives before the Form 4, so it is an early warning of insider selling.',
    tarsNote: 'Not read yet.',
  },
  {
    id: 'form-10k',
    form: 'Form 10-K',
    name: 'Annual report',
    market: 'US',
    coverage: 'not_covered',
    summary: 'The full audited annual report: business description, risks, financial statements and management\'s discussion.',
    whoFiles: 'US public companies.',
    deadline: '60 to 90 days after fiscal year end, depending on company size.',
    whyItMatters: 'The deepest source on a company. Changes in the Risk Factors section, auditor opinions and going-concern language are worth reading.',
    tarsNote: 'Not read yet.',
  },
  {
    id: 'form-10q',
    form: 'Form 10-Q',
    name: 'Quarterly report',
    market: 'US',
    coverage: 'not_covered',
    summary: 'Unaudited quarterly financial statements and management discussion.',
    whoFiles: 'US public companies, for each of the first three fiscal quarters.',
    deadline: '40 to 45 days after quarter end, depending on company size.',
    whyItMatters: 'Confirms the earnings release and sometimes reveals details (debt, legal matters, share counts) that the press release leaves out.',
    tarsNote: 'Not read yet.',
  },
  {
    id: 'form-13f',
    form: 'Form 13F-HR',
    name: 'Institutional holdings report',
    market: 'US',
    coverage: 'not_covered',
    summary: 'A quarterly list of the US-listed stocks held by large investment managers.',
    whoFiles: 'Institutional managers with more than $100 million in qualifying assets.',
    deadline: 'Within 45 days after each calendar quarter end.',
    whyItMatters: 'Shows what big funds owned at quarter end. It is stale by the time it is filed, so it shows positioning, not timing.',
    tarsNote: 'Removed from TARS in the filings-only cleanup (it used to power the Funds page).',
  },
  {
    id: 'sc-to',
    form: 'Schedule TO / 14D-9',
    name: 'Tender offer filings',
    market: 'US',
    coverage: 'not_covered',
    summary: 'Schedule TO is filed by a buyer making a tender offer directly to shareholders; Schedule 14D-9 is the target company\'s response and recommendation.',
    whoFiles: 'The bidder (TO) and the target company (14D-9).',
    deadline: 'On launch of the offer; the target responds within 10 business days.',
    whyItMatters: 'A tender offer is a live takeover attempt, usually at a premium. The 14D-9 says whether the board recommends accepting.',
    tarsNote: 'Not read yet. Many offers also show up as an 8-K Item 1.01 or 8.01.',
  },
  {
    id: 'form-s1',
    form: 'Form S-1',
    name: 'Registration statement (IPO)',
    market: 'US',
    coverage: 'not_covered',
    summary: 'The filing a company uses to register shares for an initial public offering or other public sale.',
    whoFiles: 'Companies going public or raising capital.',
    deadline: 'Before the offering.',
    whyItMatters: 'The first detailed look at a private company\'s financials, risks and ownership.',
    tarsNote: 'Not read yet.',
  },
  {
    id: 'form-def14a',
    form: 'DEF 14A',
    name: 'Definitive proxy statement',
    market: 'US',
    coverage: 'not_covered',
    summary: 'The document sent to shareholders before an annual or special meeting: director nominees, executive pay, shareholder proposals and voting items.',
    whoFiles: 'US public companies.',
    deadline: 'Before the meeting, typically 30 to 60 days ahead (varies by company and delivery method).',
    whyItMatters: 'Shows executive pay, the board slate, and any proxy fight or activist proposal. A contested proxy ("DEFC14A") is a strong activist signal.',
    tarsNote: 'Not read yet.',
  },
  {
    id: 'form-6k',
    form: 'Form 6-K / 20-F / 40-F',
    name: 'Foreign private issuer reports',
    market: 'US',
    coverage: 'not_covered',
    summary: 'Non-US companies listed in the US file a 6-K for current events (like an 8-K), and a 20-F or 40-F annual report instead of a 10-K. Many Canadian cross-listed companies file 6-K and 40-F.',
    whoFiles: 'Foreign private issuers, including Canadian companies listed on US exchanges.',
    deadline: '6-K promptly after the company publishes the news at home; 20-F within 4 months of year end; 40-F within 3 to 4 months.',
    whyItMatters: 'It is the only SEC-side window into cross-listed Canadian and foreign names, which do not file 8-Ks.',
    tarsNote: 'Not read yet. This is why cross-listed Canadian stocks produce no 8-K rows in the feed.',
  },

  // ── Not covered (Canada) ───────────────────────────────────────────────────
  {
    id: 'ca-ewr',
    form: 'Early warning report',
    name: 'Canadian significant-holder report (NI 62-103)',
    market: 'CA',
    coverage: 'not_covered',
    summary:
      'Canada\'s rough equivalent of the Schedule 13D. A buyer who reaches 10% of a class of voting or equity securities (and later each further 2% change) must announce it and file a report.',
    whoFiles: 'Anyone crossing the 10% threshold in a Canadian reporting issuer.',
    deadline: 'News release promptly, and the report within 2 business days.',
    whyItMatters: 'The earliest public sign of a stake-builder, an activist, or a strategic buyer in a Canadian company. The purpose section says why the holder is buying.',
    tarsNote: 'Not read yet. Filed on SEDAR+.',
  },
  {
    id: 'ca-mcr',
    form: 'Material change report',
    name: 'Canadian current report (NI 51-102)',
    market: 'CA',
    coverage: 'not_covered',
    summary:
      'Canada\'s rough equivalent of the 8-K. A Canadian reporting issuer must disclose a change in its business, operations or capital that would reasonably affect its share price.',
    whoFiles: 'Canadian reporting issuers.',
    deadline: 'News release immediately; the report within 10 days.',
    whyItMatters: 'Covers acquisitions, financings, major contract losses, management changes and other events. The news release usually comes first.',
    tarsNote: 'Not read yet. Filed on SEDAR+, which has no free structured feed comparable to EDGAR\'s.',
  },
];

// ── Reference tables ─────────────────────────────────────────────────────────

export type Weight = 'high' | 'medium' | 'low';

export interface ItemRow {
  code: string;
  meaning: string;
  weight: Weight;
  note: string;
}

export const EIGHT_K_ITEMS: ItemRow[] = [
  { code: '1.01', meaning: 'Entry into a material definitive agreement', weight: 'high', note: 'Merger agreements, major contracts, credit facilities.' },
  { code: '1.02', meaning: 'Termination of a material agreement', weight: 'medium', note: 'Loss of a key customer or partner, or a deal falling through.' },
  { code: '1.03', meaning: 'Bankruptcy or receivership', weight: 'high', note: 'Chapter 11 or 7 filing.' },
  { code: '1.05', meaning: 'Material cybersecurity incident', weight: 'high', note: 'Breach disclosures; later amended as the impact becomes clear.' },
  { code: '2.01', meaning: 'Completion of an acquisition or disposition of assets', weight: 'high', note: 'A deal has closed.' },
  { code: '2.02', meaning: 'Results of operations and financial condition', weight: 'medium', note: 'The earnings release. Read the guidance, not just the numbers.' },
  { code: '2.03', meaning: 'Creation of a direct financial obligation', weight: 'medium', note: 'New debt, notes or credit lines.' },
  { code: '2.04', meaning: 'Triggering events that accelerate an obligation', weight: 'high', note: 'A covenant breach or default that makes debt due early.' },
  { code: '2.05', meaning: 'Costs of exit or disposal activities', weight: 'medium', note: 'Restructuring, layoffs, plant closures.' },
  { code: '2.06', meaning: 'Material impairments', weight: 'medium', note: 'Write-downs of goodwill or assets.' },
  { code: '3.01', meaning: 'Notice of delisting or failure to meet a listing rule', weight: 'high', note: 'Exchange deficiency notice; often a distress signal.' },
  { code: '3.02', meaning: 'Unregistered sales of equity securities', weight: 'medium', note: 'Private placements and dilution.' },
  { code: '4.01', meaning: 'Change in certifying accountant', weight: 'medium', note: 'Auditor changes can precede problems; read the reason.' },
  { code: '4.02', meaning: 'Non-reliance on previously issued financial statements', weight: 'high', note: 'A restatement: past numbers should not be trusted.' },
  { code: '5.01', meaning: 'Changes in control of the registrant', weight: 'high', note: 'A new controlling holder or a change of control event.' },
  { code: '5.02', meaning: 'Departure or appointment of directors or certain officers', weight: 'medium', note: 'Sudden CEO or CFO exits are the ones to read.' },
  { code: '5.03', meaning: 'Amendments to articles or bylaws', weight: 'low', note: 'Can include takeover defenses such as a poison pill.' },
  { code: '5.07', meaning: 'Submission of matters to a vote of security holders', weight: 'low', note: 'Annual meeting results. Routine unless a contested vote.' },
  { code: '7.01', meaning: 'Regulation FD disclosure', weight: 'low', note: 'Investor presentations and press releases furnished to the SEC.' },
  { code: '8.01', meaning: 'Other events', weight: 'medium', note: 'A catch-all: companies use it for news that fits nowhere else, so the content varies widely.' },
  { code: '9.01', meaning: 'Financial statements and exhibits', weight: 'low', note: 'The attachments for another item; no news of its own.' },
];

export interface CodeRow {
  code: string;
  meaning: string;
  weight: Weight;
  note: string;
}

export const FORM_4_CODES: CodeRow[] = [
  { code: 'P', meaning: 'Open-market or private purchase', weight: 'high', note: 'The insider bought with their own money. The strongest bullish signal.' },
  { code: 'S', meaning: 'Open-market or private sale', weight: 'medium', note: 'Many reasons to sell. Larger and non-plan sales by top executives matter most.' },
  { code: 'A', meaning: 'Grant, award or other acquisition from the company', weight: 'low', note: 'Stock or option compensation; not a market purchase.' },
  { code: 'M', meaning: 'Exercise or conversion of a derivative (options)', weight: 'low', note: 'Often followed by a sale to cover costs.' },
  { code: 'X', meaning: 'Exercise of an in-the-money or at-the-money derivative', weight: 'low', note: 'Option exercise; read together with any sale.' },
  { code: 'F', meaning: 'Shares withheld to pay exercise price or taxes', weight: 'low', note: 'Mechanical tax withholding, not a discretionary sale.' },
  { code: 'G', meaning: 'Gift', weight: 'low', note: 'Charitable or family gift; sometimes used for tax planning.' },
  { code: 'D', meaning: 'Disposition back to the issuer', weight: 'low', note: 'Shares returned to the company.' },
  { code: 'C', meaning: 'Conversion of a derivative security', weight: 'low', note: 'Preferred or convertible shares turned into common stock.' },
  { code: 'J / I', meaning: 'Other / discretionary transaction', weight: 'low', note: 'Needs the footnote to interpret.' },
];

export const PRIORITY_TIERS = [
  { tier: 'Critical', range: '75-100', color: '#F6465D', meaning: 'Review now. Activist intent, distress events, cluster buys, or a clear immediate catalyst.' },
  { tier: 'High', range: '50-74', color: '#F7931A', meaning: 'Review promptly. Significant and likely to matter in the near term.' },
  { tier: 'Medium', range: '25-49', color: '#2F80ED', meaning: 'Worth a line in a feed. Notable but not urgent.' },
  { tier: 'Low', range: '0-24', color: 'var(--text-tertiary)', meaning: 'Routine. Hidden by default in the Filings feed.' },
];
