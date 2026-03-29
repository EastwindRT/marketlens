import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Types ────────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  pin: string;
  avatar_color: string;
  cash: number;
  created_at: string;
}

export interface Holding {
  id: string;
  player_id: string;
  symbol: string;
  exchange: string;
  shares: number;
  avg_cost: number;
  updated_at: string;
}

export interface Trade {
  id: string;
  player_id: string;
  symbol: string;
  exchange: string;
  trade_type: 'BUY' | 'SELL';
  shares: number;
  price: number;
  total: number;
  traded_at: string;
}

// ── Player queries ────────────────────────────────────────────────────────────

export async function getAllPlayers(): Promise<Player[]> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function loginPlayer(name: string, pin: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('name', name)
    .eq('pin', pin)
    .single();
  if (error) return null;
  return data;
}

// ── Holdings queries ──────────────────────────────────────────────────────────

export async function getHoldings(playerId: string): Promise<Holding[]> {
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .eq('player_id', playerId);
  if (error) throw error;
  return data ?? [];
}

export async function getAllHoldings(): Promise<Holding[]> {
  const { data, error } = await supabase.from('holdings').select('*');
  if (error) throw error;
  return data ?? [];
}

// ── Trade execution ───────────────────────────────────────────────────────────

export async function executeBuy(
  player: Player,
  symbol: string,
  exchange: string,
  shares: number,
  price: number
): Promise<{ success: boolean; error?: string }> {
  const total = shares * price;
  if (total > player.cash) {
    return { success: false, error: `Insufficient funds. Need $${total.toFixed(2)}, have $${player.cash.toFixed(2)}` };
  }

  // Deduct cash
  const { error: cashError } = await supabase
    .from('players')
    .update({ cash: player.cash - total })
    .eq('id', player.id);
  if (cashError) return { success: false, error: cashError.message };

  // Upsert holding (merge with existing)
  const { data: existing } = await supabase
    .from('holdings')
    .select('*')
    .eq('player_id', player.id)
    .eq('symbol', symbol)
    .single();

  if (existing) {
    const newShares = existing.shares + shares;
    const newAvgCost = (existing.shares * existing.avg_cost + shares * price) / newShares;
    const { error } = await supabase
      .from('holdings')
      .update({ shares: newShares, avg_cost: newAvgCost, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
    if (error) return { success: false, error: error.message };
  } else {
    const { error } = await supabase
      .from('holdings')
      .insert({ player_id: player.id, symbol, exchange, shares, avg_cost: price });
    if (error) return { success: false, error: error.message };
  }

  // Log trade
  await supabase.from('trades').insert({
    player_id: player.id, symbol, exchange,
    trade_type: 'BUY', shares, price, total,
  });

  return { success: true };
}

export async function executeSell(
  player: Player,
  symbol: string,
  exchange: string,
  shares: number,
  price: number
): Promise<{ success: boolean; error?: string }> {
  const { data: existing } = await supabase
    .from('holdings')
    .select('*')
    .eq('player_id', player.id)
    .eq('symbol', symbol)
    .single();

  if (!existing || existing.shares < shares) {
    return { success: false, error: `Not enough shares. Have ${existing?.shares ?? 0}, trying to sell ${shares}` };
  }

  const total = shares * price;

  // Add cash back
  const { error: cashError } = await supabase
    .from('players')
    .update({ cash: player.cash + total })
    .eq('id', player.id);
  if (cashError) return { success: false, error: cashError.message };

  // Update or delete holding
  const newShares = existing.shares - shares;
  if (newShares < 0.0001) {
    await supabase.from('holdings').delete().eq('id', existing.id);
  } else {
    await supabase
      .from('holdings')
      .update({ shares: newShares, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  }

  // Log trade
  await supabase.from('trades').insert({
    player_id: player.id, symbol, exchange,
    trade_type: 'SELL', shares, price, total,
  });

  return { success: true };
}

// ── Recent trades (activity feed) ────────────────────────────────────────────

export async function getRecentTrades(limit = 20): Promise<(Trade & { player_name: string })[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*, players(name)')
    .order('traded_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((t: Trade & { players?: { name: string } }) => ({
    ...t,
    player_name: t.players?.name ?? 'Unknown',
  }));
}
