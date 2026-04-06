import { useState, useRef } from 'react';
import { ExternalLink, Search, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useWatchlistStore } from '../store/watchlistStore';
import { useCongressTradesForWatchlist } from '../hooks/useCongressTrades';

// Notable congress members for quick access
const NOTABLE_MEMBERS = [
  { name: 'Nancy Pelosi',       slug: 'nancy-pelosi',       chamber: 'House', party: 'D' },
  { name: 'Dan Crenshaw',       slug: 'dan-crenshaw',       chamber: 'House', party: 'R' },
  { name: 'Tommy Tuberville',   slug: 'tommy-tuberville',   chamber: 'Senate', party: 'R' },
  { name: 'Mark Kelly',         slug: 'mark-kelly',         chamber: 'Senate', party: 'D' },
  { name: 'Josh Gottheimer',    slug: 'josh-gottheimer',    chamber: 'House', party: 'D' },
  { name: 'Marjorie Taylor Greene', slug: 'marjorie-taylor-greene', chamber: 'House', party: 'R' },
  { name: 'Kevin Hern',         slug: 'kevin-hern',         chamber: 'House', party: 'R' },
  { name: 'Brian Mast',         slug: 'brian-mast',         chamber: 'House', party: 'R' },
];

function partyColor(party: string) {
  if (party === 'D') return { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)' };
  if (party === 'R') return { color: '#F6465D', bg: 'rgba(246,70,93,0.12)' };
  return { color: 'var(--text-tertiary)', bg: 'var(--bg-hover)' };
}

export default function CongressPage() {
  const [tickerSearch, setTickerSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { items: watchlist } = useWatchlistStore();

  // Get historical senate data for watchlist tickers
  const watchlistTickers = watchlist.map(w => w.symbol.replace(/\.TO$/i, ''));
  const { data: historicalTrades, isLoading } = useCongressTradesForWatchlist(watchlistTickers, 365 * 5);

  function openCapitolTrades(ticker: string) {
    const t = ticker.trim().toUpperCase().replace(/\.TO$/i, '');
    if (t) window.open(`https://www.capitoltrades.com/trades/${t}`, '_blank', 'noopener');
  }

  function handleTickerSearch(e: React.FormEvent) {
    e.preventDefault();
    if (tickerSearch.trim()) openCapitolTrades(tickerSearch);
  }

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg-primary)', padding: '28px 16px 48px' }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>

        {/* ── Header ── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Building2 size={20} color="var(--accent-blue-light)" />
            <h1 style={{
              margin: 0, fontSize: 20, fontWeight: 700,
              color: 'var(--text-primary)', fontFamily: "'Inter', sans-serif", letterSpacing: '-0.02em',
            }}>
              Congress Trades
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text-tertiary)' }}>
            STOCK Act disclosures · House + Senate · Required within 45 days of trade
          </p>
        </div>

        {/* ── Live data banner ── */}
        <a
          href="https://www.capitoltrades.com/trades"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', borderRadius: 12, marginBottom: 24,
            background: 'rgba(22,82,240,0.1)', border: '1px solid rgba(22,82,240,0.3)',
            textDecoration: 'none', transition: 'border-color 150ms',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(22,82,240,0.6)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(22,82,240,0.3)')}
        >
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: 'var(--accent-blue-light)' }}>
              View all live congressional trades on Capitol Trades →
            </p>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)' }}>
              200+ politicians tracked · updated daily · House + Senate · real-time STOCK Act data
            </p>
          </div>
          <ExternalLink size={15} color="var(--accent-blue-light)" style={{ flexShrink: 0, marginLeft: 12 }} />
        </a>

        {/* ── Ticker search ── */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Search by Stock
          </p>
          <form onSubmit={handleTickerSearch} style={{ display: 'flex', gap: 8 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)', pointerEvents: 'none' }} />
              <input
                ref={inputRef}
                value={tickerSearch}
                onChange={e => setTickerSearch(e.target.value.toUpperCase())}
                placeholder="AAPL, NVDA, TSLA..."
                style={{
                  width: '100%', padding: '10px 12px 10px 34px', borderRadius: 10,
                  background: 'var(--bg-elevated)', border: '1px solid var(--border-default)',
                  color: 'var(--text-primary)', fontSize: 14, fontFamily: "'Roboto Mono', monospace",
                  outline: 'none',
                }}
                onFocus={e => (e.target.style.borderColor = 'var(--accent-blue)')}
                onBlur={e => (e.target.style.borderColor = 'var(--border-default)')}
              />
            </div>
            <button
              type="submit"
              disabled={!tickerSearch.trim()}
              style={{
                padding: '10px 18px', borderRadius: 10, fontWeight: 600, fontSize: 13,
                background: tickerSearch.trim() ? 'var(--accent-blue)' : 'var(--bg-elevated)',
                color: tickerSearch.trim() ? '#fff' : 'var(--text-tertiary)',
                border: 'none', cursor: tickerSearch.trim() ? 'pointer' : 'default',
                fontFamily: "'Inter', sans-serif", transition: 'all 150ms',
                display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
              }}
            >
              View trades <ExternalLink size={13} />
            </button>
          </form>
        </div>

        {/* ── Watchlist quick links ── */}
        {watchlist.length > 0 && (
          <div style={{ marginBottom: 28 }}>
            <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
              Your Watchlist
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {watchlist.map(item => {
                const ticker = item.symbol.replace(/\.TO$/i, '');
                const historical = (historicalTrades ?? []).filter(t => t.ticker === ticker);
                return (
                  <button
                    key={item.symbol}
                    onClick={() => openCapitolTrades(ticker)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 14px', borderRadius: 10,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                      cursor: 'pointer', transition: 'border-color 150ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace" }}>
                      {ticker}
                    </span>
                    {historical.length > 0 && (
                      <span style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 8, fontWeight: 600,
                        background: 'rgba(22,82,240,0.15)', color: 'var(--accent-blue-light)',
                      }}>
                        {historical.length} historical
                      </span>
                    )}
                    <ExternalLink size={11} color="var(--text-tertiary)" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Notable members ── */}
        <div style={{ marginBottom: 28 }}>
          <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
            Notable Members — View Portfolio on Capitol Trades
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {NOTABLE_MEMBERS.map(m => {
              const pc = partyColor(m.party);
              return (
                <a
                  key={m.slug}
                  href={`https://www.capitoltrades.com/politicians/${m.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                    borderRadius: 10, textDecoration: 'none',
                    background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                    transition: 'border-color 150ms',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                    background: pc.bg, color: pc.color, fontFamily: "'Roboto Mono', monospace",
                    minWidth: 20, textAlign: 'center', flexShrink: 0,
                  }}>
                    {m.party}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 1px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.name}
                    </p>
                    <p style={{ margin: 0, fontSize: 10, color: 'var(--text-tertiary)' }}>{m.chamber}</p>
                  </div>
                  <ExternalLink size={11} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                </a>
              );
            })}
          </div>
        </div>

        {/* ── Historical senate data ── */}
        {!isLoading && historicalTrades && historicalTrades.length > 0 && (
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
              <p style={{ margin: 0, fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
                Historical Senate Trades
              </p>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)', background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 6 }}>
                pre-2021 · Senate only
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {historicalTrades.slice(0, 20).map((t, i) => {
                const isBuy = t.type === 'purchase';
                const tradeColor = isBuy ? '#05B169' : t.type === 'sale' ? '#F6465D' : 'var(--text-tertiary)';
                const tradeBg   = isBuy ? 'rgba(5,177,105,0.1)' : t.type === 'sale' ? 'rgba(246,70,93,0.1)' : 'var(--bg-hover)';
                return (
                  <button
                    key={`${t.member}-${t.ticker}-${t.transactionDate}-${i}`}
                    onClick={() => navigate(`/stock/${t.ticker}`)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      borderRadius: 10, background: 'var(--bg-elevated)',
                      border: '1px solid var(--border-subtle)', textAlign: 'left', width: '100%',
                      cursor: 'pointer', transition: 'border-color 150ms',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                  >
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 7px', borderRadius: 6, background: 'var(--bg-hover)', color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace", minWidth: 48, textAlign: 'center', flexShrink: 0 }}>
                      {t.ticker}
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, background: tradeBg, color: tradeColor, textTransform: 'uppercase', fontFamily: "'Roboto Mono', monospace", flexShrink: 0 }}>
                      {t.type}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ margin: '0 0 1px', fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t.member}
                      </p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'Roboto Mono', monospace" }}>
                        {t.amount} · {t.transactionDate.slice(0, 10)}
                      </p>
                    </div>
                    {t.filingUrl && (
                      <a href={t.filingUrl} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        style={{ color: 'var(--text-tertiary)', flexShrink: 0 }}>
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── No data message ── */}
        {!isLoading && (!historicalTrades || historicalTrades.length === 0) && watchlist.length > 0 && (
          <div style={{ padding: '20px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
              No historical senate trades found for your watchlist tickers.
            </p>
          </div>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 24, textAlign: 'center' }}>
          Live data powered by <a href="https://www.capitoltrades.com" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-blue-light)' }}>Capitol Trades</a> ·
          Historical senate data via Senate Stock Watcher (pre-2021)
        </p>
      </div>
    </div>
  );
}
