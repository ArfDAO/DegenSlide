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
export function degenScoreBreakdown({ liquidityUsd, fdv, vol24, buys, sells, whaleWinRate }) {
  if (liquidityUsd == null && fdv == null && vol24 == null) return null; // no market data at all

  const parts = [];

  // liquidity depth (0-30)
  const liq = liquidityUsd || 0;
  let liqPts = 0;
  if (liq >= 1_000_000) liqPts = 30;
  else if (liq >= 250_000) liqPts = 24;
  else if (liq >= 50_000) liqPts = 17;
  else if (liq >= 10_000) liqPts = 9;
  else if (liq >= 2_000) liqPts = 4;
  parts.push({ key: 'liq', label: 'Liquidity depth', pts: liqPts, max: 30 });

  // FDV vs liquidity (0-20) — unknown FDV scores neutral
  let fdvPts = 10;
  if (fdv != null && liq > 0) {
    const ratio = fdv / liq;
    if (ratio <= 10) fdvPts = 20;
    else if (ratio <= 30) fdvPts = 15;
    else if (ratio <= 100) fdvPts = 9;
    else if (ratio <= 300) fdvPts = 4;
    else fdvPts = 0;
  }
  parts.push({ key: 'fdv', label: 'FDV backing', pts: fdvPts, max: 20 });

  // turnover: 24h volume vs liquidity (0-20)
  let turnPts = 8;
  if (vol24 != null && liq > 0) {
    const t = vol24 / liq;
    if (t >= 2) turnPts = 20;
    else if (t >= 1) turnPts = 16;
    else if (t >= 0.4) turnPts = 11;
    else if (t >= 0.1) turnPts = 5;
    else turnPts = 0;
  }
  parts.push({ key: 'turn', label: 'Volume turnover', pts: turnPts, max: 20 });

  // buy pressure (0-15) — only meaningful with a real sample of txns
  const txns = (buys || 0) + (sells || 0);
  let bpPts = 7;
  if (txns >= 20) {
    const p = (buys || 0) / txns;
    if (p >= 0.6) bpPts = 15;
    else if (p >= 0.52) bpPts = 11;
    else if (p >= 0.45) bpPts = 7;
    else bpPts = 2;
  }
  parts.push({ key: 'press', label: 'Buy pressure 24h', pts: bpPts, max: 15 });

  // whale quality (0-15) — observed win rate of the whale being copied
  let wqPts = 7;
  if (whaleWinRate != null) {
    if (whaleWinRate >= 0.7) wqPts = 15;
    else if (whaleWinRate >= 0.55) wqPts = 11;
    else if (whaleWinRate >= 0.4) wqPts = 7;
    else wqPts = 3;
  }
  parts.push({ key: 'whale', label: 'Whale win rate', pts: wqPts, max: 15 });

  const total = Math.max(0, Math.min(100, Math.round(parts.reduce((s, p) => s + p.pts, 0))));
  return { total, parts };
}

export function degenScore(inputs) {
  return degenScoreBreakdown(inputs)?.total ?? null;
}

export function scoreTier(score) {
  if (score >= 75) return { label: 'SOLID', color: 'var(--up)', bg: 'rgba(70, 209, 107,0.12)', border: 'rgba(70, 209, 107,0.35)' };
  if (score >= 55) return { label: 'DECENT', color: '#a06bff', bg: 'rgba(160, 107, 255,0.10)', border: 'rgba(160, 107, 255,0.35)' };
  if (score >= 35) return { label: 'RISKY', color: '#ffb02e', bg: 'rgba(255, 176, 46,0.10)', border: 'rgba(255, 176, 46,0.35)' };
  return { label: 'DEGEN', color: 'var(--down)', bg: 'rgba(255, 77, 106,0.10)', border: 'rgba(255, 77, 106,0.35)' };
}
