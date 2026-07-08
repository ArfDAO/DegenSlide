/**
 * Wallet info for the Watchlist — Monad MAINNET.
 *
 * Mainnet has no keyless Blockscout API, so this reads from the on-chain whale
 * indexer (real balance via RPC + real swaps it has observed for the address).
 * Values are mapped into the legacy shape the Watchlist UI consumes.
 */
import { EXPLORER_ADDR_URL, EXPLORER_TX_URL } from '../config/chain.js';
import { fetchAddressInfo } from './indexerApi.js';

export { EXPLORER_ADDR_URL, EXPLORER_TX_URL };

export async function fetchWalletInfo(address) {
  const info = await fetchAddressInfo(address);
  if (!info) return null;
  return {
    coin_balance: info.balanceMon != null ? BigInt(Math.round(info.balanceMon * 1e9)) * 10n ** 9n + '' : null,
    transactions_count: info.aggregate?.trades ?? null,
  };
}

export async function fetchWalletTxns(address, limit = 10) {
  const info = await fetchAddressInfo(address);
  if (!info?.trades?.length) return [];
  return info.trades.slice(0, limit).map((c) => ({
    hash: c.txHash,
    value: BigInt(Math.round(c.amountMon * 1e9)) * 10n ** 9n + '',
    method: 'Swap',
    tx_types: ['token_transfer'],
    timestamp: new Date(c.ts).toISOString(),
    status: 'ok',
    token: c.tokenSymbol,
    side: c.side,
  }));
}
