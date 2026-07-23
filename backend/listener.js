/**
 * DegenSlide Whale Indexer — Monad MAINNET
 *
 * Pure on-chain truth: polls mainnet for Uniswap V2/V3 `Swap` logs, resolves
 * each pool's tokens on-chain, isolates WMON-paired trades, and surfaces
 * whale-sized buys/sells. Streams them live over WebSocket and serves an HTTP
 * API for initial deck load, leaderboard, and per-address history.
 *
 * NO mock / static / fabricated data. Every field comes from the chain.
 *
 * Env:
 *   MONAD_RPC      - RPC url            (default https://rpc.monad.xyz)
 *   WS_PORT        - websocket port     (default 8081)
 *   HTTP_PORT      - http api port      (default 8082)
 *   WHALE_MIN_MON  - whale threshold    (default 5  MON per trade)
 *   POLL_MS        - poll interval ms   (default 2000)
 *   MAX_BLOCK_SPAN - max blocks / poll  (default 50)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { JsonRpcProvider, Contract, AbiCoder, formatUnits } from 'ethers';
import { WebSocketServer } from 'ws';
import * as db from './db.js';
import { qualityScore, daysSince } from './quality.js';
import { createRateLimiter } from './rateLimit.js';

const rateLimiter = createRateLimiter({ windowMs: Number(process.env.RATE_WINDOW_MS || 10000), max: Number(process.env.RATE_MAX || 120) });

// A single un-awaited RPC failure must not kill the whole indexer.
process.on('unhandledRejection', (e) => console.warn('[guard] unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => console.warn('[guard] uncaught exception:', e?.message || e));

const MONAD_RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz';
const PORT = Number(process.env.PORT || 8082);
const server = http.createServer();
// Pro whale gating is USD-denominated: a trade only hits the deck if it moves
// real money (WHALE_MIN_USD), OR it comes from a known/registered big wallet.
const WHALE_MIN_USD = Number(process.env.WHALE_MIN_USD || 150);    // non-registered floor, in USD (Monad-scale)
const REGISTERED_MIN_MON = Number(process.env.REGISTERED_MIN_MON || 100); // dust floor for known whales
const WHALE_MIN_MON = Number(process.env.WHALE_MIN_MON || 5);      // absolute pre-filter (cheap check)
const INCLUDE_SELLS = process.env.INCLUDE_SELLS === '1'; // deck shows copyable BUYs only by default
const DECK_ROSTER_ONLY = process.env.DECK_ROSTER_ONLY === '1'; // deck shows ALL whales by default (set =1 to restrict to verified roster only)
const POLL_MS = Number(process.env.POLL_MS || 2000);
const MAX_BLOCK_SPAN = Number(process.env.MAX_BLOCK_SPAN || 90); // RPC caps getLogs at 100
const BACKFILL_BLOCKS = Number(process.env.BACKFILL_BLOCKS || 4000); // scan recent history at boot
const INCLUDE_STABLES = process.env.INCLUDE_STABLES === '1'; // show MON/stable whale flow too

const WMON = '0x3bd359c1119da7da1d913d1c4d2b7c461115433a'; // lowercased

// ── Quote anchors — the tokens big money is priced against on Monad ──
// A pool with EXACTLY ONE of these on one side is a real, priceable market: the
// other side is the "traded token". This lets us watch the WHOLE chain (USDC-,
// USDT0- and MON-quoted pools) instead of only WMON pairs.
const QUOTE_TOKENS = new Map([
  ['0x3bd359c1119da7da1d913d1c4d2b7c461115433a', { symbol: 'MON', decimals: 18, kind: 'mon' }],   // WMON
  ['0x754704bc059f8c67012fed69bc8a327a5aafb603', { symbol: 'USDC', decimals: 6, kind: 'usd' }],
  ['0xe7cd86e13ac4309349f30b3435a9d337750fc82d', { symbol: 'USDT0', decimals: 6, kind: 'usd' }],
]);
// High-liquidity floor (USD) — only surface tokens with a real market; filters junk.
const MIN_LIQ_USD = Number(process.env.MIN_LIQ_USD || 25000);
const REGISTERED_MIN_USD = Number(process.env.REGISTERED_MIN_USD || 100); // dust floor for known whales — this is a WHALE app, no sub-$100 cards

// ── Manually-pinned VIP wallets (always tracked, regardless of discovery) ──
// Shared with cleanRoster.js so the purge never bans a pinned wallet.
import { VIP_WHALES } from './vipWhales.js';

// The live tracked roster = VIP + the verified/bot-filtered discovery roster.
// Rebuilt (hot-reloaded) whenever the discovery scan rewrites curatedWhales.json.
const REGISTERED_WHALES = new Set();
const LIVE_PROMOTED = new Set(); // whales caught by the fast live pass (kept across reloads)
const __d = path.dirname(fileURLToPath(import.meta.url));
const CURATED_PATH = path.join(__d, '..', 'src', 'data', 'curatedWhales.json');

function loadRoster() {
  REGISTERED_WHALES.clear();
  for (const v of VIP_WHALES) REGISTERED_WHALES.add(v);
  for (const p of LIVE_PROMOTED) REGISTERED_WHALES.add(p);
  let curatedCount = 0, bannedSkipped = 0;
  try {
    const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
    for (const w of curated.whales || []) if (w.address) {
      const addr = w.address.toLowerCase();
      // A wallet a previous validation pass proved to be a contract/rug is vetoed —
      // never re-import it from the (append-only, possibly stale) curated file.
      if (db.isBlacklisted(addr)) { bannedSkipped += 1; continue; }
      // durable registry: a future rescan that misses this wallet can't erase it
      db.registerWhale(addr, 'scan', { volumeUsd: w.volumeUsd ?? null, stats: w });
      curatedCount += 1;
    }
  } catch (e) { console.warn('[whales] curated roster not loaded:', e.message); }
  let registryCount = 0;
  for (const r of db.loadWhaleRegistry()) {
    if (db.isBlacklisted(r.address)) continue; // registry rows are deleted on ban, but be defensive
    REGISTERED_WHALES.add(r.address); registryCount += 1;
  }
  console.log(`[whales] roster = ${REGISTERED_WHALES.size} wallets (${VIP_WHALES.size} VIP · registry ${registryCount} · scan file ${curatedCount} · live ${LIVE_PROMOTED.size} · banned skipped ${bannedSkipped})`);
}
loadRoster();

// ── Roster hygiene: prove every tracked wallet is a real whale EOA ──
// The complaint: the roster sometimes holds protocols / routers / smart-account
// contracts (and rug deployers), not real whale wallets. Discovery already
// EXTCODESIZE-filters, but the append-only curated file + old registry rows can
// carry pre-filter contamination. This pass re-checks each NON-VIP wallet on
// chain: any address with bytecode is not an EOA → banned (removed + vetoed).
// Runs at boot and on a slow schedule; VIP pins are trusted and never banned.
const VALIDATE_BATCH = Number(process.env.VALIDATE_BATCH || 40);
const validateQueue = [];
let validateCursor = 0;
async function validateRosterBatch() {
  if (!validateQueue.length) {
    for (const a of REGISTERED_WHALES) if (!VIP_WHALES.has(a)) validateQueue.push(a);
  }
  let banned = 0, checked = 0;
  for (let i = 0; i < VALIDATE_BATCH && validateQueue.length; i++) {
    const addr = validateQueue[validateCursor % validateQueue.length];
    validateCursor += 1;
    checked += 1;
    if (VIP_WHALES.has(addr)) continue;
    let isContract = false;
    try { const code = await provider.getCode(addr); isContract = !!code && code !== '0x'; }
    catch { continue; } // RPC hiccup → re-check next round, don't ban on uncertainty
    if (isContract) {
      db.blacklistWhale(addr, 'contract');
      REGISTERED_WHALES.delete(addr);
      LIVE_PROMOTED.delete(addr);
      codeCache.set(addr, false); // remember: not an EOA
      banned += 1;
      console.log(`[validate] banned ${addr.slice(0, 12)}… — has bytecode (contract/protocol, not a whale)`);
    }
  }
  if (checked) console.log(`[validate] checked ${checked} roster wallets · ${banned} banned · roster now ${REGISTERED_WHALES.size}`);
}

// Hot-reload the roster when the discovery scan rewrites the file (debounced).
let rosterReloadTimer = null;
try {
  fs.watch(CURATED_PATH, () => {
    clearTimeout(rosterReloadTimer);
    rosterReloadTimer = setTimeout(loadRoster, 1500);
  });
} catch { /* fs.watch unsupported → rely on post-scan reload */ }

// Node's setInterval/setTimeout delay is a 32-bit signed int (max ~24.85 days).
// A larger value doesn't throw — it silently wraps to ~1ms, turning a "run every
// N hours" schedule into a runaway loop firing hundreds of times per second
// (this bit us: DISCOVERY_HOURS=999 → ~900 calls/sec, 98MB of logs in minutes).
// Every interval/timeout built from an operator-configurable env var goes
// through this so a misconfigured value degrades to "fire at the safe max"
// instead of flooding the process.
const MAX_TIMER_MS = 2_147_483_647;
function safeEvery(fn, ms, label) {
  const clamped = Math.min(Math.max(1, ms), MAX_TIMER_MS);
  if (clamped !== ms) console.warn(`[timer] ${label}: ${ms}ms exceeds the 32-bit timer max — clamped to ${clamped}ms (~${(clamped / 3600000).toFixed(1)}h)`);
  return setInterval(fn, clamped);
}

// ── Periodic auto-discovery: re-run the whale scan on a schedule in a child
// process (so the live indexer never blocks), then hot-reload the fresh roster.
const DISCOVERY_HOURS = Number(process.env.DISCOVERY_HOURS || 2);
const DISCOVERY_KILL_MIN = Number(process.env.DISCOVERY_KILL_MIN || 25); // watchdog: a hung scan must never block future scans
let discoveryRunning = false;
let lastScanAt = null;
function runDiscovery(reason) {
  if (discoveryRunning) { console.log('[discovery] skip — a scan is already running'); return; }
  discoveryRunning = true;
  console.log(`[discovery] launching whale scan (${reason})…`);
  const child = spawn(process.execPath, [path.join(__d, 'scanWhales.js')], { cwd: __d, env: process.env, stdio: 'inherit' });
  const killer = setTimeout(() => { console.warn(`[discovery] scan exceeded ${DISCOVERY_KILL_MIN}m — killing (watchdog)`); child.kill('SIGKILL'); }, DISCOVERY_KILL_MIN * 60 * 1000);
  child.on('exit', (code) => {
    clearTimeout(killer);
    discoveryRunning = false;
    lastScanAt = Date.now();
    console.log(`[discovery] scan finished (exit ${code}) — reloading roster`);
    loadRoster();
  });
  child.on('error', (e) => { clearTimeout(killer); discoveryRunning = false; console.warn('[discovery] spawn failed:', e.message); });
}

function rosterAgeHours() {
  try { return (Date.now() - fs.statSync(CURATED_PATH).mtimeMs) / 3600000; } catch { return Infinity; }
}

// ── Live whale promotion — catch NEW whales within minutes, not hours ──
// The 6h deep scan re-ranks the whole chain; this fast pass watches the live
// aggregates and promotes any fresh, directional, non-bot EOA to the roster so
// its trades reach the deck almost immediately.
const PROMOTE_MINUTES = Number(process.env.PROMOTE_MINUTES || 3);
const PROMOTE_MIN_USD = Number(process.env.PROMOTE_MIN_USD || 400); // cumulative USD to qualify as a whale — real size only, this is a whale app
const codeCache = new Map();
async function isEOA(addr) {
  if (codeCache.has(addr)) return codeCache.get(addr);
  let eoa = false;
  try { const code = await provider.getCode(addr); eoa = !code || code === '0x'; } catch { return false; }
  codeCache.set(addr, eoa);
  return eoa;
}
async function promoteWhales() {
  const cands = [...traderAgg.values()].filter((a) => !REGISTERED_WHALES.has(a.address));
  for (const a of cands) {
    const usd = (a.volumeMon || 0) * monPriceUsd;
    if (usd < PROMOTE_MIN_USD) continue;                        // not enough real activity yet
    const dir = a.trades ? Math.abs(a.buys - a.sells) / a.trades : 1;
    if (a.trades >= 10 && dir < 0.25) continue;                // balanced churn = MM bot
    if ((a.arbHits || 0) > 0) continue;                        // atomic arb bot
    if (!(await isEOA(a.address))) continue;                   // contract / AA bot
    REGISTERED_WHALES.add(a.address);
    LIVE_PROMOTED.add(a.address);
    a.verified = true;
    db.registerWhale(a.address, 'live', { volumeUsd: usd }); // durable — survives restarts & rescans
    console.log(`[promote] +whale ${a.address.slice(0, 10)} · $${usd.toFixed(0)} · dir ${dir.toFixed(2)} · ${a.trades}tx`);
  }
}

// ── Live MON price (USD) — powers the USD-denominated whale threshold ──
// Non-zero seed so sizing never divides by 0; match WMON by ADDRESS (not symbol,
// which DexScreener can render inconsistently) and take the deepest-liquidity
// priced pair. monPriceAt tracks freshness for /health.
let monPriceUsd = Number(process.env.MON_PRICE_USD || 0.0205);
let monPriceAt = 0;
async function refreshMonPrice() {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/monad/${WMON}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    const data = await res.json();
    const pairs = Array.isArray(data) ? data : (data.pairs || []);
    const best = pairs
      .filter((p) => p.priceUsd && (p.baseToken?.address || '').toLowerCase() === WMON)
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    const px = best ? Number(best.priceUsd) : null;
    if (px && px > 0) { monPriceUsd = px; monPriceAt = Date.now(); }
  } catch { /* keep last good price / seed */ }
}

// Swap event topic hashes seen live on Monad mainnet (verified on-chain).
const V3_SWAP_TOPIC = '0xc42079f94a6350f1a2cf73efd65a4d103d6d4a46513037101b0f199f1746e32d'; // Uniswap v3
const PANCAKE_V3_SWAP_TOPIC = '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83'; // PancakeSwap v3
// nad.fun (Monad's memecoin launchpad) graduated tokens trade on its OWN v3-fork
// DEX — MON-paired, real liquidity. Same pool ABI (token0/token1/fee) and same
// Swap data layout (amount0/amount1 first), just a distinct event topic. This is
// where all the real memecoin/degen whale activity lives; v3 (Uni/Pancake) only
// carries blue-chips + stables. Copyable via nad.fun's own router (see frontend).
const NADFUN_SWAP_TOPIC = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';
// Uniswap-V2-style Swap(sender, amount0In, amount1In, amount0Out, amount1Out, to).
// V2 pairs expose token0()/token1() (no fee()), so the same pool resolver works;
// only the data layout differs (four uint256, not two signed int256). Adds real
// copyable coverage for the V2 pools live on Monad.
const UNIV2_SWAP_TOPIC = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';
const V3_TOPICS = [V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, NADFUN_SWAP_TOPIC];
// ALL_SWAP_TOPICS (the getLogs filter) is derived from SWAP_DECODERS below, so
// registering a new venue automatically extends what the indexer scans.

// For Uniswap/Pancake v3 the Swap data begins with int256 amount0, int256 amount1.
const coder = AbiCoder.defaultAbiCoder();
function decodeAmounts(data) {
  const hex = data.replace(/^0x/, '');
  const amount0 = coder.decode(['int256'], '0x' + hex.slice(0, 64))[0];
  const amount1 = coder.decode(['int256'], '0x' + hex.slice(64, 128))[0];
  return { amount0, amount1 };
}
// V2 layout: amount0In, amount1In, amount0Out, amount1Out (uint256×4). Convert to
// the SAME signed "pool perspective" the v3 path uses (+ = into pool): in − out.
// The downstream net-flow logic is then identical for V2 and V3.
function decodeV2Amounts(data) {
  const hex = data.replace(/^0x/, '');
  const a0In = BigInt('0x' + hex.slice(0, 64));
  const a1In = BigInt('0x' + hex.slice(64, 128));
  const a0Out = BigInt('0x' + hex.slice(128, 192));
  const a1Out = BigInt('0x' + hex.slice(192, 256));
  return { amount0: a0In - a0Out, amount1: a1In - a1Out };
}

const POOL_ABI = [
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function fee() view returns (uint24)',
];
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

const provider = new JsonRpcProvider(MONAD_RPC);

// ── caches ──
const poolCache = new Map();   // pool(lower) -> {quoteIsToken0,quote,tokenAddr,fee,meta} | null
const tokenMeta = new Map();   // token(lower) -> {symbol,decimals}
const marketCache = new Map(); // token(lower) -> {liquidity,hasWmonPair,at}
const MARKET_TTL = 5 * 60 * 1000;

// The frontend copy engine executes on Pancake/Uniswap **v3** or the nad.fun
// router. A token whose only WMON pool is V2 has no v3 route, so a "copy" would
// revert — `hasWmonPair` alone was too loose. `hasCopyableRoute` = a WMON pair
// on a dex the app can actually route through, which is what `copyable` must use.
const COPYABLE_DEX = /pancake|uniswap|uni-?v3|nad/i;

const WMON_BAL_ABI = ['function balanceOf(address) view returns (uint256)'];
// Token liquidity + copyable-route detection, via DexScreener — with an ON-CHAIN
// fallback so a brand-new token not yet indexed by DexScreener (0 liquidity)
// doesn't get its whale buys dropped: we read the pool's WMON reserve directly.
async function getTokenMarket(tokenAddr, opts = {}) {
  const key = tokenAddr.toLowerCase();
  const cached = marketCache.get(key);
  if (cached && Date.now() - cached.at < MARKET_TTL) return cached;
  let liquidity = 0, hasWmonPair = false, hasCopyableRoute = false;
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/monad/${tokenAddr}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    const data = await res.json();
    const pairs = (Array.isArray(data) ? data : data.pairs || []).filter((p) => p.chainId === 'monad');
    for (const p of pairs) {
      const liq = Number(p.liquidity?.usd) || 0;
      if (liq > liquidity) liquidity = liq;
      const b = (p.baseToken?.address || '').toLowerCase();
      const q = (p.quoteToken?.address || '').toLowerCase();
      const isWmon = b === WMON || q === WMON;
      if (isWmon) hasWmonPair = true;
      if (isWmon && COPYABLE_DEX.test(p.dexId || '')) hasCopyableRoute = true;
    }
  } catch { /* fall through to the on-chain fallback */ }

  // Fallback: DexScreener has nothing yet, but the trade came from a real
  // MON-quoted pool → use its WMON reserve × price × 2 as the liquidity proxy.
  if (liquidity <= 0 && opts.poolAddr && opts.quoteKind === 'mon') {
    try {
      const wmon = new Contract(WMON, WMON_BAL_ABI, provider);
      const bal = Number(formatUnits(await wmon.balanceOf(opts.poolAddr), 18));
      if (bal > 0) {
        liquidity = bal * monPriceUsd * 2;
        hasWmonPair = true;
        if (opts.copyableDex) hasCopyableRoute = true; // a v3-fork MON pool is directly copyable
      }
    } catch { /* leave zeros → treated as no market */ }
  }

  const rec = { liquidity, hasWmonPair, hasCopyableRoute, at: Date.now() };
  marketCache.set(key, rec);
  return rec;
}

// ── live state for HTTP API ──
const recentWhales = [];                 // newest-first, capped
const RECENT_CAP = 80;
const traderAgg = new Map();             // address -> aggregate (incl. realized-PnL score)
const addressTrades = new Map();         // address -> recent trades (capped)
const traderPos = new Map();             // address -> Map(token -> avg-cost position) for realized PnL

async function getTokenMeta(addr) {
  const key = addr.toLowerCase();
  if (tokenMeta.has(key)) return tokenMeta.get(key);
  const c = new Contract(addr, ERC20_ABI, provider);
  let symbol = key.slice(0, 6);
  let decimals = 18;
  try { symbol = await c.symbol(); } catch { /* keep short addr */ }
  try { decimals = Number(await c.decimals()); } catch { /* default 18 */ }
  const meta = { symbol, decimals };
  tokenMeta.set(key, meta);
  return meta;
}

async function getPoolInfo(poolAddr, isV3, resolvePool) {
  const key = poolAddr.toLowerCase();
  if (poolCache.has(key)) return poolCache.get(key);

  let info = null;
  try {
    // Non-standard venue (no token0/token1): use its registered custom resolver.
    if (resolvePool) {
      info = await resolvePool(poolAddr, { provider, QUOTE_TOKENS, WMON, getTokenMeta });
      poolCache.set(key, info || null);
      return info || null;
    }
    const c = new Contract(poolAddr, POOL_ABI, provider);
    const [token0, token1] = await Promise.all([c.token0(), c.token1()]);
    const t0 = token0.toLowerCase();
    const t1 = token1.toLowerCase();
    const q0 = QUOTE_TOKENS.get(t0);
    const q1 = QUOTE_TOKENS.get(t1);

    // Need EXACTLY one quote anchor: token/token has no USD basis; quote/quote
    // (e.g. MON/USDC) is price action, not a copyable token bet.
    if ((!q0 && !q1) || (q0 && q1)) { poolCache.set(key, null); return null; }

    const quoteIsToken0 = !!q0;
    const quote = q0 || q1;
    const tokenAddr = quoteIsToken0 ? t1 : t0;
    let fee = null;
    if (isV3) {
      try { fee = Number(await c.fee()); } catch { fee = null; }
    }
    const meta = await getTokenMeta(tokenAddr);
    info = { quoteIsToken0, quote, tokenAddr, fee, meta };
    poolCache.set(key, info);
  } catch {
    poolCache.set(key, null);
  }
  return info;
}

// From a v3-style swap (amount0/amount1, pool's perspective: + into pool, - out),
// isolate the WMON leg → { side, wei }. BUY = trader spent MON for the token.
function monLeg(amount0, amount1, wmonIsToken0) {
  const amt = wmonIsToken0 ? amount0 : amount1;
  if (amt > 0n) return { side: 'BUY', wei: amt };   // MON into pool → buying the token
  if (amt < 0n) return { side: 'SELL', wei: -amt }; // MON out of pool → selling the token
  return null;
}

// The token leg is the non-WMON side; absolute value = token quantity moved.
function tokenLegWei(amount0, amount1, wmonIsToken0) {
  const amt = wmonIsToken0 ? amount1 : amount0;
  return amt < 0n ? -amt : amt;
}

// Deck eligibility: copyable BUYs only, and — when roster-only is on — only from
// verified/tracked whales (a normal person's big trade is not what we copy).
function isDeckEligible(card) {
  if (card.side !== 'BUY' && !INCLUDE_SELLS) return false;
  if (DECK_ROSTER_ONLY && !card.isRegisteredWhale) return false;
  return true;
}

function recordWhale(card) {
  // Persist first; if this trade was already stored (e.g. re-seen on a restart
  // backfill), skip so aggregates and the deck are never double-counted.
  if (!db.persistTrade(card)) return false;

  // Deck (and live feed) — copyable trades only.
  if (isDeckEligible(card)) {
    recentWhales.unshift(card);
    if (recentWhales.length > RECENT_CAP) recentWhales.pop();
  }

  // Aggregate / leaderboard — counts all trades (buys + sells) for real volume.
  const a = card.trader.toLowerCase();
  const agg = traderAgg.get(a) || {
    address: a, trades: 0, buys: 0, sells: 0,
    volumeMon: 0, netMon: 0, lastSeen: 0, lastToken: null,
  };
  agg.trades += 1;
  if (card.side === 'BUY') { agg.buys += 1; agg.netMon -= card.amountMon; }
  else { agg.sells += 1; agg.netMon += card.amountMon; }
  agg.volumeMon += card.amountMon;
  agg.lastSeen = card.ts;
  agg.lastToken = card.tokenSymbol;

  // Same-block round-trip (buy+sell of the same token in one block) = atomic arb bot.
  const tkl = (card.tokenAddress || '').toLowerCase();
  if (agg._lastBlock === card.blockNumber && agg._lastToken2 === tkl && agg._lastSide && agg._lastSide !== card.side) {
    agg.arbHits = (agg.arbHits || 0) + 1;
  }
  agg._lastBlock = card.blockNumber; agg._lastToken2 = tkl; agg._lastSide = card.side;

  // ── Realized PnL (MON) via average cost, per token ──
  // Only what we observe on-chain in WMON pools; a real, honest lower bound.
  const posMap = traderPos.get(a) || new Map();
  const tk = (card.tokenAddress || '').toLowerCase();
  const pos = posMap.get(tk) || { boughtTok: 0, spentMon: 0, soldTok: 0, recvMon: 0, realizedMon: 0 };
  if (card.side === 'BUY') {
    pos.boughtTok += card.tokenAmount || 0;
    pos.spentMon += card.amountMon || 0;
  } else { // SELL — realize against average cost of what we've seen them buy
    const avgCost = pos.boughtTok > 0 ? pos.spentMon / pos.boughtTok : 0;
    const qty = card.tokenAmount || 0;
    if (avgCost > 0) pos.realizedMon += (card.amountMon || 0) - avgCost * qty;
    pos.soldTok += qty;
    pos.recvMon += card.amountMon || 0;
  }
  posMap.set(tk, pos);
  traderPos.set(a, posMap);

  let realizedMon = 0, closedTokens = 0, winTokens = 0;
  for (const p of posMap.values()) {
    if (p.soldTok > 0 && p.boughtTok > 0) {
      closedTokens += 1;
      realizedMon += p.realizedMon;
      if (p.realizedMon > 0) winTokens += 1;
    }
  }
  agg.realizedMon = realizedMon;
  agg.closedTokens = closedTokens;
  agg.winTokens = winTokens;
  agg.activeTokens = posMap.size;
  traderAgg.set(a, agg);

  const list = addressTrades.get(a) || [];
  list.unshift(card);
  if (list.length > 30) list.pop();
  addressTrades.set(a, list);

  // Durable write so scores accumulate across restarts.
  db.persistTrader(agg);
  db.persistPosition(a, tk, pos);
  return true;
}

// True only for routes the frontend executor can PROVABLY fill (nad.fun router,
// or a MON-quoted Pancake/Uniswap v3 pool). Single source of truth so live cards
// AND cards restored from disk are gated identically — no stale copyable=true
// row (e.g. an old USDC-quoted trade) can slip a NO_LIQUIDITY card onto the deck.
function isExecutableRoute(dex, quoteSymbol) {
  return dex === 'NadFun' || ((dex === 'PancakeV3' || dex === 'UniswapV3') && quoteSymbol === 'MON');
}

// Reconstruct an in-memory card from a persisted trades row.
function rowToCard(r) {
  return {
    id: r.id, txHash: r.id.split(':')[0], trader: r.trader, side: r.side, dex: r.dex,
    groupId: r.trader + ':' + r.token + ':' + r.side,
    source: r.dex === 'NadFun' ? 'nadfun' : 'v3', // routing hint (derived from dex)
    poolAddress: r.pool, tokenAddress: r.token, tokenSymbol: r.tokenSymbol,
    tokenDecimals: r.tokenDecimals, isStable: !!r.isStable, feeTier: r.feeTier,
    amountMon: r.amountMon, amountUsd: r.amountUsd, tokenAmount: r.tokenAmount,
    quoteSymbol: r.quoteSymbol,
    copyable: isExecutableRoute(r.dex, r.quoteSymbol), // re-evaluated, not the stale stored flag
    liquidityUsd: r.liquidityUsd,
    isRegisteredWhale: REGISTERED_WHALES.has(r.trader),
    blockNumber: r.block, ts: r.ts,
  };
}

// Restore deck + aggregates + realized-PnL positions from SQLite at boot.
function initFromDb() {
  for (const [addr, r] of db.loadTraders()) {
    traderAgg.set(addr, {
      address: r.address, trades: r.trades, buys: r.buys, sells: r.sells,
      volumeMon: r.volumeMon, netMon: r.netMon, realizedMon: r.realizedMon,
      closedTokens: r.closedTokens, winTokens: r.winTokens, activeTokens: r.activeTokens,
      lastSeen: r.lastSeen, lastToken: r.lastToken,
    });
  }
  for (const [addr, m] of db.loadPositions()) traderPos.set(addr, m);
  for (const row of db.loadRecentTrades(RECENT_CAP * 6)) {
    const card = rowToCard(row); // rows are newest-first
    // Apply the current pro gate so the restored deck only holds whale-sized trades.
    const usd = card.amountUsd ?? (card.amountMon * monPriceUsd);
    const big = card.isRegisteredWhale ? usd >= REGISTERED_MIN_USD : usd >= WHALE_MIN_USD;
    if (isDeckEligible(card) && big && recentWhales.length < RECENT_CAP) recentWhales.push(card);
  }
  console.log(`[db] restored ${traderAgg.size} traders · ${recentWhales.length} deck cards · ${db.stats().dbTrades} trades on disk`);
}

// ── WebSocket server ──
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});
console.log(`[WS]   Attached to HTTP server`);

function broadcast(card) {
  const msg = JSON.stringify({ type: 'NEW_TRADE', data: card });
  for (const c of clients) if (c.readyState === 1) c.send(msg);
}

// ── Indexer poll loop ──
let lastBlock = null;

// ── Operational metrics (for /health monitoring + external uptime alerts) ──
const BOOT_AT = Date.now();
let lastChainHead = null; // newest block seen from the RPC (for "blocks behind")
let lastCardAt = 0;       // ms of the last deck card produced — staleness signal
let pollErrorCount = 0;   // cumulative RPC/poll failures

// ── Pluggable swap-log decoder registry ──────────────────────────────────
// Each supported DEX = one entry: { dex, isV3, decode, resolvePool? }.
//   decode(data)        → { amount0, amount1 } in the signed "into-pool +"
//                         convention (v3 native; v2 = in−out).
//   resolvePool(addr)?  → OPTIONAL custom pool→tokens resolver for venues that
//                         DON'T expose token0()/token1() (e.g. the custom Monad
//                         AMMs). When omitted, the standard token0/token1 path is
//                         used. This is the single place to add a new venue: give
//                         its Swap topic + a decode fn (+ a resolver if its pools
//                         are non-standard) and it flows through the whole pipeline
//                         (net-flow, whale gating, deck) unchanged.
const SWAP_DECODERS = new Map([
  [V3_SWAP_TOPIC, { dex: 'UniswapV3', isV3: true, decode: decodeAmounts }],
  [PANCAKE_V3_SWAP_TOPIC, { dex: 'PancakeV3', isV3: true, decode: decodeAmounts }],
  [NADFUN_SWAP_TOPIC, { dex: 'NadFun', isV3: true, decode: decodeAmounts }],
  [UNIV2_SWAP_TOPIC, { dex: 'UniswapV2', isV3: false, decode: decodeV2Amounts }],
  // ── Add custom Monad AMM/perp venues here once their ABI is known, e.g.:
  // ['0x<swapTopic>', { dex: 'FooDex', isV3: false, decode: decodeFoo, resolvePool: resolveFooPool }],
]);
const DEX_BY_TOPIC = Object.fromEntries([...SWAP_DECODERS].map(([t, d]) => [t, d.dex]));
// The getLogs topic filter — every registered venue's swap topic.
const ALL_SWAP_TOPICS = [...SWAP_DECODERS.keys()];

// ── Net-flow attribution (tx-level) ──────────────────────────────────────
// A single transaction can emit MANY swap logs: multi-hop routes, aggregator
// splits, arb loops. Attributing every leg to tx.from is exactly what surfaced
// tokens a wallet never actually bought (e.g. a WBTC hop mid-route). Instead we
// NET all quote-anchored legs of the tx per token and emit ONE card for the
// token the trader genuinely acquired (BUY) or disposed (SELL). Pass-through
// hops net to ~zero and are dropped. This is the single source of "correct
// transactions + correct whales".
async function processTx(txHash, logs) {
  // Resolve the trader (always an EOA — tx.from) once for the whole tx.
  let trader = null;
  try { const tx = await provider.getTransaction(txHash); if (tx?.from) trader = tx.from.toLowerCase(); }
  catch { return; }
  if (!trader) return;

  const isVIP = REGISTERED_WHALES.has(trader);

  // Per traded-token flow: net trader delta (received +, sent −), gross throughput,
  // USD spent/received, and the dominant leg's pool/fee/block for the card.
  const flow = new Map();
  for (const log of logs) {
    const spec = SWAP_DECODERS.get(log.topics[0]); if (!spec) continue;
    const dex = spec.dex;
    const pool = await getPoolInfo(log.address, spec.isV3, spec.resolvePool); if (!pool) continue; // not a single-quote-anchored pool
    let amount0, amount1;
    try { ({ amount0, amount1 } = spec.decode(log.data)); } catch { continue; }
    const quoteSigned = pool.quoteIsToken0 ? amount0 : amount1;
    const tokenSigned = pool.quoteIsToken0 ? amount1 : amount0;
    if (quoteSigned === 0n) continue;
    const traderTokenDelta = -tokenSigned; // token OUT of pool = trader received it
    const qAbs = quoteSigned > 0n ? quoteSigned : -quoteSigned;
    const usd = pool.quote.kind === 'usd'
      ? Number(formatUnits(qAbs, pool.quote.decimals))
      : Number(formatUnits(qAbs, 18)) * monPriceUsd;

    const f = flow.get(pool.tokenAddr) || { net: 0n, gross: 0n, spentUsd: 0, recvUsd: 0, topLegUsd: 0, pool, dex, poolAddress: log.address.toLowerCase(), blockNumber: log.blockNumber };
    f.net += traderTokenDelta;
    f.gross += traderTokenDelta < 0n ? -traderTokenDelta : traderTokenDelta;
    if (quoteSigned > 0n) f.spentUsd += usd; else f.recvUsd += usd; // quote INTO pool = trader spent
    if (usd > f.topLegUsd) { f.topLegUsd = usd; f.pool = pool; f.dex = dex; f.poolAddress = log.address.toLowerCase(); f.blockNumber = log.blockNumber; }
    flow.set(pool.tokenAddr, f);
  }
  if (!flow.size) return;

  // Pick the token the trader NET moved the most (by USD). Require the net to be
  // a genuine position change, not a routed-through hop (|net| must dominate the
  // gross throughput for that token) — this is what drops arb/aggregator noise.
  let best = null;
  for (const [addr, f] of flow) {
    const absNet = f.net < 0n ? -f.net : f.net;
    if (absNet === 0n) continue;
    if (f.gross > 0n && (absNet * 100n) / f.gross < 40n) continue; // <40% net kept → pass-through, not owned
    const usd = f.spentUsd + f.recvUsd;
    if (!best || usd > best.usd) best = { addr, f, usd, absNet };
  }
  if (!best) return;

  const f = best.f;
  const side = f.net > 0n ? 'BUY' : 'SELL';                 // net token received = a real BUY
  const amountUsd = side === 'BUY' ? (f.spentUsd || best.usd) : (f.recvUsd || best.usd);
  const amountMon = monPriceUsd > 0 ? amountUsd / monPriceUsd : 0;

  // Size gate: known whales pass on any real trade; everyone else must move big USD.
  if (isVIP) { if (amountUsd < REGISTERED_MIN_USD) return; }
  else if (amountUsd < WHALE_MIN_USD) return;

  // Correct-whale gate: a non-registered trader must be a plain EOA. Filters
  // protocol/router/aggregator/AA-bot contracts that are not real "whales".
  if (!isVIP && !(await isEOA(trader))) return;

  // Liquidity / rug gate: a live market must exist. Zero liquidity = rugged or
  // dead token → never surface it. Non-VIPs also need the high-liquidity floor.
  // Pass the pool so a fresh token missing from DexScreener can still price via
  // its on-chain WMON reserve (don't drop a real early whale buy).
  const market = await getTokenMarket(best.addr, { poolAddr: f.poolAddress, quoteKind: f.pool.quote.kind, copyableDex: f.dex !== 'UniswapV2' });
  if (market.liquidity <= 0) return;                        // rugged / no live pair
  if (!isVIP && market.liquidity < MIN_LIQ_USD) return;

  const meta = f.pool.meta;
  const tokenAmount = Number(formatUnits(best.absNet, meta.decimals));
  const isNadfun = f.dex === 'NadFun';
  // Copyable ONLY when the frontend executor can PROVABLY route it, so a shown
  // card never fails copy with NO_LIQUIDITY:
  //   • nad.fun → its own router (buildNadfunBuy), OR
  //   • the whale's OWN MON-quoted Pancake/Uniswap v3 pool — the copy quotes that
  //     exact router + fee tier, and the whale just traded it, so liquidity is
  //     guaranteed to exist.
  // We deliberately do NOT trust DexScreener's "has a WMON pair" here: that pair
  // can be a v2/other-DEX pool the v3 executor can't reach → NO_LIQUIDITY on copy.
  // A non-copyable trade still DISCOVERS the whale; it's just hidden from the deck.
  const copyable = isExecutableRoute(f.dex, f.pool.quote.symbol);

  const card = {
    id: txHash + ':' + trader.slice(2, 10), // one card per (tx, trader) — no per-leg dupes
    // Deck identity: all buys by the SAME whale of the SAME token collapse into
    // one card (summed on the deck). One tx is a "leg" of that group.
    groupId: trader + ':' + best.addr + ':' + side,
    txHash,
    trader,
    side,
    dex: f.dex,
    source: isNadfun ? 'nadfun' : 'v3', // frontend picks the execution engine off this
    poolAddress: f.poolAddress,
    tokenAddress: best.addr,
    tokenSymbol: meta.symbol,
    tokenDecimals: meta.decimals,
    quoteSymbol: f.pool.quote.symbol,
    isStable: false,
    feeTier: f.pool.fee,
    amountMon,
    amountUsd,
    tokenAmount,
    liquidityUsd: market.liquidity,
    copyable,
    isRegisteredWhale: isVIP,
    blockNumber: f.blockNumber,
    ts: Date.now(),
  };

  const isNew = recordWhale(card);
  if (isNew && isDeckEligible(card)) {
    lastCardAt = Date.now(); // metrics: deck freshness / "no cards" alert
    broadcast(card);
    const tag = isVIP ? '[VIP]' : '[WHALE]';
    console.log(
      `${tag} ${side} $${amountUsd.toFixed(0).padStart(6)}  ${card.tokenSymbol.padEnd(8)}/${f.pool.quote.symbol.padEnd(5)} ` +
      `${trader.slice(0, 10)}…  (${f.dex}${copyable ? '' : ' · no-MON-route'})`,
    );
  } else if (isNew && side === 'SELL' && isVIP) {
    // A tracked whale SELLING a token is NOT a deck card (you can't copy an exit),
    // but the app uses it to auto-close a user's copy when they enabled
    // "sell when the whale sells" for that position. Broadcast it as a signal.
    broadcast(card);
    console.log(`[EXIT] SELL $${amountUsd.toFixed(0).padStart(6)}  ${card.tokenSymbol.padEnd(8)} ${trader.slice(0, 10)}… → whale-exit signal`);
  }
}

// Group a batch of swap logs by transaction so net-flow attribution sees the
// whole route at once (and getTransaction is called once per tx, not per log).
async function processLogs(logs) {
  const byTx = new Map();
  for (const log of logs) {
    if (!DEX_BY_TOPIC[log.topics[0]]) continue;
    const arr = byTx.get(log.transactionHash) || [];
    arr.push(log);
    byTx.set(log.transactionHash, arr);
  }
  for (const [txHash, txLogs] of byTx) await processTx(txHash, txLogs).catch(() => {});
}

// Scan recent history once at boot so the deck is populated with real whales
// immediately, instead of waiting for a fresh trade to land.
async function backfill() {
  try {
    const current = await provider.getBlockNumber();
    const start = current - BACKFILL_BLOCKS;
    console.log(`[Backfill] scanning blocks ${start} → ${current}…`);
    for (let from = start; from <= current; from += MAX_BLOCK_SPAN) {
      const to = Math.min(current, from + MAX_BLOCK_SPAN - 1);
      let logs = [];
      try {
        logs = await provider.getLogs({ fromBlock: from, toBlock: to, topics: [ALL_SWAP_TOPICS] });
      } catch { continue; }
      await processLogs(logs);
    }
    lastBlock = current;
    console.log(`[Backfill] done · ${recentWhales.length} whales seeded`);
  } catch (err) {
    console.error('[Backfill] error:', err.shortMessage || err.message || err);
  }
}

// Catch-up config: NO block is ever skipped inside this window — a backlog from
// an RPC stall or restart is drained chunk-by-chunk. Only a backlog OLDER than
// CATCHUP_MAX (e.g. after long downtime) is capped, since blocks that stale are
// no longer "live deck" material anyway.
const CATCHUP_MAX = Number(process.env.CATCHUP_MAX || 20000); // ~2.7h at 0.5s blocks
const CATCHUP_DELAY_MS = Number(process.env.CATCHUP_DELAY_MS || 40); // pace while draining a backlog
async function poll() {
  let behind = 0;
  try {
    const current = await provider.getBlockNumber();
    lastChainHead = current; // metrics: newest head we've observed
    if (lastBlock === null) {
      lastBlock = current - 1;
      console.log(`[Indexer] live from block ${lastBlock} · whale ≥ ${WHALE_MIN_MON} MON`);
    }
    // Bound worst-case backlog: process everything within CATCHUP_MAX, only
    // fast-forward past the part too old to matter (logged so it's visible).
    if (current - lastBlock > CATCHUP_MAX) {
      console.warn(`[Indexer] ${current - lastBlock} blocks behind — capping catch-up to the last ${CATCHUP_MAX}`);
      lastBlock = current - CATCHUP_MAX;
    }

    if (current > lastBlock) {
      const from = lastBlock + 1;
      const to = Math.min(current, from + MAX_BLOCK_SPAN - 1);
      const logs = await provider.getLogs({ fromBlock: from, toBlock: to, topics: [ALL_SWAP_TOPICS] });
      await processLogs(logs);
      lastBlock = to;              // advance ONLY after a chunk is fully processed
      behind = current - lastBlock; // still behind → keep draining this tick-chain
    }
  } catch (err) {
    // On failure lastBlock is NOT advanced, so the exact same range is retried
    // next tick — an RPC hiccup can never silently skip blocks.
    pollErrorCount += 1;
    console.error('[Indexer] poll error:', err.shortMessage || err.message || err);
  } finally {
    // Drain a backlog quickly (CATCHUP_DELAY_MS); otherwise resume normal cadence.
    setTimeout(poll, behind > 0 ? CATCHUP_DELAY_MS : POLL_MS);
  }
}

// ── Deck aggregation: collapse repeat buys into one card ──────────────────
// A whale that buys the same token 5 times used to produce 5 near-identical
// deck cards. Instead we fold every buy by the same whale of the same token
// (same groupId) into ONE card: amounts are SUMMED (real total position added),
// entry price becomes the size-weighted average, and each individual buy is
// preserved as a `leg` for the card's detail view. `cards` is newest-first, so
// the first card seen per group carries the freshest metadata/price.
function aggregateDeck(cards) {
  const groups = new Map();
  for (const c of cards) {
    const gid = c.groupId || (c.trader + ':' + c.tokenAddress + ':' + c.side);
    let g = groups.get(gid);
    if (!g) {
      g = { ...c, id: gid, groupId: gid, buyCount: 0, amountUsd: 0, amountMon: 0, tokenAmount: 0, legs: [] };
      groups.set(gid, g);
    }
    g.buyCount += 1;
    g.amountUsd += c.amountUsd || 0;
    g.amountMon += c.amountMon || 0;
    g.tokenAmount += c.tokenAmount || 0;
    g.legs.push({ txHash: c.txHash, amountUsd: c.amountUsd, amountMon: c.amountMon, tokenAmount: c.tokenAmount, ts: c.ts, blockNumber: c.blockNumber });
  }
  // Preserve the deck's newest-first ordering by the most recent leg.
  return [...groups.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// Compact profitability score derived from a trader's aggregate (realized only).
function scoreFromAgg(agg) {
  if (!agg) return null;
  const closed = agg.closedTokens || 0;
  return {
    realizedMon: agg.realizedMon || 0,
    winRate: closed > 0 ? agg.winTokens / closed : null,
    closedTokens: closed,
    activeTokens: agg.activeTokens || 0,
    trades: agg.trades || 0,
  };
}

// ── HTTP API ──
// Locked to the real production frontend (+ local dev) instead of '*' — an
// open CORS policy meant ANY site (including stale/duplicate Vercel
// deployments from old imports) could call this backend and would silently
// work. Only an explicitly allowed Origin gets echoed back; everyone else's
// browser blocks the response. Override/extend via ALLOWED_ORIGINS (CSV).
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://deepswap-zeta.vercel.app,http://localhost:5173,http://localhost:5174')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
function corsHeadersFor(origin) {
  return origin && ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}
const sendJson = (req, res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    ...corsHeadersFor(req.headers.origin),
  });
  res.end(JSON.stringify(body));
};

server.on('request', async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  // Per-IP rate limit on the public data endpoints (health/liveness exempt).
  if (path !== '/health') {
    const rl = rateLimiter(req);
    if (!rl.ok) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': String(rl.retryAfterSec), ...corsHeadersFor(req.headers.origin) });
      return res.end(JSON.stringify({ error: 'rate limited' }));
    }
  }

  if (path === '/health') {
    // Operational health so an external uptime monitor can alert when the
    // indexer silently degrades. `healthy:false` fires only on HARD problems.
    const now = Date.now();
    const blocksBehind = (lastChainHead != null && lastBlock != null) ? lastChainHead - lastBlock : null;
    const priceAgeMin = monPriceAt ? (now - monPriceAt) / 60000 : null;
    const cardAgeMin = lastCardAt ? (now - lastCardAt) / 60000 : null;
    const BEHIND_ALERT = Number(process.env.BEHIND_ALERT || 800);
    const PRICE_STALE_MIN = Number(process.env.PRICE_STALE_MIN || 5);
    const NO_CARD_ALERT_MIN = Number(process.env.NO_CARD_ALERT_MIN || 45);
    const alerts = [];
    if (lastBlock == null) alerts.push('poll-not-started');
    if (blocksBehind != null && blocksBehind > BEHIND_ALERT) alerts.push(`far-behind:${blocksBehind}`);
    if (priceAgeMin != null && priceAgeMin > PRICE_STALE_MIN) alerts.push('price-stale');
    const warnings = [];
    if (cardAgeMin != null && cardAgeMin > NO_CARD_ALERT_MIN) warnings.push(`no-cards:${Math.round(cardAgeMin)}m`);
    return sendJson(req, res, 200, {
      ok: true, healthy: alerts.length === 0, alerts, warnings,
      chain: 'monad', feed: 'rpc-poll+catchup',
      uptimeSec: Math.round((now - BOOT_AT) / 1000),
      lastBlock, chainHead: lastChainHead, blocksBehind,
      monPriceUsd, priceAgeSec: monPriceAt ? Math.round((now - monPriceAt) / 1000) : null,
      lastCardAgeSec: lastCardAt ? Math.round((now - lastCardAt) / 1000) : null,
      pollErrors: pollErrorCount,
      whales: recentWhales.length, traders: traderAgg.size,
      whaleMinUsd: WHALE_MIN_USD, minLiqUsd: MIN_LIQ_USD,
      registered: REGISTERED_WHALES.size, deckRosterOnly: DECK_ROSTER_ONLY,
      dexes: Object.values(DEX_BY_TOPIC),
      discovery: { engine: 'deep-scan + live-promote', scanEveryHours: DISCOVERY_HOURS, promoteEveryMinutes: PROMOTE_MINUTES, running: discoveryRunning, lastFinished: lastScanAt },
      ...db.stats(),
    });
  }
  // ── Universal copy quote via the OpenOcean aggregator (BUY and SELL) ──
  // Aggregates EVERY Monad DEX (nad.fun graduated DEX, Uniswap, Kuru, LFJ, …), so
  // any token with real liquidity is both copyable AND sellable — the role Jupiter
  // plays for Solana. side=buy: MON→token (amount = human MON). side=sell:
  // token→MON (amount = human token units). Proxied here to dodge CORS and keep an
  // optional OPENOCEAN_API_KEY server-side. Returns a ready-to-sign tx (+ the
  // router to approve, for sells).
  if (path === '/quote') {
    const token = (url.searchParams.get('token') || '').toLowerCase();
    const amount = url.searchParams.get('amount'); // human amount of the IN token
    const taker = url.searchParams.get('taker');
    const side = url.searchParams.get('side') === 'sell' ? 'sell' : 'buy';
    const slippageBps = Number(url.searchParams.get('slippageBps') || 1000);
    if (!/^0x[0-9a-f]{40}$/.test(token) || !amount || Number(amount) <= 0 || !/^0x[0-9a-fA-F]{40}$/.test(taker || '')) {
      return sendJson(req, res, 400, { error: 'bad params' });
    }
    try {
      const NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
      const inTok = side === 'sell' ? token : NATIVE;
      const outTok = side === 'sell' ? NATIVE : token;
      const slippage = Math.min(50, Math.max(0.05, slippageBps / 100)); // OpenOcean wants percent
      const gwei = Number(process.env.MON_GAS_GWEI || 50); // for OpenOcean's estimate only; our tx sets its own gas
      const qs = `inTokenAddress=${inTok}&outTokenAddress=${outTok}&amount=${encodeURIComponent(amount)}&gasPrice=${gwei}&slippage=${slippage}&account=${taker}`;
      const oo = await fetch(`https://open-api.openocean.finance/v4/monad/swap?${qs}`, {
        headers: { Accept: 'application/json', ...(process.env.OPENOCEAN_API_KEY ? { apikey: process.env.OPENOCEAN_API_KEY } : {}) },
        signal: AbortSignal.timeout(12000),
      });
      const j = await oo.json();
      const d = j?.data;
      if (j?.code !== 200 || !d || !d.to || !d.data || d.value === undefined || !(BigInt(d.outAmount || '0') > 0n)) {
        return sendJson(req, res, 200, { ok: false, reason: 'no-route' });
      }
      // For a sell, the token must be approved to the OpenOcean spender first.
      return sendJson(req, res, 200, { ok: true, side, to: d.to, spender: d.to, data: d.data, value: String(d.value), out: String(d.outAmount), minOut: String(d.minOutAmount || '0'), dex: 'OpenOcean' });
    } catch (e) {
      return sendJson(req, res, 200, { ok: false, reason: e.message || 'quote failed' });
    }
  }

  if (path === '/whales') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 40), RECENT_CAP);
    // Aggregate first (repeat buys → one card), THEN limit, so the cap counts
    // distinct whale·token signals rather than raw legs.
    const whales = aggregateDeck(recentWhales).slice(0, limit).map((c) => ({
      ...c, traderScore: scoreFromAgg(traderAgg.get(c.trader.toLowerCase())),
    }));
    return sendJson(req, res, 200, { whales });
  }
  if (path === '/leaderboard') {
    const board = [...traderAgg.values()]
      .map((a) => ({
        ...a, winRate: a.closedTokens > 0 ? a.winTokens / a.closedTokens : null, verified: REGISTERED_WHALES.has(a.address),
        quality: qualityScore({ realizedUsd: (a.realizedMon || 0) * monPriceUsd, volumeUsd: (a.volumeMon || 0) * monPriceUsd, winRate: a.closedTokens > 0 ? a.winTokens / a.closedTokens : null, closedTokens: a.closedTokens, recencyDays: daysSince(a.lastSeen) }),
      }))
      .sort((a, b) => b.quality - a.quality) // rank by quality (PnL + win-rate + recency), not raw volume
      .slice(0, 80);
    return sendJson(req, res, 200, { traders: board });
  }
  if (path === '/roster') {
    // Verified Smart Money roster — served from the DURABLE whale_registry
    // (every wallet ever confirmed: scans, live promotions, external seeds).
    // Rows are never deleted, so the list only grows. Richest stats win; live
    // promotions fill in from the running aggregate.
    const byAddr = new Map();
    for (const r of db.loadWhaleRegistry()) {
      const base = r.stats && typeof r.stats === 'object' ? r.stats : { address: r.address };
      byAddr.set(r.address, {
        ...base, address: r.address,
        volumeUsd: Math.max(Number(base.volumeUsd) || 0, Number(r.volumeUsd) || 0),
        source: r.source, firstSeen: r.firstSeen, lastSeen: r.lastSeen,
      });
    }
    try {
      const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
      for (const w of curated.whales || []) {
        if (w.address && !byAddr.has(w.address.toLowerCase())) byAddr.set(w.address.toLowerCase(), w);
      }
    } catch { /* file may be mid-rewrite by the discovery scan */ }
    for (const addr of REGISTERED_WHALES) {
      if (byAddr.has(addr)) continue; // curated stats already richer
      const a = traderAgg.get(addr);
      if (!a) continue; // no live activity yet → nothing to show
      byAddr.set(addr, {
        address: addr,
        volumeUsd: Math.round((a.volumeMon || 0) * monPriceUsd * 100) / 100,
        volumeMon: Math.round((a.volumeMon || 0) * 100) / 100,
        trades: a.trades, buys: a.buys, sells: a.sells,
        tokens: a.lastToken ? [a.lastToken] : [], lastToken: a.lastToken,
        realizedMon: Math.round((a.realizedMon || 0) * 100) / 100, closedTokens: a.closedTokens || 0,
        winTokens: a.winTokens || 0, winRate: a.closedTokens > 0 ? Math.round((a.winTokens / a.closedTokens) * 100) / 100 : null,
        lpAddedUsd: 0, isMarketMaker: false, livePromoted: true,
      });
    }
    // Rank by quality: use the scan's persisted qualityScore when present, else
    // derive it live (realized PnL + win-rate + last-seen recency).
    const rosterRank = (w) => (w.qualityScore != null ? w.qualityScore : qualityScore({
      realizedUsd: w.realizedUsd != null ? w.realizedUsd : (w.realizedMon || 0) * monPriceUsd,
      volumeUsd: w.volumeUsd || 0, winRate: w.winRate, closedTokens: w.closedTokens || 0,
      recencyDays: daysSince(traderAgg.get(w.address)?.lastSeen),
    }));
    const whales = [...byAddr.values()].sort((x, y) => rosterRank(y) - rosterRank(x));
    return sendJson(req, res, 200, { count: whales.length, whales });
  }
  const m = path.match(/^\/address\/(0x[0-9a-fA-F]{40})$/);
  if (m) {
    const a = m[1].toLowerCase();
    let balanceMon = null;
    try { balanceMon = Number(formatUnits(await provider.getBalance(a), 18)); } catch {}
    // Full history straight from disk (survives restarts, deeper than the live cap).
    const trades = db.tradesByAddress(a, 30).map(rowToCard);
    return sendJson(req, res, 200, {
      address: a,
      balanceMon,
      aggregate: traderAgg.get(a) || null,
      score: scoreFromAgg(traderAgg.get(a)),
      trades: trades.length ? trades : (addressTrades.get(a) || []),
    });
  }
  sendJson(req, res, 404, { error: 'not found' });
});
server.listen(PORT, () => console.log(`[HTTP/WS] listening on port ${PORT}`));

await refreshMonPrice();
console.log(`[price] MON = $${monPriceUsd} · whale floor $${WHALE_MIN_USD} (~${Math.round(WHALE_MIN_USD / monPriceUsd)} MON)`);
setInterval(refreshMonPrice, 60000);
initFromDb();
await backfill();
poll();

// Roster hygiene: ban any tracked wallet that is actually a contract/protocol
// (not a real whale EOA). First pass after backfill; then on a slow rotation so
// the whole roster gets re-verified over time as new wallets are promoted in.
const VALIDATE_MINUTES = Number(process.env.VALIDATE_MINUTES || 7);
setTimeout(validateRosterBatch, 60000);
safeEvery(validateRosterBatch, VALIDATE_MINUTES * 60 * 1000, 'validate interval');
console.log(`[validate] roster hygiene every ${VALIDATE_MINUTES}m (${VALIDATE_BATCH}/batch · bans contracts)`);

// Live promotion: catch brand-new whales within minutes (deck stays fresh).
setTimeout(promoteWhales, 45000); // first pass shortly after backfill settles
safeEvery(promoteWhales, PROMOTE_MINUTES * 60 * 1000, 'promote interval');
console.log(`[promote] live whale promotion every ${PROMOTE_MINUTES}m (≥ $${PROMOTE_MIN_USD} directional EOA)`);

// Deep re-rank + persistence of the whole roster on a slower schedule.
safeEvery(() => runDiscovery('scheduled'), DISCOVERY_HOURS * 3600 * 1000, 'discovery interval');
if (rosterAgeHours() > DISCOVERY_HOURS) {
  setTimeout(() => runDiscovery('stale at boot'), 30000); // let backfill settle first
  console.log(`[discovery] roster is ${rosterAgeHours() === Infinity ? 'missing' : rosterAgeHours().toFixed(1) + 'h'} old → scan queued`);
} else {
  console.log(`[discovery] roster fresh (${rosterAgeHours().toFixed(1)}h) · next scan in ${DISCOVERY_HOURS}h`);
}
