import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Player } from '../api/supabase';
import { signOutGoogle } from '../api/supabase';

interface LeagueStore {
  player: Player | null;
  playerStatus: 'idle' | 'loading' | 'ready' | 'error' | 'timed_out';
  setPlayer: (p: Player | null) => void;
  setPlayerStatus: (status: LeagueStore['playerStatus']) => void;
  logout: () => void;
}

export const useLeagueStore = create<LeagueStore>()(
  persist(
    (set) => ({
      player: null,
      playerStatus: 'idle',
      setPlayer: (player) => set({ player }),
      setPlayerStatus: (playerStatus) => set({ playerStatus }),
      logout: () => {
        signOutGoogle(); // sign out from Supabase Auth (fires SIGNED_OUT → clears player)
        set({ player: null, playerStatus: 'idle' });
      },
    }),
    {
      name: 'tars-league-session',
      partialize: (state) => ({ player: state.player }),
    }
  )
);
