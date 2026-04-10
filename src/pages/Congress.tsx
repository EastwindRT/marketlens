import { useState } from 'react';
import { ExternalLink, Search, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWatchlistStore } from '../store/watchlistStore';
import { useLatestCongressTrades } from '../hooks/useCongressTrades';

const NOTABLE_MEMBERS = [
  { name: 'Nancy Pelosi',           slug: 'nancy-pelosi',           chamber: 'House',  party: 'D' },
  { name: 'Dan Crenshaw',           slug: 'dan-crenshaw',           chamber: 'House',  party: 'R' },
  { name: 'Tommy Tuberville',       slug: 'tommy-tuberville',       chamber: 'Senate', party: 'R' },
  { name: 'Mark Kelly',             slug: 'mark-kelly',             chamber: 'Senate', party: 'D' },
  { name: 'Josh Gottheimer',        slug: 'josh-gottheimer',        chamber: 'House',  party: 'D' },
  { name: 'Marjorie Taylor Greene', slug: 'marjorie-taylor-greene', chamber: 'House',  party: 'R' },
  { name: 'Kevin Hern',             slug: 'kevin-hern',             chamber: 'House',  party: 'R' },
  { name: 'Brian Mast',             slug: 'brian-mast',             chamber: 'House',  party: 'R' },
];

function partyColor(party: string) {
  if (party === 'D') return { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' };
  if (party === 'R') return { color: '#F6465D', bg: 'rgba(246,70,93,0.12)' };
  return { color: 'var(--text-tertiary)', bg: 'var(--bg-hover)' };
}

export default function CongressPage() {
  const [tickerFilter, setTickerFilter] = useState('');
  const navigate = useNavigate();
  const { items: watchlist } = useWatchlistStore();
  const { data: allTrades, isLoading } = useLatestCongressTrades(200);

  const trades = (allTrades ?? []).filter(t => {
    if (!tickerFilter) return true;
    return t.ticker.toUpperCase().includes(tickerFilter.toUpperCase());
  });

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 80px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>

        {/* Header */}
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

        {/* Ticker filter */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
            <input
              value={tickerFilter}
              onChange={e => setTickerFilter(e.target.value.toUpperCase())}
              placeholder="Filter by ticker (AAPL, NVDA…)"
              style={{
                width: '100%', padding: '10px 12px 10px 34px', borderRadius: 10, boxSizing: 'border-box',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                color: 'var(--text-primary)', fontSize: 14, fontFamily: "'Roboto Mono', monospace", outline: 'none',
              }}
              onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
              onBlur={e => (e.target.style.borderColor = 'var(--border-default)')}
            />
          </div>
        </div>

        {/* Watchlist quick filter chips */}
        {watchlist.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
            <button
              onClick={() => setTickerFilter('')}
              style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                background: !tickerFilter ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                color: !tickerFilter ? '#fff' : 'var(--text-secondary)',
                border: `1px solid ${!tickerFilter ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                fontFamily: "'Roboto Mono', monospace",
              }}
            >ALL</button>
            {watchlist.map(item => {
              const t = item.symbol.replace(/\.TO$/i, '');
              const active = tickerFilter === t;
              return (
                <button key={t} onClick={() => setTickerFilter(active ? '' : t)}
                  style={{
                    padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    background: active ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                    color: active ? '#fff' : 'var(--text-primary)',
                    border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-subtle)'}`,
                    fontFamily: "'Roboto Mono', monospace",
                  }}
                >{t}</button>
              );
            })}
          </div>
        )}

        {/* Trades feed */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Latest Trades {trades.length > 0 && <span style={{ fontWeight: 400, textTransform: 'none', marginLeft: 4 }}>· {trades.length} shown</span>}
          </p>

          {isLoading && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} style={{ height: 60, borderRadius: 10, background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', opacity: 0.6 }} />
              ))}
            </div>
          )}

          {!isLoading && trades.length === 0 && (
            <div style={{ padding: '32px 0', textAlign: 'center' }}>
              <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
                {tickerFilter ? `No congress trades found for ${tickerFilter}` : 'No trades available'}
              </p>
            </div>
          )}

          {!isLoading && trades.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {trades.map((t, i) => {
                const isBuy      = t.type === 'purchase';
                const tradeColor = isBuy ? '#05B169' : '#F6465D';
                const tradeBg    = isBuy ? 'rgba(5,177,105,0.12)' : 'rgba(246,70,93,0.12)';
                const tradeBorder = isBuy ? 'rgba(5,177,105,0.3)' : 'rgba(246,70,93,0.3)';
                const pc = partyColor(t.party);

                return (
                  <div
                    key={`${t.member}-${t.ticker}-${t.transactionDate}-${i}`}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px',
                      borderRadius: 12, background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer', transition: 'border-color 150ms',
                    }}
                    onClick={() => navigate(`/stock/${t.ticker}`)}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    {/* BUY/SELL badge */}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                      background: tradeBg, color: tradeColor, border: `1px solid ${tradeBorder}`,
                      textTransform: 'uppercase', fontFamily: "'Roboto Mono', monospace",
                    }}>
                      {isBuy ? 'BUY' : 'SELL'}
                    </span>

                    {/* Ticker */}
                    <span style={{
                      fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 6, flexShrink: 0,
                      background: 'var(--bg-hover)', color: 'var(--text-primary)',
                      border: '1px solid var(--border-default)', fontFamily: "'Roboto Mono', monospace",
                    }}>
                      {t.ticker}
                    </span>

                    {/* Member + party */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.member}
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                          background: pc.bg, color: pc.color, fontFamily: "'Roboto Mono', monospace",
                        }}>{t.party || t.chamber}</span>
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                        {t.transactionDate}{t.disclosureDate && t.disclosureDate !== t.transactionDate ? ` · filed ${t.disclosureDate}` : ''}
                      </p>
                    </div>

                    {/* Value range — prominent on the right */}
                    {t.amount && (
                      <span style={{
                        fontSize: 12, fontWeight: 700, color: tradeColor,
                        fontFamily: "'Roboto Mono', monospace", flexShrink: 0, textAlign: 'right',
                      }}>
                        {t.amount}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Notable members */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Notable Members — View on Capitol Trades
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
            {NOTABLE_MEMBERS.map(m => {
              const pc = partyColor(m.party);
              return (
                <a key={m.slug} href={`https://www.capitoltrades.com/politicians/${m.slug}`}
                  target="_blank" rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    borderRadius: 10, textDecoration: 'none',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                    transition: 'border-color 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: pc.bg, color: pc.color, fontFamily: "'Roboto Mono', monospace", minWidth: 20, textAlign: 'center', flexShrink: 0 }}>
                    {m.party}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 1px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</p>
                    <p style={{ margin: 0, fontSize: 10, color: 'var(--text-tertiary)' }}>{m.chamber}</p>
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
