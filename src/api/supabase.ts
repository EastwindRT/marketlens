import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── Types ────────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  pin: string;
  google_email?: string;
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

export interface WatchlistRecord {
  id: string;
  player_id: string;
  symbol: string;
  name?: string;
  exchange?: string;
  created_at: string;
  updated_at: string;
}

export interface WatchlistInput {
  symbol: string;
  name?: string;
  exchange?: string;
}

// ── Google OAuth auth ─────────────────────────────────────────────────────────

export async function signInWithGoogle(): Promise<void> {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  });
}

export async function getPlayerByGoogleEmail(email: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('google_email', email.toLowerCase())
    .single();
  if (error) return null;
  return data;
}

export async function signOutGoogle(): Promise<void> {
  await supabase.auth.signOut();
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

// -- Watchlist persistence ----------------------------------------------------

export async function getWatchlist(playerId: string): Promise<WatchlistInput[]> {
  const { data, error } = await supabase
    .from('watchlists')
    .select('*')
    .eq('player_id', playerId)
    .order('updated_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((item: WatchlistRecord) => ({
    symbol: item.symbol,
    name: item.name,
    exchange: item.exchange,
  }));
}

export async function upsertWatchlistItem(playerId: string, item: WatchlistInput): Promise<void> {
  const payload = {
    player_id: playerId,
    symbol: item.symbol,
    name: item.name ?? null,
    exchange: item.exchange ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('watchlists')
    .upsert(payload, { onConflict: 'player_id,symbol' });
  if (error) throw error;
}

export async function removeWatchlistItem(playerId: string, symbol: string): Promise<void> {
  const { error } = await supabase
    .from('watchlists')
    .delete()
    .eq('player_id', playerId)
    .eq('symbol', symbol);
  if (error) throw error;
}

export async function replaceWatchlist(playerId: string, items: WatchlistInput[]): Promise<void> {
  const { error: deleteError } = await supabase
    .from('watchlists')
    .delete()
    .eq('player_id', playerId);
  if (deleteError) throw deleteError;

  if (items.length === 0) return;

  const now = new Date().toISOString();
  const rows = items.map((item) => ({
    player_id: playerId,
    symbol: item.symbol,
    name: item.name ?? null,
    exchange: item.exchange ?? null,
    created_at: now,
    updated_at: now,
  }));

  const { error: insertError } = await supabase
    .from('watchlists')
    .insert(rows);
  if (insertError) throw insertError;
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

// ── Admin operations ──────────────────────────────────────────────────────────

export async function getPlayerTrades(playerId: string): Promise<Trade[]> {
  const { data, error } = await supabase
    .from('trades')
    .select('*')
    .eq('player_id', playerId)
    .order('traded_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function adminResetPlayer(playerId: string): Promise<void> {
  // Delete trades and holdings, reset cash to starting amount
  await supabase.from('trades').delete().eq('player_id', playerId);
  await supabase.from('holdings').delete().eq('player_id', playerId);
  const { error } = await supabase
    .from('players')
    .update({ cash: 1000 })
    .eq('id', playerId);
  if (error) throw error;
}

export async function adminResetAll(): Promise<void> {
  await supabase.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('holdings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  const { error } = await supabase
    .from('players')
    .update({ cash: 1000 })
    .neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) throw error;
}

export async function adminUndoTrade(trade: Trade): Promise<void> {
  // Fetch current player cash
  const { data: player, error: playerErr } = await supabase
    .from('players').select('cash').eq('id', trade.player_id).single();
  if (playerErr || !player) throw playerErr ?? new Error('Player not found');

  if (trade.trade_type === 'BUY') {
    // Reverse a buy: refund cash, reduce shares
    const newCash = player.cash + trade.total;
    await supabase.from('players').update({ cash: newCash }).eq('id', trade.player_id);

    const { data: holding } = await supabase
      .from('holdings').select('*').eq('player_id', trade.player_id).eq('symbol', trade.symbol).single();
    if (holding) {
      const newShares = holding.shares - trade.shares;
      if (newShares < 0.0001) {
        await supabase.from('holdings').delete().eq('id', holding.id);
      } else {
        await supabase.from('holdings').update({ shares: newShares }).eq('id', holding.id);
      }
    }
  } else {
    // Reverse a sell: deduct cash, restore shares
    const newCash = player.cash - trade.total;
    await supabase.from('players').update({ cash: newCash }).eq('id', trade.player_id);

    const { data: holding } = await supabase
      .from('holdings').select('*').eq('player_id', trade.player_id).eq('symbol', trade.symbol).single();
    if (holding) {
      await supabase.from('holdings').update({ shares: holding.shares + trade.shares }).eq('id', holding.id);
    } else {
      await supabase.from('holdings').insert({
        player_id: trade.player_id, symbol: trade.symbol, exchange: trade.exchange,
        shares: trade.shares, avg_cost: trade.price,
      });
    }
  }

  // Delete the trade record
  await supabase.from('trades').delete().eq('id', trade.id);
}

export async function adminDeletePlayer(playerId: string): Promise<void> {
  await supabase.from('trades').delete().eq('player_id', playerId);
  await supabase.from('holdings').delete().eq('player_id', playerId);
  const { error } = await supabase.from('players').delete().eq('id', playerId);
  if (error) throw error;
}

export async function adminSetCash(playerId: string, amount: number): Promise<void> {
  const { error } = await supabase
    .from('players')
    .update({ cash: amount })
    .eq('id', playerId);
  if (error) throw error;
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
