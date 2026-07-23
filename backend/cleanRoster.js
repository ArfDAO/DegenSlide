/**
 * Roster cleanup — sync the committed roster to LIVE, then purge what shouldn't
 * be there. Two removal classes:
 *   BAN  (permanent veto, never re-added): non-wallets — EVM contracts,
 *        SVM programs / PDAs.
 *   DROP (soft remove, can be re-discovered): wallets that aren't real active
 *        whales right now — no gas / dust balance, or (with a recency source)
 *        no on-chain activity in the last INACTIVE_DAYS.
 *
 * It first pulls the LIVE Render /roster and folds it into the committed curated
 * JSON + local registry, so the committed files (which the free-tier Render
 * re-seeds from on every deploy) match what's actually live before cleaning.
 *
 * Usage:
 *   node cleanRoster.js monad [--dry]
 *   node cleanRoster.js solana [--dry]
 * Env: MONAD_RPC, SOLANA_RPC, CLEAN_DELAY_MS(60),
 *      GAS_MIN_MON(0.01)  — Monad: drop wallets holding less (can't trade),
 *      SOL_MIN(0.005)     — Solana dust floor,
 *      INACTIVE_DAYS(30)  — drop wallets with no tx in this window,
 *      ETHERSCAN_API_KEY  — enables Monad last-activity recency (V2, chainid 143).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = path.dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency): pick up KEY=value lines from backend/.env
// so the user can just drop ETHERSCAN_API_KEY there. Existing env vars win.
try {
  for (const line of fs.readFileSync(path.join(__d, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no backend/.env → rely on real env */ }

const chain = (process.argv[2] || '').toLowerCase();
const DRY = process.argv.includes('--dry');
const DELAY_MS = Number(process.env.CLEAN_DELAY_MS || 60);
const GAS_MIN_MON = Number(process.env.GAS_MIN_MON || 0.01);
const SOL_MIN = Number(process.env.SOL_MIN || 0.005);
const INACTIVE_DAYS = Number(process.env.INACTIVE_DAYS || 30);
const DAY = 86400000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (chain !== 'monad' && chain !== 'solana') { console.error('usage: node cleanRoster.js <monad|solana> [--dry]'); process.exit(1); }

process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, chain === 'solana' ? 'solWhales.db' : 'whales.db');
const db = await import('./db.js');

const LIVE_URL = chain === 'solana'
  ? 'https://deepswap-solana-bot-h10w.onrender.com/roster'
  : 'https://deepswap-monad-bot2-u0ob.onrender.com/roster';
const CURATED = path.join(__d, '..', 'src', 'data', chain === 'solana' ? 'curatedSolWhales.json' : 'curatedWhales.json');
const norm = (a) => (chain === 'monad' ? a.toLowerCase() : a);

// ── 1. Sync committed roster ← LIVE Render registry ──────────────────────
async function syncLive(curated) {
  const byAddr = new Map((curated.whales || []).map((w) => [norm(w.address), w]));
  let added = 0, registered = 0;
  try {
    const r = await fetch(LIVE_URL, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    for (const w of j.whales || []) {
      if (!w.address) continue;
      const key = norm(w.address);
      if (db.isBlacklisted(key)) continue;                 // never re-import a banned wallet
      if (!byAddr.has(key)) { byAddr.set(key, w); added += 1; }
      // fold every live wallet into the durable registry too
      const ok = db.registerWhale(w.address, w.source || 'live', { volumeUsd: w.volumeUsd ?? null, solBalance: w.solBalance ?? null, stats: w });
      if (ok) registered += 1;
    }
    console.log(`[clean] live-sync: +${added} new to curated · ${registered} upserted to registry`);
  } catch (e) { console.warn('[clean] live-sync failed (offline?):', e.message); }
  curated.whales = [...byAddr.values()];
  return curated;
}

async function classifyMonad(addresses) {
  const { JsonRpcProvider } = await import('ethers');
  const { VIP_WHALES } = await import('./vipWhales.js');
  const provider = new JsonRpcProvider(process.env.MONAD_RPC || 'https://rpc.monad.xyz');
  const KEY = process.env.ETHERSCAN_API_KEY || '';
  const ban = new Map(); const drop = new Map();
  let i = 0;
  for (const a of addresses) {
    i += 1;
    if (VIP_WHALES.has(a)) continue;
    if (db.isBlacklisted(a)) continue;
    let code = '0x';
    try { code = await provider.getCode(a); } catch { continue; }
    if (code && code !== '0x') { ban.set(a, 'contract'); await sleep(DELAY_MS); continue; }
    let bal = null; try { bal = Number(await provider.getBalance(a)) / 1e18; } catch {}
    if (bal != null && bal < GAS_MIN_MON) { drop.set(a, `no-gas(${bal.toFixed(4)} MON)`); await sleep(DELAY_MS); continue; }
    if (KEY) {
      try {
        const r = await fetch(`https://api.etherscan.io/v2/api?chainid=143&module=account&action=txlist&address=${a}&page=1&offset=1&sort=desc&apikey=${KEY}`, { signal: AbortSignal.timeout(12000) });
        const ts = Number((await r.json()).result?.[0]?.timeStamp) * 1000;
        if (ts > 0 && Date.now() - ts > INACTIVE_DAYS * DAY) drop.set(a, `inactive>${INACTIVE_DAYS}d`);
      } catch {}
    }
    if (i % 75 === 0) console.log(`  …checked ${i}/${addresses.length}`);
    await sleep(DELAY_MS);
  }
  return { ban, drop, hasRecency: !!KEY };
}

async function classifySolana(addresses) {
  const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
  const SYS = '11111111111111111111111111111111';
  async function rpc(method, params) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
    const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
  }
  const ban = new Map(); const drop = new Map();
  let i = 0;
  for (const a of addresses) {
    i += 1;
    if (db.isBlacklisted(a)) continue;
    let info;
    try { info = (await rpc('getAccountInfo', [a, { encoding: 'base64' }]))?.value; }
    catch { await sleep(DELAY_MS * 4); continue; }
    if (info?.executable) { ban.set(a, 'program'); await sleep(DELAY_MS); continue; }
    if (info && info.owner !== SYS) { ban.set(a, 'pda'); await sleep(DELAY_MS); continue; }
    try {
      const sigs = await rpc('getSignaturesForAddress', [a, { limit: 1 }]);
      const bt = sigs?.[0]?.blockTime ? sigs[0].blockTime * 1000 : null;
      if (bt && Date.now() - bt > INACTIVE_DAYS * DAY) drop.set(a, `inactive>${INACTIVE_DAYS}d`);
    } catch {}
    if (i % 50 === 0) console.log(`  …checked ${i}/${addresses.length}`);
    await sleep(DELAY_MS);
  }
  return { ban, drop, hasRecency: true };
}

async function main() {
  let curated = { whales: [] };
  try { curated = JSON.parse(fs.readFileSync(CURATED, 'utf8')); } catch {}
  const beforeCurated = (curated.whales || []).length;

  if (!DRY) curated = await syncLive(curated); // sync committed ← live first

  // union of everything we now know about
  const addrs = new Map();
  for (const w of curated.whales || []) if (w.address) addrs.set(norm(w.address), true);
  for (const r of db.loadWhaleRegistry()) if (r.address) addrs.set(norm(r.address), true);
  const list = [...addrs.keys()];
  console.log(`[clean:${chain}] scanning ${list.length} addresses ${DRY ? '(DRY RUN — no live-sync, no writes)' : ''}…`);

  const { ban, drop, hasRecency } = chain === 'monad' ? await classifyMonad(list) : await classifySolana(list);

  console.log(`\n[clean:${chain}] BAN (permanent, non-wallet): ${ban.size}`);
  for (const [a, why] of ban) console.log(`  ⛔ ${a}  (${why})`);
  console.log(`[clean:${chain}] DROP (soft remove, re-discoverable): ${drop.size}${hasRecency ? '' : '  [recency off — no ETHERSCAN_API_KEY]'}`);
  for (const [a, why] of drop) console.log(`  ✂  ${a}  (${why})`);

  if (DRY) { console.log('\n[clean] dry run — nothing changed.'); process.exit(0); }
  if (!ban.size && !drop.size) { console.log('\n[clean] roster already clean.'); }

  // apply: BAN → blacklist (delete + veto); DROP → soft remove (delete only)
  for (const [a, why] of ban) db.blacklistWhale(a, why.split('(')[0]);
  for (const a of drop.keys()) db.removeWhale(a);

  const gone = new Set([...ban.keys(), ...drop.keys()].map(norm));
  curated.whales = (curated.whales || []).filter((w) => w.address && !gone.has(norm(w.address)));
  curated.count = curated.whales.length;
  curated.cleanedAt = new Date().toISOString();
  fs.writeFileSync(CURATED, JSON.stringify(curated, null, 2));

  console.log(`\n[clean:${chain}] DONE`);
  console.log(`  · banned ${ban.size} · dropped ${drop.size}`);
  console.log(`  · registry now ${db.loadWhaleRegistry().length} · blacklist ${db.loadBlacklist().length}`);
  console.log(`  · curated: ${beforeCurated} → ${curated.whales.length} whales (${path.relative(path.join(__d, '..'), CURATED)})`);
  console.log('  → commit the updated .db + curated JSON, then redeploy Render.');
  process.exit(0);
}
main().catch((e) => { console.error('[clean] fatal', e.message || e); process.exit(1); });
