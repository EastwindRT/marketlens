import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WatchlistItem {
  symbol: string;
  name?: string;
  exchange?: string;
}

interface WatchlistStore {
  items: WatchlistItem[];
  addItem: (item: WatchlistItem) => void;
  removeItem: (symbol: string) => void;
  hasItem: (symbol: string) => boolean;
}

export const useWatchlistStore = create<WatchlistStore>()(
  persist(
    (set, get) => ({
      items: [
        { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ' },
        { symbol: 'SHOP.TO', name: 'Shopify Inc.', exchange: 'TSX' },
        { symbol: 'TD.TO', name: 'TD Bank', exchange: 'TSX' },
        { symbol: 'MSFT', name: 'Microsoft Corp.', exchange: 'NASDAQ' },
        { symbol: 'NVDA', name: 'NVIDIA Corp.', exchange: 'NASDAQ' },
      ],
      addItem: (item) => {
        if (!get().hasItem(item.symbol)) {
          set((state) => ({ items: [...state.items, item] }));
        }
      },
      removeItem: (symbol) =>
        set((state) => ({ items: state.items.filter((i) => i.symbol !== symbol) })),
      hasItem: (symbol) => get().items.some((i) => i.symbol === symbol),
    }),
    { name: 'moneytalks-watchlist' }
  )
);
