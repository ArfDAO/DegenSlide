/**
 * Solana "quality universe" pool discovery — shared by solListener.js (live)
 * and solScanWhales.js (historical scan).
 *
 * The whole point of the app is copying BIG whales on tokens people actually
 * know — high market-cap / high-liquidity tokens — NOT obscure micro-cap
 * memecoins. DexScreener's token-pairs endpoint only returns a trending subset
 * that misses the blue chips (JUP, BONK, WIF, JTO…), so we build the universe
 * two ways and merge:
 *
 *   1. Blue chips by NAME — a list of well-known Solana tokens resolved to
 *      their REAL mint + deepest pool LIVE via DexScreener search (no
 *      hardcoded addresses; every mint/pool comes from the live API).
 *   2. Dynamic high-liquidity / high-market-cap pools from the token-pairs
 *      endpoint, gated by a market-cap floor so junk micro-caps are excluded.
 *
 * NO mock data: symbols are just names; all addresses, pools, liquidity and
 * market caps are fetched live.
 */

const UA = { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } };
const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const QUOTE_MINTS = new Set([WSOL, USDC, USDT]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Well-known Solana tokens (by name). Mints are resolved LIVE — this is a
// watchlist of what to look for, not hardcoded on-chain data.
export const MAJOR_SYMBOLS = [
  'JUP', 'BONK', 'WIF', 'JTO', 'PYTH', 'RAY', 'RENDER', 'JLP', 'ORCA', 'POPCAT',
  'MEW', 'BOME', 'DRIFT', 'KMNO', 'W', 'TNSR', 'JITOSOL', 'MSOL', 'INF', 'PENGU',
  'TRUMP', 'FARTCOIN', 'AI16Z', 'GRASS', 'ME', 'CLOUD', 'MOODENG', 'GOAT',
];

// mint -> deepest one-quote pool descriptor (cached across refreshes)
function poolFromPair(p) {
  if (p.chainId !== 'solana' || !p.pairAddress) return null;
  const bQ = QUOTE_MINTS.has(p.baseToken?.address);
  const qQ = QUOTE_MINTS.has(p.quoteToken?.address);
  if (bQ === qQ) return null; // need exactly one quote side
  const tokenSide = bQ ? p.quoteToken : p.baseToken;
  const quoteSide = bQ ? p.baseToken : p.quoteToken;
  return {
    pool: p.pairAddress, dex: p.dexId || 'solana-dex',
    tokenMint: tokenSide.address, tokenSymbol: tokenSide.symbol || tokenSide.address.slice(0, 4),
    quoteMint: quoteSide.address,
    liq: Number(p.liquidity?.usd) || 0, vol: Number(p.volume?.h24) || 0,
    mcap: Number(p.marketCap) || Number(p.fdv) || 0,
  };
}

// Deepest one-quote pool for a given mint (real liquidity leader for that token).
async function bestPoolForMint(mint) {
  try {
    const arr = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${mint}`, UA)).json();
    const cands = (Array.isArray(arr) ? arr : []).map(poolFromPair).filter((p) => p && p.tokenMint === mint);
    return cands.sort((a, b) => b.liq - a.liq)[0] || null;
  } catch { return null; }
}

// Resolve a well-known symbol → its real mint via live search, then its deepest pool.
async function resolveSymbol(sym) {
  try {
    const d = await (await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(sym)}`, UA)).json();
    const matches = (d.pairs || []).filter((p) => p.chainId === 'solana' && (p.baseToken?.symbol || '').toUpperCase() === sym.toUpperCase());
    if (!matches.length) return null;
    // pick the mint with the deepest liquidity across its pairs
    const byMint = new Map();
    for (const p of matches) {
      const liq = Number(p.liquidity?.usd) || 0;
      const m = p.baseToken.address;
      if (!byMint.has(m) || liq > byMint.get(m)) byMint.set(m, liq);
    }
    const topMint = [...byMint.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    return topMint ? await bestPoolForMint(topMint) : null;
  } catch { return null; }
}

/**
 * Build the quality pool universe: blue chips (resolved live) + dynamic
 * high-liquidity / high-market-cap pools. Deduped by pool, sorted by liquidity.
 *   opts: { minLiq, minMcap, maxPools, delayMs }
 */
export async function discoverQualityPools({ minLiq = 150000, minMcap = 20000000, maxPools = 24, delayMs = 120 } = {}) {
  const byPool = new Map();
  const add = (p) => { if (p && p.liq >= minLiq && !byPool.has(p.pool)) byPool.set(p.pool, p); };

  // 1) blue chips by name → real mint + deepest pool (live)
  for (const sym of MAJOR_SYMBOLS) {
    const p = await resolveSymbol(sym);
    if (p) add(p);
    await sleep(delayMs);
  }

  // 2) dynamic high-liquidity / high-mcap pools from the trending endpoint,
  //    gated by market cap so junk micro-caps don't leak in
  for (const q of QUOTE_MINTS) {
    try {
      const arr = await (await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${q}`, UA)).json();
      for (const raw of (Array.isArray(arr) ? arr : [])) {
        const p = poolFromPair(raw);
        if (p && p.mcap >= minMcap) add(p);
      }
    } catch { /* keep going */ }
    await sleep(delayMs);
  }

  return [...byPool.values()].sort((a, b) => b.liq - a.liq).slice(0, maxPools);
}
