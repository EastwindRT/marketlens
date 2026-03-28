import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Clock, TrendingUp } from 'lucide-react';
import { finnhub } from '../../api/finnhub';

function useDebounceLocal<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

interface SearchResult {
  symbol: string;
  description: string;
  type: string;
}

interface SearchBarProps {
  onClose?: () => void;
  autoFocus?: boolean;
}

const POPULAR_STOCKS = [
  { symbol: 'AAPL', description: 'Apple Inc.', type: 'Common Stock' },
  { symbol: 'MSFT', description: 'Microsoft Corporation', type: 'Common Stock' },
  { symbol: 'NVDA', description: 'NVIDIA Corporation', type: 'Common Stock' },
  { symbol: 'SHOP.TO', description: 'Shopify Inc.', type: 'Common Stock' },
  { symbol: 'TD.TO', description: 'Toronto-Dominion Bank', type: 'Common Stock' },
];

export function SearchBar({ onClose, autoFocus = false }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('ml-recent-searches') || '[]'); } catch { return []; }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const debouncedQuery = useDebounceLocal(query, 300);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape') {
        setOpen(false);
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    const hasKey = !!import.meta.env.VITE_FINNHUB_API_KEY;
    if (!hasKey) {
      const filtered = POPULAR_STOCKS.filter(s =>
        s.symbol.toLowerCase().includes(debouncedQuery.toLowerCase()) ||
        s.description.toLowerCase().includes(debouncedQuery.toLowerCase())
      );
      setResults(filtered);
      setLoading(false);
      return;
    }
    finnhub.search(debouncedQuery)
      .then(res => {
        setResults((res.result || []).slice(0, 8).map((r: any) => ({
          symbol: r.symbol,
          description: r.description,
          type: r.type,
        })));
      })
      .catch(() => setResults([]))
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  const handleSelect = (symbol: string) => {
    const updated = [symbol, ...recentSearches.filter(s => s !== symbol)].slice(0, 5);
    setRecentSearches(updated);
    localStorage.setItem('ml-recent-searches', JSON.stringify(updated));
    navigate(`/stock/${symbol}`);
    setQuery('');
    setOpen(false);
    onClose?.();
  };

  const showDropdown = open && (query.length > 0 || recentSearches.length > 0);

  return (
    <div className="relative" style={{ width: 320 }}>
      <div
        className="flex items-center gap-2 px-3 py-2 rounded-xl"
        style={{
          background: 'var(--bg-elevated)',
          border: `1px solid ${open ? 'var(--accent-blue)' : 'var(--border-default)'}`,
          transition: 'border-color 150ms ease-out',
        }}
      >
        <Search size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder="Search stocks... ⌘K"
          className="flex-1 bg-transparent outline-none text-sm"
          style={{ color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]); }} style={{ color: 'var(--text-tertiary)', cursor: 'pointer', border: 'none', background: 'none', padding: 0 }}>
            <X size={14} />
          </button>
        )}
        {!query && (
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: 'var(--text-tertiary)', background: 'var(--bg-hover)', fontSize: 10 }}>
            ⌘K
          </span>
        )}
      </div>

      {showDropdown && (
        <div
          className="absolute top-full mt-2 w-full rounded-xl overflow-hidden z-50"
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-default)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            minWidth: 320,
          }}
        >
          {recentSearches.length > 0 && !query && (
            <div>
              <div className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Recent
              </div>
              {recentSearches.map(s => (
                <button
                  key={s}
                  onClick={() => handleSelect(s)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors"
                  style={{ color: 'var(--text-primary)', cursor: 'pointer', border: 'none', background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <Clock size={14} style={{ color: 'var(--text-tertiary)' }} />
                  <span className="font-mono font-medium">{s}</span>
                </button>
              ))}
            </div>
          )}

          {!query && (
            <div>
              <div className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Popular
              </div>
              {POPULAR_STOCKS.map(s => (
                <button
                  key={s.symbol}
                  onClick={() => handleSelect(s.symbol)}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors"
                  style={{ color: 'var(--text-primary)', cursor: 'pointer', border: 'none', background: 'transparent' }}
                  onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <TrendingUp size={14} style={{ color: 'var(--text-tertiary)' }} />
                  <span className="font-mono font-medium" style={{ minWidth: 80 }}>{s.symbol}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>{s.description}</span>
                </button>
              ))}
            </div>
          )}

          {query && loading && (
            <div className="px-3 py-4 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
              Searching...
            </div>
          )}

          {query && !loading && results.length === 0 && (
            <div className="px-3 py-4 text-sm text-center" style={{ color: 'var(--text-secondary)' }}>
              No results for "{query}"
            </div>
          )}

          {query && !loading && results.map(r => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r.symbol)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-sm"
              style={{ color: 'var(--text-primary)', cursor: 'pointer', border: 'none', background: 'transparent' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="font-mono font-semibold" style={{ minWidth: 80, color: 'var(--text-primary)' }}>{r.symbol}</span>
              <span className="truncate" style={{ color: 'var(--text-secondary)' }}>{r.description}</span>
              <span className="ml-auto text-xs" style={{ color: 'var(--text-tertiary)' }}>{r.type}</span>
            </button>
          ))}
        </div>
      )}

      {showDropdown && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}
