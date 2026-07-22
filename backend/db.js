/**
 * SQLite persistence for the whale indexer.
 *
 * Durable, accumulating store so realized-PnL scores, trader aggregates and the
 * deck survive restarts and grow over time (the in-memory Maps reset on restart).
 *
 * Every row originates from a real on-chain swap — no fabricated data.
 */
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(process.env.WHALE_DB || path.join(__dirname, 'whales.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY, trader TEXT, side TEXT, dex TEXT, pool TEXT,
  token TEXT, tokenSymbol TEXT, tokenDecimals INTEGER, feeTier INTEGER,
  amountMon REAL, amountUsd REAL, tokenAmount REAL, quoteSymbol TEXT,
  copyable INTEGER, liquidityUsd REAL, isStable INTEGER, block INTEGER, ts INTEGER
);
CREATE INDEX IF NOT EXISTS idx_trades_trader ON trades(trader);
CREATE INDEX IF NOT EXISTS idx_trades_ts ON trades(ts);
CREATE TABLE IF NOT EXISTS traders (
  address TEXT PRIMARY KEY, trades INTEGER, buys INTEGER, sells INTEGER,
  volumeMon REAL, netMon REAL, realizedMon REAL, closedTokens INTEGER,
  winTokens INTEGER, activeTokens INTEGER, lastSeen INTEGER, lastToken TEXT
);
CREATE TABLE IF NOT EXISTS positions (
  trader TEXT, token TEXT, boughtTok REAL, spentMon REAL, soldTok REAL,
  recvMon REAL, realizedMon REAL, PRIMARY KEY (trader, token)
);
CREATE TABLE IF NOT EXISTS whale_registry (
  address TEXT PRIMARY KEY,
  source TEXT,            -- 'scan' | 'live' | 'gmgn' | 'manual'
  firstSeen INTEGER,      -- ms epoch, set once, never changes
  lastSeen INTEGER,       -- ms epoch, refreshed on every re-sighting
  volumeUsd REAL,
  solBalance REAL,
  stats TEXT              -- JSON blob of the richest stats we have for this wallet
);
CREATE TABLE IF NOT EXISTS whale_blacklist (
  address TEXT PRIMARY KEY,
  reason TEXT,           -- 'contract' | 'program' | 'rug' | 'manual' | ...
  ts INTEGER             -- ms epoch when banned
);
`);

const insTrade = db.prepare(`INSERT OR IGNORE INTO trades
 (id,trader,side,dex,pool,token,tokenSymbol,tokenDecimals,feeTier,amountMon,amountUsd,tokenAmount,quoteSymbol,copyable,liquidityUsd,isStable,block,ts)
 VALUES (@id,@trader,@side,@dex,@pool,@token,@tokenSymbol,@tokenDecimals,@feeTier,@amountMon,@amountUsd,@tokenAmount,@quoteSymbol,@copyable,@liquidityUsd,@isStable,@block,@ts)`);
const upTrader = db.prepare(`INSERT INTO traders
 (address,trades,buys,sells,volumeMon,netMon,realizedMon,closedTokens,winTokens,activeTokens,lastSeen,lastToken)
 VALUES (@address,@trades,@buys,@sells,@volumeMon,@netMon,@realizedMon,@closedTokens,@winTokens,@activeTokens,@lastSeen,@lastToken)
 ON CONFLICT(address) DO UPDATE SET trades=@trades,buys=@buys,sells=@sells,volumeMon=@volumeMon,netMon=@netMon,
   realizedMon=@realizedMon,closedTokens=@closedTokens,winTokens=@winTokens,activeTokens=@activeTokens,
   lastSeen=@lastSeen,lastToken=@lastToken`);
const upPos = db.prepare(`INSERT INTO positions (trader,token,boughtTok,spentMon,soldTok,recvMon,realizedMon)
 VALUES (@trader,@token,@boughtTok,@spentMon,@soldTok,@recvMon,@realizedMon)
 ON CONFLICT(trader,token) DO UPDATE SET boughtTok=@boughtTok,spentMon=@spentMon,soldTok=@soldTok,recvMon=@recvMon,realizedMon=@realizedMon`);

// Returns true if this trade was newly inserted (false = already seen → don't double-count).
export function persistTrade(card) {
  const info = insTrade.run({
    id: card.id, trader: card.trader, side: card.side, dex: card.dex, pool: card.poolAddress,
    token: card.tokenAddress, tokenSymbol: card.tokenSymbol, tokenDecimals: card.tokenDecimals ?? null,
    feeTier: card.feeTier ?? null, amountMon: card.amountMon, amountUsd: card.amountUsd ?? null,
    tokenAmount: card.tokenAmount ?? null, quoteSymbol: card.quoteSymbol ?? null,
    copyable: card.copyable ? 1 : 0, liquidityUsd: card.liquidityUsd ?? null,
    isStable: card.isStable ? 1 : 0, block: card.blockNumber ?? null, ts: card.ts,
  });
  return info.changes > 0;
}
export function persistTrader(agg) {
  upTrader.run({
    address: agg.address, trades: agg.trades, buys: agg.buys, sells: agg.sells,
    volumeMon: agg.volumeMon, netMon: agg.netMon, realizedMon: agg.realizedMon ?? 0,
    closedTokens: agg.closedTokens ?? 0, winTokens: agg.winTokens ?? 0, activeTokens: agg.activeTokens ?? 0,
    lastSeen: agg.lastSeen, lastToken: agg.lastToken ?? null,
  });
}
export function persistPosition(trader, token, pos) {
  upPos.run({ trader, token, boughtTok: pos.boughtTok, spentMon: pos.spentMon, soldTok: pos.soldTok, recvMon: pos.recvMon, realizedMon: pos.realizedMon });
}

export function loadTraders() {
  const map = new Map();
  for (const r of db.prepare('SELECT * FROM traders').all()) map.set(r.address, r);
  return map;
}
export function loadPositions() {
  const map = new Map();
  for (const r of db.prepare('SELECT * FROM positions').all()) {
    if (!map.has(r.trader)) map.set(r.trader, new Map());
    map.get(r.trader).set(r.token, { boughtTok: r.boughtTok, spentMon: r.spentMon, soldTok: r.soldTok, recvMon: r.recvMon, realizedMon: r.realizedMon });
  }
  return map;
}
export function loadRecentTrades(limit = 240) {
  return db.prepare('SELECT * FROM trades ORDER BY ts DESC LIMIT ?').all(limit);
}
export function tradesByAddress(addr, limit = 30) {
  return db.prepare('SELECT * FROM trades WHERE trader=? ORDER BY ts DESC LIMIT ?').all(addr, limit);
}
// ── Whale registry: every wallet ever confirmed as a whale, forever. ──
// Rows are only inserted or enriched, NEVER deleted — a rescan that misses a
// wallet must not erase it (the global app's roster has to be durable).
const upWhale = db.prepare(`INSERT INTO whale_registry (address,source,firstSeen,lastSeen,volumeUsd,solBalance,stats)
 VALUES (@address,@source,@now,@now,@volumeUsd,@solBalance,@stats)
 ON CONFLICT(address) DO UPDATE SET
   lastSeen=@now,
   volumeUsd=MAX(COALESCE(volumeUsd,0), COALESCE(@volumeUsd,0)),
   solBalance=COALESCE(@solBalance, solBalance),
   stats=COALESCE(@stats, stats)`);

export function registerWhale(address, source, { volumeUsd = null, solBalance = null, stats = null } = {}) {
  // A banned wallet (contract / program / rug) must never be re-added by a later
  // discovery pass — the blacklist is the durable veto over the append-only registry.
  if (blacklistHas.get(address)) return false;
  upWhale.run({
    address: address, source, now: Date.now(),
    volumeUsd, solBalance,
    stats: stats ? JSON.stringify(stats) : null,
  });
  return true;
}
export function loadWhaleRegistry() {
  return db.prepare('SELECT * FROM whale_registry ORDER BY volumeUsd DESC').all().map((r) => ({
    ...r, stats: r.stats ? JSON.parse(r.stats) : null,
  }));
}

// ── Whale blacklist: wallets that turned out NOT to be real whale EOAs
// (protocol/router/AA contracts on EVM, programs/PDAs on Solana) or rugged
// projects. Banning removes the row from the registry AND vetoes any future
// re-registration, so a wallet only has to be caught once. ──
const insBan = db.prepare('INSERT OR REPLACE INTO whale_blacklist (address,reason,ts) VALUES (?,?,?)');
const delWhale = db.prepare('DELETE FROM whale_registry WHERE address=?');
const blacklistHas = db.prepare('SELECT 1 FROM whale_blacklist WHERE address=?').pluck();

export function blacklistWhale(address, reason = 'manual') {
  insBan.run(address, reason, Date.now());
  const info = delWhale.run(address);
  return info.changes > 0; // true = a registry row was actually removed
}
export function isBlacklisted(address) {
  return !!blacklistHas.get(address);
}
// Soft removal: drop a wallet from the roster WITHOUT a permanent veto — used
// for "not active enough" / "no gas" wallets that could legitimately return as
// whales later (unlike contracts/programs, which get blacklistWhale). Discovery
// is free to re-add them if they resume real whale-sized trading.
export function removeWhale(address) {
  return delWhale.run(address).changes > 0;
}
export function loadBlacklist() {
  return db.prepare('SELECT * FROM whale_blacklist').all();
}

export function stats() {
  return {
    dbTrades: db.prepare('SELECT COUNT(*) c FROM trades').get().c,
    dbTraders: db.prepare('SELECT COUNT(*) c FROM traders').get().c,
    dbRegistry: db.prepare('SELECT COUNT(*) c FROM whale_registry').get().c,
    dbBlacklist: db.prepare('SELECT COUNT(*) c FROM whale_blacklist').get().c,
  };
}
