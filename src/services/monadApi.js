const EXPLORER = 'https://testnet.monadexplorer.com';
const API_BASE = '/monad-api';

export const EXPLORER_TX_URL = (hash) => `${EXPLORER}/tx/${hash}`;
export const EXPLORER_ADDR_URL = (addr) => `${EXPLORER}/address/${addr}`;

const TAG_POOLS = [
  ['Whale', 'Alpha', 'Pro'],
  ['Degen', 'Sniper', 'Fast'],
  ['Safe', 'Trend', 'Momentum'],
  ['Early', 'LowCap', 'Fresh'],
  ['Alpha', 'Breakout', 'Safe'],
  ['Degen', 'Momentum', 'Early'],
];
const SENTIMENTS = ['bullish', 'bullish', 'neutral', 'bullish', 'bearish', 'bullish'];

function weiToMon(wei) {
  const val = parseFloat(wei || '0') / 1e18;
  if (val === 0) return '0';
  if (val >= 1000) return val.toFixed(0);
  if (val >= 1) return val.toFixed(2);
  return val.toFixed(4);
}

function generateSparkline(seed) {
  const pts = [];
  let val = 50 + (seed % 30);
  for (let i = 0; i < 10; i++) {
    val += ((seed * (i + 1) * 13) % 20) - 9;
    pts.push(Math.max(10, Math.min(90, val)));
  }
  return pts;
}

function sparklineFromValues(vals) {
  if (!vals?.length) return null;
  const max = Math.max(...vals, 0.0001);
  const normalized = vals.map(v => Math.min(90, Math.max(10, (v / max) * 80 + 10)));
  // pad to 10 points
  while (normalized.length < 10) normalized.unshift(normalized[0] ?? 50);
  return normalized.slice(-10);
}

function deriveActionText(lastTx, address) {
  if (!lastTx) return 'ACTIVE ON MONAD';
  const method = (lastTx.method || '').toLowerCase();
  const isContract = lastTx.to?.is_contract;
  const toName = lastTx.to?.name;
  const valMon = parseFloat(lastTx.value || '0') / 1e18;
  const isSender = lastTx.from?.hash?.toLowerCase() === address?.toLowerCase();

  if (method.includes('swap')) {
    return `SWAPPING ${valMon > 0 ? valMon.toFixed(3) + ' MON' : 'TOKENS'}`;
  }
  if (method === 'transfer' || (lastTx.tx_types || []).includes('token_transfer')) {
    return `MOVING TOKENS ON MONAD`;
  }
  if (isContract && toName) {
    return `USING ${toName.toUpperCase().slice(0, 14)}`;
  }
  if (isContract) {
    return `CALLING CONTRACT`;
  }
  if (valMon > 0 && isSender) {
    return `SENDING ${valMon.toFixed(4)} MON`;
  }
  if (valMon > 0) {
    return `RECEIVED ${valMon.toFixed(4)} MON`;
  }
  return 'ACTIVE ON MONAD';
}

function mapAccountToTrader(acc, index) {
  const balanceRaw = acc.balance || acc.coin_balance || '0';
  const balanceMon = weiToMon(balanceRaw);
  const balNum = parseFloat(balanceMon);
  const txCount = parseInt(acc.txcount || acc.transactions_count || 0, 10);
  const winRate = Math.min(96, 52 + (txCount % 45));
  const pnl = Math.floor(balNum * 0.012 * (1 + txCount / 80) + txCount * 5);
  const tier =
    balNum > 100000 ? 'whale'
    : balNum > 10000 ? 'smart_money'
    : balNum > 1000  ? 'pro'
    : txCount > 200  ? 'degen'
    : 'fresh';

  return {
    id: index + 1,
    address: acc.address || acc.hash,
    balanceMon,
    winRate,
    profit: `+$${pnl.toLocaleString()}`,
    actionText: acc.actionText ?? `${balanceMon} MON`,
    tokenSymbol: acc.tokenSymbol ?? 'MON',
    tradeSize: balNum,
    txCount,
    sentiment: SENTIMENTS[index % SENTIMENTS.length],
    confidence: Math.min(98, 55 + (txCount % 43)),
    tags: TAG_POOLS[index % TAG_POOLS.length],
    isPremium: false,
    tier,
    tradeCount: txCount,
    volume24h: acc.volume24h ?? null,
    sparkline: acc.sparkline ?? generateSparkline(index * 17 + txCount),
    lastTxHash: acc.lastTxHash ?? null,
    lastTxBlock: acc.lastTxBlock ?? null,
    lastTxMethod: acc.lastTxMethod ?? null,
    isLive: true,
  };
}

async function fetchJson(url, timeout = 7000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Enrich a single trader with their last transactions (runs in parallel for all)
async function enrichTrader(trader) {
  try {
    const data = await fetchJson(
      `${API_BASE}/api/v2/addresses/${trader.address}/transactions?limit=5&filter=validated`,
      5000
    );
    const txns = (data.items || []).filter(Boolean);
    if (!txns.length) return trader;

    const lastTx = txns[0];
    const totalVolMon = txns.reduce((s, tx) => s + parseFloat(tx.value || '0') / 1e18, 0);
    const sparkVals = txns.map(tx => parseFloat(tx.value || '0') / 1e18);

    return {
      ...trader,
      actionText: deriveActionText(lastTx, trader.address),
      lastTxHash: lastTx.hash,
      lastTxBlock: lastTx.block,
      lastTxMethod: lastTx.method || null,
      volume24h: totalVolMon > 0 ? `${totalVolMon.toFixed(3)} MON` : null,
      sparkline: sparklineFromValues(sparkVals) ?? trader.sparkline,
      tokenSymbol:
        lastTx.tx_types?.includes('token_transfer') ? 'MON'
        : trader.tokenSymbol,
    };
  } catch {
    return trader;
  }
}

// Strategy 1: listaccounts
async function tryListAccounts() {
  const data = await fetchJson(`${API_BASE}/api?module=account&action=listaccounts&limit=20`);
  if (data.status !== '1' || !Array.isArray(data.result) || !data.result.length) throw new Error('empty');
  return data.result.slice(0, 12).map(mapAccountToTrader);
}

// Strategy 2: recent validated transactions → unique senders
async function tryFromTransactions() {
  const data = await fetchJson(`${API_BASE}/api/v2/transactions?filter=validated&limit=50`);
  const txns = data.items || [];
  if (!txns.length) throw new Error('empty');

  const seen = new Map();
  for (const tx of txns) {
    const from = tx.from?.hash?.toLowerCase();
    if (!from || seen.has(from)) continue;
    seen.set(from, {
      address: from,
      balance: tx.value || '0',
      txcount: (tx.nonce != null ? tx.nonce + 1 : 10),
    });
    if (seen.size >= 12) break;
  }
  if (!seen.size) throw new Error('empty');
  return [...seen.values()].map(mapAccountToTrader);
}

export async function fetchTopTraders() {
  let traders = null;

  for (const fn of [tryListAccounts, tryFromTransactions]) {
    try {
      const result = await fn();
      if (result?.length) { traders = result; break; }
    } catch (_) { /* try next */ }
  }

  if (!traders?.length) return { traders: null, isLive: false };

  // Enrich top 8 in parallel with real last-tx data
  const top = traders.slice(0, 8);
  const rest = traders.slice(8);
  const enriched = await Promise.all(top.map(enrichTrader));

  return { traders: [...enriched, ...rest], isLive: true };
}

export async function fetchMonadStats() {
  try {
    const data = await fetchJson(`${API_BASE}/api/v2/stats`, 5000);
    return {
      totalTxns: data.total_transactions || null,
      totalBlocks: data.total_blocks || null,
      avgBlockTime: data.average_block_time || null,
    };
  } catch {
    return null;
  }
}
