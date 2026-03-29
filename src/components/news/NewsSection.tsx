import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { useStockNews } from '../../hooks/useStockNews';
import { useAnalystData } from '../../hooks/useAnalystData';
import { useEdgarFilings } from '../../hooks/useEdgarFilings';
import { formatPrice } from '../../utils/formatters';
import { format, fromUnixTime } from 'date-fns';
import type { NewsItem, AnalystRecommendation, PriceTarget, EarningsSurprise, Edgar13DFiling } from '../../api/types';

interface Props {
  symbol: string;
  isCanadian: boolean;
  currentPrice?: number;
  currency?: string;
}

type Tab = 'news' | 'analyst' | 'filings';

export function NewsSection({ symbol, isCanadian, currentPrice, currency = 'USD' }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('news');
  const { data: news, isLoading: newsLoading } = useStockNews(symbol);
  const { recs, target, earnings } = useAnalystData(symbol);
  const { data: filings, isLoading: filingsLoading } = useEdgarFilings(symbol, isCanadian);

  const newsCount = news?.length ?? 0;
  const filingsCount = filings?.length ?? 0;

  const tabs: { id: Tab; label: string; count?: number; countColor?: string }[] = [
    { id: 'news', label: 'News', count: newsCount, countColor: 'var(--text-tertiary)' },
    { id: 'analyst', label: 'Analyst' },
    { id: 'filings', label: '13D / 13G', count: filingsCount, countColor: '#F7931A' },
  ];

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 24 }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontFamily: "'Inter', sans-serif" }}>
          Market Signals
        </span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 12px', borderRadius: 20,
              border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 500, fontFamily: "'Inter', sans-serif",
              background: activeTab === tab.id ? 'var(--accent-blue)' : 'var(--bg-elevated)',
              color: activeTab === tab.id ? '#fff' : 'var(--text-secondary)',
              transition: 'all 150ms ease-out',
            }}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span style={{
                padding: '1px 6px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                background: activeTab === tab.id ? 'rgba(255,255,255,0.2)' : 'var(--bg-hover)',
                color: activeTab === tab.id ? '#fff' : (tab.countColor ?? 'var(--text-tertiary)'),
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'news' && (
        <NewsTab
          news={news ?? []}
          loading={newsLoading}
          isCanadian={isCanadian}
          symbol={symbol}
        />
      )}
      {activeTab === 'analyst' && (
        <AnalystTab
          recs={recs.data ?? []}
          target={target.data}
          earnings={earnings.data ?? []}
          loading={recs.isLoading}
          isCanadian={isCanadian}
          currentPrice={currentPrice}
          currency={currency}
        />
      )}
      {activeTab === 'filings' && (
        <FilingsTab
          filings={filings ?? []}
          loading={filingsLoading}
          isCanadian={isCanadian}
          symbol={symbol}
        />
      )}
    </div>
  );
}

// ─── News Tab ────────────────────────────────────────────────────────────────

function NewsTab({
  news,
  loading,
  isCanadian,
  symbol,
}: {
  news: NewsItem[];
  loading: boolean;
  isCanadian: boolean;
  symbol: string;
}) {
  if (isCanadian) {
    const baseTicker = symbol.replace('.TO', '');
    return (
      <div style={{ padding: '20px 0', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
          Company news is available for US-listed stocks only.
        </p>
        <a
          href={`https://finance.yahoo.com/quote/${symbol}/news/`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-blue-light)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          View {baseTicker} news on Yahoo Finance <ExternalLink size={12} />
        </a>
      </div>
    );
  }

  if (loading) return <NewsSkeleton />;
  if (!news.length) return (
    <p style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '20px 0' }}>No recent news found.</p>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {news.slice(0, 10).map((item, i) => (
        <a
          key={item.id ?? i}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', gap: 12, padding: 14, borderRadius: 12, textDecoration: 'none',
            background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
            transition: 'border-color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {item.source}
              </span>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)', flexShrink: 0, marginLeft: 8 }}>
                {format(fromUnixTime(item.datetime), 'MMM d')}
              </span>
            </div>
            <p style={{
              fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.45,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              marginBottom: 0,
            }}>
              {item.headline}
            </p>
          </div>
          {item.image && (
            <img
              src={item.image}
              alt=""
              style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, background: 'var(--bg-surface)' }}
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
        </a>
      ))}
    </div>
  );
}

// ─── Analyst Tab ─────────────────────────────────────────────────────────────

function AnalystTab({
  recs,
  target,
  earnings,
  loading,
  isCanadian,
  currentPrice,
  currency,
}: {
  recs: AnalystRecommendation[];
  target?: PriceTarget;
  earnings: EarningsSurprise[];
  loading: boolean;
  isCanadian: boolean;
  currentPrice?: number;
  currency: string;
}) {
  if (isCanadian) {
    return (
      <div style={{ padding: '20px 0', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          Analyst data is available for US-listed stocks only.
        </p>
      </div>
    );
  }
  if (loading) return <div style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '20px 0' }}>Loading analyst data…</div>;

  const latestRec = recs?.[0];
  const totalRec = latestRec
    ? (latestRec.strongBuy + latestRec.buy + latestRec.hold + latestRec.sell + latestRec.strongSell)
    : 0;

  function consensus(r: AnalystRecommendation | undefined): { label: string; color: string } {
    if (!r || totalRec === 0) return { label: '—', color: 'var(--text-secondary)' };
    const bullish = (r.strongBuy + r.buy) / totalRec;
    const bearish = (r.sell + r.strongSell) / totalRec;
    if (bullish >= 0.6) return { label: 'STRONG BUY', color: 'var(--color-up)' };
    if (bullish >= 0.4) return { label: 'BUY', color: 'var(--color-up)' };
    if (bearish >= 0.4) return { label: 'SELL', color: 'var(--color-down)' };
    return { label: 'HOLD', color: '#8A8F98' };
  }

  const con = consensus(latestRec);
  const bars = latestRec ? [
    { label: 'Strong Buy', count: latestRec.strongBuy, color: '#039855' },
    { label: 'Buy', count: latestRec.buy, color: 'var(--color-up)' },
    { label: 'Hold', count: latestRec.hold, color: '#8A8F98' },
    { label: 'Sell', count: latestRec.sell, color: 'var(--color-down)' },
    { label: 'Strong Sell', count: latestRec.strongSell, color: '#C01048' },
  ] : [];
  const maxBar = Math.max(...bars.map(b => b.count), 1);

  const hasData = !!(latestRec || (target && target.targetMean > 0) || earnings?.length);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Consensus */}
      {latestRec && (
        <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>Analyst Consensus</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: con.color }}>{con.label}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {bars.map(bar => (
              <div key={bar.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 72, flexShrink: 0 }}>{bar.label}</span>
                <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--bg-hover)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3,
                    width: `${(bar.count / maxBar) * 100}%`,
                    background: bar.color, transition: 'width 400ms ease-out',
                  }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-tertiary)', width: 20, textAlign: 'right', fontFamily: "'Roboto Mono', monospace" }}>{bar.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Price Target */}
      {target && target.targetMean > 0 && (
        <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, display: 'block', marginBottom: 12 }}>Price Target</span>
          <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
            {[
              { label: 'Mean', val: target.targetMean },
              { label: 'Low', val: target.targetLow },
              { label: 'High', val: target.targetHigh },
            ].map(({ label, val }) => (
              <div key={label} style={{ flex: 1, textAlign: 'center', padding: '8px 0', borderRadius: 8, background: 'var(--bg-hover)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                  {formatPrice(val, currency as 'USD' | 'CAD')}
                </div>
              </div>
            ))}
          </div>
          {/* Range bar with current price indicator */}
          {currentPrice && target.targetHigh > target.targetLow && (
            <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'var(--bg-hover)' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3,
                width: `${Math.min(100, Math.max(0, ((currentPrice - target.targetLow) / (target.targetHigh - target.targetLow)) * 100))}%`,
                background: 'var(--accent-blue)',
              }} />
              <div style={{
                position: 'absolute', top: '50%', transform: 'translateY(-50%)',
                left: `${Math.min(96, Math.max(2, ((currentPrice - target.targetLow) / (target.targetHigh - target.targetLow)) * 100))}%`,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-blue-light)', border: '2px solid var(--bg-elevated)', marginLeft: -5 }} />
              </div>
            </div>
          )}
          {currentPrice && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatPrice(target.targetLow, currency as 'USD' | 'CAD')}</span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>Current {formatPrice(currentPrice, currency as 'USD' | 'CAD')}</span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{formatPrice(target.targetHigh, currency as 'USD' | 'CAD')}</span>
            </div>
          )}
        </div>
      )}

      {/* Earnings */}
      {earnings && earnings.length > 0 && (
        <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, display: 'block', marginBottom: 12 }}>Recent Earnings</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {earnings.slice(0, 4).map((e, i) => {
              const beat = e.actual !== null && e.estimate !== null ? e.actual >= e.estimate : null;
              const pct = e.surprisePercent;
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', width: 72 }}>{e.period?.slice(0, 7)}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
                    EPS: <span style={{ fontFamily: "'Roboto Mono', monospace", color: 'var(--text-primary)' }}>{e.actual ?? '—'}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}> vs </span>
                    <span style={{ fontFamily: "'Roboto Mono', monospace" }}>{e.estimate ?? '—'}E</span>
                  </span>
                  {beat !== null && (
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '2px 7px', borderRadius: 10,
                      background: beat ? 'rgba(5,177,105,0.1)' : 'rgba(246,70,93,0.1)',
                      color: beat ? 'var(--color-up)' : 'var(--color-down)',
                      fontFamily: "'Roboto Mono', monospace",
                    }}>
                      {pct != null ? `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` : (beat ? 'BEAT' : 'MISS')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!hasData && (
        <p style={{ color: 'var(--text-tertiary)', fontSize: 13, padding: '20px 0' }}>No analyst data available.</p>
      )}
    </div>
  );
}

// ─── Filings Tab ─────────────────────────────────────────────────────────────

function FilingsTab({
  filings,
  loading,
  isCanadian,
  symbol,
}: {
  filings: Edgar13DFiling[];
  loading: boolean;
  isCanadian: boolean;
  symbol: string;
}) {
  if (isCanadian) {
    const baseTicker = symbol.replace('.TO', '');
    return (
      <div style={{ padding: 16, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 10 }}>
          Canadian major ownership filings are reported on <strong>SEDAR+</strong> (Early Warning Reports require 10%+ ownership).
        </p>
        <a
          href="https://www.sedarplus.ca/landingpage/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent-blue-light)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 8 }}
        >
          Search {baseTicker} on SEDAR+ <ExternalLink size={12} />
        </a>
      </div>
    );
  }

  if (loading) return <FilingsSkeleton />;

  const formColor = (form: string): { bg: string; color: string; border: string } => {
    if (form.startsWith('13D') || form.startsWith('SC 13D') || form.startsWith('SCHEDULE 13D')) {
      return { bg: 'rgba(247,147,26,0.12)', color: '#F7931A', border: 'rgba(247,147,26,0.25)' };
    }
    return { bg: 'rgba(45,107,255,0.12)', color: 'var(--accent-blue-light)', border: 'rgba(45,107,255,0.25)' };
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {filings.length === 0 ? (
        <div style={{ padding: '20px 0' }}>
          <p style={{ color: 'var(--text-tertiary)', fontSize: 13, marginBottom: 8 }}>No 13D/13G filings found in the past 2 years.</p>
          <a
            href={`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${symbol}&type=SC+13&dateb=&owner=include&count=10`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent-blue-light)', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 4 }}
          >
            Search EDGAR directly <ExternalLink size={12} />
          </a>
        </div>
      ) : (
        filings.map((f, i) => {
          const fc = formColor(f.formType);
          return (
            <a
              key={f.accessionNo || i}
              href={f.edgarUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12,
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                textDecoration: 'none', transition: 'border-color 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
            >
              {/* Form type badge */}
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                background: fc.bg, color: fc.color, border: `1px solid ${fc.border}`,
                fontFamily: "'Roboto Mono', monospace",
              }}>
                {f.formType}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {f.filerName}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', margin: '2px 0 0', fontFamily: "'Roboto Mono', monospace" }}>
                  Filed {f.filedDate}
                  {f.periodOfReport && f.periodOfReport !== f.filedDate ? ` · Period: ${f.periodOfReport}` : ''}
                </p>
              </div>
              <ExternalLink size={13} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
            </a>
          );
        })
      )}
      {filings.length > 0 && (
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 4 }}>
          13D = 5%+ stake (activist intent) · 13G = 5%+ stake (passive) · Source: SEC EDGAR
        </p>
      )}
    </div>
  );
}

// ─── Skeleton components ──────────────────────────────────────────────────────

function NewsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1, 2, 3].map(i => (
        <div key={i} style={{ padding: 14, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
          <div style={{ width: 80, height: 10, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 8 }} className="animate-pulse" />
          <div style={{ width: '90%', height: 13, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 5 }} className="animate-pulse" />
          <div style={{ width: '70%', height: 13, borderRadius: 4, background: 'var(--bg-hover)' }} className="animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function FilingsSkeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {[1, 2].map(i => (
        <div key={i} style={{ padding: 14, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 56, height: 24, borderRadius: 6, background: 'var(--bg-hover)' }} className="animate-pulse" />
          <div style={{ flex: 1 }}>
            <div style={{ width: '60%', height: 13, borderRadius: 4, background: 'var(--bg-hover)', marginBottom: 6 }} className="animate-pulse" />
            <div style={{ width: '40%', height: 10, borderRadius: 4, background: 'var(--bg-hover)' }} className="animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
