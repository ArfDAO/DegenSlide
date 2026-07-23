/**
 * Whale DISCOVERY + bot elimination for Monad MAINNET.
 *
 * Pipeline (all on-chain, no fabricated data):
 *  1. Watch the highest-volume v3 DEXes (Uniswap + PancakeSwap) across the whole
 *     chain — any pool anchored to MON / USDC / USDT0.
 *  2. Only high-liquidity tokens (DexScreener liquidity ≥ MIN_LIQ_USD) → no junk.
 *  3. Threshold each Swap by USD value; aggregate per wallet (resolved via tx.from).
 *  4. Historical getLogs scrape over SCAN_MAX_BLOCKS; rank the biggest wallets.
 *  5. BOT ELIMINATION:
 *       - EXTCODESIZE (getCode): drop contracts / 7702-delegated smart accounts.
 *       - same-block round-trips (atomic arb) → bot.
 *       - high-frequency balanced churn (MM/arb) → bot.
 *     What remains are real directional EOA "smart money" whales.
 *
 * Output: src/data/curatedWhales.json (the verified whale roster).
 *
 * Env: MONAD_RPC, SCAN_MIN_USD(5), MIN_LIQ_USD(50000), SCAN_MAX_BLOCKS(120000),
 *      SCAN_TARGET(160 candidates), OUT_COUNT(100)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Contract, AbiCoder, formatUnits } from 'ethers';
import * as db from './db.js';
import { qualityScore } from './quality.js';

// Monad targets sub-second blocks (~0.5s) — good enough to bucket a wallet's
// last-seen block into a recency-in-days for the quality decay.
const MON_BLOCK_SEC = Number(process.env.MON_BLOCK_SEC || 0.5);

const MONAD_RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz';
const SCAN_MIN_USD = Number(process.env.SCAN_MIN_USD || 5);      // per-swap floor (discovery gathers cumulative behaviour)
const MIN_LIQ_USD = Number(process.env.MIN_LIQ_USD || 150000);    // high-liquidity token floor (raised: thin pools + tax tokens were reverting real copy-trades)
const MAX_BLOCKS = Number(process.env.SCAN_MAX_BLOCKS || 300000); // explore-window size (rotates through history each run)
const FRESH_BLOCKS = Number(process.env.SCAN_FRESH_BLOCKS || 60000); // always-scan window at the chain tip → catches brand-new whales
const HISTORY_DEPTH = Number(process.env.SCAN_HISTORY_DEPTH || 12000000); // how far back the explore walk goes before wrapping to the tip — whale activity lives in the recent window, not at genesis
const TARGET = Number(process.env.SCAN_TARGET || 1500);          // safety cap on distinct candidate wallets held in memory
const OUT_COUNT = Number(process.env.OUT_COUNT || 140);
const MAX_PER_TOKEN = Number(process.env.MAX_PER_TOKEN || 45);   // cap so 1-2 hyper-liquid tokens can't monopolise the roster (raised: high-liquidity tokens hold many real, safe-to-copy whales — capping at 20 was discarding them)
const CHUNK = 90;

const WMON = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a';
const QUOTE_TOKENS = new Map([
  [WMON, { symbol: 'MON', decimals: 18, kind: 'mon' }],
  ['0x754704bc059f8c67012fed69bc8a327a5aafb603', { symbol: 'USDC', decimals: 6, kind: 'usd' }],
  ['0xe7cd86e13ac4309349f30b3435a9d337750fc82d', { symbol: 'USDT0', decimals: 6, kind: 'usd' }],
]);
const V3_SWAP_TOPIC = '0xc42079f94a6350f1a2cf73efd65a4d103d6d4a46513037101b0f199f1746e32d';
const PANCAKE_V3_SWAP_TOPIC = '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83';
const NADFUN_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67'; // nad.fun v3-fork DEX (memecoins)
const UNIV2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'; // Uniswap-V2-style pairs
const SWAP_TOPICS = new Set([V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, NADFUN_SWAP_TOPIC, UNIV2_SWAP_TOPIC]);
// Uniswap/PancakeSwap v3 Mint(address,address,int24,int24,uint128,uint256,uint256) —
// fired when someone ADDS liquidity. Big LP providers = market-maker whales.
const MINT_TOPIC = '0x7a53080ba414158be7ec69b987b5fb7d07dee101fe85488f0853ae16239d0bde';
const ALL_TOPICS = [V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, NADFUN_SWAP_TOPIC, UNIV2_SWAP_TOPIC, MINT_TOPIC];

const coder = AbiCoder.defaultAbiCoder();
const POOL_ABI = ['function token0() view returns (address)', 'function token1() view returns (address)', 'function fee() view returns (uint24)'];
const ERC20_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];
const provider = new JsonRpcProvider(MONAD_RPC);

const poolCache = new Map();
const tokenMeta = new Map();
const marketCache = new Map();
const txFromCache = new Map();
const blockSides = new Map();  // `${addr}|${block}|${token}` -> Set(side) for same-block arb detection
const whales = new Map();

let monPriceUsd = 0.0205;
async function refreshMonPrice() {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/monad/${WMON}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    const data = await res.json();
    const pairs = Array.isArray(data) ? data : data.pairs || [];
    const best = pairs.filter((p) => p.priceUsd && (p.baseToken?.symbol === 'MON' || p.baseToken?.symbol === 'WMON'))
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    const px = best ? Number(best.priceUsd) : null;
    if (px > 0) monPriceUsd = px;
  } catch {}
}

async function getTokenMeta(addr) {
  const key = addr.toLowerCase();
  if (tokenMeta.has(key)) return tokenMeta.get(key);
  const c = new Contract(addr, ERC20_ABI, provider);
  let symbol = key.slice(0, 6), decimals = 18;
  try { symbol = await c.symbol(); } catch {}
  try { decimals = Number(await c.decimals()); } catch {}
  const meta = { symbol, decimals };
  tokenMeta.set(key, meta);
  return meta;
}
async function getTokenLiquidity(addr) {
  const key = addr.toLowerCase();
  if (marketCache.has(key)) return marketCache.get(key);
  let liquidity = 0;
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/monad/${addr}`, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } });
    const data = await res.json();
    const pairs = (Array.isArray(data) ? data : data.pairs || []).filter((p) => p.chainId === 'monad');
    for (const p of pairs) liquidity = Math.max(liquidity, Number(p.liquidity?.usd) || 0);
  } catch {}
  marketCache.set(key, liquidity);
  return liquidity;
}
async function getPoolInfo(poolAddr) {
  const key = poolAddr.toLowerCase();
  if (poolCache.has(key)) return poolCache.get(key);
  let info = null;
  try {
    const c = new Contract(poolAddr, POOL_ABI, provider);
    const [t0, t1] = await Promise.all([c.token0(), c.token1()]);
    const a0 = t0.toLowerCase(), a1 = t1.toLowerCase();
    const q0 = QUOTE_TOKENS.get(a0), q1 = QUOTE_TOKENS.get(a1);
    if ((!q0 && !q1) || (q0 && q1)) { poolCache.set(key, null); return null; }
    const quoteIsToken0 = !!q0;
    const quote = q0 || q1;
    const tokenAddr = quoteIsToken0 ? a1 : a0;
    const meta = await getTokenMeta(tokenAddr);
    info = { quoteIsToken0, quote, tokenAddr, meta };
    poolCache.set(key, info);
  } catch { poolCache.set(key, null); }
  return info;
}
async function txFrom(hash) {
  if (txFromCache.has(hash)) return txFromCache.get(hash);
  let from = null;
  try { const tx = await provider.getTransaction(hash); if (tx?.from) from = tx.from.toLowerCase(); } catch {}
  txFromCache.set(hash, from);
  return from;
}
function decodeAmounts(data) {
  const hex = data.replace(/^0x/, '');
  return { amount0: coder.decode(['int256'], '0x' + hex.slice(0, 64))[0], amount1: coder.decode(['int256'], '0x' + hex.slice(64, 128))[0] };
}
// Uniswap-V2 Swap data = amount0In, amount1In, amount0Out, amount1Out (uint256×4).
// Convert to the same signed "into pool +" convention the v3 net-flow expects.
function decodeV2Amounts(data) {
  const hex = data.replace(/^0x/, '');
  const a0In = BigInt('0x' + hex.slice(0, 64)), a1In = BigInt('0x' + hex.slice(64, 128));
  const a0Out = BigInt('0x' + hex.slice(128, 192)), a1Out = BigInt('0x' + hex.slice(192, 256));
  return { amount0: a0In - a0Out, amount1: a1In - a1Out };
}
// Mint data = sender(32), amount(32), amount0(32), amount1(32) → the deposited amounts.
function decodeMint(data) {
  const hex = data.replace(/^0x/, '');
  return { amount0: coder.decode(['uint256'], '0x' + hex.slice(128, 192))[0], amount1: coder.decode(['uint256'], '0x' + hex.slice(192, 256))[0] };
}
function ensureWhale(from) {
  let w = whales.get(from);
  if (!w) {
    w = { address: from, volumeUsd: 0, trades: 0, buys: 0, sells: 0, tokens: new Map(), lastToken: null, lastSeen: 0, pos: new Map(), arbHits: 0, maxLiq: 0, lpAddedUsd: 0, lpEvents: 0 };
    whales.set(from, w);
  }
  return w;
}
function isCleanSymbol(s) {
  if (!s) return false;
  if (/^0x/i.test(s)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,11}$/.test(s);
}

// ── Mint (add liquidity) → market-maker whale signal (per-event) ──
async function processMint(log) {
  const pool = await getPoolInfo(log.address);
  if (!pool) return;
  let m0, m1;
  try { ({ amount0: m0, amount1: m1 } = decodeMint(log.data)); } catch { return; }
  const qAbs = pool.quoteIsToken0 ? m0 : m1;
  const usdLp = pool.quote.kind === 'usd'
    ? Number(formatUnits(qAbs, pool.quote.decimals))
    : Number(formatUnits(qAbs, 18)) * monPriceUsd;
  const lpUsd = usdLp * 2; // rough total position value (both legs)
  if (lpUsd < SCAN_MIN_USD) return;
  const liq = await getTokenLiquidity(pool.tokenAddr);
  if (liq < MIN_LIQ_USD) return;
  const from = await txFrom(log.transactionHash);
  if (!from) return;
  const w = ensureWhale(from);
  w.lpAddedUsd += lpUsd;
  w.lpEvents += 1;
  w.maxLiq = Math.max(w.maxLiq, liq);
  w.tokens.set(pool.meta.symbol, (w.tokens.get(pool.meta.symbol) || 0) + lpUsd);
  if (!w.lastToken) w.lastToken = pool.meta.symbol;
}

// ── Swap attribution via NET-FLOW per transaction ──
// A whale's real trade is the token they NET acquired/disposed across the whole
// tx — not every intermediate hop. Aggregating per-leg inflated volume and
// polluted each whale's token list with pass-through tokens; a pure arb loop
// (buy+sell same token in one tx) counted as two "trades". Net-flow fixes both:
// one trade per tx, attributed to the genuinely-moved token; arb loops net to
// ~zero → dropped and flagged as bot behaviour instead of counted as volume.
async function processSwapTx(txHash, logs) {
  const from = await txFrom(txHash);
  if (!from) return;

  const flow = new Map(); // tokenAddr -> { net, gross, spentUsd, recvUsd, meta, block }
  for (const log of logs) {
    const pool = await getPoolInfo(log.address);
    if (!pool) continue;
    let a0, a1;
    try { ({ amount0: a0, amount1: a1 } = log.topics[0] === UNIV2_SWAP_TOPIC ? decodeV2Amounts(log.data) : decodeAmounts(log.data)); } catch { continue; }
    const quoteSigned = pool.quoteIsToken0 ? a0 : a1;
    const tokenSigned = pool.quoteIsToken0 ? a1 : a0;
    if (quoteSigned === 0n) continue;
    const traderTokenDelta = -tokenSigned;
    const qAbs = quoteSigned > 0n ? quoteSigned : -quoteSigned;
    const usd = pool.quote.kind === 'usd'
      ? Number(formatUnits(qAbs, pool.quote.decimals))
      : Number(formatUnits(qAbs, 18)) * monPriceUsd;
    const f = flow.get(pool.tokenAddr) || { net: 0n, gross: 0n, spentUsd: 0, recvUsd: 0, meta: pool.meta, block: log.blockNumber };
    f.net += traderTokenDelta;
    f.gross += traderTokenDelta < 0n ? -traderTokenDelta : traderTokenDelta;
    if (quoteSigned > 0n) f.spentUsd += usd; else f.recvUsd += usd;
    f.block = log.blockNumber;
    flow.set(pool.tokenAddr, f);
  }
  if (!flow.size) return;

  // Winner = the token with the largest genuine net position change.
  let best = null, passthrough = false;
  for (const [addr, f] of flow) {
    const absNet = f.net < 0n ? -f.net : f.net;
    if (absNet === 0n) { passthrough = true; continue; }
    if (f.gross > 0n && (absNet * 100n) / f.gross < 40n) { passthrough = true; continue; } // routed through, not owned
    const usd = f.spentUsd + f.recvUsd;
    if (!best || usd > best.usd) best = { addr, f, usd };
  }
  // A tx whose tokens all net to ~zero is an arb/MM loop — flag it, don't bank it.
  if (!best) {
    if (passthrough) { const w = ensureWhale(from); w.arbHits += 1; whales.set(from, w); }
    return;
  }

  const f = best.f;
  const side = f.net > 0n ? 'BUY' : 'SELL';
  const usd = side === 'BUY' ? (f.spentUsd || best.usd) : (f.recvUsd || best.usd);
  if (usd < SCAN_MIN_USD) return;

  const liq = await getTokenLiquidity(best.addr);
  if (liq < MIN_LIQ_USD) return; // high-liquidity gate — only real markets, no rugs/junk

  const absNet = f.net < 0n ? -f.net : f.net;
  const tokenAmount = Number(formatUnits(absNet, f.meta.decimals));

  const w = ensureWhale(from);
  w.volumeUsd += usd;
  w.trades += 1;
  if (side === 'BUY') w.buys += 1; else w.sells += 1;
  w.tokens.set(f.meta.symbol, (w.tokens.get(f.meta.symbol) || 0) + usd);
  w.lastToken = f.meta.symbol;
  w.lastSeen = f.block;
  w.maxLiq = Math.max(w.maxLiq, liq);
  if (passthrough) w.arbHits += 1; // tx had a real leg AND a routed-through leg → still bot-ish

  // realized PnL (avg cost, USD)
  const p = w.pos.get(best.addr) || { boughtTok: 0, spentUsd: 0, soldTok: 0, realizedUsd: 0 };
  if (side === 'BUY') { p.boughtTok += tokenAmount; p.spentUsd += usd; }
  else { const avg = p.boughtTok > 0 ? p.spentUsd / p.boughtTok : 0; if (avg > 0) p.realizedUsd += usd - avg * tokenAmount; p.soldTok += tokenAmount; }
  w.pos.set(best.addr, p);
  whales.set(from, w);
}

// Realized PnL (avg-cost, USD) rolled up from a whale's per-token positions.
function realizedOf(w) {
  let realizedUsd = 0, closedTokens = 0, winTokens = 0;
  for (const p of w.pos.values()) if (p.soldTok > 0 && p.boughtTok > 0) {
    closedTokens += 1; realizedUsd += p.realizedUsd; if (p.realizedUsd > 0) winTokens += 1;
  }
  return { realizedUsd, closedTokens, winTokens, winRate: closedTokens > 0 ? winTokens / closedTokens : null };
}

// Quality-based ranking score (profit + win-rate + recency), replacing raw
// volume. `tipBlock` anchors the last-seen → recency-in-days conversion.
function whaleQuality(w, tipBlock) {
  const { realizedUsd, closedTokens, winRate } = realizedOf(w);
  const recencyDays = (tipBlock && w.lastSeen) ? Math.max(0, (tipBlock - w.lastSeen)) * MON_BLOCK_SEC / 86400 : null;
  // LP providers with no trade volume still count via their provided liquidity.
  const volumeUsd = Math.max(w.volumeUsd || 0, w.lpAddedUsd || 0);
  return qualityScore({ realizedUsd, volumeUsd, winRate, closedTokens, recencyDays });
}

// Step 5: is this address a bot? EXTCODESIZE + behavioural checks.
async function classify(w) {
  let code = '0x';
  try { code = await provider.getCode(w.address); } catch {}
  const isContract = !!code && code !== '0x';                // contract / 7702 smart account
  const directionality = w.trades ? Math.abs(w.buys - w.sells) / w.trades : 0;
  const arbBot = w.arbHits > 0;                              // atomic same-block round-trips
  const churnBot = w.trades >= 40 && directionality < 0.2;   // high-freq balanced churn = MM/arb
  // Wash/MM tightening: a wallet that churns a lot of volume in near-perfect
  // buy/sell balance while realizing almost no PnL is washing, not accumulating.
  const { realizedUsd } = realizedOf(w);
  const washBot = w.trades >= 20 && directionality < 0.15
    && w.volumeUsd > 0 && Math.abs(realizedUsd) < w.volumeUsd * 0.004;
  return { isContract, arbBot, churnBot, washBot, directionality, isBot: isContract || arbBot || churnBot || washBot };
}

// Scan one contiguous block window [fromBlock, toBlock], newest→oldest.
async function scanRange(fromBlock, toBlock, label) {
  let to = toBlock, scanned = 0;
  while (to >= fromBlock && whales.size < TARGET) {
    const from = Math.max(fromBlock, to - CHUNK + 1);
    let logs = [];
    try { logs = await provider.getLogs({ fromBlock: from, toBlock: to, topics: [ALL_TOPICS] }); }
    catch { to = from - 1; continue; }
    // LP mints are per-event; swaps are grouped by tx for net-flow attribution.
    for (const log of logs) if (log.topics[0] === MINT_TOPIC) await processMint(log).catch(() => {});
    const byTx = new Map();
    for (const log of logs) {
      if (!SWAP_TOPICS.has(log.topics[0])) continue;
      const arr = byTx.get(log.transactionHash) || [];
      arr.push(log);
      byTx.set(log.transactionHash, arr);
    }
    for (const [txHash, txLogs] of byTx) await processSwapTx(txHash, txLogs).catch(() => {});
    scanned += (to - from + 1);
    if (scanned % (CHUNK * 25) < CHUNK) console.log(`[scan:${label}] ~${scanned} blocks · ${whales.size} candidates (block ${from})`);
    to = from - 1;
  }
  return scanned;
}

async function main() {
  await refreshMonPrice();
  const current = await provider.getBlockNumber();

  // The old scan always re-read the SAME recent window from the tip, so every
  // run re-found the same wallets and the roster plateaued. Now discovery walks
  // the WHOLE chain: a rotating explore-cursor moves one MAX_BLOCKS window
  // further back each run (persisted in the file, which CI checks out fresh),
  // plus a fixed FRESH window at the tip so brand-new whales are never missed.
  let prevData = {};
  try { prevData = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'curatedWhales.json'), 'utf8')); } catch { /* first run */ }
  let exploreEnd = Number.isFinite(prevData.scanCursorBlock) ? prevData.scanCursorBlock : current;
  const activeFloor = Math.max(FRESH_BLOCKS, current - HISTORY_DEPTH);
  if (exploreEnd <= activeFloor || exploreEnd > current) exploreEnd = current; // wrap/reset to tip

  console.log(`[scan] MON=$${monPriceUsd} · min $${SCAN_MIN_USD}/swap · liq≥$${MIN_LIQ_USD} · tip ${current}`);

  // Pass A — fresh tip window (brand-new whales, every run)
  const freshFrom = Math.max(0, current - FRESH_BLOCKS);
  let scanned = await scanRange(freshFrom, current, 'fresh');

  // Pass B — rotating explore window (a different historical slice each run)
  const exploreTo = Math.min(exploreEnd, freshFrom - 1); // don't re-scan the fresh window
  const exploreFrom = Math.max(0, exploreTo - MAX_BLOCKS);
  if (exploreTo > exploreFrom) {
    console.log(`[scan] explore window ${exploreFrom}→${exploreTo} (cursor was ${exploreEnd})`);
    scanned += await scanRange(exploreFrom, exploreTo, 'explore');
  }
  // advance cursor backward; wrap to the tip once the walk passes the active
  // history window (whales don't live at genesis) so we keep re-covering the
  // region where new whales actually appear.
  let nextCursor = exploreFrom - 1;
  const historyFloor = Math.max(FRESH_BLOCKS, current - HISTORY_DEPTH);
  if (nextCursor <= historyFloor) nextCursor = current;

  // Rank candidates by QUALITY (realized PnL + win-rate + recency), not raw
  // volume — so the roster surfaces proven, currently-active smart money.
  const score = (w) => whaleQuality(w, current);
  const domToken = (w) => [...w.tokens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '?';

  // Bucket candidates by their DOMINANT token first, then round-robin across
  // buckets before classifying. Without this, a couple of hyper-liquid tokens
  // (e.g. AUSD/cbBTC) monopolise every slot — every quality token with real
  // whales should be represented, not just the two busiest.
  const byToken = new Map();
  for (const w of whales.values()) { const k = domToken(w); if (!byToken.has(k)) byToken.set(k, []); byToken.get(k).push(w); }
  for (const list of byToken.values()) list.sort((a, b) => score(b) - score(a));
  const order = [...byToken.values()].sort((a, b) => score(b[0]) - score(a[0])); // strongest token first
  const candidateBudget = OUT_COUNT * 3 + 60; // classify a wider, diverse pool before the bot filter thins it
  const candidates = [];
  for (let i = 0, done = false; !done && candidates.length < candidateBudget; i++) {
    done = true;
    for (const list of order) if (i < list.length && candidates.length < candidateBudget) { candidates.push(list[i]); done = false; }
  }
  console.log(`[scan] classifying ${candidates.length} candidates across ${byToken.size} tokens (EXTCODESIZE + behaviour)…`);
  let dropContract = 0, dropArb = 0, dropChurn = 0, dropWash = 0;
  const clean = [];
  for (const w of candidates) {
    const c = await classify(w);
    if (c.isBot) {
      if (c.isContract) dropContract += 1; else if (c.arbBot) dropArb += 1; else if (c.washBot) dropWash += 1; else dropChurn += 1;
      continue;
    }
    w._directionality = c.directionality;
    w._domToken = domToken(w);
    clean.push(w);
  }
  console.log(`[scan] removed bots → ${dropContract} contracts · ${dropArb} same-block-arb · ${dropChurn} churn-MM · ${dropWash} wash`);

  // Final selection: round-robin across tokens, capped per token, so 1-2
  // hyper-liquid tokens (e.g. AUSD/cbBTC) can't monopolise the roster. Any
  // slots left over (small token pools exhausted) spill to the biggest
  // remaining tokens so the roster still fills to OUT_COUNT.
  const cleanByToken = new Map();
  for (const w of clean) { const k = w._domToken; if (!cleanByToken.has(k)) cleanByToken.set(k, []); cleanByToken.get(k).push(w); }
  const cleanOrder = [...cleanByToken.values()].sort((a, b) => score(b[0]) - score(a[0]));
  const picked = [];
  for (let i = 0, done = false; !done && picked.length < OUT_COUNT; i++) {
    done = true;
    for (const list of cleanOrder) {
      if (picked.length >= OUT_COUNT) break;
      if (i >= list.length) continue;
      const takenFromThisToken = picked.filter((w) => w._domToken === list[0]._domToken).length;
      if (takenFromThisToken >= MAX_PER_TOKEN) continue; // respect the cap
      picked.push(list[i]); done = false;
    }
  }
  // Backfill any remaining slots (small-token pools exhausted) from the
  // biggest tokens beyond the cap, so the roster still reaches OUT_COUNT.
  if (picked.length < OUT_COUNT) {
    const pickedSet = new Set(picked);
    for (const list of cleanOrder) {
      for (const w of list) {
        if (picked.length >= OUT_COUNT) break;
        if (!pickedSet.has(w)) { picked.push(w); pickedSet.add(w); }
      }
      if (picked.length >= OUT_COUNT) break;
    }
  }
  const finalDist = [...picked.reduce((m, w) => m.set(w._domToken, (m.get(w._domToken) || 0) + 1), new Map())];
  console.log(`[scan] ${picked.length} whales across ${cleanByToken.size} tokens (cap ${MAX_PER_TOKEN}/token): ${finalDist.sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(' ')}`);

  const round2 = (x) => Math.round(x * 100) / 100;
  const ranked = picked.map((w) => {
    let realizedUsd = 0, closedTokens = 0, winTokens = 0;
    for (const p of w.pos.values()) if (p.soldTok > 0 && p.boughtTok > 0) { closedTokens += 1; realizedUsd += p.realizedUsd; if (p.realizedUsd > 0) winTokens += 1; }
    const cleanTokens = [...w.tokens.entries()].filter(([s]) => isCleanSymbol(s)).sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 6);
    const lastToken = isCleanSymbol(w.lastToken) ? w.lastToken : (cleanTokens[0] || null);
    return {
      address: w.address,
      volumeUsd: round2(w.volumeUsd),
      volumeMon: round2(monPriceUsd > 0 ? w.volumeUsd / monPriceUsd : 0),
      trades: w.trades, buys: w.buys, sells: w.sells,
      directionality: round2(w._directionality),
      lpAddedUsd: round2(w.lpAddedUsd), lpEvents: w.lpEvents,
      isMarketMaker: w.lpAddedUsd >= 1000, // provided real liquidity
      maxLiquidityUsd: Math.round(w.maxLiq),
      tokens: cleanTokens, lastToken,
      realizedUsd: round2(realizedUsd),
      realizedMon: round2(monPriceUsd > 0 ? realizedUsd / monPriceUsd : 0),
      closedTokens, winTokens,
      winRate: closedTokens > 0 ? Math.round((winTokens / closedTokens) * 100) / 100 : null,
      // persisted so the live /roster can order by quality without recomputing
      qualityScore: round2(whaleQuality(w, current)),
    };
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, '..', 'src', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'curatedWhales.json');
  // MERGE with the previous file — discovery only ever ADDS whales. A wallet
  // found by an earlier scan is still real even if this scan window missed it;
  // overwriting would silently shrink the global roster on every rescan.
  let prevWhales = [];
  try { prevWhales = JSON.parse(fs.readFileSync(outFile, 'utf8')).whales || []; } catch { /* first run */ }
  const mergedByAddr = new Map(prevWhales.filter((w) => w.address).map((w) => [w.address.toLowerCase(), w]));
  for (const w of ranked) mergedByAddr.set(w.address.toLowerCase(), w); // fresh stats win
  // Drop any address the live indexer's validation pass has since banned as a
  // contract/protocol/rug — the curated file must not keep re-seeding known junk.
  let bannedDropped = 0;
  for (const addr of [...mergedByAddr.keys()]) if (db.isBlacklisted(addr)) { mergedByAddr.delete(addr); bannedDropped += 1; }
  if (bannedDropped) console.log(`[scan] dropped ${bannedDropped} blacklisted (contract/rug) wallets from the roster file`);
  // Order by quality (fresh scans carry qualityScore; older carried-over entries
  // fall back to volume so they still sort sensibly until their next rescan).
  const rankOf = (w) => (w.qualityScore != null ? w.qualityScore : (w.volumeUsd || 0) * 0.05);
  const mergedWhales = [...mergedByAddr.values()].sort((a, b) => rankOf(b) - rankOf(a));
  fs.writeFileSync(outFile, JSON.stringify({
    source: 'Monad mainnet — on-chain discovery + bot elimination (Swap logs, all quote anchors)',
    scannedAt: new Date().toISOString(),
    scannedBlocks: scanned, minUsdPerSwap: SCAN_MIN_USD, minLiquidityUsd: MIN_LIQ_USD,
    scanCursorBlock: nextCursor, // rotating explore cursor — next run continues the history walk here
    botsRemoved: { contracts: dropContract, sameBlockArb: dropArb, churnMM: dropChurn, wash: dropWash },
    count: mergedWhales.length, whales: mergedWhales,
  }, null, 2));
  console.log(`[scan] DONE · ${ranked.length} fresh + ${mergedWhales.length - ranked.length} carried = ${mergedWhales.length} whales → ${outFile}`);
  console.log('[scan] top 5:', ranked.slice(0, 5).map((w) => `${w.address.slice(0, 10)}=$${Math.round(w.volumeUsd).toLocaleString()}`).join('  '));
  process.exit(0);
}

main().catch((e) => { console.error('[scan] fatal', e.message || e); process.exit(1); });
