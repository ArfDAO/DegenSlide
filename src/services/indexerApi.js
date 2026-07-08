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
  return {
    id: raw.id,
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

export async function fetchWhaleDeck(limit = 40) {
  try {
    const { whales } = await getJson(`/whales?limit=${limit}`);
    return (whales || []).map(toTraderCard);
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
