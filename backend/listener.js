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
const VIP_WHALES = new Set([
  '0x4cd934beae89200b3e5f16783897c9424e25f3df',
  '0xe1aa0010b4c25f38a7c8a724fdd79c6e8ce543fe',
  '0xe50f5af8a97379b6ebd968121186c71b88dc0b69',
  '0x69c350da1c843093aff7aae118af7fa73e7736f8',
  '0x15ddce897d76ac39c188ade4d353711a60395315',
  '0xa9615d22b2d1f8836d60fe7e1c13c56ec7a342e3',
  '0xe50585bd466bff569da0a1737b299fdb31aa368e',
  '0x33a458ea4cad5c7943f8ae2a58dc5dcd3bb2fb07',
  '0x5a8bcbdb13fdad13d622ffac3e30ea17eea06fed',
  '0x05ca0b7b8626ae142c90219cc3cf42faca0dd103',
  '0xa99767ff6874018935af8924eeb3de3c7b578edc',
  '0xb3a41293d166b21ccb8c61ae9011cbc7559d348f',
  '0x0f3f5ffc9f100c11335ac8b9e89dc91bb5f41c98',
  '0xb11e96e929c64cfe12c28f1c0417bb8ddaf5f6b6',
  '0x8524a3a88e9d9672b33e34de03e174f140ef6663',
  '0xbb34dab96850d0b453c1f984a81bb497efb229e7',
  '0x988d179a9e8a174cc92ebd51492281dd2f19fa9e',
  '0xc0ea1c03bb9d466d506c0fb1621f256e291c38e2',
  '0x17b04ada408086bb37743d8589e5e18c522be159',
  '0xb42f812a44c22cc6b861478900401ee759ebead6',
  '0xa581a60fdea3c390ff08f033733c6b678f5f9f49',
]);

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
  let curatedCount = 0;
  try {
    const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
    for (const w of curated.whales || []) if (w.address) {
      // durable registry: a future rescan that misses this wallet can't erase it
      db.registerWhale(w.address.toLowerCase(), 'scan', { volumeUsd: w.volumeUsd ?? null, stats: w });
      curatedCount += 1;
    }
  } catch (e) { console.warn('[whales] curated roster not loaded:', e.message); }
  let registryCount = 0;
  for (const r of db.loadWhaleRegistry()) { REGISTERED_WHALES.add(r.address); registryCount += 1; }
  console.log(`[whales] roster = ${REGISTERED_WHALES.size} wallets (${VIP_WHALES.size} VIP · registry ${registryCount} · scan file ${curatedCount} · live ${LIVE_PROMOTED.size})`);
}
loadRoster();

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
let monPriceUsd = Number(process.env.MON_PRICE_USD || 0.0205); // seed; refreshed live
async function refreshMonPrice() {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/monad/${WMON}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    const data = await res.json();
    const pairs = Array.isArray(data) ? data : (data.pairs || []);
    const best = pairs
      .filter((p) => p.priceUsd && (p.baseToken?.symbol === 'MON' || p.baseToken?.symbol === 'WMON'))
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    const px = best ? Number(best.priceUsd) : null;
    if (px && px > 0) monPriceUsd = px;
  } catch { /* keep last good price */ }
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
const V3_TOPICS = [V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC, NADFUN_SWAP_TOPIC];

// For both Uniswap v3 and PancakeSwap v3, the Swap event data begins with
// int256 amount0, int256 amount1 — so we decode those two words generically.
const coder = AbiCoder.defaultAbiCoder();
function decodeAmounts(data) {
  const hex = data.replace(/^0x/, '');
  const amount0 = coder.decode(['int256'], '0x' + hex.slice(0, 64))[0];
  const amount1 = coder.decode(['int256'], '0x' + hex.slice(64, 128))[0];
  return { amount0, amount1 };
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

// Token liquidity + whether a WMON route exists (for copyability), via DexScreener.
async function getTokenMarket(tokenAddr) {
  const key = tokenAddr.toLowerCase();
  const cached = marketCache.get(key);
  if (cached && Date.now() - cached.at < MARKET_TTL) return cached;
  let liquidity = 0, hasWmonPair = false;
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
      if (b === WMON || q === WMON) hasWmonPair = true;
    }
  } catch { /* keep zeros → treated as low-liquidity */ }
  const rec = { liquidity, hasWmonPair, at: Date.now() };
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

async function getPoolInfo(poolAddr, isV3) {
  const key = poolAddr.toLowerCase();
  if (poolCache.has(key)) return poolCache.get(key);

  let info = null;
  try {
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

// Reconstruct an in-memory card from a persisted trades row.
function rowToCard(r) {
  return {
    id: r.id, txHash: r.id.split(':')[0], trader: r.trader, side: r.side, dex: r.dex,
    source: r.dex === 'NadFun' ? 'nadfun' : 'v3', // routing hint (derived from dex)
    poolAddress: r.pool, tokenAddress: r.token, tokenSymbol: r.tokenSymbol,
    tokenDecimals: r.tokenDecimals, isStable: !!r.isStable, feeTier: r.feeTier,
    amountMon: r.amountMon, amountUsd: r.amountUsd, tokenAmount: r.tokenAmount,
    quoteSymbol: r.quoteSymbol, copyable: !!r.copyable, liquidityUsd: r.liquidityUsd,
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

const DEX_BY_TOPIC = {
  [V3_SWAP_TOPIC]: 'UniswapV3',
  [PANCAKE_V3_SWAP_TOPIC]: 'PancakeV3',
  [NADFUN_SWAP_TOPIC]: 'NadFun',
};

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
    const dex = DEX_BY_TOPIC[log.topics[0]]; if (!dex) continue;
    const pool = await getPoolInfo(log.address, true); if (!pool) continue; // not a single-quote-anchored pool
    let amount0, amount1;
    try { ({ amount0, amount1 } = decodeAmounts(log.data)); } catch { continue; }
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
  const market = await getTokenMarket(best.addr);
  if (market.liquidity <= 0) return;                        // rugged / no live pair
  if (!isVIP && market.liquidity < MIN_LIQ_USD) return;

  const meta = f.pool.meta;
  const tokenAmount = Number(formatUnits(best.absNet, meta.decimals));
  const isNadfun = f.dex === 'NadFun';
  // nad.fun tokens route through nad.fun's own router (frontend), so they're
  // always copyable; v3 tokens need a MON route on Uniswap/Pancake.
  const copyable = isNadfun || f.pool.quote.kind === 'mon' || market.hasWmonPair;

  const card = {
    id: txHash + ':' + trader.slice(2, 10), // one card per (tx, trader) — no per-leg dupes
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
        logs = await provider.getLogs({ fromBlock: from, toBlock: to, topics: [V3_TOPICS] });
      } catch { continue; }
      await processLogs(logs);
    }
    lastBlock = current;
    console.log(`[Backfill] done · ${recentWhales.length} whales seeded`);
  } catch (err) {
    console.error('[Backfill] error:', err.shortMessage || err.message || err);
  }
}

async function poll() {
  try {
    const current = await provider.getBlockNumber();
    if (lastBlock === null) {
      lastBlock = current - 1;
      console.log(`[Indexer] live from block ${lastBlock} · whale ≥ ${WHALE_MIN_MON} MON`);
    }
    // Only skip ahead if we fall MASSIVELY behind (RPC stall) — otherwise we
    // process every block so sparse whale swaps are never missed.
    if (current - lastBlock > 1000) {
      lastBlock = current - 300;
    }

    if (current > lastBlock) {
      const from = lastBlock + 1;
      const to = Math.min(current, from + MAX_BLOCK_SPAN - 1);
      const logs = await provider.getLogs({
        fromBlock: from,
        toBlock: to,
        topics: [V3_TOPICS],
      });
      await processLogs(logs);
      lastBlock = to;
    }
  } catch (err) {
    console.error('[Indexer] poll error:', err.shortMessage || err.message || err);
  } finally {
    setTimeout(poll, POLL_MS);
  }
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
const sendJson = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(body));
};

server.on('request', async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/health') {
    return sendJson(res, 200, {
      ok: true, lastBlock, whales: recentWhales.length,
      traders: traderAgg.size, whaleMinUsd: WHALE_MIN_USD, minLiqUsd: MIN_LIQ_USD, monPriceUsd,
      registered: REGISTERED_WHALES.size, deckRosterOnly: DECK_ROSTER_ONLY,
      discovery: { engine: 'deep-scan + live-promote', scanEveryHours: DISCOVERY_HOURS, promoteEveryMinutes: PROMOTE_MINUTES, running: discoveryRunning, lastFinished: lastScanAt },
      ...db.stats(),
    });
  }
  if (path === '/whales') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 40), RECENT_CAP);
    const whales = recentWhales.slice(0, limit).map((c) => ({
      ...c, traderScore: scoreFromAgg(traderAgg.get(c.trader.toLowerCase())),
    }));
    return sendJson(res, 200, { whales });
  }
  if (path === '/leaderboard') {
    const board = [...traderAgg.values()]
      .map((a) => ({ ...a, winRate: a.closedTokens > 0 ? a.winTokens / a.closedTokens : null, verified: REGISTERED_WHALES.has(a.address) }))
      .sort((a, b) => b.volumeMon - a.volumeMon)
      .slice(0, 80);
    return sendJson(res, 200, { traders: board });
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
    const whales = [...byAddr.values()].sort((x, y) => (y.volumeUsd || 0) - (x.volumeUsd || 0));
    return sendJson(res, 200, { count: whales.length, whales });
  }
  const m = path.match(/^\/address\/(0x[0-9a-fA-F]{40})$/);
  if (m) {
    const a = m[1].toLowerCase();
    let balanceMon = null;
    try { balanceMon = Number(formatUnits(await provider.getBalance(a), 18)); } catch {}
    // Full history straight from disk (survives restarts, deeper than the live cap).
    const trades = db.tradesByAddress(a, 30).map(rowToCard);
    return sendJson(res, 200, {
      address: a,
      balanceMon,
      aggregate: traderAgg.get(a) || null,
      score: scoreFromAgg(traderAgg.get(a)),
      trades: trades.length ? trades : (addressTrades.get(a) || []),
    });
  }
  sendJson(res, 404, { error: 'not found' });
});
server.listen(PORT, () => console.log(`[HTTP/WS] listening on port ${PORT}`));

await refreshMonPrice();
console.log(`[price] MON = $${monPriceUsd} · whale floor $${WHALE_MIN_USD} (~${Math.round(WHALE_MIN_USD / monPriceUsd)} MON)`);
setInterval(refreshMonPrice, 60000);
initFromDb();
await backfill();
poll();

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
