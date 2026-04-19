import { useNavigate } from 'react-router-dom';
import { usePeerComparison } from '../../hooks/usePeerComparison';
import { formatPrice, formatChange } from '../../utils/formatters';

interface Props {
  symbol: string;
}

export function PeerComparison({ symbol }: Props) {
  const navigate = useNavigate();
  const { data: peers, isLoading } = usePeerComparison(symbol);

  if (isLoading) {
    return (
      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 20, paddingBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 12 }}>
          Peer Comparison
        </div>
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {[1, 2, 3, 4].map(i => (
            <div key={i} style={{ minWidth: 110, height: 72, borderRadius: 10, background: 'var(--bg-elevated)', flexShrink: 0 }} className="animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!peers || peers.length === 0) return null;

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 20, paddingBottom: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 12 }}>
        Peer Comparison
      </div>
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
        {peers.map(peer => {
          const isUp = peer.changePct >= 0;
          return (
            <button
              key={peer.symbol}
              onClick={() => navigate(`/stock/${peer.symbol}`)}
              style={{
                minWidth: 110, padding: '10px 12px', borderRadius: 10, textAlign: 'left',
                background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)',
                cursor: 'pointer', flexShrink: 0, transition: 'border-color 150ms',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-default)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, fontFamily: "'Roboto Mono', monospace" }}>
                {peer.symbol}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', fontFamily: "'Roboto Mono', monospace", marginBottom: 2 }}>
                {peer.price > 0 ? formatPrice(peer.price, 'USD') : '—'}
              </div>
              <div style={{ fontSize: 11, fontWeight: 500, color: isUp ? 'var(--color-up)' : 'var(--color-down)', fontFamily: "'Roboto Mono', monospace" }}>
                {peer.changePct !== 0 ? formatChange(peer.changePct) : '—'}
              </div>
              {peer.peRatio != null && (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  P/E {peer.peRatio.toFixed(1)}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
