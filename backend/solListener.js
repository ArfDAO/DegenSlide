/**
 * DegenSlide Whale Indexer — SOLANA MAINNET
 *
 * Same architecture as the Monad listener (listener.js), adapted to Solana:
 *  - Pool discovery: DexScreener top Solana pools anchored to SOL/USDC/USDT
 *    (exactly one quote side) with real liquidity ≥ MIN_LIQ_USD. No junk.
 *  - Live watch: getSignaturesForAddress per pool → getTransaction → parse the
 *    SIGNER's token-balance deltas (pre/post) + lamports. Quote leg gives the
 *    real USD size; the opposite leg is the traded token. Failed txs skipped.
 *  - Whale gate (USD), behavioural bot filtering + live promotion, avg-cost
 *    realized PnL, SQLite persistence — identical semantics to Monad.
 *
 * NO mock / fabricated data. Every card is a real parsed mainnet transaction.
 *
 * Env: SOLANA_RPC (default public mainnet-beta — rate-limited; use a dedicated
 * RPC in production), WS_PORT(8083), HTTP_PORT(8084), WHALE_MIN_USD(1000),
 * MIN_LIQ_USD(150000), MAX_POOLS(12), POLL_MS(8000), TX_BUDGET(24),
 * PROMOTE_MIN_USD(3000), PROMOTE_MINUTES(2), WHALE_DB(backend/solWhales.db)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { discoverQualityPools } from './solPools.js';

const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, 'solWhales.db');
const db = await import('./db.js');

const SOL_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const PORT = Number(process.env.PORT || 8084);
const server = await import('node:http').then(m => m.createServer());
const WHALE_MIN_USD = Number(process.env.WHALE_MIN_USD || 500);    // DISCOVERY floor: how big a swap must be to flag a NEW whale
const TRACK_MIN_USD = Number(process.env.TRACK_MIN_USD || 150);    // TRACKING floor: known whales' trades shown down to this size (any token)
const MIN_LIQ_USD = Number(process.env.MIN_LIQ_USD || 150000);
const MAX_POOLS = Number(process.env.MAX_POOLS || 24);
const MIN_MCAP_USD = Number(process.env.MIN_MCAP_USD || 20000000); // dynamic pools must clear this market cap
const POLL_MS = Number(process.env.POLL_MS || 8000);
const TX_BUDGET = Number(process.env.TX_BUDGET || 24);             // getTransaction calls per cycle (public RPC limits)
const RPC_DELAY_MS = Number(process.env.RPC_DELAY_MS || 80);
const PROMOTE_MIN_USD = Number(process.env.PROMOTE_MIN_USD || 3000);
const PROMOTE_MINUTES = Number(process.env.PROMOTE_MINUTES || 2);
// Solana v1 is a watch-only whale feed (no MON route to copy) — SELLs are real
// signal there (whale exits), so they're shown by default. Set INCLUDE_SELLS=0 to hide.
const INCLUDE_SELLS = process.env.INCLUDE_SELLS !== '0';
const BACKFILL_SIGS_PER_POOL = Number(process.env.BACKFILL_SIGS_PER_POOL || 15);

const WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE_TOKENS = new Map([
  [WSOL, { symbol: 'SOL', kind: 'sol' }],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: 'USDC', kind: 'usd' }],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { symbol: 'USDT', kind: 'usd' }],
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } };
async function rpc(method, params) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 15000); // a hung connection must not stall the whole indexer
  try {
    const res = await fetch(SOL_RPC, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ac.signal,
    });
    const j = await res.json();
    if (j.error) throw new Error(j.error.message);
    return j.result;
  } finally {
    clearTimeout(t);
  }
}

// ── live SOL price (DexScreener, refreshed) ──
let solPriceUsd = 0;
async function refreshSolPrice() {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${WSOL}`, UA);
    const pairs = (await res.json()) || [];
    const best = (Array.isArray(pairs) ? pairs : []).filter((p) => p.priceUsd && p.baseToken?.address === WSOL)
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    const px = best ? Number(best.priceUsd) : null;
    if (px > 0) solPriceUsd = px;
  } catch { /* keep last */ }
}

// ── pool discovery: the QUALITY universe (well-known blue chips + high-liq/
// high-mcap tokens), resolved live via solPools.js. Used only to DISCOVER new
// whales; the deck itself follows whale wallets across ALL tokens. ──
const pools = new Map(); // pairAddress -> {pool,dex,tokenMint,tokenSymbol,quoteMint,quote,liq,mcap,lastSig}
async function refreshPools() {
  let top = [];
  try { top = await discoverQualityPools({ minLiq: MIN_LIQ_USD, minMcap: MIN_MCAP_USD, maxPools: MAX_POOLS }); }
  catch { return; } // keep previous set on API hiccup
  if (!top.length) return;
  const next = new Map();
  for (const p of top) next.set(p.pool, {
    ...p, quote: QUOTE_TOKENS.get(p.quoteMint), lastSig: pools.get(p.pool)?.lastSig || null,
  });
  pools.clear();
  for (const [k, v] of next) pools.set(k, v);
  console.log(`[pools] watching ${pools.size} quality pools: ${top.slice(0, 8).map((p) => `${p.tokenSymbol}`).join(' ')}…`);
}

// ── state (same shapes as Monad listener) ──
const recentWhales = [];
const RECENT_CAP = 80;
const traderAgg = new Map();
const addressTrades = new Map();
const traderPos = new Map();
const REGISTERED_WHALES = new Set(); // grows via live promotion (verified roster)
const LIVE_PROMOTED = new Set();      // fast-pass promotions, kept across roster reloads
const CURATED_PATH = path.join(__d, '..', 'src', 'data', 'curatedSolWhales.json');

// The discovery scan (solScanWhales.js) writes a bot-filtered curated file; load
// it into the verified roster and hot-reload when the scan rewrites it. Live
// promotions survive reloads. base58 addresses — NO lowercasing.
function loadRoster() {
  const kept = new Set(LIVE_PROMOTED);
  REGISTERED_WHALES.clear();
  for (const p of kept) REGISTERED_WHALES.add(p);
  let curatedCount = 0;
  try {
    const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
    for (const w of curated.whales || []) if (w.address) { REGISTERED_WHALES.add(w.address); curatedCount += 1; }
  } catch { /* file absent until first scan completes */ }
  console.log(`[whales] roster = ${REGISTERED_WHALES.size} wallets (${curatedCount} scanned + ${LIVE_PROMOTED.size} live)`);
}
loadRoster();
let rosterReloadTimer = null;
try { fs.watch(CURATED_PATH, () => { clearTimeout(rosterReloadTimer); rosterReloadTimer = setTimeout(loadRoster, 1500); }); } catch { /* file may not exist yet */ }

// ── Periodic auto-discovery: deep historical scan in a child process (never
// blocks the live poller), then hot-reload the fresh roster. Mirrors Monad. ──
const DISCOVERY_HOURS = Number(process.env.SOL_DISCOVERY_HOURS || 6);
let discoveryRunning = false;
function runDiscovery(reason) {
  if (discoveryRunning) { console.log('[discovery] skip — a scan is already running'); return; }
  discoveryRunning = true;
  console.log(`[discovery] launching Solana whale scan (${reason})…`);
  const child = spawn(process.execPath, [path.join(__d, 'solScanWhales.js')], { cwd: __d, env: process.env, stdio: 'inherit' });
  child.on('exit', (code) => { discoveryRunning = false; console.log(`[discovery] scan finished (exit ${code}) — reloading roster`); loadRoster(); });
  child.on('error', (e) => { discoveryRunning = false; console.warn('[discovery] spawn failed:', e.message); });
}
function rosterAgeHours() {
  try { return (Date.now() - fs.statSync(CURATED_PATH).mtimeMs) / 3600000; } catch { return Infinity; }
}

function scoreFromAgg(agg) {
  if (!agg) return null;
  const closed = agg.closedTokens || 0;
  return {
    realizedMon: agg.realizedMon || 0,
    winRate: closed > 0 ? agg.winTokens / closed : null,
    closedTokens: closed, activeTokens: agg.activeTokens || 0, trades: agg.trades || 0,
  };
}

// Deck = registered whales only (real Smart Money), across ANY token. Pool
// discovery still records unknown traders for promotion, but they don't reach
// the deck until they're promoted. Set DECK_ROSTER_ONLY=0 to show every trade.
const DECK_ROSTER_ONLY = process.env.DECK_ROSTER_ONLY !== '0';
function isDeckEligible(card) {
  if (DECK_ROSTER_ONLY && !card.isRegisteredWhale) return false;
  return card.side === 'BUY' || INCLUDE_SELLS;
}

function recordWhale(card) {
  if (!db.persistTrade(card)) return false;
  if (isDeckEligible(card)) {
    recentWhales.unshift(card);
    if (recentWhales.length > RECENT_CAP) recentWhales.pop();
  }
  const a = card.trader; // base58, case-sensitive — no lowercasing
  const agg = traderAgg.get(a) || {
    address: a, trades: 0, buys: 0, sells: 0,
    volumeMon: 0, volumeUsd: 0, netMon: 0, lastSeen: 0, lastToken: null, arbHits: 0,
  };
  agg.trades += 1;
  if (card.side === 'BUY') { agg.buys += 1; agg.netMon -= card.amountMon; }
  else { agg.sells += 1; agg.netMon += card.amountMon; }
  agg.volumeMon += card.amountMon;
  agg.volumeUsd = (agg.volumeUsd || 0) + card.amountUsd;
  agg.lastSeen = card.ts;
  agg.lastToken = card.tokenSymbol;
  // same-slot round-trip = atomic arb bot
  if (agg._lastBlock === card.blockNumber && agg._lastTok === card.tokenAddress && agg._lastSide && agg._lastSide !== card.side) {
    agg.arbHits += 1;
  }
  agg._lastBlock = card.blockNumber; agg._lastTok = card.tokenAddress; agg._lastSide = card.side;

  // realized PnL (avg cost, native units)
  const posMap = traderPos.get(a) || new Map();
  const pos = posMap.get(card.tokenAddress) || { boughtTok: 0, spentMon: 0, soldTok: 0, recvMon: 0, realizedMon: 0 };
  if (card.side === 'BUY') { pos.boughtTok += card.tokenAmount || 0; pos.spentMon += card.amountMon || 0; }
  else {
    const avg = pos.boughtTok > 0 ? pos.spentMon / pos.boughtTok : 0;
    if (avg > 0) pos.realizedMon += (card.amountMon || 0) - avg * (card.tokenAmount || 0);
    pos.soldTok += card.tokenAmount || 0; pos.recvMon += card.amountMon || 0;
  }
  posMap.set(card.tokenAddress, pos);
  traderPos.set(a, posMap);
  let realizedMon = 0, closedTokens = 0, winTokens = 0;
  for (const p of posMap.values()) if (p.soldTok > 0 && p.boughtTok > 0) { closedTokens += 1; realizedMon += p.realizedMon; if (p.realizedMon > 0) winTokens += 1; }
  agg.realizedMon = realizedMon; agg.closedTokens = closedTokens; agg.winTokens = winTokens; agg.activeTokens = posMap.size;
  traderAgg.set(a, agg);

  const list = addressTrades.get(a) || [];
  list.unshift(card);
  if (list.length > 30) list.pop();
  addressTrades.set(a, list);
  db.persistTrader(agg);
  db.persistPosition(a, card.tokenAddress, pos);
  return true;
}

// ── live promotion: a candidate discovered trading QUALITY tokens is promoted
// only if it's a REAL whale — big SOL balance OR big volume — and passes the
// behavioural bot filters (every Solana fee payer is a keypair, so no
// contract check applies). ──
const MIN_SOL_BALANCE = Number(process.env.MIN_SOL_BALANCE || 40);
const BIG_VOLUME_USD = Number(process.env.BIG_VOLUME_USD || 25000);
const balCache = new Map(); // addr -> { sol, at }
async function solBalance(addr) {
  const c = balCache.get(addr);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return c.sol;
  let sol = 0;
  try { sol = (await rpc('getBalance', [addr]))?.value / 1e9 || 0; } catch { return 0; }
  balCache.set(addr, { sol, at: Date.now() });
  return sol;
}
async function promoteWhales() {
  for (const a of [...traderAgg.values()]) {
    if (REGISTERED_WHALES.has(a.address)) continue;
    if ((a.volumeUsd || 0) < PROMOTE_MIN_USD) continue;
    const dir = a.trades ? Math.abs(a.buys - a.sells) / a.trades : 1;
    if (a.trades >= 10 && dir < 0.25) continue;  // balanced churn = MM bot
    if ((a.arbHits || 0) > 0) continue;          // atomic arb bot
    const bal = await solBalance(a.address);      // real-whale confirmation
    if (bal < MIN_SOL_BALANCE && (a.volumeUsd || 0) < BIG_VOLUME_USD) continue;
    REGISTERED_WHALES.add(a.address);
    LIVE_PROMOTED.add(a.address);
    console.log(`[promote] +whale ${a.address.slice(0, 10)}… · $${Math.round(a.volumeUsd)} · ${bal.toFixed(1)} SOL · dir ${dir.toFixed(2)} · ${a.trades}tx`);
  }
}

// ── tx parsing: owner-scoped balance deltas (pool-INDEPENDENT).
// Give it the wallet we care about (a tracked whale) and it detects that
// wallet's swap in ANY token; omit owner and it falls back to the fee payer
// (used by pool-based discovery to catch brand-new whales).
// minUsd is the per-swap USD floor. DISCOVERY uses the big WHALE_MIN_USD (to
// identify whales); once a wallet is a verified whale, TRACKING uses the small
// TRACK_MIN_USD so we surface WHATEVER token that whale trades next — big or
// small — instead of only their headline pool.
function computeSwap(tx, owner, minUsd = WHALE_MIN_USD) {
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction?.message?.accountKeys || [];
  if (!owner) owner = keys.find((k) => k.signer)?.pubkey;
  if (!owner) return null;
  const delta = new Map();
  for (const b of tx.meta.postTokenBalances || []) if (b.owner === owner) delta.set(b.mint, (delta.get(b.mint) || 0) + (Number(b.uiTokenAmount?.uiAmount) || 0));
  for (const b of tx.meta.preTokenBalances || []) if (b.owner === owner) delta.set(b.mint, (delta.get(b.mint) || 0) - (Number(b.uiTokenAmount?.uiAmount) || 0));
  const si = keys.findIndex((k) => k.pubkey === owner);
  if (si >= 0 && tx.meta.postBalances && tx.meta.preBalances) {
    const lam = (tx.meta.postBalances[si] - tx.meta.preBalances[si]) / 1e9;
    delta.set(WSOL, (delta.get(WSOL) || 0) + lam); // native SOL folded into the wSOL bucket
  }
  // strongest quote leg → real USD size + direction
  let quoteMint = null, quoteDelta = 0, quoteUsd = 0;
  for (const [mint, q] of QUOTE_TOKENS) {
    const dv = delta.get(mint) || 0;
    const usd = Math.abs(dv) * (q.kind === 'usd' ? 1 : solPriceUsd);
    if (usd > quoteUsd) { quoteUsd = usd; quoteDelta = dv; quoteMint = mint; }
  }
  if (!quoteMint || quoteUsd < minUsd) return null;
  // strongest opposite-signed leg = the token the whale actually traded (any token)
  let tokMint = null, tokDelta = 0;
  for (const [mint, dv] of delta) {
    if (QUOTE_TOKENS.has(mint)) continue;
    if (Math.sign(dv) === Math.sign(quoteDelta) || dv === 0) continue;
    if (Math.abs(dv) > Math.abs(tokDelta)) { tokDelta = dv; tokMint = mint; }
  }
  if (!tokMint) return null;
  const decimals = (tx.meta.postTokenBalances || []).find((b) => b.mint === tokMint)?.uiTokenAmount?.decimals ?? null;
  return {
    owner, side: quoteDelta < 0 ? 'BUY' : 'SELL', quoteMint, amountUsd: quoteUsd,
    tokenMint: tokMint, tokenAmount: Math.abs(tokDelta), decimals, slot: tx.slot,
  };
}

// ── token metadata resolver (DexScreener, cached): symbol / liquidity / dex /
// stable flag for ANY mint. This is what frees the deck from a fixed pool list. ──
const tokenMeta = new Map(); // mint -> { symbol, liq, dex, isStable, at }
const STABLE = /^(USDC|USDT|USDS|USDe|DAI|PYUSD|USDY|sUSD|FDUSD)$/i;
async function resolveToken(mint) {
  const cached = tokenMeta.get(mint);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached;
  let meta = { symbol: mint.slice(0, 4), liq: 0, dex: 'solana-dex', isStable: false, at: Date.now() };
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/solana/${mint}`, UA);
    const arr = await res.json();
    const pairs = (Array.isArray(arr) ? arr : []).filter((p) => p.chainId === 'solana' && p.baseToken?.address === mint);
    const best = pairs.sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    if (best) meta = {
      symbol: best.baseToken?.symbol || meta.symbol, liq: Number(best.liquidity?.usd) || 0,
      dex: best.dexId || meta.dex, isStable: STABLE.test(best.baseToken?.symbol || ''), at: Date.now(),
    };
  } catch { /* keep fallback */ }
  tokenMeta.set(mint, meta);
  return meta;
}

async function buildCard(sig, s) {
  const meta = await resolveToken(s.tokenMint);
  return {
    id: sig, txHash: sig, trader: s.owner, side: s.side, dex: meta.dex,
    poolAddress: null, tokenAddress: s.tokenMint, tokenSymbol: meta.symbol,
    tokenDecimals: s.decimals, quoteSymbol: QUOTE_TOKENS.get(s.quoteMint)?.symbol,
    isStable: meta.isStable, feeTier: null,
    amountMon: solPriceUsd > 0 ? s.amountUsd / solPriceUsd : 0, // native (SOL) equivalent
    amountUsd: s.amountUsd, tokenAmount: s.tokenAmount,
    liquidityUsd: meta.liq, copyable: true, // in-app copy: Phantom signs a live Jupiter swap
    isRegisteredWhale: REGISTERED_WHALES.has(s.owner),
    blockNumber: s.slot, ts: Date.now(),
  };
}

// ── WS ──
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on('connection', (ws) => { clients.add(ws); ws.on('close', () => clients.delete(ws)); });
console.log(`[WS]   Attached to HTTP server`);
function broadcast(card) {
  const msg = JSON.stringify({ type: 'NEW_TRADE', data: card });
  for (const c of clients) if (c.readyState === 1) c.send(msg);
}

let lastSlot = null;

// Fetch + parse one signature scoped to an owner (a tracked whale, or the fee
// payer for pool discovery), surfacing whatever token they traded.
async function processSig(sig, owner, minUsd = WHALE_MIN_USD) {
  let tx = null;
  try { tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); }
  catch { return; }
  const s = computeSwap(tx, owner, minUsd);
  if (!s) return;
  const card = await buildCard(sig, s);
  const isNew = recordWhale(card);
  if (isNew && isDeckEligible(card)) {
    broadcast(card);
    console.log(`[WHALE] ${card.side} $${Math.round(card.amountUsd).toString().padStart(6)}  ${(card.tokenSymbol || '?').padEnd(10)}/${(card.quoteSymbol || '').padEnd(4)} ${card.trader.slice(0, 8)}…  (${card.dex})`);
  }
}

// ── PRIMARY feed: follow the registered whales' WALLETS across ALL tokens.
// Rotate through the roster in budgeted batches (public RPC honesty). Whatever
// token a whale buys or sells surfaces — no fixed pool list. ──
const WHALE_POLL_MS = Number(process.env.WHALE_POLL_MS || 7000);
const WHALE_BATCH = Number(process.env.WHALE_BATCH || 6); // whales checked per cycle
const walletCursor = new Map(); // whaleAddr -> newest signature already seen
let whaleRing = 0;
async function whalePoll() {
  try {
    const roster = [...REGISTERED_WHALES];
    for (let i = 0; i < WHALE_BATCH && roster.length; i++) {
      const addr = roster[whaleRing % roster.length];
      whaleRing++;
      const cur = walletCursor.get(addr);
      let sigs = [];
      try { sigs = await rpc('getSignaturesForAddress', [addr, cur ? { limit: 20, until: cur } : { limit: 4 }]); }
      catch { continue; }
      await sleep(RPC_DELAY_MS);
      if (sigs.length) walletCursor.set(addr, sigs[0].signature);
      for (const sg of sigs) {
        if (sg.err) continue;
        await processSig(sg.signature, addr, TRACK_MIN_USD); // known whale → show any-size trade in any token
        await sleep(RPC_DELAY_MS);
      }
    }
  } catch (e) {
    console.error('[whalePoll] error:', e.message || e);
  } finally {
    setTimeout(whalePoll, WHALE_POLL_MS);
  }
}

// ── SECONDARY: pool sampling to DISCOVER brand-new whales (fee-payer parse →
// promotion). Lighter than before; the deck itself comes from whalePoll. ──
async function discoveryPoll() {
  try {
    // per-pool queues → round-robin so the busiest token can't hog the budget
    const perPool = [];
    for (const p of pools.values()) {
      let sigs = [];
      try { sigs = await rpc('getSignaturesForAddress', [p.pool, p.lastSig ? { limit: 25, until: p.lastSig } : { limit: 4 }]); }
      catch { continue; }
      await sleep(RPC_DELAY_MS);
      if (sigs.length) p.lastSig = sigs[0].signature;
      perPool.push(sigs.filter((s) => !s.err).map((s) => s.signature));
    }
    const jobs = [];
    for (let i = 0, done = false; !done; i++) {
      done = true;
      for (const q of perPool) if (i < q.length) { jobs.push(q[i]); done = false; }
    }
    for (const sig of jobs.slice(0, TX_BUDGET)) {
      await processSig(sig, null); // null owner → fee-payer parse (catches unknown whales)
      await sleep(RPC_DELAY_MS);
    }
    try { lastSlot = await rpc('getSlot', []); } catch { /* keep */ }
  } catch (e) {
    console.error('[discoveryPoll] error:', e.message || e);
  } finally {
    setTimeout(discoveryPoll, POLL_MS);
  }
}

// ── boot backfill: seed the deck from the registered whales' recent trades
// (their real swaps in whatever token), plus a pool pass to find fresh whales. ──
async function backfill() {
  const roster = [...REGISTERED_WHALES].slice(0, 30);
  console.log(`[backfill] seeding from ${roster.length} whale wallets + ${pools.size} pools…`);
  for (const addr of roster) {
    let sigs = [];
    try { sigs = await rpc('getSignaturesForAddress', [addr, { limit: 6 }]); } catch { continue; }
    if (sigs.length) walletCursor.set(addr, sigs[0].signature);
    for (const s of sigs.filter((x) => !x.err).slice(0, 4)) { await processSig(s.signature, addr, TRACK_MIN_USD); await sleep(RPC_DELAY_MS); }
  }
  for (const p of pools.values()) {
    let sigs = [];
    try { sigs = await rpc('getSignaturesForAddress', [p.pool, { limit: 20 }]); } catch { continue; }
    p.lastSig = sigs[0]?.signature || null;
    for (const s of sigs.filter((x) => !x.err).slice(0, BACKFILL_SIGS_PER_POOL)) { await processSig(s.signature, null, WHALE_MIN_USD); await sleep(RPC_DELAY_MS); }
  }
  console.log(`[backfill] done · ${recentWhales.length} whale trades seeded`);
}

function initFromDb() {
  for (const [addr, r] of db.loadTraders()) {
    traderAgg.set(addr, { address: r.address, trades: r.trades, buys: r.buys, sells: r.sells,
      volumeMon: r.volumeMon, volumeUsd: r.volumeMon * solPriceUsd, netMon: r.netMon, realizedMon: r.realizedMon,
      closedTokens: r.closedTokens, winTokens: r.winTokens, activeTokens: r.activeTokens,
      lastSeen: r.lastSeen, lastToken: r.lastToken, arbHits: 0 });
  }
  for (const [addr, m] of db.loadPositions()) traderPos.set(addr, m);
  for (const row of db.loadRecentTrades(RECENT_CAP * 4)) {
    if (row.side !== 'BUY' && !INCLUDE_SELLS) continue;
    if ((row.amountUsd || 0) < TRACK_MIN_USD) continue; // tracked whales' trades shown down to the tracking floor
    if (DECK_ROSTER_ONLY && !REGISTERED_WHALES.has(row.trader)) continue; // roster-only deck
    if (recentWhales.length >= RECENT_CAP) break;
    recentWhales.push({
      id: row.id, txHash: row.id, trader: row.trader, side: row.side, dex: row.dex,
      poolAddress: row.pool, tokenAddress: row.token, tokenSymbol: row.tokenSymbol,
      tokenDecimals: row.tokenDecimals, quoteSymbol: row.quoteSymbol, isStable: false, feeTier: null,
      amountMon: row.amountMon, amountUsd: row.amountUsd, tokenAmount: row.tokenAmount,
      liquidityUsd: row.liquidityUsd, copyable: true,
      isRegisteredWhale: REGISTERED_WHALES.has(row.trader), blockNumber: row.block, ts: row.ts,
    });
  }
  console.log(`[db] restored ${traderAgg.size} traders · ${recentWhales.length} deck cards · ${db.stats().dbTrades} trades on disk`);
}

// ── HTTP API (same shape as the Monad listener) ──
const sendJson = (res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(body));
};
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

server.on('request', async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  if (p === '/health') {
    return sendJson(res, 200, {
      ok: true, chain: 'solana', lastBlock: lastSlot, whales: recentWhales.length,
      traders: traderAgg.size, whaleMinUsd: WHALE_MIN_USD, minLiqUsd: MIN_LIQ_USD,
      monPriceUsd: solPriceUsd, pools: pools.size, registered: REGISTERED_WHALES.size, ...db.stats(),
    });
  }
  if (p === '/whales') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 40), RECENT_CAP);
    const whales = recentWhales.slice(0, limit).map((c) => ({ ...c, traderScore: scoreFromAgg(traderAgg.get(c.trader)) }));
    return sendJson(res, 200, { whales });
  }
  if (p === '/leaderboard') {
    const board = [...traderAgg.values()]
      .map((a) => ({ ...a, winRate: a.closedTokens > 0 ? a.winTokens / a.closedTokens : null, verified: REGISTERED_WHALES.has(a.address) }))
      .sort((a, b) => b.volumeMon - a.volumeMon).slice(0, 80);
    return sendJson(res, 200, { traders: board });
  }
  if (p === '/roster') {
    // Verified Smart Money — the scanned curated file MERGED with this session's
    // live-promoted whales, so the list grows over time (same model as Monad).
    // Rich scan stats win; live promotions fill in from the running aggregate.
    const byAddr = new Map();
    try {
      const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
      for (const w of curated.whales || []) if (w.address) byAddr.set(w.address, w);
    } catch { /* file absent until first scan completes */ }
    for (const addr of REGISTERED_WHALES) {
      if (byAddr.has(addr)) continue;
      const a = traderAgg.get(addr);
      if (!a) continue;
      byAddr.set(addr, {
        address: a.address, volumeUsd: Math.round((a.volumeUsd || 0) * 100) / 100,
        volumeMon: Math.round(a.volumeMon * 100) / 100, trades: a.trades, buys: a.buys, sells: a.sells,
        tokens: a.lastToken ? [a.lastToken] : [], lastToken: a.lastToken,
        realizedMon: Math.round((a.realizedMon || 0) * 100) / 100, closedTokens: a.closedTokens || 0,
        winTokens: a.winTokens || 0, winRate: a.closedTokens > 0 ? Math.round((a.winTokens / a.closedTokens) * 100) / 100 : null,
        lpAddedUsd: 0, isMarketMaker: false, livePromoted: true,
      });
    }
    const whales = [...byAddr.values()].sort((x, y) => (y.volumeUsd || 0) - (x.volumeUsd || 0));
    return sendJson(res, 200, { count: whales.length, whales });
  }
  const m = p.match(/^\/address\/(.+)$/);
  if (m && B58.test(m[1])) {
    const a = m[1];
    let balanceMon = null;
    try { balanceMon = (await rpc('getBalance', [a])).value / 1e9; } catch {}
    const trades = db.tradesByAddress(a, 30);
    return sendJson(res, 200, {
      address: a, balanceMon, aggregate: traderAgg.get(a) || null,
      score: scoreFromAgg(traderAgg.get(a)), trades: trades.length ? trades : (addressTrades.get(a) || []),
    });
  }
  sendJson(res, 404, { error: 'not found' });
});
server.listen(PORT, () => console.log(`[HTTP/WS] listening on port ${PORT}`));

// ── boot ──
await refreshSolPrice();
console.log(`[price] SOL = $${solPriceUsd} · whale floor $${WHALE_MIN_USD}/swap · pool liq ≥ $${MIN_LIQ_USD}`);
setInterval(refreshSolPrice, 60000);
await refreshPools();
setInterval(refreshPools, 10 * 60 * 1000); // pool set follows the market
initFromDb();
await backfill();
promoteWhales();
setInterval(promoteWhales, PROMOTE_MINUTES * 60 * 1000);
whalePoll();      // primary: follow whale wallets across ALL tokens
discoveryPoll();  // secondary: sample pools to discover new whales

// Deep discovery: run now if the curated file is missing/stale, then on a schedule.
const age = rosterAgeHours();
if (age > DISCOVERY_HOURS) { console.log(`[discovery] roster age ${age === Infinity ? 'none' : age.toFixed(1) + 'h'} > ${DISCOVERY_HOURS}h — scanning now`); runDiscovery('boot'); }
else console.log(`[discovery] roster age ${age.toFixed(1)}h — next scan in ≤${DISCOVERY_HOURS}h`);
setInterval(() => runDiscovery('scheduled'), DISCOVERY_HOURS * 3600 * 1000);
