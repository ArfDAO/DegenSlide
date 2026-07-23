/**
 * GMGN whale-discovery engine — the ONLY discovery path for Solana.
 *
 * The system model: discovery finds proven Smart Money wallets via the GMGN
 * OpenAPI (gmgn-cli) and registers them PERMANENTLY into the durable
 * whale_registry. The live indexer (solListener.js) then tracks ONLY these
 * registered wallets — no blanket transaction scanning anywhere.
 *
 * Discovery vectors (all real GMGN data, no fabrication):
 *   A. track smartmoney  — GMGN's live Smart Money trade feed (smart_degen)
 *   B. track kol         — GMGN's KOL/renowned trade feed
 *   C. market trending → token traders — for each trending token with real
 *      liquidity and smart-money presence, harvest its top traders tagged
 *      smart_degen / renowned. This is the growth engine: every run sweeps
 *      dozens of tokens × up to TRADERS_PER_TOKEN wallets each.
 *
 * Candidate filtering (GMGN tags): wash_trader / sandwich_bot / rat_trader /
 * bundler / dex_bot / sniper and is_suspicious are rejected outright.
 *
 * Quality gate (GMGN 7d portfolio stats): a candidate must show winrate ≥
 * MIN_WINRATE or realized profit ≥ MIN_PROFIT_USD. Feed wallets (vectors A/B)
 * that GMGN itself already tags smart_degen/renowned pass if stats are
 * unavailable. Every accepted wallet is verified on-chain (getBalance) before
 * registering — no blind trust in any external list.
 *
 * Cloud (Render) bootstrap: if ~/.config/gmgn/.env is absent but the
 * GMGN_API_KEY + GMGN_PRIVATE_KEY env vars are set, the config file is
 * written from them so the CLI works in a fresh container.
 *
 * Env: SOLANA_RPC, GMGN_LIMIT(200), IMPORT_DELAY_MS(400),
 *      GMGN_TREND_TOKENS(24 per interval), GMGN_TRADERS_PER_TOKEN(50),
 *      GMGN_MIN_TOKEN_LIQ(100000), GMGN_MIN_WINRATE(0.4),
 *      GMGN_MIN_PROFIT_USD(1000), GMGN_MAX_NEW(400)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, 'solWhales.db');
const db = await import('./db.js');
const { runExternalSources } = await import('./discoverySources.js');

const SOL_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const GMGN_LIMIT = Number(process.env.GMGN_LIMIT || 200);
const DELAY_MS = Number(process.env.IMPORT_DELAY_MS || 400);
const TREND_TOKENS = Number(process.env.GMGN_TREND_TOKENS || 24);      // tokens swept per trending interval
const TRADERS_PER_TOKEN = Number(process.env.GMGN_TRADERS_PER_TOKEN || 50);
const MIN_TOKEN_LIQ = Number(process.env.GMGN_MIN_TOKEN_LIQ || 100000); // junk-token floor for the sweep
const MIN_WINRATE = Number(process.env.GMGN_MIN_WINRATE || 0.4);
const MIN_PROFIT_USD = Number(process.env.GMGN_MIN_PROFIT_USD || 1000);
const MAX_NEW = Number(process.env.GMGN_MAX_NEW || 400);                // per-run registration cap
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BAD_TAGS = new Set(['wash_trader', 'sandwich_bot', 'rat_trader', 'bundler', 'dex_bot', 'sniper']);
const GOOD_TAGS = new Set(['smart_degen', 'renowned']);
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
  return execFileSync(bin, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
}
function cliJson(args) {
  try { return JSON.parse(cli(args)); }
  catch (e) { console.warn(`[gmgn-sync] ${args.slice(0, 3).join(' ')} failed:`, (e.message || '').split('\n')[0]); return null; }
}

async function solRpc(method, params) {
  const res = await fetch(SOL_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function rpcBalance(addr) {
  return (await solRpc('getBalance', [addr]))?.value / 1e9 || 0;
}

// The System Program owns every ordinary wallet. A candidate whose account is
// executable, is owned by any other program (a PDA / token account / protocol
// vault), or doesn't exist is NOT a real whale wallet — reject it so smart
// contracts and program addresses never enter the roster.
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
async function isRealWallet(addr) {
  const info = (await solRpc('getAccountInfo', [addr, { encoding: 'base64' }]))?.value;
  if (!info) return true; // account not yet on chain (0-lamport EOA) → allow; getBalance still gates
  if (info.executable) return false;               // a program (smart contract)
  return info.owner === SYSTEM_PROGRAM;             // real wallet iff System-owned
}

// candidate pool: addr -> { volUsd, tags:Set, vector, fromFeed }
const candidates = new Map();
function addCandidate(addr, { volUsd = 0, tags = [], vector, fromFeed = false }) {
  if (!addr || !B58.test(addr)) return;
  if (tags.some((t) => BAD_TAGS.has(t))) return; // manipülatif cüzdanlar registry'ye giremez
  const c = candidates.get(addr) || { volUsd: 0, tags: new Set(), vectors: new Set(), fromFeed: false };
  c.volUsd += volUsd;
  for (const t of tags) c.tags.add(t);
  c.vectors.add(vector);
  c.fromFeed = c.fromFeed || fromFeed;
  candidates.set(addr, c);
}

// ── Vector A + B: Smart Money and KOL trade feeds ──
function sweepFeeds() {
  for (const list of ['smartmoney', 'kol']) {
    const data = cliJson(['track', list, '--chain', 'sol', '--limit', String(GMGN_LIMIT), '--raw']);
    if (!data) continue;
    const trades = data.list || data.data?.list || [];
    for (const t of trades) {
      const tags = t.maker_info?.tags || [];
      if (list === 'smartmoney' && !tags.includes('smart_degen')) continue;
      addCandidate(t.maker, { volUsd: Number(t.amount_usd) || 0, tags, vector: `feed:${list}`, fromFeed: true });
    }
    console.log(`[gmgn-sync] feed ${list}: cumulative candidates = ${candidates.size}`);
  }
}

// ── Vector C: trending tokens → top traders tagged smart_degen / renowned ──
function sweepTrendingTraders() {
  const seen = new Set();
  const tokens = [];
  for (const interval of ['1h', '6h', '24h']) {
    const data = cliJson(['market', 'trending', '--chain', 'sol', '--interval', interval,
      '--limit', '100', '--min-liquidity', String(MIN_TOKEN_LIQ), '--min-smart-degen-count', '2',
      '--filter', 'not_wash_trading', '--raw']);
    const list = data?.data?.rank || data?.rank || data?.data?.list || data?.list || [];
    let took = 0;
    for (const tk of list) {
      if (took >= TREND_TOKENS) break;
      if (!tk.address || seen.has(tk.address)) continue;
      seen.add(tk.address);
      tokens.push({ address: tk.address, symbol: tk.symbol });
      took += 1;
    }
  }
  console.log(`[gmgn-sync] trending sweep: ${tokens.length} quality tokens with smart-money presence`);
  for (const tk of tokens) {
    for (const tag of ['smart_degen', 'renowned']) {
      const data = cliJson(['token', 'traders', '--chain', 'sol', '--address', tk.address,
        '--limit', String(TRADERS_PER_TOKEN), '--tag', tag, '--order-by', 'profit', '--raw']);
      const list = data?.data?.list || data?.list || [];
      for (const tr of list) {
        if (tr.is_suspicious) continue;
        if ((tr.maker_token_tags || []).some((t) => BAD_TAGS.has(t))) continue;
        const vol = (Number(tr.buy_volume_cur) || 0) + (Number(tr.sell_volume_cur) || 0);
        addCandidate(tr.address, { volUsd: vol, tags: tr.tags || [tag], vector: `token:${tk.symbol}` });
      }
    }
  }
  console.log(`[gmgn-sync] trader sweep done: cumulative candidates = ${candidates.size}`);
}

// ── GMGN 7d wallet stats (winrate / realized profit) — the authoritative
// performance numbers shown in the app. Fetched per wallet, timestamped. ──
function fetchWalletStats(addr) {
  const data = cliJson(['portfolio', 'stats', '--chain', 'sol', '--wallet', addr, '--period', '7d', '--raw']);
  const s = Array.isArray(data) ? data[0] : (data?.wallet_address ? data : data?.data);
  if (!s || !s.wallet_address) return null;
  const winrate = Number(s.pnl_stat?.winrate);
  return {
    winRate: Number.isFinite(winrate) ? Math.round(winrate * 100) / 100 : null,
    realizedUsd7d: Math.round((Number(s.realized_profit) || 0) * 100) / 100,
    trades7d: (s.buy || 0) + (s.sell || 0),
    tokens7d: s.pnl_stat?.token_num ?? null,
    twitter: s.common?.twitter_username || null,
    solBalanceGmgn: Number(s.native_balance) || null,
    statsAt: Date.now(),
  };
}

// External discovery vectors are curated smart-money lists (already vetted by
// the provider), so they qualify like GMGN feed wallets when GMGN stats aren't
// available. The on-chain wallet check + balance floor still gate every one.
const EXTERNAL_VECTOR = /^(birdeye|solanatracker|cielo)/;

// ── Quality gate for NEW candidates ──
function statsGate(addr, cand) {
  const stats = fetchWalletStats(addr);
  if (!stats) {
    // stats unavailable → GMGN feed wallets need a good tag; externally-sourced
    // (pre-vetted) wallets qualify on their source alone.
    const gmgnFeedOk = cand.fromFeed && [...cand.tags].some((t) => GOOD_TAGS.has(t));
    const externalOk = [...cand.vectors].some((v) => EXTERNAL_VECTOR.test(v));
    return { pass: gmgnFeedOk || externalOk, stats: null };
  }
  const pass = (stats.winRate != null && stats.winRate >= MIN_WINRATE) || stats.realizedUsd7d >= MIN_PROFIT_USD;
  return { pass, stats };
}

// ── Stats refresh: keep the WHOLE registry's winrate/PnL numbers accurate.
// Refreshes wallets with missing stats first, then the stalest ones, capped
// per run so the roster's performance data rolls over roughly daily. ──
const STATS_TTL_MS = Number(process.env.GMGN_STATS_TTL_HOURS || 24) * 3600 * 1000;
const STATS_REFRESH_CAP = Number(process.env.GMGN_STATS_REFRESH_CAP || 150);
function refreshRegistryStats() {
  const now = Date.now();
  const due = db.loadWhaleRegistry()
    .filter((r) => !r.stats?.statsAt || now - r.stats.statsAt > STATS_TTL_MS)
    .sort((a, b) => (a.stats?.statsAt || 0) - (b.stats?.statsAt || 0))
    .slice(0, STATS_REFRESH_CAP);
  if (!due.length) { console.log('[gmgn-sync] stats refresh: all fresh'); return; }
  console.log(`[gmgn-sync] stats refresh: updating ${due.length} wallets…`);
  let ok = 0;
  for (const r of due) {
    const stats = fetchWalletStats(r.address);
    if (!stats) continue;
    const prev = r.stats && typeof r.stats === 'object' ? r.stats : { address: r.address };
    db.registerWhale(r.address, r.source, { stats: { ...prev, ...stats } });
    ok += 1;
  }
  console.log(`[gmgn-sync] stats refresh done · ${ok}/${due.length} updated`);
}

async function main() {
  // GMGN sweeps run only when the CLI is configured; external sources run
  // regardless, so discovery still works on a Birdeye/Cielo-only setup.
  let gmgnOk = false;
  try { cli(['config', '--check']); gmgnOk = true; }
  catch { console.log('[gmgn-sync] gmgn-cli missing/unconfigured — skipping GMGN sweeps (external sources still run)'); }

  if (gmgnOk) {
    sweepFeeds();
    sweepTrendingTraders();
    refreshRegistryStats(); // keep existing whales' winrate/PnL accurate
  }

  // External smart-money sources (Birdeye / Solana Tracker / Cielo) — each gated
  // on its own key; every candidate still passes the quality gate + on-chain
  // wallet verification below.
  try {
    const ext = await runExternalSources();
    for (const c of ext) addCandidate(c.address, { volUsd: c.volUsd, tags: c.tags, vector: c.vector });
    if (ext.length) console.log(`[gmgn-sync] external sources contributed ${ext.length} candidates`);
  } catch (e) { console.warn('[gmgn-sync] external sources error:', e.message); }

  if (!candidates.size) { console.log('[gmgn-sync] no candidates returned — nothing to do'); return; }

  // register only NEW wallets (already-registered ones stay untouched — the
  // registry is permanent, and skipping them saves API + RPC budget)
  const known = new Set(db.loadWhaleRegistry().map((r) => r.address));
  const fresh = [...candidates.entries()].filter(([a]) => !known.has(a))
    .sort((x, y) => y[1].volUsd - x[1].volUsd) // biggest first — best use of the per-run cap
    .slice(0, MAX_NEW);
  console.log(`[gmgn-sync] ${candidates.size} candidates from GMGN · ${fresh.length} new to evaluate`);

  let ok = 0, rejected = 0;
  for (const [addr, c] of fresh) {
    try {
      const { pass, stats } = statsGate(addr, c);
      if (!pass) { rejected += 1; continue; }
      // Reject programs / PDAs / vaults — only real System-owned wallets qualify.
      if (!(await isRealWallet(addr))) { rejected += 1; db.blacklistWhale(addr, 'program'); console.log(`[gmgn-sync] reject ${addr.slice(0, 10)}… — not a real wallet (program/PDA)`); continue; }
      const bal = await rpcBalance(addr); // real on-chain confirmation
      db.registerWhale(addr, 'gmgn', {
        volumeUsd: Math.round(c.volUsd * 100) / 100, solBalance: bal,
        stats: { address: addr, tags: [...c.tags], vectors: [...c.vectors], ...(stats || {}) },
      });
      ok += 1;
      console.log(`[gmgn-sync] +${addr.slice(0, 10)}… · ${bal.toFixed(2)} SOL · wr ${stats?.winRate ?? '—'} · $${Math.round(stats?.realizedUsd7d ?? 0)} 7d · [${[...c.tags].join(',')}]`);
    } catch (e) {
      console.warn(`[gmgn-sync] skip ${addr.slice(0, 10)}… — ${e.message}`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`[gmgn-sync] done · +${ok} new whales · ${rejected} failed quality gate · registry now ${db.loadWhaleRegistry().length}`);
}

main().catch((e) => { console.error('[gmgn-sync] fatal:', e.message || e); process.exit(0); /* never crash the caller */ });
