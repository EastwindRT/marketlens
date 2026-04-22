import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getWatchlist,
  replaceWatchlist,
  removeWatchlistItem,
  upsertWatchlistItem,
} from '../api/supabase';

export interface WatchlistItem {
  symbol: string;
  name?: string;
  exchange?: string;
}

const LEGACY_DEFAULT_ITEMS: WatchlistItem[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
  { symbol: 'SHOP.TO', name: 'Shopify Inc.', exchange: 'TSX' },
  { symbol: 'TD.TO', name: 'TD Bank', exchange: 'TSX' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', exchange: 'NASDAQ' },
];

const HAS_SUPABASE =
  !!import.meta.env.VITE_SUPABASE_URL && !!import.meta.env.VITE_SUPABASE_ANON_KEY;

function normalizeItem(item: WatchlistItem): WatchlistItem {
  return {
    symbol: item.symbol.toUpperCase(),
    name: item.name,
    exchange: item.exchange,
  };
}

function dedupe(items: WatchlistItem[]): WatchlistItem[] {
  const seen = new Set<string>();
  const out: WatchlistItem[] = [];
  for (const item of items) {
    const normalized = normalizeItem(item);
    if (seen.has(normalized.symbol)) continue;
    seen.add(normalized.symbol);
    out.push(normalized);
  }
  return out;
}

const LEGACY_DEFAULT_SYMBOLS = dedupe(LEGACY_DEFAULT_ITEMS).map((item) => item.symbol).sort();

function isLegacySeededWatchlist(items: WatchlistItem[]): boolean {
  const symbols = dedupe(items).map((item) => item.symbol).sort();
  return (
    symbols.length === LEGACY_DEFAULT_SYMBOLS.length &&
    symbols.every((symbol, index) => symbol === LEGACY_DEFAULT_SYMBOLS[index])
  );
}

function sanitizeItems(items: WatchlistItem[]): WatchlistItem[] {
  const normalized = dedupe(items);
  return isLegacySeededWatchlist(normalized) ? [] : normalized;
}

interface WatchlistStore {
  items: WatchlistItem[];
  hydrated: boolean;
  syncing: boolean;
  currentPlayerId: string | null;
  initialize: (playerId: string | null) => Promise<void>;
  addItem: (item: WatchlistItem) => Promise<void>;
  removeItem: (symbol: string) => Promise<void>;
  hasItem: (symbol: string) => boolean;
}

export const useWatchlistStore = create<WatchlistStore>()(
  persist(
    (set, get) => ({
      items: [],
      hydrated: false,
      syncing: false,
      currentPlayerId: null,

      initialize: async (playerId) => {
        const fallbackItems = sanitizeItems(get().items);

        if (!playerId || !HAS_SUPABASE) {
          set({
            currentPlayerId: null,
            hydrated: true,
            syncing: false,
            items: fallbackItems,
          });
          return;
        }

        set({ currentPlayerId: playerId, hydrated: false, syncing: true });

        try {
          const remoteItems = sanitizeItems(await getWatchlist(playerId));

          if (remoteItems.length > 0) {
            set({
              items: remoteItems,
              currentPlayerId: playerId,
              hydrated: true,
              syncing: false,
            });
            return;
          }

          set({
            items: [],
            currentPlayerId: playerId,
            hydrated: true,
            syncing: false,
          });

          if (fallbackItems.length > 0) {
            await replaceWatchlist(playerId, fallbackItems);
            return;
          }

          await replaceWatchlist(playerId, []);
        } catch {
          set({
            items: fallbackItems,
            currentPlayerId: playerId,
            hydrated: true,
            syncing: false,
          });
        }
      },

      addItem: async (item) => {
        const normalized = normalizeItem(item);
        if (get().hasItem(normalized.symbol)) return;

        const nextItems = dedupe([...get().items, normalized]);
        set({ items: nextItems });

        const playerId = get().currentPlayerId;
        if (!playerId || !HAS_SUPABASE) return;

        try {
          await upsertWatchlistItem(playerId, normalized);
        } catch {
          // Keep local state intact as a fallback even if remote sync fails.
        }
      },

      removeItem: async (symbol) => {
        const normalizedSymbol = symbol.toUpperCase();
        const nextItems = get().items.filter((item) => item.symbol !== normalizedSymbol);
        set({ items: nextItems });

        const playerId = get().currentPlayerId;
        if (!playerId || !HAS_SUPABASE) return;

        try {
          await removeWatchlistItem(playerId, normalizedSymbol);
        } catch {
          // Keep local state intact as a fallback even if remote sync fails.
        }
      },

      hasItem: (symbol) => get().items.some((item) => item.symbol === symbol.toUpperCase()),
    }),
    {
      name: 'tars-watchlist',
      partialize: (state) => ({ items: state.items }),
    }
  )
);
