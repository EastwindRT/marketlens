import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../api/supabase';
import { executeBuy, executeSell, findTradeByClientRef, isLikelyTransientTradeError } from '../api/supabase';

export type PendingTradeStatus = 'pending' | 'syncing' | 'failed';
export type PendingTradeType = 'BUY' | 'SELL';

export interface PendingTrade {
  id: string;
  playerId: string;
  symbol: string;
  exchange: string;
  tradeType: PendingTradeType;
  shares: number;
  price: number;
  total: number;
  tradedAt?: string | null;
  note?: string | null;
  createdAt: string;
  status: PendingTradeStatus;
  attemptCount: number;
  lastError?: string | null;
}

interface PendingTradeStore {
  trades: PendingTrade[];
  enqueueTrade: (trade: Omit<PendingTrade, 'status' | 'attemptCount' | 'lastError'>) => void;
  markTradeSyncing: (id: string) => void;
  markTradeFailed: (id: string, error?: string | null) => void;
  markTradeSynced: (id: string) => void;
  clearPlayerTrades: (playerId: string) => void;
}

export const usePendingTradeStore = create<PendingTradeStore>()(
  persist(
    (set) => ({
      trades: [],
      enqueueTrade: (trade) =>
        set((state) => ({
          trades: [
            ...state.trades,
            {
              ...trade,
              status: 'pending',
              attemptCount: 0,
              lastError: null,
            },
          ],
        })),
      markTradeSyncing: (id) =>
        set((state) => ({
          trades: state.trades.map((trade) =>
            trade.id === id
              ? {
                  ...trade,
                  status: 'syncing',
                  attemptCount: trade.attemptCount + 1,
                  lastError: null,
                }
              : trade
          ),
        })),
      markTradeFailed: (id, error) =>
        set((state) => ({
          trades: state.trades.map((trade) =>
            trade.id === id
              ? {
                  ...trade,
                  status: 'failed',
                  lastError: error ?? 'Sync failed',
                }
              : trade
          ),
        })),
      markTradeSynced: (id) =>
        set((state) => ({
          trades: state.trades.filter((trade) => trade.id !== id),
        })),
      clearPlayerTrades: (playerId) =>
        set((state) => ({
          trades: state.trades.filter((trade) => trade.playerId !== playerId),
        })),
    }),
    {
      name: 'tars-pending-trades',
    }
  )
);

let syncInFlight = false;

export async function syncPendingTradesForPlayer(player: Player): Promise<void> {
  if (syncInFlight) return;

  const queue = usePendingTradeStore
    .getState()
    .trades
    .filter((trade) => trade.playerId === player.id && trade.status !== 'syncing')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (queue.length === 0) return;

  syncInFlight = true;
  try {
    for (const trade of queue) {
      usePendingTradeStore.getState().markTradeSyncing(trade.id);

      try {
        const existing = await findTradeByClientRef(player.id, trade.id);
        if (existing) {
          usePendingTradeStore.getState().markTradeSynced(trade.id);
          continue;
        }

        const result =
          trade.tradeType === 'BUY'
            ? await executeBuy(player, trade.symbol, trade.exchange, trade.shares, trade.price, trade.tradedAt, trade.note)
            : await executeSell(player, trade.symbol, trade.exchange, trade.shares, trade.price, trade.tradedAt, trade.note);

        if (result.success) {
          usePendingTradeStore.getState().markTradeSynced(trade.id);
          continue;
        }

        usePendingTradeStore.getState().markTradeFailed(trade.id, result.error ?? 'Sync failed');
        if (!isLikelyTransientTradeError(result.error)) {
          continue;
        }
      } catch (error) {
        const message = String((error as Error)?.message || error);
        usePendingTradeStore.getState().markTradeFailed(trade.id, message);
      }
    }
  } finally {
    syncInFlight = false;
  }
}
