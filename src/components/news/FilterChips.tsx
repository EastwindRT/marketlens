import type { NewsCategory } from '../../api/news';

type FilterOption = {
  id: NewsCategory | 'all';
  label: string;
};

interface FilterChipsProps {
  value: NewsCategory | 'all';
  onChange: (next: NewsCategory | 'all') => void;
  options?: FilterOption[];
}

const defaultOptions: FilterOption[] = [
  { id: 'all', label: 'All' },
  { id: 'macro', label: 'Macro' },
  { id: 'sector', label: 'Sector' },
  { id: 'company', label: 'Company' },
  { id: 'policy', label: 'Policy' },
  { id: 'us_politics', label: 'US Politics' },
  { id: 'canada_macro', label: 'Canada' },
  { id: 'trade_policy', label: 'Trade Policy' },
  { id: 'geopolitical', label: 'Geopolitical' },
];

export function FilterChips({
  value,
  onChange,
  options = defaultOptions,
}: FilterChipsProps) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        paddingBottom: 2,
      }}
    >
      {options.map((option) => {
        const active = value === option.id;
        return (
          <button
            key={option.id}
            onClick={() => onChange(option.id)}
            style={{
              flexShrink: 0,
              padding: '8px 14px',
              borderRadius: 999,
              border: `1px solid ${active ? 'var(--accent-blue)' : 'var(--border-default)'}`,
              background: active ? 'var(--accent-blue)' : 'var(--bg-elevated)',
              color: active ? '#fff' : 'var(--text-secondary)',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 140ms ease',
              whiteSpace: 'nowrap',
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
