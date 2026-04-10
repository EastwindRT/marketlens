import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../api/supabase';
import { signOutGoogle } from '../api/supabase';

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
      logout: () => {
        signOutGoogle(); // sign out from Supabase Auth (fires SIGNED_OUT → clears player)
        set({ player: null });
      },
      updateCash: (cash) =>
        set((state) => state.player ? { player: { ...state.player, cash } } : {}),
    }),
    { name: 'tars-league-session' }
  )
);
