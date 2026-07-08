/**
 * Wallet + copy-trade execution on Solana MAINNET.
 *
 * Same call surface as ./wallet.js (the EVM/MetaMask implementation) so the
 * app can swap implementations per network via ./activeWallet.js:
 *   connectWallet / getConnectedAccount / getMonBalance (native = SOL here)
 *   copyBuy (SOL -> whale's token) / sellToken (token -> SOL)
 *
 * Execution path is 100% real: Phantom wallet signs a live Jupiter aggregator
 * transaction (lite-api.jup.ag). No mock data, no simulated fills.
 */
import { VersionedTransaction } from '@solana/web3.js';
import { CHAINS, DEFAULT_SLIPPAGE_BPS } from '../config/chain.js';

const SOL = CHAINS.solana;
const RPC_URL = SOL.rpcUrl;
const JUP = SOL.jupiterApi;
const WSOL = SOL.nativeToken; // So1111...1112 — Jupiter treats it as native SOL with wrapAndUnwrapSol
// Fee headroom: tx fee + priority fee + ATA rent (~0.002 SOL) for first-time tokens
const FEE_BUFFER_SOL = 0.01;

export const WALLET_NAME = 'Phantom';
export const WALLET_INSTALL_URL = 'https://phantom.com/download';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function provider() {
  if (typeof window === 'undefined') return null;
  const p = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null);
  return p || null;
}

export function isWalletAvailable() {
  return !!provider();
}

// ── raw JSON-RPC to Solana mainnet (read-only queries) ──
let rpcId = 0;
async function rpc(method, params = []) {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message || 'RPC_ERROR');
  return j.result;
}

export async function connectWallet() {
  const p = provider();
  if (!p) throw new Error('NO_METAMASK'); // same sentinel the app already handles as "no wallet"
  const resp = await p.connect();
  const pk = (resp?.publicKey ?? p.publicKey)?.toString();
  if (!pk) throw new Error('NO_ACCOUNTS');
  return pk; // base58 is case-sensitive — never lowercase
}

export async function getConnectedAccount() {
  const p = provider();
  if (!p) return null;
  try {
    const resp = await p.connect({ onlyIfTrusted: true });
    return (resp?.publicKey ?? p.publicKey)?.toString() || null;
  } catch {
    return null; // not previously approved — user must click Connect
  }
}

export async function disconnectWallet() {
  try { await provider()?.disconnect(); } catch { /* already disconnected */ }
}

/** Subscribe to wallet account changes. Returns an unsubscribe fn. */
export function onAccountsChanged(cb) {
  const p = provider();
  if (!p) return () => {};
  const onChange = (pk) => cb(pk ? [pk.toString()] : []);
  const onDisc = () => cb([]);
  p.on('accountChanged', onChange);
  p.on('disconnect', onDisc);
  return () => {
    try { p.removeListener?.('accountChanged', onChange); p.removeListener?.('disconnect', onDisc); } catch {}
  };
}

/** Native balance in SOL (name kept for cross-chain interface parity). */
export async function getMonBalance(address) {
  try {
    const r = await rpc('getBalance', [address]);
    return (r?.value ?? 0) / 1e9;
  } catch {
    return null;
  }
}

// ── Jupiter aggregator (live quotes + executable transactions) ──

async function jupQuote(inputMint, outputMint, amountRaw, slippageBps) {
  const url = `${JUP}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amountRaw}&slippageBps=${slippageBps}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  const q = await res.json();
  if (!res.ok || q.error || !q.outAmount) return null;
  return q;
}

async function jupSwapTx(quoteResponse, userPublicKey) {
  const res = await fetch(`${JUP}/swap`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true }),
  });
  const j = await res.json();
  if (!res.ok || !j.swapTransaction) throw new Error(j.error || 'SWAP_BUILD_FAILED');
  return j.swapTransaction; // base64 VersionedTransaction
}

async function signAndSend(swapTxB64) {
  const p = provider();
  if (!p) throw new Error('NO_METAMASK');
  const bytes = Uint8Array.from(atob(swapTxB64), (c) => c.charCodeAt(0));
  const tx = VersionedTransaction.deserialize(bytes);
  const { signature } = await p.signAndSendTransaction(tx);
  return signature;
}

/**
 * Wait until the signature is confirmed ON-CHAIN. A signed-and-sent tx is not
 * a trade — only a confirmed one is. Throws TX_FAILED if it landed with an
 * error, TX_TIMEOUT if it never confirmed.
 */
async function confirmOnChain(signature, timeoutMs = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await rpc('getSignatureStatuses', [[signature], { searchTransactionHistory: true }]);
      const st = r?.value?.[0];
      if (st) {
        if (st.err) throw Object.assign(new Error('TX_FAILED'), { signature });
        if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') return st;
      }
    } catch (e) {
      if (e.message === 'TX_FAILED') throw e; // real on-chain failure — surface it
      /* transient RPC error — keep polling */
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw Object.assign(new Error('TX_TIMEOUT'), { signature });
}

/** Real token amount the owner received/spent in a confirmed tx (raw units). */
async function actualTokenDelta(signature, owner, mint) {
  try {
    const tx = await rpc('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
    if (!tx?.meta) return null;
    const sum = (arr) => (arr || [])
      .filter((b) => b.owner === owner && b.mint === mint)
      .reduce((s, b) => s + BigInt(b.uiTokenAmount?.amount || '0'), 0n);
    const delta = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
    return delta > 0n ? delta.toString() : null;
  } catch {
    return null;
  }
}

function dexLabel(quote) {
  const labels = [...new Set((quote.routePlan || []).map((r) => r.swapInfo?.label).filter(Boolean))];
  return labels.length ? labels.join('+') : 'Jupiter';
}

async function mintDecimals(mint) {
  try {
    const r = await rpc('getTokenSupply', [mint]);
    return r?.value?.decimals ?? null;
  } catch {
    return null;
  }
}

/**
 * Copy a whale's buy: SOL -> tokenMint via Jupiter, signed by Phantom.
 * Returns { hash, dex, fee, amountOutMin, expectedOut, decimals } — same shape
 * as the EVM copyBuy (plus decimals, which Solana can resolve on the fly).
 */
export async function copyBuy(from, tokenMint, amountSol, opts = {}) {
  if (!tokenMint || !BASE58.test(tokenMint)) throw new Error('NO_TOKEN_ADDRESS');
  const slippageBps = opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const lamports = Math.round(amountSol * 1e9);

  // Pre-flight: SOL pays the swap AND fees/rent — fail with clear numbers
  // instead of prompting a doomed Phantom confirmation. Retry once so a
  // transient RPC hiccup can't skip the check.
  let balance = await getMonBalance(from);
  if (balance == null) { await new Promise((r) => setTimeout(r, 800)); balance = await getMonBalance(from); }
  if (balance == null) throw new Error('BALANCE_UNKNOWN'); // can't verify funds — refuse to prompt a blind trade
  if (balance < amountSol + FEE_BUFFER_SOL) {
    throw Object.assign(new Error('INSUFFICIENT_FUNDS'), {
      needMon: amountSol + FEE_BUFFER_SOL, haveMon: balance, gasMon: FEE_BUFFER_SOL,
    });
  }

  const quote = await jupQuote(WSOL, tokenMint, lamports, slippageBps);
  if (!quote) throw new Error('NO_LIQUIDITY');

  const [swapTx, decimals] = await Promise.all([jupSwapTx(quote, from), mintDecimals(tokenMint)]);
  const hash = await signAndSend(swapTx);
  await confirmOnChain(hash); // throws if the swap failed on-chain — no fake fills
  // Position size = tokens actually received on-chain, not the quote's estimate
  const realOut = await actualTokenDelta(hash, from, tokenMint);
  return {
    hash,
    dex: dexLabel(quote),
    fee: null,
    amountOutMin: quote.otherAmountThreshold,
    expectedOut: realOut ?? quote.outAmount,
    decimals,
  };
}

/** SPL token balance for a wallet: { raw: BigInt, decimals }. */
export async function getTokenInfo(user, mint) {
  const r = await rpc('getTokenAccountsByOwner', [user, { mint }, { encoding: 'jsonParsed' }]);
  let raw = 0n;
  let decimals = 9;
  for (const acc of r?.value || []) {
    const t = acc.account?.data?.parsed?.info?.tokenAmount;
    if (!t) continue;
    raw += BigInt(t.amount || '0');
    decimals = t.decimals ?? decimals;
  }
  return { raw, decimals };
}

/**
 * Sell a token back to native SOL (closes/reduces a copied position).
 * opts: { slippageBps, amountRaw } — amountRaw defaults to full balance.
 * Returns { hash, dex, fee, amountIn, expectedOut, amountOutMin }.
 */
export async function sellToken(from, tokenMint, opts = {}) {
  if (!tokenMint || !BASE58.test(tokenMint)) throw new Error('NO_TOKEN_ADDRESS');
  const slippageBps = opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  const { raw: balance } = await getTokenInfo(from, tokenMint);
  if (balance <= 0n) throw new Error('NO_BALANCE');

  let amountIn = balance;
  if (opts.amountRaw) {
    try { const want = BigInt(opts.amountRaw); if (want > 0n && want < balance) amountIn = want; } catch { /* full balance */ }
  }

  const quote = await jupQuote(tokenMint, WSOL, amountIn.toString(), slippageBps);
  if (!quote) throw new Error('NO_LIQUIDITY');

  const swapTx = await jupSwapTx(quote, from);
  const hash = await signAndSend(swapTx);
  await confirmOnChain(hash); // position is only "closed" once the sell landed on-chain
  return {
    hash,
    dex: dexLabel(quote),
    fee: null,
    amountIn: amountIn.toString(),
    expectedOut: quote.outAmount,
    amountOutMin: quote.otherAmountThreshold,
  };
}
