/**
 * Degen Score — a 0-100 "how sketchy is this play" rating computed ONLY from
 * live on-chain / market data already on the card. No mock inputs: if there
 * isn't enough real data to judge, we return null and show nothing.
 *
 * Components (weights sum to 100):
 *   liquidity depth (30)      — thin pools rug; deep pools survive exits
 *   FDV / liquidity (20)      — high ratio = nothing backing the valuation
 *   volume / liquidity (20)   — real trading interest vs a dead pool
 *   buy pressure 24h (15)     — buys vs sells among real txns
 *   whale quality (15)        — the copied whale's observed win rate
 */
export function degenScore({ liquidityUsd, fdv, vol24, buys, sells, whaleWinRate }) {
  if (liquidityUsd == null && fdv == null && vol24 == null) return null; // no market data at all

  let score = 0;

  // liquidity depth (0-30)
  const liq = liquidityUsd || 0;
  if (liq >= 1_000_000) score += 30;
  else if (liq >= 250_000) score += 24;
  else if (liq >= 50_000) score += 17;
  else if (liq >= 10_000) score += 9;
  else if (liq >= 2_000) score += 4;

  // FDV vs liquidity (0-20) — unknown FDV scores neutral
  if (fdv != null && liq > 0) {
    const ratio = fdv / liq;
    if (ratio <= 10) score += 20;
    else if (ratio <= 30) score += 15;
    else if (ratio <= 100) score += 9;
    else if (ratio <= 300) score += 4;
  } else score += 10;

  // turnover: 24h volume vs liquidity (0-20)
  if (vol24 != null && liq > 0) {
    const t = vol24 / liq;
    if (t >= 2) score += 20;
    else if (t >= 1) score += 16;
    else if (t >= 0.4) score += 11;
    else if (t >= 0.1) score += 5;
  } else score += 8;

  // buy pressure (0-15) — only meaningful with a real sample of txns
  const txns = (buys || 0) + (sells || 0);
  if (txns >= 20) {
    const p = (buys || 0) / txns;
    if (p >= 0.6) score += 15;
    else if (p >= 0.52) score += 11;
    else if (p >= 0.45) score += 7;
    else score += 2;
  } else score += 7;

  // whale quality (0-15) — observed win rate of the whale being copied
  if (whaleWinRate != null) {
    if (whaleWinRate >= 0.7) score += 15;
    else if (whaleWinRate >= 0.55) score += 11;
    else if (whaleWinRate >= 0.4) score += 7;
    else score += 3;
  } else score += 7;

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function scoreTier(score) {
  if (score >= 75) return { label: 'SOLID', color: 'var(--up)', bg: 'rgba(47,230,168,0.12)', border: 'rgba(47,230,168,0.35)' };
  if (score >= 55) return { label: 'DECENT', color: '#22d3ee', bg: 'rgba(34,211,238,0.10)', border: 'rgba(34,211,238,0.35)' };
  if (score >= 35) return { label: 'RISKY', color: '#f5b544', bg: 'rgba(245,181,68,0.10)', border: 'rgba(245,181,68,0.35)' };
  return { label: 'DEGEN', color: 'var(--down)', bg: 'rgba(255,93,125,0.10)', border: 'rgba(255,93,125,0.35)' };
}
