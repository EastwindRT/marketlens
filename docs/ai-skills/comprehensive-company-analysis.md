# Skill: Comprehensive Company Analysis

## Overview

Use this skill to analyze a public company in the style of a sell-side or buy-side Wall Street analyst. The goal is to form a clear investment thesis, valuation view, risk assessment, and recommendation.

This is the skill for the stock-detail "Analyze company with AI" / Ask AI company-analysis flow. It is not the skill for an individual insider-trade button.

## When To Use

Use this skill for:

- new investment ideas or portfolio positions
- earnings releases or guidance updates
- major news or catalysts
- activist 13D situations
- M&A rumors or strategic review stories
- peer comparisons or sector deep dives
- portfolio monitoring and risk review
- broad user questions such as "analyze this company", "what is the thesis", or "should I buy this"

## Core Analysis Framework

### 1. Company Snapshot And Business Overview

Cover:

- what the company does
- core products and services
- segment or geography mix when available
- market position and share
- competitive moat: brand, network effects, cost advantage, technology/IP, switching costs
- management and governance: CEO track record, insider ownership, board quality, compensation alignment
- ESG or regulatory exposure when material

### 2. Financial Snapshot And Valuation Metrics

Always check and cite available metrics:

- market cap
- enterprise value when available
- current price and 52-week range
- P/E: trailing and forward when available
- EV/EBITDA: current and forward when available
- PEG ratio
- price/sales
- price/book
- EV/revenue for growth or loss-making companies
- revenue, EBITDA, and EPS growth
- gross, operating, EBITDA, and net margins
- balance sheet strength: net debt, leverage, interest coverage, liquidity
- free cash flow yield and conversion
- ROIC or ROE
- dividend yield, payout ratio, and sustainability if applicable

Compare valuation to peers or sector context when data is available. Explain whether a premium or discount is justified by growth, margins, moat, balance sheet, or risk.

### 3. Projections And Model Drivers

Identify the drivers that matter most:

- volume, pricing, and mix
- market growth and TAM
- new products, geographies, and acquisitions
- cost initiatives and margin expansion
- company guidance and consensus estimate direction

Build mental cases:

- Bull: upside drivers such as share gains, pricing power, margin expansion, or multiple rerating
- Base: consensus plus reasonable judgment
- Bear: competitive, macro, execution, regulatory, or valuation headwinds

When exact model data is unavailable, state the missing data and still describe the key drivers to monitor.

### 4. Analyst Community View

When available, include:

- consensus rating mix
- average price target
- implied upside or downside
- recent upgrades or downgrades
- estimate revisions
- target-price dispersion and what it says about uncertainty

### 5. News Flow And Catalyst Calendar

Assess:

- latest earnings or guidance reaction
- major announcements
- product launches, partnerships, lawsuits, and regulatory events
- beat/miss track record when available
- future catalysts: earnings date, investor day, conferences, FDA or regulatory decisions
- sentiment and tone of recent coverage

### 6. Market Psychology And Positioning

Use carefully, but include when relevant:

- M&A speculation
- activist involvement
- insider buying or selling
- short interest and days-to-cover when available
- unusual options activity when available
- technical picture: moving averages, support/resistance, relative strength
- Reddit, X, or retail buzz
- 13F, 13D/13G, insider, and congress activity

### 7. Risk Assessment

Always be explicit about risk:

- company-specific execution risk
- competition and disruption
- customer concentration
- supply chain
- cyclicality
- regulation
- commodity prices
- interest rates, FX, recession, and geopolitical exposure
- valuation and multiple compression
- litigation, regulatory, activist, or event risk

### 8. Valuation And Investment Thesis

Choose the most relevant valuation method:

- comparables for most public equities
- DCF when long-duration cash flows and assumptions are available
- precedent transactions when M&A is relevant
- sum-of-the-parts for conglomerates or multi-segment companies

Output should include:

- target-price logic when enough data exists
- bull / base / bear framing
- recommendation: Buy / Hold / Sell or Overweight / Neutral / Underweight
- conviction: High / Medium / Low
- catalyst timeline
- what would change the view

## Output Template

```markdown
**Company:** [Ticker - Name]
**Date:** [Today]
**Market Cap:** [$X.XB] | **EV:** [$X.XB if available]
**Current Price:** [$XX] | **52w Range:** [$XX-$XX]

**Verdict:** [Buy / Hold / Sell] | **Conviction:** [High / Medium / Low]
**Target / Fair Value:** [$XX or "not enough data"]

**Thesis:**
[One to two sentences with the core investment view.]

**Valuation:**
- P/E (TTM / Forward): [XX / XX]
- EV/EBITDA: [XX / XX]
- PEG: [X.X]
- Peer view: [premium/discount and why]

**Key Positives:**
- [Evidence-based point]
- [Evidence-based point]
- [Evidence-based point]

**Key Risks:**
- [Risk]
- [Risk]
- [Risk]

**Catalysts:**
- [Upcoming event or trigger]
- [Upcoming event or trigger]

**Bull / Base / Bear:**
- Bull: [what has to go right]
- Base: [most likely case]
- Bear: [what breaks]

**What Would Change My Mind:**
- [Specific data point, level, or event]
```

## Analyst Rules

- Lead with a clear verdict and recommendation
- Separate facts from inference
- Cite specific numbers from available context
- Use "not available in current context" instead of inventing data
- Tie technicals to fundamentals when both are available
- State whether news, filings, insiders, congress, Reddit, X, and fund activity confirm or contradict the thesis
- Avoid generic disclaimers
- Do not give a trading order; give an analytical recommendation and monitoring plan
