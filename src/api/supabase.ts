import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DB_STEP_TIMEOUT_MS = 8000;
const DB_STEP_RETRIES = 1;

async function withDbTimeout<T>(promise: Promise<T>, label: string, timeoutMs = DB_STEP_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runDbStep<T>(label: string, factory: () => Promise<T>, retries = DB_STEP_RETRIES): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await withDbTimeout(factory(), label);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label} failed`);
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Player {
  id: string;
  name: string;
  pin?: string | null;            // legacy — unused for new accounts
  google_email?: string | null;
  display_name?: string | null;   // preferred display name (defaults to name)
  avatar_color: string;
  cash?: number | null;           // legacy — ignored; unlimited theoretical dollars
  created_at: string;
  last_active_at?: string | null;
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

export interface PortfolioSnapshot {
  player: Player | null;
  holdings: Holding[];
  watchlist: WatchlistInput[];
}

export interface SearchLog {
  id: string;
  player_id: string;
  query: string;
  selected_symbol?: string | null;
  created_at: string;
  player_name?: string;
  player_email?: string | null;
}

export interface LeaderboardSnapshot {
  players: Player[];
  holdings: Holding[];
  recentTrades: (Trade & { player_name: string })[];
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
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function signOutGoogle(): Promise<void> {
  await supabase.auth.signOut();
}

// Auto-create a player row for a newly authenticated Google user.
// Idempotent — safe to call on every session restore.
const AVATAR_PALETTE = ['#1652F0', '#05B169', '#F6465D', '#F0A716', '#9B59B6', '#E67E22', '#1ABC9C', '#E74C3C', '#6366F1', '#14B8A6'];

export async function ensurePlayerForSession(session: {
  user: { email?: string | null; user_metadata?: Record<string, unknown> };
}): Promise<Player | null> {
  const email = session.user.email?.toLowerCase();
  if (!email) return null;

  // Existing?
  const existing = await getPlayerByGoogleEmail(email);
  if (existing) return existing;

  // Derive a name from Google metadata; fall back to email local-part.
  const meta = session.user.user_metadata ?? {};
  const metaName = (meta.full_name ?? meta.name ?? meta.user_name ?? '') as string;
  const localPart = email.split('@')[0];
  const displayName = (metaName || localPart).trim() || 'Trader';

  // Deterministic avatar colour from email hash for visual continuity.
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) | 0;
  const avatarColor = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];

  const { data, error } = await supabase
    .from('players')
    .insert({
      name: displayName,
      display_name: displayName,
      google_email: email,
      avatar_color: avatarColor,
      last_active_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    // Race condition — another tab created it. Fetch again.
    const recovered = await getPlayerByGoogleEmail(email);
    if (recovered) return recovered;
    throw error;
  }
  return data;
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

export async function getPlayerById(playerId: string): Promise<Player | null> {
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('id', playerId)
    .maybeSingle();
  if (error) return null;
  return data;
}

export async function touchPlayerActivity(playerId: string): Promise<void> {
  const { error } = await supabase
    .from('players')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', playerId);
  if (error) throw error;
}

export async function recordSearchLog(
  playerId: string,
  query: string,
  selectedSymbol?: string | null,
): Promise<void> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return;

  const { error } = await supabase
    .from('search_logs')
    .insert({
      player_id: playerId,
      query: cleanQuery.slice(0, 120),
      selected_symbol: selectedSymbol?.trim().toUpperCase() || null,
    });
  if (error) throw error;
}

export async function getRecentSearchLogs(limit = 100): Promise<SearchLog[]> {
  const { data, error } = await supabase
    .from('search_logs')
    .select('id, player_id, query, selected_symbol, created_at, players(name, google_email)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: row.id,
    player_id: row.player_id,
    query: row.query,
    selected_symbol: row.selected_symbol,
    created_at: row.created_at,
    player_name: row.players?.name ?? 'Unknown',
    player_email: row.players?.google_email ?? null,
  }));
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

export async function getPortfolioSnapshot(playerId: string): Promise<PortfolioSnapshot> {
  const res = await fetch(`/api/portfolio-snapshot?playerId=${encodeURIComponent(playerId)}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Portfolio snapshot request failed (${res.status})`);
  }

  const json = await res.json();
  return {
    player: json?.player ?? null,
    holdings: Array.isArray(json?.holdings) ? json.holdings : [],
    watchlist: Array.isArray(json?.watchlist) ? json.watchlist : [],
  };
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

// Trade execution — unlimited theoretical dollars, no cash balance concept.
// `tradedAt` is optional and lets users backfill historical positions.

export async function executeBuy(
  player: Player,
  symbol: string,
  exchange: string,
  shares: number,
  price: number,
  tradedAt?: string | null,
  note?: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(shares > 0) || !(price > 0)) {
      return { success: false, error: 'Shares and price must be greater than zero.' };
    }
    const total = shares * price;

    const { data: existing, error: existingError } = await runDbStep<any>(
      'Load existing holding',
      async () =>
        await supabase
          .from('holdings')
          .select('*')
          .eq('player_id', player.id)
          .eq('symbol', symbol)
          .maybeSingle(),
    );
    if (existingError) return { success: false, error: existingError.message };

    if (existing) {
      const newShares = existing.shares + shares;
      const newAvgCost = (existing.shares * existing.avg_cost + shares * price) / newShares;
      const { error } = await runDbStep<any>(
        'Update holding',
        async () =>
          await supabase
            .from('holdings')
            .update({ shares: newShares, avg_cost: newAvgCost, updated_at: new Date().toISOString() })
            .eq('id', existing.id),
      );
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await runDbStep<any>(
        'Create holding',
        async () =>
          await supabase
            .from('holdings')
            .insert({ player_id: player.id, symbol, exchange, shares, avg_cost: price }),
      );
      if (error) return { success: false, error: error.message };
    }

    const tradeRow: Record<string, unknown> = {
      player_id: player.id, symbol, exchange,
      trade_type: 'BUY', shares, price, total,
    };
    if (tradedAt) tradeRow.traded_at = tradedAt;
    if (note)     tradeRow.note = note;
    const { error: tradeError } = await runDbStep<any>(
      'Log trade',
      async () => await supabase.from('trades').insert(tradeRow),
    );
    if (tradeError) return { success: false, error: tradeError.message };

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Trade failed' };
  }
}

export async function executeSell(
  player: Player,
  symbol: string,
  exchange: string,
  shares: number,
  price: number,
  tradedAt?: string | null,
  note?: string | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!(shares > 0) || !(price > 0)) {
      return { success: false, error: 'Shares and price must be greater than zero.' };
    }

    const { data: existing, error: existingError } = await runDbStep<any>(
      'Load existing holding',
      async () =>
        await supabase
          .from('holdings')
          .select('*')
          .eq('player_id', player.id)
          .eq('symbol', symbol)
          .maybeSingle(),
    );
    if (existingError) return { success: false, error: existingError.message };

    if (!existing || existing.shares < shares) {
      return { success: false, error: `Not enough shares. Have ${existing?.shares ?? 0}, trying to sell ${shares}` };
    }

    const total = shares * price;
    const newShares = existing.shares - shares;
    if (newShares < 0.0001) {
      const { error } = await runDbStep<any>(
        'Delete holding',
        async () => await supabase.from('holdings').delete().eq('id', existing.id),
      );
      if (error) return { success: false, error: error.message };
    } else {
      const { error } = await runDbStep<any>(
        'Update holding',
        async () =>
          await supabase
            .from('holdings')
            .update({ shares: newShares, updated_at: new Date().toISOString() })
            .eq('id', existing.id),
      );
      if (error) return { success: false, error: error.message };
    }

    const tradeRow: Record<string, unknown> = {
      player_id: player.id, symbol, exchange,
      trade_type: 'SELL', shares, price, total,
    };
    if (tradedAt) tradeRow.traded_at = tradedAt;
    if (note)     tradeRow.note = note;
    const { error: tradeError } = await runDbStep<any>(
      'Log trade',
      async () => await supabase.from('trades').insert(tradeRow),
    );
    if (tradeError) return { success: false, error: tradeError.message };

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Trade failed' };
  }
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
  // Wipe trades + holdings — player row stays so they can continue.
  await supabase.from('trades').delete().eq('player_id', playerId);
  await supabase.from('holdings').delete().eq('player_id', playerId);
}

export async function adminResetAll(): Promise<void> {
  await supabase.from('trades').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('holdings').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}

export async function adminUndoTrade(trade: Trade): Promise<void> {
  // With unlimited theoretical dollars, undoing only touches the holding row.
  if (trade.trade_type === 'BUY') {
    const { data: holding } = await supabase
      .from('holdings').select('*').eq('player_id', trade.player_id).eq('symbol', trade.symbol).maybeSingle();
    if (holding) {
      const newShares = holding.shares - trade.shares;
      if (newShares < 0.0001) {
        await supabase.from('holdings').delete().eq('id', holding.id);
      } else {
        await supabase.from('holdings').update({ shares: newShares }).eq('id', holding.id);
      }
    }
  } else {
    // Reverse a sell: restore shares.
    const { data: holding } = await supabase
      .from('holdings').select('*').eq('player_id', trade.player_id).eq('symbol', trade.symbol).maybeSingle();
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

// adminSetCash removed — cash balance is no longer a concept. Keeping the export
// would only invite reintroduction. Callers should be deleted along with this.

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

export async function getLeaderboardSnapshot(limit = 8): Promise<LeaderboardSnapshot> {
  const res = await fetch(`/api/leaderboard-snapshot?limit=${encodeURIComponent(limit)}`);
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || `Leaderboard snapshot request failed (${res.status})`);
  }

  const json = await res.json();
  return {
    players: Array.isArray(json?.players) ? json.players : [],
    holdings: Array.isArray(json?.holdings) ? json.holdings : [],
    recentTrades: Array.isArray(json?.recentTrades) ? json.recentTrades : [],
  };
}
