/**
 * DegenSlide Whale Indexer — SOLANA MAINNET
 *
 * REGISTRY-ONLY model (no blanket transaction scanning):
 *  1. Discovery: gmgnSync.js finds proven Smart Money wallets via the GMGN
 *     OpenAPI and registers them PERMANENTLY into the durable whale_registry.
 *  2. Tracking: this indexer follows ONLY the registered whale wallets —
 *     getSignaturesForAddress per wallet → getTransaction → parse that
 *     wallet's token-balance deltas (pre/post) + lamports. Quote leg gives
 *     the real USD size; the opposite leg is the traded token, whatever it is.
 *  3. Deck/WS/API surface the registered whales' buys and sells, avg-cost
 *     realized PnL, SQLite persistence.
 *
 * NO mock / fabricated data. Every card is a real parsed mainnet transaction.
 *
 * Env: SOLANA_RPC (default public mainnet-beta — rate-limited; use a dedicated
 * RPC in production), PORT(8084), TRACK_MIN_USD(150), WHALE_POLL_MS(7000),
 * WHALE_BATCH(8), GMGN_SYNC_MINUTES(45), WHALE_DB(backend/solWhales.db)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { heliusEnabled, syncWebhook, webhookPath, validateAuth, heliusStatus } from './heliusWebhook.js';
import { qualityScore, daysSince } from './quality.js';

const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, 'solWhales.db');
const db = await import('./db.js');

// A single un-awaited RPC failure (e.g. an aborted fetch) must NOT kill the
// whole indexer — log it and keep polling. The poll loops handle their own
// errors; this is the last-resort net for anything that slips through.
process.on('unhandledRejection', (e) => console.warn('[guard] unhandled rejection:', e?.message || e));
process.on('uncaughtException', (e) => console.warn('[guard] uncaught exception:', e?.message || e));

const SOL_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const PORT = Number(process.env.PORT || 8084);
const server = await import('node:http').then(m => m.createServer());
const TRACK_MIN_USD = Number(process.env.TRACK_MIN_USD || 150);    // TRACKING floor: registered whales' trades shown down to this size (any token)
const RPC_DELAY_MS = Number(process.env.RPC_DELAY_MS || 80);
// GMGN discovery scheduling state (declared early — /health reads it)
const GMGN_SYNC_MINUTES = Number(process.env.GMGN_SYNC_MINUTES || 30);
const GMGN_KILL_MIN = Number(process.env.GMGN_KILL_MIN || 20); // watchdog: a hung sync must never block future syncs
let gmgnRunning = false;
let lastGmgnSyncAt = null;
// SELLs are real signal (whale exits), so they're shown by default.
// Set INCLUDE_SELLS=0 to hide.
const INCLUDE_SELLS = process.env.INCLUDE_SELLS !== '0';

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

// ── state (same shapes as Monad listener) ──
const recentWhales = [];
const RECENT_CAP = 80;
const traderAgg = new Map();
const addressTrades = new Map();
const traderPos = new Map();
const REGISTERED_WHALES = new Set(); // the verified roster — grows via GMGN discovery only
const CURATED_PATH = path.join(__d, '..', 'src', 'data', 'curatedSolWhales.json');

// The curated file ships with the repo (exported from a grown registry via
// exportSolRegistry.js) and is upserted into the DURABLE whale_registry
// (SQLite) at boot — so a fresh container starts with the full roster even on
// an ephemeral disk. The live roster is the FULL registry: everything ever
// found keeps being tracked forever. base58 addresses — NO lowercasing.
function loadRoster() {
  REGISTERED_WHALES.clear();
  let curatedCount = 0, bannedSkipped = 0;
  try {
    const curated = JSON.parse(fs.readFileSync(CURATED_PATH, 'utf8'));
    for (const w of curated.whales || []) if (w.address) {
      if (db.isBlacklisted(w.address)) { bannedSkipped += 1; continue; } // proven program/PDA — never re-import
      db.registerWhale(w.address, w.source || 'curated', { volumeUsd: w.volumeUsd ?? null, solBalance: w.solBalance ?? null, stats: w });
      curatedCount += 1;
    }
  } catch { /* file absent until first scan completes */ }
  let registryCount = 0;
  for (const r of db.loadWhaleRegistry()) {
    if (db.isBlacklisted(r.address)) continue;
    REGISTERED_WHALES.add(r.address); registryCount += 1;
  }
  console.log(`[whales] roster = ${REGISTERED_WHALES.size} wallets (registry ${registryCount} · curated file ${curatedCount} · banned skipped ${bannedSkipped})`);
  scheduleWebhookSync('roster-reload'); // keep the Helius address list in sync as the roster grows (no-op pre-boot)
}
loadRoster();

// ── Roster hygiene: prove every tracked wallet is a real System-owned wallet ──
// GMGN discovery can occasionally surface program / PDA / vault addresses (and
// the curated file may carry pre-filter contamination). This pass re-checks each
// wallet's account: executable, or owned by anything other than the System
// Program → not a real whale → banned (removed + vetoed from re-import).
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const VALIDATE_BATCH = Number(process.env.VALIDATE_BATCH || 25);
const validateQueue = [];
let validateCursor = 0;
async function validateRosterBatch() {
  if (!validateQueue.length) validateQueue.push(...REGISTERED_WHALES);
  let banned = 0, checked = 0;
  for (let i = 0; i < VALIDATE_BATCH && validateQueue.length; i++) {
    const addr = validateQueue[validateCursor % validateQueue.length];
    validateCursor += 1;
    checked += 1;
    let info;
    try { info = (await rpc('getAccountInfo', [addr, { encoding: 'base64' }]))?.value; }
    catch { continue; } // RPC hiccup → re-check next round, never ban on uncertainty
    if (info === undefined) continue;                 // request failed cleanly → skip
    if (info === null) continue;                       // 0-lamport account → getBalance/quality gate covers it
    if (!info.executable && info.owner === SYSTEM_PROGRAM) continue; // real wallet ✓
    db.blacklistWhale(addr, info.executable ? 'program' : 'pda');
    REGISTERED_WHALES.delete(addr);
    banned += 1;
    console.log(`[validate] banned ${addr.slice(0, 10)}… — ${info.executable ? 'executable program' : 'owned by ' + info.owner.slice(0, 8)} (not a whale)`);
    await sleep(RPC_DELAY_MS);
  }
  if (checked) console.log(`[validate] checked ${checked} roster wallets · ${banned} banned · roster now ${REGISTERED_WHALES.size}`);
}
let rosterReloadTimer = null;
try { fs.watch(CURATED_PATH, () => { clearTimeout(rosterReloadTimer); rosterReloadTimer = setTimeout(loadRoster, 1500); }); } catch { /* file may not exist yet */ }

function scoreFromAgg(agg) {
  if (!agg) return null;
  const closed = agg.closedTokens || 0;
  return {
    realizedMon: agg.realizedMon || 0,
    winRate: closed > 0 ? agg.winTokens / closed : null,
    closedTokens: closed, activeTokens: agg.activeTokens || 0, trades: agg.trades || 0,
  };
}

// Collapse a whale's repeat buys of the same token into one deck card: amounts
// summed, each buy kept as a `leg` for the detail view. See listener.js for the
// full rationale. `cards` is newest-first; the first per group carries freshest
// metadata (symbol/liquidity/price).
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
  return [...groups.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

// Deck = registered whales only (real Smart Money), across ANY token.
// Set DECK_ROSTER_ONLY=0 to show every persisted trade (debug only).
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

// ── tx parsing: owner-scoped balance deltas (pool-INDEPENDENT).
// Give it the tracked whale's wallet and it detects that wallet's swap in ANY
// token. minUsd is the per-swap USD floor (TRACK_MIN_USD) so we surface
// WHATEVER token that whale trades next — big or small.
function computeSwap(tx, owner, minUsd = TRACK_MIN_USD) {
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction?.message?.accountKeys || [];
  if (!owner) return null;
  const delta = new Map();
  for (const b of tx.meta.postTokenBalances || []) if (b.owner === owner) delta.set(b.mint, (delta.get(b.mint) || 0) + (Number(b.uiTokenAmount?.uiAmount) || 0));
  for (const b of tx.meta.preTokenBalances || []) if (b.owner === owner) delta.set(b.mint, (delta.get(b.mint) || 0) - (Number(b.uiTokenAmount?.uiAmount) || 0));
  // accountKeys are objects ({pubkey}) under jsonParsed, or plain strings under
  // the raw-webhook/base64 encoding — support both so the same parser serves the
  // RPC poller AND the Helius webhook payloads.
  const keyStr = (k) => (typeof k === 'string' ? k : k?.pubkey);
  const si = keys.findIndex((k) => keyStr(k) === owner);
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
    groupId: s.owner + ':' + s.tokenMint + ':' + s.side, // repeat buys collapse into one deck card
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

// Fetch + parse one signature scoped to a tracked whale's wallet, surfacing
// whatever token they traded.
async function processSig(sig, owner, minUsd = TRACK_MIN_USD) {
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

// ── REAL-TIME feed: Helius raw-transaction webhook ───────────────────────
// Helius POSTs every confirmed transaction touching a tracked whale straight to
// us (no polling latency). Each pushed tx is the standard getTransaction shape,
// so it flows through the SAME computeSwap → buildCard → recordWhale path as the
// poller. persistTrade() dedupes by signature, so a tx the poller ALSO catches
// is never double-counted. This is the primary feed when configured; the poller
// downgrades to a slow reconciliation safety-net.
function ownersInTx(tx) {
  const set = new Set();
  for (const b of tx?.meta?.postTokenBalances || []) if (b.owner) set.add(b.owner);
  for (const b of tx?.meta?.preTokenBalances || []) if (b.owner) set.add(b.owner);
  const keys = tx?.transaction?.message?.accountKeys || [];
  const k0 = keys[0]; // fee payer / primary signer = the trading wallet
  if (k0) set.add(typeof k0 === 'string' ? k0 : k0?.pubkey);
  return [...set];
}
let webhookHits = 0;
async function handleHeliusPayload(txs) {
  if (!Array.isArray(txs)) return;
  for (const tx of txs) {
    if (tx?.meta?.err) continue;
    const sig = tx?.transaction?.signatures?.[0] || tx?.signature;
    if (!sig) continue;
    for (const owner of ownersInTx(tx)) {
      if (!REGISTERED_WHALES.has(owner)) continue; // only tracked whales become cards
      const s = computeSwap(tx, owner, TRACK_MIN_USD);
      if (!s) continue;
      const card = await buildCard(sig, s);
      const isNew = recordWhale(card);
      if (isNew && isDeckEligible(card)) {
        webhookHits += 1;
        broadcast(card);
        console.log(`[HELIUS] ${card.side} $${Math.round(card.amountUsd).toString().padStart(6)}  ${(card.tokenSymbol || '?').padEnd(10)}/${(card.quoteSymbol || '').padEnd(4)} ${owner.slice(0, 8)}…  (${card.dex})`);
      }
    }
  }
}

// Register / refresh the Helius webhook so its address list == the live roster.
// Debounced, and gated on the server being reachable (Helius pings the URL on
// create) — so it only fires after we're listening and past boot.
let serverReady = false;
let webhookSyncTimer = null;
function scheduleWebhookSync(reason) {
  if (!heliusEnabled() || !serverReady) return;
  clearTimeout(webhookSyncTimer);
  webhookSyncTimer = setTimeout(async () => {
    const r = await syncWebhook([...REGISTERED_WHALES]);
    if (r.ok && r.action && r.action !== 'unchanged') console.log(`[helius] webhook ${r.action} · ${r.count} addresses (${reason})`);
    else if (!r.ok) console.warn(`[helius] webhook sync failed (${reason}):`, r.reason);
  }, 8000);
}

// ── PRIMARY feed: follow the registered whales' WALLETS across ALL tokens.
// Rotate through the roster in budgeted batches (public RPC honesty). Whatever
// token a whale buys or sells surfaces — no fixed pool list. ──
const WHALE_POLL_MS = Number(process.env.WHALE_POLL_MS || 7000);
const WHALE_RECON_MS = Number(process.env.WHALE_RECON_MS || 120000); // slow safety-net cadence once Helius push is live
const WHALE_BATCH = Number(process.env.WHALE_BATCH || 10); // whales checked per cycle (all RPC budget is ours now)
// When Helius push is active the poller is just a reconciliation net (catches
// anything missed during a webhook hiccup / cold start), so it runs slowly.
const pollDelay = () => (heliusEnabled() ? WHALE_RECON_MS : WHALE_POLL_MS);
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
    setTimeout(whalePoll, pollDelay());
  }
}

// ── slot heartbeat (for /health) ──
async function slotPoll() {
  try { lastSlot = await rpc('getSlot', []); } catch { /* keep */ }
  setTimeout(slotPoll, 30000);
}

// ── boot backfill: seed the deck from the registered whales' recent trades
// (their real swaps in whatever token). ──
async function backfill() {
  const roster = [...REGISTERED_WHALES].slice(0, 30);
  console.log(`[backfill] seeding from ${roster.length} whale wallets…`);
  for (const addr of roster) {
    let sigs = [];
    try { sigs = await rpc('getSignaturesForAddress', [addr, { limit: 6 }]); } catch { continue; }
    if (sigs.length) walletCursor.set(addr, sigs[0].signature);
    for (const s of sigs.filter((x) => !x.err).slice(0, 4)) { await processSig(s.signature, addr, TRACK_MIN_USD); await sleep(RPC_DELAY_MS); }
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
      groupId: row.trader + ':' + row.token + ':' + row.side,
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
// Locked to the real production frontend (+ local dev) instead of '*' — see
// listener.js for why. Override/extend via ALLOWED_ORIGINS (CSV).
const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS || 'https://deepswap-zeta.vercel.app,http://localhost:5173,http://localhost:5174')
    .split(',').map((s) => s.trim()).filter(Boolean),
);
function corsHeadersFor(origin) {
  return origin && ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
}
const sendJson = (req, res, code, body) => {
  res.writeHead(code, { 'Content-Type': 'application/json', ...corsHeadersFor(req.headers.origin) });
  res.end(JSON.stringify(body));
};
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

server.on('request', async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  // ── Helius webhook receiver — real-time whale transactions pushed here ──
  if (req.method === 'POST' && p === webhookPath()) {
    let raw = '';
    let tooBig = false;
    req.on('data', (c) => { raw += c; if (raw.length > 16 * 1024 * 1024) { tooBig = true; req.destroy(); } });
    req.on('end', () => {
      // Ack immediately so Helius marks delivery successful and never retries.
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
      if (tooBig) return;
      if (!validateAuth(req.headers['authorization'] || '')) { console.warn('[helius] rejected webhook POST — bad/missing auth header'); return; }
      let payload;
      try { payload = JSON.parse(raw); } catch { return; }
      handleHeliusPayload(payload).catch((e) => console.warn('[helius] payload handler error:', e.message || e));
    });
    req.on('error', () => { try { res.writeHead(400); res.end(); } catch {} });
    return;
  }

  if (p === '/health') {
    return sendJson(req, res, 200, {
      ok: true, chain: 'solana', lastBlock: lastSlot, whales: recentWhales.length,
      traders: traderAgg.size, trackMinUsd: TRACK_MIN_USD,
      monPriceUsd: solPriceUsd, registered: REGISTERED_WHALES.size,
      feed: heliusEnabled() ? 'helius-webhook (realtime)' : 'rpc-poll',
      helius: { ...heliusStatus(), hits: webhookHits },
      discovery: { engine: 'gmgn', everyMinutes: GMGN_SYNC_MINUTES, running: gmgnRunning, lastFinished: lastGmgnSyncAt },
      ...db.stats(),
    });
  }
  if (p === '/whales') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 40), RECENT_CAP);
    const whales = aggregateDeck(recentWhales).slice(0, limit).map((c) => ({ ...c, traderScore: scoreFromAgg(traderAgg.get(c.trader)) }));
    return sendJson(req, res, 200, { whales });
  }
  if (p === '/leaderboard') {
    const board = [...traderAgg.values()]
      .map((a) => ({
        ...a, winRate: a.closedTokens > 0 ? a.winTokens / a.closedTokens : null, verified: REGISTERED_WHALES.has(a.address),
        quality: qualityScore({ realizedUsd: (a.realizedMon || 0) * solPriceUsd, volumeUsd: a.volumeUsd || (a.volumeMon || 0) * solPriceUsd, winRate: a.closedTokens > 0 ? a.winTokens / a.closedTokens : null, closedTokens: a.closedTokens, recencyDays: daysSince(a.lastSeen) }),
      }))
      .sort((a, b) => b.quality - a.quality).slice(0, 80); // rank by quality, not raw volume
    return sendJson(req, res, 200, { traders: board });
  }
  if (p === '/roster') {
    // Verified Smart Money — served from the DURABLE whale_registry, which holds
    // every wallet ever confirmed (scans + live promotions + external seeds).
    // Rows are never deleted, so the list only grows. Richest stats win:
    // registry stats blob (scan output) first, live aggregate fills the gaps.
    const byAddr = new Map();
    for (const r of db.loadWhaleRegistry()) {
      const base = r.stats && typeof r.stats === 'object' ? r.stats : { address: r.address };
      byAddr.set(r.address, {
        ...base, address: r.address,
        volumeUsd: Math.max(Number(base.volumeUsd) || 0, Number(r.volumeUsd) || 0),
        solBalance: r.solBalance ?? base.solBalance ?? null,
        source: r.source, firstSeen: r.firstSeen, lastSeen: r.lastSeen,
      });
    }
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
    // Rank by quality (realized PnL + win-rate + recency). GMGN stats carry 7d
    // realized PnL / win-rate; last-seen recency comes from observed trades.
    const rosterRank = (w) => qualityScore({
      realizedUsd: w.realizedUsd7d != null ? w.realizedUsd7d : (w.realizedMon || 0) * solPriceUsd,
      volumeUsd: w.volumeUsd || 0, winRate: w.winRate, closedTokens: w.closedTokens || w.trades7d || 0,
      recencyDays: daysSince(traderAgg.get(w.address)?.lastSeen),
    });
    const whales = [...byAddr.values()].sort((x, y) => rosterRank(y) - rosterRank(x));
    return sendJson(req, res, 200, { count: whales.length, whales });
  }
  const m = p.match(/^\/address\/(.+)$/);
  if (m && B58.test(m[1])) {
    const a = m[1];
    let balanceMon = null;
    try { balanceMon = (await rpc('getBalance', [a])).value / 1e9; } catch {}
    const trades = db.tradesByAddress(a, 30);
    return sendJson(req, res, 200, {
      address: a, balanceMon, aggregate: traderAgg.get(a) || null,
      score: scoreFromAgg(traderAgg.get(a)), trades: trades.length ? trades : (addressTrades.get(a) || []),
    });
  }
  sendJson(req, res, 404, { error: 'not found' });
});
server.listen(PORT, () => { serverReady = true; console.log(`[HTTP/WS] listening on port ${PORT}`); });

// ── boot ──
await refreshSolPrice();
console.log(`[price] SOL = $${solPriceUsd} · tracking floor $${TRACK_MIN_USD}/swap · roster-only feed`);
setInterval(refreshSolPrice, 60000);
initFromDb();
await backfill();
whalePoll();  // safety-net poller (slow when Helius push is live; primary otherwise)
slotPoll();

// ── Real-time: register the Helius webhook with the current roster ──
// Runs after we're listening + backfilled (Helius pings the URL on create).
// When unconfigured this is a clean no-op and the poller stays primary.
if (heliusEnabled()) {
  // Fail-loud if the endpoint is unauthenticated: without a shared secret anyone
  // could POST forged transactions to /helius-webhook and inject fake deck cards.
  if (!heliusStatus().authProtected) console.warn('[helius] ⚠ HELIUS_WEBHOOK_SECRET is NOT set — the /helius-webhook endpoint is unauthenticated. Set it (and it is sent as the webhook authHeader) to reject forged pushes.');
  const r = await syncWebhook([...REGISTERED_WHALES]);
  if (r.ok) console.log(`[helius] real-time feed ON · webhook ${r.action} · ${r.count} whales → ${webhookPath()} (poller now ${WHALE_RECON_MS / 1000}s reconciliation)`);
  else console.warn(`[helius] webhook setup failed — staying on RPC poll:`, r.reason);
} else {
  console.log('[helius] not configured (set HELIUS_API_KEY + PUBLIC_URL for real-time) — using RPC poll');
}

// Roster hygiene: ban programs / PDAs / vaults that slipped into the roster.
const VALIDATE_MINUTES = Number(process.env.VALIDATE_MINUTES || 8);
setTimeout(validateRosterBatch, 90 * 1000);
setInterval(validateRosterBatch, VALIDATE_MINUTES * 60 * 1000);
console.log(`[validate] roster hygiene every ${VALIDATE_MINUTES}m (${VALIDATE_BATCH}/batch · bans programs/PDAs)`);

// GMGN whale discovery: periodically sweep GMGN (smart-money feed + KOL feed +
// trending tokens' top traders) into the PERMANENT registry (source 'gmgn'),
// then reload the roster so the new whales go straight into live tracking.
// Skips harmlessly when gmgn-cli isn't configured (e.g. cloud without the key).
function runGmgnSync(reason) {
  if (gmgnRunning) return;
  gmgnRunning = true;
  console.log(`[gmgn-sync] launching (${reason})…`);
  const child = spawn(process.execPath, [path.join(__d, 'gmgnSync.js')], { cwd: __d, env: process.env, stdio: 'inherit' });
  const killer = setTimeout(() => { console.warn(`[gmgn-sync] exceeded ${GMGN_KILL_MIN}m — killing (watchdog)`); child.kill('SIGKILL'); }, GMGN_KILL_MIN * 60 * 1000);
  child.on('exit', () => { clearTimeout(killer); gmgnRunning = false; lastGmgnSyncAt = Date.now(); loadRoster(); });
  child.on('error', (e) => { clearTimeout(killer); gmgnRunning = false; console.warn('[gmgn-sync] spawn failed:', e.message); });
}
setTimeout(() => runGmgnSync('boot'), 60 * 1000); // after backfill settles
setInterval(() => runGmgnSync('scheduled'), GMGN_SYNC_MINUTES * 60 * 1000);
