import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../api/supabase';

interface LeagueStore {
  player: Player | null;
  setPlayer: (p: Player | null) => void;
  logout: () => void;
  updateCash: (cash: number) => void;
}

export const useLeagueStore = create<LeagueStore>()(
  persist(
    (set) => ({
      player: null,
      setPlayer: (player) => set({ player }),
      logout: () => set({ player: null }),
      updateCash: (cash) =>
        set((state) => state.player ? { player: { ...state.player, cash } } : {}),
    }),
    { name: 'moneytalks-league-session' }
  )
);
