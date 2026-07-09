/**
 * GMGN smart-money sync — pulls GMGN's verified Smart Money + KOL wallets for
 * Solana via the official gmgn-cli and registers them PERMANENTLY into the
 * durable whale_registry (source 'gmgn'). Every wallet is verified on-chain
 * (getBalance) before registering — no blind trust in any external list.
 *
 * Designed to run periodically from solListener (same cadence as discovery).
 * Degrades gracefully: if gmgn-cli is missing or unconfigured it logs and
 * exits 0 so the indexer keeps running untouched.
 *
 * Cloud (Render) bootstrap: if ~/.config/gmgn/.env is absent but the
 * GMGN_API_KEY + GMGN_PRIVATE_KEY env vars are set, the config file is
 * written from them so the CLI works in a fresh container.
 *
 * Env: SOLANA_RPC, GMGN_LIMIT(200), IMPORT_DELAY_MS(400)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, 'solWhales.db');
const db = await import('./db.js');

const SOL_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const GMGN_LIMIT = Number(process.env.GMGN_LIMIT || 200);
const DELAY_MS = Number(process.env.IMPORT_DELAY_MS || 400);
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── cloud bootstrap: materialise the CLI config from env vars if needed ──
const cfgDir = path.join(os.homedir(), '.config', 'gmgn');
const cfgFile = path.join(cfgDir, '.env');
if (!fs.existsSync(cfgFile) && process.env.GMGN_API_KEY && process.env.GMGN_PRIVATE_KEY) {
  fs.mkdirSync(cfgDir, { recursive: true });
  fs.writeFileSync(cfgFile, `GMGN_API_KEY=${process.env.GMGN_API_KEY}\nGMGN_PRIVATE_KEY=${process.env.GMGN_PRIVATE_KEY}\n`, { mode: 0o600 });
  console.log('[gmgn-sync] CLI config written from env vars');
}

function cli(args) {
  // prefer the locally-installed dependency; fall back to a global install
  const local = path.join(__d, 'node_modules', '.bin', 'gmgn-cli');
  const bin = fs.existsSync(local) ? local : 'gmgn-cli';
  return execFileSync(bin, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function rpcBalance(addr) {
  const res = await fetch(SOL_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [addr] }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return (j.result?.value || 0) / 1e9;
}

async function main() {
  // configured?
  try { cli(['config', '--check']); }
  catch { console.log('[gmgn-sync] gmgn-cli missing/unconfigured — skipping (set GMGN_API_KEY + GMGN_PRIVATE_KEY to enable)'); return; }

  // collect wallets from both platform-tagged lists — real GMGN data only
  const wallets = new Map(); // addr -> { volUsd, tags }
  for (const list of ['smartmoney', 'kol']) {
    let out;
    try { out = cli(['track', list, '--chain', 'sol', '--limit', String(GMGN_LIMIT), '--raw']); }
    catch (e) { console.warn(`[gmgn-sync] ${list} fetch failed:`, (e.message || '').split('\n')[0]); continue; }
    let data;
    try { data = JSON.parse(out); } catch { continue; }
    const trades = data.list || data.data?.list || [];
    for (const t of trades) {
      if (!t.maker || !B58.test(t.maker)) continue;
      const tags = t.maker_info?.tags || [];
      if (tags.includes('wash_trader') || tags.includes('sandwich_bot')) continue; // manipülatif cüzdanlar registry'ye giremez
      if (list === 'smartmoney' && !tags.includes('smart_degen')) continue;
      const w = wallets.get(t.maker) || { volUsd: 0, tags: new Set() };
      w.volUsd += Number(t.amount_usd) || 0;
      for (const tag of tags) w.tags.add(tag);
      wallets.set(t.maker, w);
    }
    console.log(`[gmgn-sync] ${list}: cumulative unique wallets = ${wallets.size}`);
  }
  if (!wallets.size) { console.log('[gmgn-sync] no wallets returned — nothing to do'); return; }

  // register only NEW wallets (already-registered ones stay untouched — the
  // registry is permanent, and skipping them saves RPC budget)
  const known = new Set(db.loadWhaleRegistry().map((r) => r.address));
  const fresh = [...wallets.entries()].filter(([a]) => !known.has(a));
  console.log(`[gmgn-sync] ${wallets.size} wallets from GMGN · ${fresh.length} new`);

  let ok = 0;
  for (const [addr, w] of fresh) {
    try {
      const bal = await rpcBalance(addr); // real on-chain confirmation
      db.registerWhale(addr, 'gmgn', { volumeUsd: Math.round(w.volUsd * 100) / 100, solBalance: bal, stats: { address: addr, tags: [...w.tags] } });
      ok += 1;
      console.log(`[gmgn-sync] +${addr.slice(0, 10)}… · ${bal.toFixed(2)} SOL · [${[...w.tags].join(',')}]`);
    } catch (e) {
      console.warn(`[gmgn-sync] skip ${addr.slice(0, 10)}… — ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`[gmgn-sync] done · +${ok} new whales · registry now ${db.loadWhaleRegistry().length}`);
}

main().catch((e) => { console.error('[gmgn-sync] fatal:', e.message || e); process.exit(0); /* never crash the caller */ });
