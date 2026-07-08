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
export function stats() {
  return {
    dbTrades: db.prepare('SELECT COUNT(*) c FROM trades').get().c,
    dbTraders: db.prepare('SELECT COUNT(*) c FROM traders').get().c,
  };
}
