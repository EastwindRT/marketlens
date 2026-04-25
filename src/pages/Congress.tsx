import { useMemo, useState } from 'react';
import { ExternalLink, Search, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWatchlistStore } from '../store/watchlistStore';
import { useCongressMemberActivity, useLatestCongressTrades } from '../hooks/useCongressTrades';

const NOTABLE_MEMBERS = [
  { name: 'Nancy Pelosi', slug: 'nancy-pelosi', chamber: 'House', party: 'D' },
  { name: 'Dan Crenshaw', slug: 'dan-crenshaw', chamber: 'House', party: 'R' },
  { name: 'Tommy Tuberville', slug: 'tommy-tuberville', chamber: 'Senate', party: 'R' },
  { name: 'Mark Kelly', slug: 'mark-kelly', chamber: 'Senate', party: 'D' },
  { name: 'Josh Gottheimer', slug: 'josh-gottheimer', chamber: 'House', party: 'D' },
  { name: 'Marjorie Taylor Greene', slug: 'marjorie-taylor-greene', chamber: 'House', party: 'R' },
  { name: 'Kevin Hern', slug: 'kevin-hern', chamber: 'House', party: 'R' },
  { name: 'Brian Mast', slug: 'brian-mast', chamber: 'House', party: 'R' },
];

function partyColor(party: string) {
  if (party === 'D') return { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' };
  if (party === 'R') return { color: '#F6465D', bg: 'rgba(246,70,93,0.12)' };
  return { color: 'var(--text-tertiary)', bg: 'var(--bg-hover)' };
}

function parseAmountMid(s: string): number {
  if (!s) return 0;
  const nums = s.replace(/[^0-9,]/g, ' ').trim().split(/\s+/).map((n) => parseInt(n.replace(/,/g, ''), 10)).filter(Boolean);
  if (nums.length >= 2) return (nums[0] + nums[nums.length - 1]) / 2;
  if (nums.length === 1) return nums[0];
  return 0;
}

function compactDollar(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(n >= 10e6 ? 0 : 1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

function formatCongressAmount(s: string): { mid: string; range: string } {
  if (!s) return { mid: '—', range: '' };
  const nums = s.replace(/,/g, '').match(/\d+/g)?.map(Number) ?? [];
  if (s.toLowerCase().includes('over') && nums.length >= 1) {
    return { mid: `>${compactDollar(nums[0])}`, range: '' };
  }
  if (nums.length >= 2) {
    const [lo, hi] = [nums[0], nums[nums.length - 1]];
    return { mid: `~${compactDollar((lo + hi) / 2)}`, range: `${compactDollar(lo)} - ${compactDollar(hi)}` };
  }
  if (nums.length === 1) return { mid: compactDollar(nums[0]), range: '' };
  return { mid: s, range: '' };
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1)}%`;
}

export default function CongressPage() {
  const [tickerFilter, setTickerFilter] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'size'>('date');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [memberSort, setMemberSort] = useState<'active' | 'buyers' | 'sellers' | 'returns'>('returns');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const navigate = useNavigate();
  const { items: watchlist } = useWatchlistStore();
  const { data: allTrades, isLoading, isError } = useLatestCongressTrades(200);
  const {
    data: memberActivity,
    isLoading: membersLoading,
    isError: membersError,
  } = useCongressMemberActivity(180);

  const trades = useMemo(() => {
    const filtered = (allTrades ?? []).filter((trade) => {
      if (!tickerFilter) return true;
      return trade.ticker.toUpperCase().includes(tickerFilter.toUpperCase());
    });
    return [...filtered].sort((a, b) => {
      const diff = sortBy === 'size'
        ? parseAmountMid(a.amount) - parseAmountMid(b.amount)
        : (a.transactionDate ?? '').localeCompare(b.transactionDate ?? '');
      return sortDir === 'desc' ? -diff : diff;
    });
  }, [allTrades, tickerFilter, sortBy, sortDir]);

  const rankedMembers = useMemo(() => {
    const list = memberActivity?.members ?? [];
    return [...list].sort((a, b) => {
      if (memberSort === 'returns') {
        return (b.averageReturnPct ?? -Infinity) - (a.averageReturnPct ?? -Infinity)
          || b.totalAmountMin - a.totalAmountMin
          || b.totalTrades - a.totalTrades;
      }
      if (memberSort === 'buyers') {
        return b.buyAmountMin - a.buyAmountMin || b.purchaseCount - a.purchaseCount || b.totalTrades - a.totalTrades;
      }
      if (memberSort === 'sellers') {
        return b.sellAmountMin - a.sellAmountMin || b.saleCount - a.saleCount || b.totalTrades - a.totalTrades;
      }
      return b.totalAmountMin - a.totalAmountMin || b.totalTrades - a.totalTrades || b.latestTradeDate.localeCompare(a.latestTradeDate);
    });
  }, [memberActivity?.members, memberSort]);

  const selectedMember = useMemo(() => {
    if (selectedMemberId) return rankedMembers.find((member) => member.memberId === selectedMemberId) ?? null;
    return rankedMembers[0] ?? null;
  }, [rankedMembers, selectedMemberId]);

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 80px' }}>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Building2 size={20} color="var(--accent-blue-light)" />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em' }}>
              Congress Trades
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
            STOCK Act disclosures · value ranges only (qty not disclosed) · Quiver Quant
          </p>
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                Ranked Member Activity Portfolios
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
                Ranked from disclosed trading activity over the last 180 days. Returns are estimated from stock performance since each disclosed trade date, direction-adjusted for buys vs sells.
              </p>
            </div>
            <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 3, gap: 2 }}>
              {([
                { id: 'active', label: 'Most Active' },
                { id: 'buyers', label: 'Biggest Buyers' },
                { id: 'sellers', label: 'Biggest Sellers' },
                { id: 'returns', label: 'Best Returns' },
              ] as const).map((option) => (
                <button
                  key={option.id}
                  onClick={() => setMemberSort(option.id)}
                  style={{
                    padding: '5px 10px',
                    borderRadius: 7,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: 'none',
                    background: memberSort === option.id ? 'var(--bg-hover)' : 'transparent',
                    color: memberSort === option.id ? 'var(--text-primary)' : 'var(--text-tertiary)',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          {membersLoading && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 14 }}>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} style={{ height: 116, borderRadius: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', opacity: 0.6 }} />
              ))}
            </div>
          )}

          {!membersLoading && membersError && (
            <div style={{ padding: '16px 14px', borderRadius: 12, background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.2)', marginBottom: 14 }}>
              <p style={{ margin: 0, color: 'var(--color-down)', fontSize: 13 }}>
                Could not load ranked member activity right now.
              </p>
            </div>
          )}

          {!membersLoading && !membersError && rankedMembers.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8, marginBottom: 14 }}>
                {rankedMembers.slice(0, 8).map((member) => {
                  const party = partyColor(member.party);
                  const selected = selectedMember?.memberId === member.memberId;
                  return (
                    <button
                      key={member.memberId}
                      onClick={() => setSelectedMemberId(member.memberId)}
                      style={{
                        borderRadius: 12,
                        border: `1px solid ${selected ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                        background: selected ? 'rgba(22,82,240,0.08)' : 'var(--bg-elevated)',
                        padding: '12px 14px',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {member.member}
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                            {member.chamber} {member.state ? `· ${member.state}` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999, background: party.bg, color: party.color, fontFamily: "'Roboto Mono', monospace" }}>
                          {member.party || member.chamber}
                        </span>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <Metric label="Trades" value={String(member.totalTrades)} />
                        <Metric label="Activity" value={compactDollar(member.totalAmountMin)} />
                        <Metric label="Buys" value={String(member.purchaseCount)} positive />
                        <Metric label="Sells" value={String(member.saleCount)} negative />
                        <Metric
                          label="Return"
                          value={formatPercent(member.averageReturnPct)}
                          positive={member.averageReturnPct != null && member.averageReturnPct >= 0}
                          negative={member.averageReturnPct != null && member.averageReturnPct < 0}
                        />
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedMember && (
                <div style={{ borderRadius: 14, border: '1px solid var(--border-subtle)', background: 'var(--bg-elevated)', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div>
                      <h2 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {selectedMember.member}
                      </h2>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
                        Disclosed activity portfolio over the last 180 days · latest trade {selectedMember.latestTradeDate}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <SummaryPill label="Buy Value" value={compactDollar(selectedMember.buyAmountMin)} tone="up" />
                      <SummaryPill label="Sell Value" value={compactDollar(selectedMember.sellAmountMin)} tone="down" />
                      <SummaryPill
                        label="Return"
                        value={formatPercent(selectedMember.averageReturnPct)}
                        tone={
                          selectedMember.averageReturnPct == null
                            ? 'neutral'
                            : selectedMember.averageReturnPct >= 0
                              ? 'up'
                              : 'down'
                        }
                      />
                      <SummaryPill
                        label="Net"
                        value={`${selectedMember.netAmountMin >= 0 ? '+' : '-'}${compactDollar(Math.abs(selectedMember.netAmountMin))}`}
                        tone={selectedMember.netAmountMin >= 0 ? 'up' : 'down'}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
                    <div>
                      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                        Top Tickers
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selectedMember.topTickers.slice(0, 8).map((ticker) => {
                          const isNetBuy = ticker.estimatedNetAmountMin >= 0;
                          return (
                            <button
                              key={ticker.ticker}
                              onClick={() => navigate(`/stock/${ticker.ticker}`)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                width: '100%',
                                textAlign: 'left',
                                borderRadius: 10,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg-primary)',
                                padding: '10px 12px',
                                cursor: 'pointer',
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                                  {ticker.ticker}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                  {ticker.tradeCount} trades · {ticker.purchaseCount} buys · {ticker.saleCount} sells · {formatPercent(ticker.averageReturnPct)}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 12, fontWeight: 700, color: isNetBuy ? '#05B169' : '#F6465D', fontFamily: "'Roboto Mono', monospace" }}>
                                  {isNetBuy ? '+' : '-'}{compactDollar(Math.abs(ticker.estimatedNetAmountMin))}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                  gross {compactDollar(ticker.estimatedGrossAmountMin)}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div>
                      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                        Recent Disclosures
                      </p>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {selectedMember.recentTrades.slice(0, 6).map((trade, index) => {
                          const isBuy = trade.type === 'purchase';
                          return (
                            <button
                              key={`${trade.ticker}-${trade.transactionDate}-${index}`}
                              onClick={() => navigate(`/stock/${trade.ticker}`)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 12,
                                width: '100%',
                                textAlign: 'left',
                                borderRadius: 10,
                                border: '1px solid var(--border-subtle)',
                                background: 'var(--bg-primary)',
                                padding: '10px 12px',
                                cursor: 'pointer',
                              }}
                            >
                              <div>
                                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                                  {trade.ticker}
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                                  {trade.transactionDate}
                                </div>
                              </div>
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: isBuy ? '#05B169' : '#F6465D' }}>
                                  {isBuy ? 'BUY' : 'SELL'}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                                  {formatCongressAmount(trade.amount).mid}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
            <input
              value={tickerFilter}
              onChange={(e) => setTickerFilter(e.target.value.toUpperCase())}
              placeholder="Filter by ticker (AAPL, NVDA...)"
              style={{
                width: '100%',
                padding: '10px 12px 10px 34px',
                borderRadius: 10,
                boxSizing: 'border-box',
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border-default)',
                color: 'var(--text-primary)',
                fontSize: 14,
                fontFamily: "'Roboto Mono', monospace",
                outline: 'none',
              }}
              onFocus={(e) => (e.target.style.borderColor = 'var(--accent-blue)')}
              onBlur={(e) => (e.target.style.borderColor = 'var(--border-default)')}
            />
          </div>
        </div>

        {watchlist.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
            <button
              onClick={() => setTickerFilter('')}
              style={{
                padding: '5px 12px',
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: !tickerFilter ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                color: !tickerFilter ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${!tickerFilter ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                fontFamily: "'Roboto Mono', monospace",
              }}
            >
              ALL
            </button>
            {watchlist.map((item) => {
              const ticker = item.symbol.replace(/\.TO$/i, '');
              const active = tickerFilter === ticker;
              return (
                <button
                  key={ticker}
                  onClick={() => setTickerFilter(active ? '' : ticker)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: active ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                    color: active ? '#fff' : 'var(--text-primary)',
                    border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                    fontFamily: "'Roboto Mono', monospace",
                  }}
                >
                  {ticker}
                </button>
              );
            })}
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Latest Trades {trades.length > 0 && <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 4 }}>· {trades.length} shown</span>}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sort</span>
              <div style={{ display: 'flex', background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: 3, gap: 2 }}>
                {(['date', 'size'] as const).map((option) => (
                  <button
                    key={option}
                    onClick={() => {
                      if (sortBy === option) setSortDir((value) => (value === 'desc' ? 'asc' : 'desc'));
                      else {
                        setSortBy(option);
                        setSortDir('desc');
                      }
                    }}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 7,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      background: sortBy === option ? 'var(--bg-hover)' : 'transparent',
                      color: sortBy === option ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      border: sortBy === option ? '1px solid var(--border-default)' : '1px solid transparent',
                      transition: 'all 120ms',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                  >
                    {option === 'date' ? 'Date' : 'Size'}
                    {sortBy === option && <span style={{ fontSize: 9 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} style={{ height: 60, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', opacity: 0.6 }} />
              ))}
            </div>
          )}

          {!isLoading && isError && (
            <div style={{ padding: '20px 16px', borderRadius: 10, background: 'rgba(246,70,93,0.08)', border: '1px solid rgba(246,70,93,0.25)', textAlign: 'center' }}>
              <p style={{ color: '#F6465D', fontSize: 13, marginBottom: 4 }}>Congress data unavailable</p>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 12 }}>Quiver Quant may be temporarily down. Data refreshes every 30 minutes — try again shortly.</p>
            </div>
          )}

          {!isLoading && !isError && trades.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
                {tickerFilter ? `No congress trades found for ${tickerFilter}` : 'No trades available'}
              </p>
            </div>
          )}

          {!isLoading && !isError && trades.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {trades.map((trade, index) => {
                const isBuy = trade.type === 'purchase';
                const tradeColor = isBuy ? '#05B169' : '#F6465D';
                const tradeBg = isBuy ? 'rgba(5,177,105,0.12)' : 'rgba(246,70,93,0.12)';
                const tradeBorder = isBuy ? 'rgba(5,177,105,0.3)' : 'rgba(246,70,93,0.3)';
                const party = partyColor(trade.party);

                return (
                  <div
                    key={`${trade.member}-${trade.ticker}-${trade.transactionDate}-${index}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '11px 14px',
                      borderRadius: 12,
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      transition: 'border-color 150ms',
                    }}
                    onClick={() => navigate(`/stock/${trade.ticker}`)}
                    onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        flexShrink: 0,
                        background: tradeBg,
                        color: tradeColor,
                        border: `1px solid ${tradeBorder}`,
                        textTransform: 'uppercase',
                        fontFamily: "'Roboto Mono', monospace",
                      }}
                    >
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>

                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        padding: '3px 8px',
                        borderRadius: 6,
                        flexShrink: 0,
                        background: 'var(--bg-hover)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-default)',
                        fontFamily: "'Roboto Mono', monospace",
                      }}
                    >
                      {trade.ticker}
                    </span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {trade.member}
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            background: party.bg,
                            color: party.color,
                            fontFamily: "'Roboto Mono', monospace",
                          }}
                        >
                          {trade.party || trade.chamber}
                        </span>
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                        {trade.transactionDate}
                        {trade.disclosureDate && trade.disclosureDate !== trade.transactionDate ? ` · filed ${trade.disclosureDate}` : ''}
                      </p>
                    </div>

                    {trade.amount && (() => {
                      const { mid, range } = formatCongressAmount(trade.amount);
                      return (
                        <div style={{ flexShrink: 0, textAlign: 'right' }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: tradeColor, fontFamily: "'Roboto Mono', monospace" }}>
                            {mid}
                          </div>
                          {range && (
                            <div style={{ fontSize: 10, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace", marginTop: 1 }}>
                              {range}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Notable Members — View on Capitol Trades
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
            {NOTABLE_MEMBERS.map((member) => {
              const party = partyColor(member.party);
              return (
                <a
                  key={member.slug}
                  href={`https://www.capitoltrades.com/politicians/${member.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    textDecoration: 'none',
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-subtle)',
                    transition: 'border-color 150ms',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: party.bg, color: party.color, fontFamily: "'Roboto Mono', monospace", minWidth: 20, textAlign: 'center', flexShrink: 0 }}>
                    {member.party}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 1px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.name}</p>
                    <p style={{ margin: 0, fontSize: 10, color: 'var(--text-tertiary)' }}>{member.chamber}</p>
                  </div>
                  <ExternalLink size={11} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                </a>
              );
            })}
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>
          Live data via <a href="https://www.quiverquant.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue-light)' }}>Quiver Quant</a> ·
          Politician profiles via <a href="https://www.capitoltrades.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue-light)' }}>Capitol Trades</a>
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <div style={{ padding: '8px 9px', borderRadius: 10, background: 'var(--bg-primary)', border: '1px solid var(--border-subtle)' }}>
      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: positive ? '#05B169' : negative ? '#F6465D' : 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: string; tone: 'up' | 'down' | 'neutral' }) {
  const color = tone === 'up' ? '#05B169' : tone === 'down' ? '#F6465D' : 'var(--text-primary)';
  const background = tone === 'up' ? 'rgba(5,177,105,0.10)' : tone === 'down' ? 'rgba(246,70,93,0.10)' : 'var(--bg-primary)';
  return (
    <div style={{ padding: '7px 10px', borderRadius: 999, border: '1px solid var(--border-subtle)', background }}>
      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginRight: 6 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: "'Roboto Mono', monospace" }}>{value}</span>
    </div>
  );
}
