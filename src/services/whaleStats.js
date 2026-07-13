/**
 * Unified whale performance accessor for the Top page.
 *
 * Every wallet can carry stats from up to three REAL sources, in order of
 * trustworthiness:
 *   1. GMGN 7d portfolio stats (Solana registry — refreshed by gmgnSync.js):
 *      winRate, realizedUsd7d, trades7d, tokens7d
 *   2. Deep on-chain scan (Monad curated file — backend/scanWhales.js):
 *      winRate, realizedUsd, closedTokens
 *   3. Live observed round-trips (indexer aggregate — partial by nature):
 *      realizedMon, winTokens/closedTokens
 *
 * The accessor picks the best available source so both chains show honest,
 * consistent numbers. No fabrication: absent data renders as absent.
 */
export function whalePerf(w, monPriceUsd) {
  if (!w) return { winRate: null, pnlUsd: null, trades: null, tokens: null, source: null };
  // 1) GMGN 7d stats (authoritative for Solana wallets)
  if (w.realizedUsd7d != null || w.statsAt != null) {
    return {
      winRate: w.winRate ?? null,
      pnlUsd: w.realizedUsd7d ?? null,
      trades: w.trades7d ?? w.trades ?? null,
      tokens: w.tokens7d ?? null,
      twitter: w.twitter || null,
      source: 'gmgn7d',
      sourceLabel: '7d PnL · GMGN',
    };
  }
  // 2) Deep on-chain scan output (Monad curated roster)
  if (w.realizedUsd != null && (w.closedTokens || 0) > 0) {
    return {
      winRate: w.winRate ?? (w.closedTokens ? (w.winTokens || 0) / w.closedTokens : null),
      pnlUsd: w.realizedUsd,
      trades: w.trades ?? null,
      tokens: w.closedTokens,
      source: 'scan',
      sourceLabel: 'realized · on-chain',
    };
  }
  // 3) Live observed aggregate (partial — only what the indexer has seen)
  if ((w.closedTokens || 0) > 0 && w.realizedMon != null) {
    return {
      winRate: w.winRate ?? (w.closedTokens ? (w.winTokens || 0) / w.closedTokens : null),
      pnlUsd: monPriceUsd ? w.realizedMon * monPriceUsd : null,
      pnlNative: w.realizedMon,
      trades: w.trades ?? null,
      tokens: w.closedTokens,
      source: 'observed',
      sourceLabel: 'realized · observed',
    };
  }
  return { winRate: null, pnlUsd: null, trades: w.trades ?? null, tokens: null, source: null, sourceLabel: null };
}

export function fmtUsdSigned(v) {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '+';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return `${s}$${a.toFixed(0)}`;
}
