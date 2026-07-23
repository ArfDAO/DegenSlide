/**
 * Unified whale QUALITY score — shared by both chains' discovery + ranking so
 * the roster is ordered by "who is actually good", not just raw volume.
 *
 * Signals (all already produced on-chain / by discovery):
 *   - realized PnL (USD)  — proven profit is the dominant signal
 *   - trade volume (USD)  — a soft floor for wallets with no closed positions yet
 *   - win rate            — reliability multiplier (only once enough trades closed)
 *   - recency (days)      — decay so stale wallets sink below active ones
 *
 * Deliberately simple + monotonic so it's explainable and can't be gamed by a
 * single dimension: a big-volume wallet that never realizes profit ranks below a
 * smaller, consistently-profitable, recently-active one.
 */

// Recency decay buckets (days since last observed trade → multiplier).
export function recencyMultiplier(days) {
  if (days == null) return 1;            // unknown → don't penalize (no data ≠ stale)
  if (days <= 7) return 1;
  if (days <= 30) return 0.7;
  if (days <= 90) return 0.4;
  return 0.15;
}

const MIN_CLOSED_FOR_WINRATE = 3; // win rate is noise below this many closed positions

export function qualityScore({ realizedUsd = 0, volumeUsd = 0, winRate = null, closedTokens = 0, recencyDays = null } = {}) {
  // Base: realized PnL drives it; volume is a 5% soft floor for unproven wallets.
  // realizedUsd may be negative — losers legitimately rank below break-even, but
  // we don't fully bury a high-volume wallet (it may just have open positions).
  let s = volumeUsd * 0.05 + realizedUsd;
  if (s < 0) s = volumeUsd * 0.01;

  // Win-rate multiplier (0.6×…1.4×) — only when enough positions have closed.
  if (winRate != null && closedTokens >= MIN_CLOSED_FOR_WINRATE) {
    const wr = Math.max(0, Math.min(1, winRate));
    s *= 0.6 + 0.8 * wr;
  }

  // Recency decay.
  s *= recencyMultiplier(recencyDays);
  return s;
}

// Convenience: days since an ms-epoch timestamp (last observed trade), or null.
export function daysSince(ms) {
  if (!ms || !Number.isFinite(ms)) return null;
  const d = (Date.now() - ms) / 86400000;
  return d >= 0 ? d : null;
}
