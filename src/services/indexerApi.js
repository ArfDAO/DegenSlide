/**
 * Frontend client for the on-chain whale indexer (backend/listener.js).
 * Every value returned here originates from real Monad mainnet swap logs.
 */
import { INDEXER_HTTP, INDEXER_WS } from '../config/chain.js';

async function getJson(path, timeout = 7000) {
  const res = await fetch(`${INDEXER_HTTP}${path}`, {
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
  return res.json();
}

// Map a raw indexer card to the shape the UI expects.
export function toTraderCard(raw) {
  // Deck identity is the GROUP (whale + token + side): repeat buys of the same
  // token by the same whale are one card. A live WS frame is a single leg of
  // that group; the backend snapshot is pre-aggregated. We normalise both to the
  // same shape (buyCount + legs) so the merge in App.jsx is uniform.
  const groupId = raw.groupId || `${raw.trader}:${raw.tokenAddress}:${raw.side}`;
  const legs = raw.legs && raw.legs.length
    ? raw.legs
    : [{ txHash: raw.txHash, amountUsd: raw.amountUsd, amountMon: raw.amountMon, tokenAmount: raw.tokenAmount, ts: raw.ts, blockNumber: raw.blockNumber }];
  return {
    id: groupId,                    // deck key = the group, not the tx
    groupId,
    buyCount: raw.buyCount || 1,
    legs,
    txHash: raw.txHash,
    address: raw.trader,
    side: raw.side,                 // 'BUY' | 'SELL'
    dex: raw.dex,                   // 'PancakeV3' | 'UniswapV3'
    poolAddress: raw.poolAddress,
    tokenAddress: raw.tokenAddress,
    tokenSymbol: raw.tokenSymbol,
    tokenDecimals: raw.tokenDecimals,
    feeTier: raw.feeTier,
    amountMon: raw.amountMon,
    amountUsd: raw.amountUsd,
    tokenAmount: raw.tokenAmount,
    quoteSymbol: raw.quoteSymbol,
    liquidityUsd: raw.liquidityUsd,
    copyable: raw.copyable !== false,
    isStable: raw.isStable,
    isRegisteredWhale: raw.isRegisteredWhale || false,
    traderScore: raw.traderScore || null,   // realized-PnL profitability score
    ts: raw.ts,
    blockNumber: raw.blockNumber,
    isLive: true,
  };
}

// Collapse repeat buys (same whale · same token · same side) into one card,
// client-side. The backend already aggregates its /whales response, but this
// makes the deck correct even against a backend that hasn't been redeployed yet
// (it would otherwise return one card per trade → duplicate group ids + an
// inflated signal count). Idempotent: re-aggregating already-aggregated cards
// (one per group, each carrying its own legs) yields the same result.
export function aggregateCards(cards) {
  const groups = new Map();
  for (const c of cards) {
    const gid = c.groupId || c.id;
    let g = groups.get(gid);
    if (!g) { g = { ...c, id: gid, groupId: gid, amountUsd: 0, amountMon: 0, tokenAmount: 0, legs: [], _txs: new Set() }; groups.set(gid, g); }
    for (const leg of (c.legs && c.legs.length ? c.legs : [{ txHash: c.txHash, amountUsd: c.amountUsd, amountMon: c.amountMon, tokenAmount: c.tokenAmount, ts: c.ts, blockNumber: c.blockNumber }])) {
      const k = leg.txHash || `${leg.ts}:${leg.amountUsd}`;
      if (g._txs.has(k)) continue; // same tx seen twice (backend + client overlap)
      g._txs.add(k);
      g.legs.push(leg);
      g.amountUsd += leg.amountUsd || 0;
      g.amountMon += leg.amountMon || 0;
      g.tokenAmount += leg.tokenAmount || 0;
    }
  }
  const out = [...groups.values()];
  for (const g of out) { g.buyCount = g.legs.length; g.legs.sort((a, b) => (b.ts || 0) - (a.ts || 0)); g.ts = g.legs[0]?.ts ?? g.ts; delete g._txs; }
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}

export async function fetchWhaleDeck(limit = 40) {
  try {
    const { whales } = await getJson(`/whales?limit=${limit}`);
    return aggregateCards((whales || []).map(toTraderCard));
  } catch {
    return [];
  }
}

export async function fetchWhaleLeaderboard() {
  try {
    const { traders } = await getJson('/leaderboard');
    return traders || [];
  } catch {
    return [];
  }
}

export async function fetchAddressInfo(address) {
  try {
    return await getJson(`/address/${address}`);
  } catch {
    return null;
  }
}

export async function indexerHealth() {
  try {
    return await getJson('/health', 4000);
  } catch {
    return null;
  }
}

/**
 * Open a live whale feed. onCard(card) fires for each new whale trade.
 * Returns a cleanup function. Auto-reconnects on drop.
 */
export function openWhaleFeed(onCard) {
  let ws = null;
  let closed = false;
  let retry = null;

  const connect = () => {
    if (closed) return;
    try {
      ws = new WebSocket(INDEXER_WS);
    } catch {
      retry = setTimeout(connect, 3000);
      return;
    }
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'NEW_TRADE' && msg.data) onCard(toTraderCard(msg.data));
      } catch { /* ignore malformed frame */ }
    };
    ws.onclose = () => {
      if (!closed) retry = setTimeout(connect, 3000);
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  };

  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    try { ws?.close(); } catch {}
  };
}
