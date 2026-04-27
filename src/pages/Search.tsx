import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search as SearchIcon, AlertCircle } from 'lucide-react';
import { finnhub } from '../api/finnhub';
import { tmx } from '../api/tmx';
import { Skeleton } from '../components/ui/LoadingSkeleton';
import { recordSearchLog } from '../api/supabase';
import { useLeagueStore } from '../store/leagueStore';

export default function Search() {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const player = useLeagueStore((state) => state.player);
  const [loggedQuery, setLoggedQuery] = useState('');

  function looksLikeCanadianExactTicker(value: string) {
    return /^[A-Z0-9-]+\.(TO|TSX|V|TSXV)$/i.test(value.trim());
  }

  useEffect(() => {
    if (!query) { setResults([]); setError(null); return; }
    setLoading(true);
    setError(null);
    const timeout = setTimeout(async () => {
      try {
        if (!import.meta.env.VITE_FINNHUB_API_KEY) {
          setResults([
            { symbol: 'AAPL', description: 'Apple Inc.', type: 'Common Stock' },
            { symbol: 'MSFT', description: 'Microsoft Corporation', type: 'Common Stock' },
            { symbol: 'SHOP.TO', description: 'Shopify Inc.', type: 'Common Stock' },
            { symbol: 'NVDA', description: 'NVIDIA Corporation', type: 'Common Stock' },
            { symbol: 'TD.TO', description: 'Toronto-Dominion Bank', type: 'Common Stock' },
          ].filter(r => r.symbol.toLowerCase().includes(query.toLowerCase()) || r.description.toLowerCase().includes(query.toLowerCase())));
        } else {
          const exactCanadian = looksLikeCanadianExactTicker(query)
            ? await tmx.getQuote(query).then((quote) => quote ? [{
                symbol: query.trim().toUpperCase(),
                description: quote.name || query.trim().toUpperCase(),
                type: quote.exchangeCode || 'TSXV',
              }] : []).catch(() => [])
            : [];

          const res = await finnhub.search(query);
          const finnhubResults = res.result?.slice(0, 20) || [];
          const exactSymbol = query.trim().toUpperCase();
          const merged = [...exactCanadian];
          for (const item of finnhubResults) {
            if (merged.some((existing) => existing.symbol.toUpperCase() === item.symbol.toUpperCase())) continue;
            merged.push(item);
          }

          merged.sort((a, b) => {
            const aExact = a.symbol.toUpperCase() === exactSymbol ? 1 : 0;
            const bExact = b.symbol.toUpperCase() === exactSymbol ? 1 : 0;
            return bExact - aExact;
          });

          setResults(merged);
        }
      } catch (err: any) {
        setError(err?.message || 'Search failed');
        setResults([]);
      }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const cleanQuery = query.trim();
    if (!player?.id || loading || error || cleanQuery.length < 2 || cleanQuery === loggedQuery) return;

    setLoggedQuery(cleanQuery);
    void recordSearchLog(player.id, cleanQuery, null).catch((logError) => {
      console.warn('[Search] failed to record search log:', logError);
    });
  }, [player?.id, query, loading, error, loggedQuery]);

  useEffect(() => {
    if (!query.trim()) {
      setLoggedQuery('');
    }
  }, [query]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Search Stocks</h1>
        <div
          className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-default)' }}
        >
          <SearchIcon size={18} style={{ color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by name or ticker..."
            autoFocus
            className="flex-1 bg-transparent outline-none text-base"
            style={{ color: 'var(--text-primary)', fontFamily: 'Inter, sans-serif' }}
          />
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 rounded-xl" style={{ background: 'var(--bg-surface)' }}>
              <Skeleton width={60} height={20} />
              <Skeleton width={200} height={16} />
            </div>
          ))}
        </div>
      )}

      {!loading && results.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
          {results.map((r, i) => (
            <div
              key={r.symbol}
              className="flex items-center gap-4 px-4 py-3.5 cursor-pointer"
              style={{
                borderBottom: i < results.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                background: 'var(--bg-surface)',
              }}
              onClick={() => {
                if (player?.id) {
                  void recordSearchLog(player.id, query.trim(), r.symbol).catch((logError) => {
                    console.warn('[Search] failed to record selected result:', logError);
                  });
                }
                navigate(`/stock/${r.symbol}`);
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-elevated)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'var(--bg-surface)')}
            >
              <span className="font-mono font-bold text-sm" style={{ minWidth: 80, color: 'var(--text-primary)' }}>
                {r.symbol}
              </span>
              <span className="flex-1" style={{ color: 'var(--text-secondary)' }}>{r.description}</span>
              <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}>
                {r.type}
              </span>
            </div>
          ))}
        </div>
      )}

      {!loading && error && (
        <div
          className="flex items-center gap-2 p-4 rounded-xl text-sm"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--color-down)', color: 'var(--color-down)' }}
        >
          <AlertCircle size={15} />
          <span>Search unavailable — {error}. Try again in a moment.</span>
        </div>
      )}

      {!loading && !error && query && results.length === 0 && (
        <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>
          No results found for "{query}"
        </div>
      )}
    </div>
  );
}
