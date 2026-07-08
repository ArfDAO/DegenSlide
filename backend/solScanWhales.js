/**
 * DegenSlide Whale Discovery — SOLANA MAINNET (historical scan)
 *
 * The Solana counterpart of scanWhales.js. Same 5-step professional pipeline,
 * adapted to Solana's account model:
 *   1. High-liquidity pools only — DexScreener top Solana pools anchored to
 *      exactly one quote (SOL / USDC / USDT), liquidity ≥ MIN_LIQ_USD. No junk.
 *   2. Deep history — page back through getSignaturesForAddress per pool, then
 *      getTransaction + parse the SIGNER's pre/post token+lamport deltas.
 *   3. USD threshold — the quote leg gives the real per-swap USD size.
 *   4. Aggregate per wallet — volume, buys/sells, avg-cost realized PnL, tokens,
 *      same-slot arb round-trips.
 *   5. Bot elimination — on Solana every fee payer is a keypair (no EXTCODESIZE),
 *      so behaviour is the signal: atomic same-slot arb + balanced high-freq churn.
 *
 * Output: src/data/curatedSolWhales.json — real, bot-filtered mainnet wallets,
 * shaped identically to the Monad curated file so the frontend treats both the
 * same. NO mock / fabricated data. Public RPC is rate-limited, so the scan is
 * budgeted (SCAN_TX_BUDGET) and backs off on 429 — a dedicated RPC lifts this.
 *
 * Env: SOLANA_RPC, MIN_LIQ_USD(150000), SCAN_MIN_USD(300), SCAN_MAX_POOLS(20),
 * PAGES_PER_POOL(3), SCAN_TX_BUDGET(1500), SCAN_TARGET(120), OUT_COUNT(100),
 * RPC_DELAY_MS(60)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverQualityPools } from './solPools.js';

const SOL_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const MIN_LIQ_USD = Number(process.env.MIN_LIQ_USD || 150000);
const MIN_MCAP_USD = Number(process.env.MIN_MCAP_USD || 20000000); // dynamic pools must clear this market cap (skip junk micro-caps)
const SCAN_MIN_USD = Number(process.env.SCAN_MIN_USD || 300);       // per-swap floor to count a wallet as active in a quality token
const MIN_SOL_BALANCE = Number(process.env.MIN_SOL_BALANCE || 40);  // a real whale holds real SOL (or trades huge volume)
const BIG_VOLUME_USD = Number(process.env.BIG_VOLUME_USD || 25000); // …or moves this much through quality pools
const SCAN_MAX_POOLS = Number(process.env.SCAN_MAX_POOLS || 24);    // quality universe size
const PAGES_PER_POOL = Number(process.env.PAGES_PER_POOL || 8);     // getSignaturesForAddress pages (≤1000 each)
const SCAN_TX_BUDGET = Number(process.env.SCAN_TX_BUDGET || 6000);  // getTransaction calls total (RPC honesty)
const TARGET = Number(process.env.SCAN_TARGET || 350);             // distinct candidates before bot-filtering
const OUT_COUNT = Number(process.env.OUT_COUNT || 100);
const MAX_PER_TOKEN = Number(process.env.MAX_PER_TOKEN || 20);     // cap so one hot token (e.g. ANTFUN) can't monopolise the roster
const RPC_DELAY_MS = Number(process.env.RPC_DELAY_MS || 60);

const WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE_TOKENS = new Map([
  [WSOL, { symbol: 'SOL', kind: 'sol' }],
  ['EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', { symbol: 'USDC', kind: 'usd' }],
  ['Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', { symbol: 'USDT', kind: 'usd' }],
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } };

// ── rate-limit-aware RPC (public mainnet-beta throttles hard) ──
async function rpc(method, params, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(SOL_RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      });
      if (res.status === 429) { await sleep(500 * (i + 1)); continue; }
      const j = await res.json();
      if (j.error) { if (/rate|limit|429/i.test(j.error.message || '')) { await sleep(500 * (i + 1)); continue; } throw new Error(j.error.message); }
      return j.result;
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(300 * (i + 1));
    }
  }
  return null;
}

let solPriceUsd = 0;
async function refreshSolPrice() {
  try {
    const res = await fetch(`https://api.dexscreener.com/token-pairs/v1/solana/${WSOL}`, UA);
    const pairs = (await res.json()) || [];
    const best = (Array.isArray(pairs) ? pairs : []).filter((p) => p.priceUsd && p.baseToken?.address === WSOL)
      .sort((a, b) => (Number(b.liquidity?.usd) || 0) - (Number(a.liquidity?.usd) || 0))[0];
    if (best && Number(best.priceUsd) > 0) solPriceUsd = Number(best.priceUsd);
  } catch { /* keep last */ }
}

// ── Step 1: QUALITY pool universe (well-known blue chips + high-liq/high-mcap),
// resolved live via solPools.js — no obscure micro-caps. ──
async function discoverPools() {
  return discoverQualityPools({ minLiq: MIN_LIQ_USD, minMcap: MIN_MCAP_USD, maxPools: SCAN_MAX_POOLS });
}

// ── parse the signer's real balance deltas into a swap (same model as the live listener) ──
function parseSwap(tx, poolInfo) {
  if (!tx || tx.meta?.err) return null;
  const keys = tx.transaction?.message?.accountKeys || [];
  const signer = keys.find((k) => k.signer)?.pubkey;
  if (!signer) return null;
  const delta = new Map();
  for (const b of tx.meta.postTokenBalances || []) if (b.owner === signer) delta.set(b.mint, (delta.get(b.mint) || 0) + (Number(b.uiTokenAmount?.uiAmount) || 0));
  for (const b of tx.meta.preTokenBalances || []) if (b.owner === signer) delta.set(b.mint, (delta.get(b.mint) || 0) - (Number(b.uiTokenAmount?.uiAmount) || 0));
  const si = keys.findIndex((k) => k.pubkey === signer);
  if (si >= 0 && tx.meta.postBalances && tx.meta.preBalances) {
    const lam = (tx.meta.postBalances[si] - tx.meta.preBalances[si]) / 1e9;
    delta.set(WSOL, (delta.get(WSOL) || 0) + lam);
  }
  let quoteMint = null, quoteDelta = 0, quoteUsd = 0;
  for (const [mint, q] of QUOTE_TOKENS) {
    const dv = delta.get(mint) || 0;
    const usd = Math.abs(dv) * (q.kind === 'usd' ? 1 : solPriceUsd);
    if (usd > quoteUsd) { quoteUsd = usd; quoteDelta = dv; quoteMint = mint; }
  }
  if (!quoteMint || quoteUsd < SCAN_MIN_USD) return null;
  let tokMint = null, tokDelta = 0;
  for (const [mint, dv] of delta) {
    if (QUOTE_TOKENS.has(mint)) continue;
    if (Math.sign(dv) === Math.sign(quoteDelta) || dv === 0) continue;
    if (Math.abs(dv) > Math.abs(tokDelta)) { tokDelta = dv; tokMint = mint; }
  }
  if (!tokMint) return null;
  return {
    signer, side: quoteDelta < 0 ? 'BUY' : 'SELL', amountUsd: quoteUsd,
    tokenMint: tokMint, tokenAmount: Math.abs(tokDelta), slot: tx.slot,
    tokenSymbol: tokMint === poolInfo.tokenMint ? poolInfo.tokenSymbol : tokMint.slice(0, 4),
  };
}

// ── Step 4: per-wallet aggregate (volume, PnL, arb, tokens) ──
const whales = new Map();
function ensureWhale(addr) {
  let w = whales.get(addr);
  if (!w) {
    w = { address: addr, trades: 0, buys: 0, sells: 0, volumeUsd: 0, arbHits: 0,
      tokens: new Map(), lastToken: null, pos: new Map(), _last: null };
    whales.set(addr, w);
  }
  return w;
}
function record(s) {
  const w = ensureWhale(s.signer);
  w.trades += 1;
  if (s.side === 'BUY') w.buys += 1; else w.sells += 1;
  w.volumeUsd += s.amountUsd;
  w.lastToken = s.tokenSymbol;
  w.tokens.set(s.tokenSymbol, (w.tokens.get(s.tokenSymbol) || 0) + s.amountUsd);
  // same-slot opposite-side round-trip on the same token = atomic arb
  if (w._last && w._last.slot === s.slot && w._last.token === s.tokenMint && w._last.side !== s.side) w.arbHits += 1;
  w._last = { slot: s.slot, token: s.tokenMint, side: s.side };
  // avg-cost realized PnL in USD
  const p = w.pos.get(s.tokenMint) || { boughtTok: 0, spentUsd: 0, soldTok: 0, realizedUsd: 0 };
  if (s.side === 'BUY') { p.boughtTok += s.tokenAmount; p.spentUsd += s.amountUsd; }
  else {
    const avg = p.boughtTok > 0 ? p.spentUsd / p.boughtTok : 0;
    if (avg > 0) p.realizedUsd += s.amountUsd - avg * s.tokenAmount;
    p.soldTok += s.tokenAmount;
  }
  w.pos.set(s.tokenMint, p);
}

function isCleanSymbol(s) {
  return typeof s === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,11}$/.test(s);
}

// ── Step 5: behavioural bot classification (no EXTCODESIZE on Solana) ──
function classify(w) {
  const directionality = w.trades ? Math.abs(w.buys - w.sells) / w.trades : 0;
  const arbBot = w.arbHits > 0;
  const churnBot = w.trades >= 40 && directionality < 0.2;
  return { directionality, isBot: arbBot || churnBot, arbBot, churnBot };
}

async function main() {
  await refreshSolPrice();
  const pools = await discoverPools();
  console.log(`[sol-scan] SOL=$${solPriceUsd} · min $${SCAN_MIN_USD}/swap · liq≥$${MIN_LIQ_USD} · ${pools.length} pools · budget ${SCAN_TX_BUDGET} tx`);
  if (!pools.length) { console.error('[sol-scan] no pools discovered — aborting'); process.exit(1); }

  // Step 2: collect signatures deep per pool (cheap metadata), newest→oldest,
  // kept in SEPARATE per-pool queues so we can spread the budget evenly.
  const perPool = [];
  for (const p of pools) {
    const q = [];
    let before = null;
    for (let page = 0; page < PAGES_PER_POOL; page++) {
      let sigs = [];
      try { sigs = await rpc('getSignaturesForAddress', [p.pool, before ? { limit: 1000, before } : { limit: 1000 }]); }
      catch { break; }
      await sleep(RPC_DELAY_MS);
      if (!sigs || !sigs.length) break;
      for (const s of sigs) if (!s.err) q.push({ sig: s.signature, p });
      before = sigs[sigs.length - 1].signature;
    }
    perPool.push(q);
  }
  // Round-robin interleave: one sig from each pool per round, so the busiest
  // token (e.g. ANTFUN) can't monopolise the budget — every pool contributes
  // whales, giving a genuinely diverse roster across ALL tokens.
  const jobs = [];
  for (let i = 0, done = false; !done; i++) {
    done = true;
    for (const q of perPool) if (i < q.length) { jobs.push(q[i]); done = false; }
  }
  console.log(`[sol-scan] ${jobs.length} candidate signatures across ${pools.length} pools · fetching up to ${SCAN_TX_BUDGET} txs…`);

  // Step 3+4: fetch + parse within budget, stop early once we have enough candidates
  let processed = 0;
  for (const j of jobs) {
    if (processed >= SCAN_TX_BUDGET) break;
    if (whales.size >= TARGET && processed >= SCAN_TX_BUDGET / 2) break; // enough breadth, save RPC
    let tx = null;
    try { tx = await rpc('getTransaction', [j.sig, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]); }
    catch { continue; }
    processed += 1;
    await sleep(RPC_DELAY_MS);
    const s = parseSwap(tx, j.p);
    if (s) record(s);
    if (processed % 200 === 0) console.log(`[sol-scan] ${processed} txs · ${whales.size} candidate wallets`);
  }

  // behavioural bot elimination over the whole candidate set
  let dropArb = 0, dropChurn = 0;
  const clean = [];
  for (const w of [...whales.values()].sort((a, b) => b.volumeUsd - a.volumeUsd)) {
    const c = classify(w);
    if (c.isBot) { if (c.arbBot) dropArb += 1; else dropChurn += 1; continue; }
    w._directionality = c.directionality;
    w._domToken = [...w.tokens.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '?'; // biggest token by volume
    clean.push(w);
  }
  console.log(`[sol-scan] removed bots → ${dropArb} same-slot-arb · ${dropChurn} churn-MM`);

  // Bucket whales by their dominant token, then round-robin across tokens,
  // CAPPED per token, so the hottest token (e.g. ANTFUN) can't monopolise the
  // roster — every quality token with real whales gets real representation.
  // Leftover slots (small-token pools exhausted) spill to the biggest tokens.
  const buckets = new Map(); // token -> whales[] (sorted by volume desc)
  for (const w of clean) { const k = w._domToken; if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(w); }
  const order = [...buckets.values()].sort((a, b) => b[0].volumeUsd - a[0].volumeUsd); // strongest token first
  const picked = [];
  for (let i = 0, done = false; !done && picked.length < OUT_COUNT; i++) {
    done = true;
    for (const b of order) {
      if (picked.length >= OUT_COUNT) break;
      if (i >= b.length) continue;
      const taken = picked.filter((w) => w._domToken === b[0]._domToken).length;
      if (taken >= MAX_PER_TOKEN) continue;
      picked.push(b[i]); done = false;
    }
  }
  if (picked.length < OUT_COUNT) {
    const pickedSet = new Set(picked);
    for (const b of order) {
      for (const w of b) { if (picked.length >= OUT_COUNT) break; if (!pickedSet.has(w)) { picked.push(w); pickedSet.add(w); } }
      if (picked.length >= OUT_COUNT) break;
    }
  }
  const finalDist = [...picked.reduce((m, w) => m.set(w._domToken, (m.get(w._domToken) || 0) + 1), new Map())];
  console.log(`[sol-scan] ${picked.length} whales across ${buckets.size} tokens (cap ${MAX_PER_TOKEN}/token): ${finalDist.sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}(${n})`).join(' ')}`);

  // Step 5b: confirm these are REAL whales — a big SOL balance OR big volume
  // through quality pools. Wallets with neither (small one-off traders) drop.
  console.log(`[sol-scan] verifying ${picked.length} wallets by SOL balance…`);
  const verified = [];
  for (const w of picked) {
    let bal = 0;
    try { bal = (await rpc('getBalance', [w.address]))?.value / 1e9 || 0; } catch {}
    await sleep(RPC_DELAY_MS);
    w._solBalance = bal;
    if (bal >= MIN_SOL_BALANCE || w.volumeUsd >= BIG_VOLUME_USD) verified.push(w);
  }
  console.log(`[sol-scan] ${verified.length}/${picked.length} confirmed whales (bal ≥ ${MIN_SOL_BALANCE} SOL or vol ≥ $${BIG_VOLUME_USD})`);

  const round2 = (x) => Math.round(x * 100) / 100;
  const ranked = verified.map((w) => {
    let realizedUsd = 0, closedTokens = 0, winTokens = 0;
    for (const p of w.pos.values()) if (p.soldTok > 0 && p.boughtTok > 0) { closedTokens += 1; realizedUsd += p.realizedUsd; if (p.realizedUsd > 0) winTokens += 1; }
    const cleanTokens = [...w.tokens.entries()].filter(([s]) => isCleanSymbol(s)).sort((a, b) => b[1] - a[1]).map(([s]) => s).slice(0, 6);
    const lastToken = isCleanSymbol(w.lastToken) ? w.lastToken : (cleanTokens[0] || null);
    return {
      address: w.address,
      volumeUsd: round2(w.volumeUsd),
      volumeMon: round2(solPriceUsd > 0 ? w.volumeUsd / solPriceUsd : 0), // SOL-equivalent (field name kept for frontend parity)
      solBalance: round2(w._solBalance || 0),
      trades: w.trades, buys: w.buys, sells: w.sells,
      directionality: round2(w._directionality),
      lpAddedUsd: 0, lpEvents: 0, isMarketMaker: false, // LP scanning is EVM-specific; Solana whales scored on swap volume/PnL
      tokens: cleanTokens, lastToken,
      realizedUsd: round2(realizedUsd),
      realizedMon: round2(solPriceUsd > 0 ? realizedUsd / solPriceUsd : 0),
      closedTokens, winTokens,
      winRate: closedTokens > 0 ? Math.round((winTokens / closedTokens) * 100) / 100 : null,
    };
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, '..', 'src', 'data');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'curatedSolWhales.json');
  fs.writeFileSync(outFile, JSON.stringify({
    source: 'Solana mainnet — on-chain discovery + behavioural bot elimination (signer balance-delta parsing, one-quote pools)',
    scannedAt: new Date().toISOString(),
    txsScanned: processed, minUsdPerSwap: SCAN_MIN_USD, minLiquidityUsd: MIN_LIQ_USD,
    botsRemoved: { sameSlotArb: dropArb, churnMM: dropChurn },
    count: ranked.length, whales: ranked,
  }, null, 2));
  console.log(`[sol-scan] DONE · ${ranked.length} verified whales → ${outFile}`);
  console.log('[sol-scan] top 5:', ranked.slice(0, 5).map((w) => `${w.address.slice(0, 8)}=$${Math.round(w.volumeUsd).toLocaleString()}`).join('  '));
  process.exit(0);
}

main().catch((e) => { console.error('[sol-scan] fatal', e.message || e); process.exit(1); });
