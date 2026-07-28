/**
 * Alpha-only deck filter — shared, pure logic (extracted from listener.js /
 * solListener.js so both indexers use ONE definition and it's unit-testable).
 *
 * A market-maker / arb bot churns BOTH ways — balanced buys≈sells and a net
 * position ≈ 0 relative to its volume (it round-trips baskets of tokens at
 * near-identical sizes; a same-slot arbHits detector alone misses cross-token
 * baskets, this catches them). A real alpha whale is DIRECTIONAL: it either
 * accumulates (net buy) or exits (net sell), so |net|/volume stays high.
 *
 * These take plain data + options — no module-level state — so the two
 * listeners each pass their own MM_WALLETS/traderAgg/env-tunable lookups in,
 * and the actual decision math lives in exactly one place.
 */
export const DEFAULT_ARB_HITS_MAX = 3;
export const DEFAULT_CHURN_MIN_TRADES = 6;
export const DEFAULT_CHURN_NET_RATIO = 0.15;
export const DEFAULT_CHURN_BUYS_MAX = 12;

export function isChurnBot(agg, { minTrades = DEFAULT_CHURN_MIN_TRADES, netRatio = DEFAULT_CHURN_NET_RATIO } = {}) {
  if (!agg) return false;
  const buys = agg.buys || 0, sells = agg.sells || 0, trades = agg.trades || 0;
  if (trades < minTrades) return false;
  const balanced = buys >= 2 && sells >= 2 && Math.min(buys, sells) / Math.max(buys, sells) >= 0.5;
  const vol = agg.volumeMon || agg.volumeUsd || 0;
  const netTiny = vol > 0 && Math.abs(agg.netMon || 0) / vol < netRatio;
  return balanced && netTiny;
}

// Same-slot arb (arbHits) OR balanced net-≈0 churn = bot. `agg` may be absent
// (never-seen trader) → not a bot by this signal (caller still checks MM_WALLETS).
export function isBotAgg(agg, { arbHitsMax = DEFAULT_ARB_HITS_MAX, minTrades, netRatio } = {}) {
  if (!agg) return false;
  if ((agg.arbHits || 0) >= arbHitsMax) return true;
  return isChurnBot(agg, { minTrades, netRatio });
}

export function isAlphaCard(card, { isBot = false } = {}) {
  if (card.isStable) return false;
  if (isBot) return false;
  return true;
}

export function isAlphaAgg(card, { isBot = false, churnBuysMax = DEFAULT_CHURN_BUYS_MAX } = {}) {
  if (!isAlphaCard(card, { isBot })) return false;
  if ((card.buyCount || 1) >= churnBuysMax) return false;
  return true;
}
