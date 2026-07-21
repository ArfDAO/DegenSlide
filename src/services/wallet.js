/**
 * Wallet + copy-trade execution on Monad MAINNET.
 *
 * "Copy" = replicate a whale's BUY: swap native MON -> the token the whale bought.
 * We quote both PancakeSwap v3 and Uniswap v3 with a balance-independent on-chain
 * eth_call (from = the WMON contract, which holds huge native balance), pick the
 * router with real liquidity + best output, and execute there with a real
 * amountOutMinimum. No mock data, no hardcoded prices, no silent fallbacks.
 */
import { MONAD_MAINNET, CONTRACTS, DEFAULT_SLIPPAGE_BPS, EXPLORER_URL } from '../config/chain.js';

export { EXPLORER_URL };

export function isMetaMaskAvailable() {
  return typeof window !== 'undefined' && typeof window.ethereum !== 'undefined';
}

// ── cross-chain wallet interface parity (see ./activeWallet.js) ──
export const WALLET_NAME = 'MetaMask';
export const WALLET_INSTALL_URL = 'https://metamask.io/download/';
export const isWalletAvailable = isMetaMaskAvailable;

export async function disconnectWallet() {
  /* MetaMask has no programmatic disconnect — the app just forgets the account */
}

/** Subscribe to account changes (a chain switch forces a clean reload). Returns unsubscribe. */
export function onAccountsChanged(cb) {
  if (!isMetaMaskAvailable()) return () => {};
  const onAccts = (accounts) => cb(accounts.map((a) => a.toLowerCase()));
  const onChain = () => window.location.reload();
  window.ethereum.on('accountsChanged', onAccts);
  window.ethereum.on('chainChanged', onChain);
  return () => {
    window.ethereum.removeListener('accountsChanged', onAccts);
    window.ethereum.removeListener('chainChanged', onChain);
  };
}

const mmCall = (method, params = []) => window.ethereum.request({ method, params });

// Read-only RPC straight to Monad — used for quotes so they don't depend on the
// user's wallet balance or MetaMask's eth_call quirks.
//
// A quote returning '0x' means "no output" and the caller reads it as no
// liquidity — so a TRANSIENT network/RPC blip must NOT be reported as '0x', or
// every route reads as NO_LIQUIDITY and the copy fails for a healthy token.
// We retry transient failures (network error, non-2xx, rate limit) a couple of
// times; only a real `execution reverted` (no pool at that fee) returns '0x'.
async function rpcEthCall(tx, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(MONAD_MAINNET.rpcUrls[0], {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [tx, 'latest'] }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { await sleep(250 * (i + 1)); continue; } // 429 / 5xx → retry
      const j = await res.json();
      if (j.error) {
        const msg = String(j.error.message || '').toLowerCase();
        // A genuine revert = no pool / no liquidity at this route → legitimate '0x'.
        if (msg.includes('revert') || msg.includes('execution')) return '0x';
        await sleep(250 * (i + 1)); continue; // transient node error → retry
      }
      return j.result || '0x';
    } catch {
      await sleep(250 * (i + 1)); // network error / timeout → retry
    }
  }
  return '0x';
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── hex / abi helpers ──
const strip = (h) => h.replace(/^0x/, '');
const pad32 = (hex) => strip(hex).padStart(64, '0').toLowerCase();
const addr32 = (a) => pad32(strip(a.toLowerCase()));
const hexBig = (b) => '0x' + b.toString(16);
const monToWei = (mon) => BigInt(Math.round(mon * 1e9)) * 10n ** 9n;

// Each route is a Uniswap-v3-style SwapRouter; they differ only by the
// exactInputSingle selector and whether the params struct carries a deadline.
const ROUTES = {
  PancakeV3: {
    router: CONTRACTS.PANCAKE_SWAP_ROUTER,
    selector: '0x414bf389', // exactInputSingle WITH deadline
    hasDeadline: true,
    feeTiers: [500, 2500, 10000, 100],
  },
  UniswapV3: {
    router: CONTRACTS.UNISWAP_SWAP_ROUTER_02,
    selector: '0x04e45aaf', // exactInputSingle WITHOUT deadline (SwapRouter02)
    hasDeadline: false,
    feeTiers: [500, 3000, 10000, 100],
  },
};

function encodeExactInputSingle(route, { tokenIn = CONTRACTS.WMON, tokenOut, fee, recipient, deadline, amountIn, amountOutMinimum }) {
  const body =
    addr32(tokenIn) +
    addr32(tokenOut) +
    pad32(hexBig(BigInt(fee))) +
    addr32(recipient) +
    (route.hasDeadline ? pad32(hexBig(BigInt(deadline))) : '') +
    pad32(hexBig(amountIn)) +
    pad32(hexBig(amountOutMinimum)) +
    pad32('0x0'); // sqrtPriceLimitX96 = 0
  return route.selector + body;
}

// ── ERC-20 + multicall(bytes[]) ABI encoding (swap + unwrapWETH9 in one tx) ──
const SEL_MULTICALL = '0xac9650d8';   // multicall(bytes[])
const SEL_UNWRAP = '0x49404b7c';      // unwrapWETH9(uint256,address)
const SEL_BALANCEOF = '0x70a08231';   // balanceOf(address)
const SEL_DECIMALS = '0x313ce567';    // decimals()
const SEL_ALLOWANCE = '0xdd62ed3e';   // allowance(address,address)
const SEL_APPROVE = '0x095ea7b3';     // approve(address,uint256)
const MAX_UINT = (1n << 256n) - 1n;

function padRight32(hex) {
  const h = strip(hex);
  const rem = h.length % 64;
  return rem === 0 ? h : h + '0'.repeat(64 - rem);
}
function encodeBytesArray(items) {
  const clean = items.map(strip);
  const elems = clean.map((h) => pad32(hexBig(BigInt(h.length / 2))) + padRight32(h));
  const offsets = [];
  let acc = items.length * 32; // offset words occupy the head
  for (let i = 0; i < items.length; i++) { offsets.push(pad32(hexBig(BigInt(acc)))); acc += elems[i].length / 2; }
  return pad32(hexBig(BigInt(items.length))) + offsets.join('') + elems.join('');
}
function encodeMulticall(items) {
  return SEL_MULTICALL + pad32(hexBig(32n)) + encodeBytesArray(items);
}



// Balance-independent quote: simulate the swap from the WMON contract (huge MON
// balance) so it never reverts for lack of funds. Returns amountOut (0n if no pool).
async function quoteRoute(route, tokenOut, amountInWei, fee, deadline) {
  const data = encodeExactInputSingle(route, {
    tokenOut, fee, recipient: CONTRACTS.WMON, deadline, amountIn: amountInWei, amountOutMinimum: 0n,
  });
  const tx = { from: CONTRACTS.WMON, to: route.router, value: hexBig(amountInWei), data };
  const res = await rpcEthCall(tx);
  if (!res || res === '0x') return 0n;
  try { return BigInt('0x' + strip(res).slice(0, 64)); } catch { return 0n; }
}

export async function connectWallet() {
  if (!isMetaMaskAvailable()) throw new Error('NO_METAMASK');
  const accounts = await mmCall('eth_requestAccounts');
  if (!accounts?.length) throw new Error('NO_ACCOUNTS');
  await ensureMonadMainnet();
  return accounts[0].toLowerCase();
}

/**
 * Sign a plain-text message with the external wallet (gasless, no tx).
 * Deterministic: the same account signing the same string always returns the
 * same signature — that property is what lets us derive a recoverable trading
 * wallet from it (see turboWallet.linkTurboWallet). Returns the 0x-hex signature.
 */
export async function signMessage(address, message) {
  if (!isMetaMaskAvailable()) throw new Error('NO_METAMASK');
  const hex = '0x' + Array.from(new TextEncoder().encode(message), (b) => b.toString(16).padStart(2, '0')).join('');
  return await mmCall('personal_sign', [hex, address.toLowerCase()]);
}

export async function ensureMonadMainnet() {
  try {
    await mmCall('wallet_switchEthereumChain', [{ chainId: MONAD_MAINNET.chainId }]);
  } catch (err) {
    if (err.code === 4902 || err.code === -32603) {
      await mmCall('wallet_addEthereumChain', [MONAD_MAINNET]);
    } else {
      throw err;
    }
  }
}

export async function getConnectedAccount() {
  if (!isMetaMaskAvailable()) return null;
  try {
    const accounts = await mmCall('eth_accounts');
    if (!accounts?.length) return null;
    const chainId = await mmCall('eth_chainId');
    if (chainId.toLowerCase() !== MONAD_MAINNET.chainId) return null;
    return accounts[0].toLowerCase();
  } catch {
    return null;
  }
}

export async function getMonBalance(address) {
  try {
    const wei = await mmCall('eth_getBalance', [address, 'latest']);
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return null;
  }
}

/**
 * Find the best (route, fee, amountOut) for MON -> tokenOut across both DEXes.
 * Probes the whale's own DEX + fee first.
 */
export async function bestCopyQuote(tokenOut, amountMon, opts = {}) {
  const amountInWei = monToWei(amountMon);
  const deadline = Math.floor(Date.now() / 1000) + 600;

  // order routes so the whale's DEX is tried first
  const order = opts.preferredDex && ROUTES[opts.preferredDex]
    ? [opts.preferredDex, ...Object.keys(ROUTES).filter((k) => k !== opts.preferredDex)]
    : Object.keys(ROUTES);

  let best = { routeKey: null, fee: null, amountOut: 0n, amountInWei, deadline };
  for (const routeKey of order) {
    const route = ROUTES[routeKey];
    const tiers = opts.preferredFee
      ? [opts.preferredFee, ...route.feeTiers.filter((f) => f !== opts.preferredFee)]
      : route.feeTiers;
    for (const fee of tiers) {
      const out = await quoteRoute(route, tokenOut, amountInWei, fee, deadline);
      if (out > best.amountOut) best = { routeKey, fee, amountOut: out, amountInWei, deadline };
    }
  }
  return best;
}

/**
 * Copy a whale's buy: MON -> tokenOut on the best available DEX.
 * Returns { hash, dex, fee, amountOutMin, expectedOut }.
 */
export async function copyBuy(from, tokenOut, amountMon, opts = {}) {
  if (!tokenOut || !/^0x[0-9a-fA-F]{40}$/.test(tokenOut)) throw new Error('NO_TOKEN_ADDRESS');
  await ensureMonadMainnet(); // every trade executes on Monad mainnet — never testnet
  const { routeKey, fee, amountOut, amountInWei: maxAmountInWei, deadline } = await bestCopyQuote(tokenOut, amountMon, opts);
  if (amountOut === 0n) throw Object.assign(new Error('NO_LIQUIDITY'), { details: 'No route found' });

  const balance = BigInt(await mmCall('eth_getBalance', [from, 'latest']));
  let amountInWei = maxAmountInWei;
  const GAS_BUFFER = 20000000000000000n; // 0.02 MON
  if (balance <= amountInWei + GAS_BUFFER) {
    if (balance > GAS_BUFFER) amountInWei = balance - GAS_BUFFER;
    else throw insufficient(amountInWei, balance, 0n);
  }

  const slippageBps = opts.slippageBps || 1000; // 10% default
  const amountOutMin = (amountOut * BigInt(10000 - slippageBps)) / 10000n;

  const route = ROUTES[routeKey];
  const data = encodeExactInputSingle(route, {
    tokenOut, fee, recipient: from, deadline, amountIn: amountInWei, amountOutMinimum: amountOutMin,
  });
  const tx = { from, to: route.router, value: hexBig(amountInWei), data };


  let gasLimit;
  try {
    gasLimit = BigInt(await mmCall('eth_estimateGas', [tx]));
  } catch (e) {
    const errStr = String(e?.message || '') + String(e?.cause?.message || '') + JSON.stringify(e?.cause?.data || {}) + JSON.stringify(e?.data || {}) + JSON.stringify(e || {});
    if (errStr.toLowerCase().includes('insufficient funds')) {
      throw insufficient(amountInWei, balance, 0n);
    }
    if (errStr.toLowerCase().includes('reserve balance')) {
      console.warn('[CopyTrade] Monad RPC reserve balance bug detected. Bypassing estimateGas with 800k gas limit.');
      gasLimit = 800000n;
    } else {
      console.error('[CopyTrade] EstimateGas Reverted. Tx:', tx, 'Error:', e);
      throw Object.assign(new Error('SWAP_REVERT'), { cause: e }); // slippage / pool issue
    }
  }
  
  const gasPrice = BigInt(await mmCall('eth_gasPrice'));
  const gasCost = gasLimit * gasPrice;
  if (balance < amountInWei + gasCost) {
    throw insufficient(amountInWei, balance, gasCost);
  }

  tx.gas = hexBig(gasLimit); // MUST provide gas to prevent MetaMask from re-estimating
  const hash = await mmCall('eth_sendTransaction', [tx]);
  // A sent tx is not a trade — only a mined, successful one is.
  const rec = await waitReceipt(hash);
  if (!rec) throw Object.assign(new Error('TX_TIMEOUT'), { hash });
  if (rec.status === '0x0') throw Object.assign(new Error('TX_FAILED'), { hash });
  return { hash, dex: routeKey, fee, amountOutMin: amountOutMin.toString(), expectedOut: amountOut.toString() };
}

function insufficient(valueWei, balanceWei, gasWei) {
  const need = Number(valueWei + gasWei) / 1e18;
  const have = Number(balanceWei) / 1e18;
  return Object.assign(new Error('INSUFFICIENT_FUNDS'), { needMon: need, haveMon: have, gasMon: Number(gasWei) / 1e18 });
}

// ── Signer-agnostic tx builders (used by the Turbo trading wallet, which signs
// locally with its own key instead of prompting MetaMask). Same routing,
// quoting and slippage math as the interactive path above. ──

/** Build an unsigned MON→token buy tx. Returns { tx:{to,value,data}, meta }. */
export async function buildBuyTx(from, tokenOut, amountMon, opts = {}) {
  if (!tokenOut || !/^0x[0-9a-fA-F]{40}$/.test(tokenOut)) throw new Error('NO_TOKEN_ADDRESS');
  const { routeKey, fee, amountOut, amountInWei, deadline } = await bestCopyQuote(tokenOut, amountMon, opts);
  if (amountOut === 0n) throw new Error('NO_LIQUIDITY');
  const slippageBps = opts.slippageBps || 1000;
  const amountOutMin = (amountOut * BigInt(10000 - slippageBps)) / 10000n;
  const route = ROUTES[routeKey];
  const data = encodeExactInputSingle(route, {
    tokenOut, fee, recipient: from, deadline, amountIn: amountInWei, amountOutMinimum: amountOutMin,
  });
  return {
    tx: { to: route.router, value: amountInWei, data },
    meta: { dex: routeKey, fee, expectedOut: amountOut.toString(), amountOutMin: amountOutMin.toString() },
  };
}

/**
 * Build an unsigned token→MON sell plan. Returns { approveTx|null, tx, meta }.
 * approveTx (if present) must be mined before tx.
 */
export async function buildSellPlan(from, tokenIn, opts = {}) {
  if (!tokenIn || !/^0x[0-9a-fA-F]{40}$/.test(tokenIn)) throw new Error('NO_TOKEN_ADDRESS');
  const slippageBps = opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const { raw: balance } = await getTokenInfo(from, tokenIn);
  if (balance <= 0n) throw new Error('NO_BALANCE');
  let amountIn = balance;
  if (opts.amountRaw) {
    try { const want = BigInt(opts.amountRaw); if (want > 0n && want < balance) amountIn = want; } catch { /* full balance */ }
  }
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const order = opts.preferredDex && ROUTES[opts.preferredDex]
    ? [opts.preferredDex, ...Object.keys(ROUTES).filter((k) => k !== opts.preferredDex)]
    : Object.keys(ROUTES);
  let chosen = null;
  for (const routeKey of order) {
    const route = ROUTES[routeKey];
    let best = { fee: null, out: 0n };
    for (const fee of route.feeTiers) {
      const out = await quoteSell(route, from, tokenIn, amountIn, fee, deadline);
      if (out > best.out) best = { fee, out };
    }
    if (best.out > 0n) { chosen = { routeKey, route, fee: best.fee, out: best.out }; break; }
  }
  if (!chosen) throw new Error('NO_LIQUIDITY');
  const allowance = await getAllowance(tokenIn, from, chosen.route.router);
  const approveTx = allowance < amountIn
    ? { to: tokenIn, value: 0n, data: SEL_APPROVE + addr32(chosen.route.router) + pad32(hexBig(MAX_UINT)) }
    : null;
  const amountOutMin = (chosen.out * BigInt(10000 - slippageBps)) / 10000n;
  const swapCall = encodeExactInputSingle(chosen.route, {
    tokenIn, tokenOut: CONTRACTS.WMON, fee: chosen.fee, recipient: chosen.route.router,
    deadline, amountIn, amountOutMinimum: amountOutMin,
  });
  const unwrapCall = SEL_UNWRAP + pad32(hexBig(amountOutMin)) + addr32(from);
  return {
    approveTx,
    tx: { to: chosen.route.router, value: 0n, data: encodeMulticall([swapCall, unwrapCall]) },
    meta: { dex: chosen.routeKey, fee: chosen.fee, amountIn: amountIn.toString(), expectedOut: chosen.out.toString(), amountOutMin: amountOutMin.toString() },
  };
}

// ── Sell-side allowance helpers (used by the Turbo local signer) ──
// The v3 sell quote simulates a real transferFrom, so it silently returns 0
// (looks like "no liquidity") until the router is approved. The Turbo path
// approves the sell router FIRST, then quotes.
export function sellRouterFor(dexKey) {
  const route = ROUTES[dexKey] || ROUTES.PancakeV3;
  return route.router;
}
export async function sellAllowance(tokenIn, owner, dexKey) {
  return getAllowance(tokenIn, owner, sellRouterFor(dexKey));
}
export function buildApproveTx(tokenIn, dexKey) {
  return { to: tokenIn, value: 0n, data: SEL_APPROVE + addr32(sellRouterFor(dexKey)) + pad32(hexBig(MAX_UINT)) };
}

// ── SELL: close a position by swapping the token back to native MON ──

const first32 = (res) => (res && res !== '0x' ? BigInt('0x' + strip(res).slice(0, 64)) : 0n);

export async function getTokenInfo(user, token) {
  const [balHex, decHex] = await Promise.all([
    rpcEthCall({ to: token, data: SEL_BALANCEOF + addr32(user) }),
    rpcEthCall({ to: token, data: SEL_DECIMALS }),
  ]);
  const raw = first32(balHex);
  const decimals = decHex && decHex !== '0x' ? Number(first32(decHex)) : 18;
  return { raw, decimals };
}

async function getAllowance(token, owner, spender) {
  const res = await rpcEthCall({ to: token, data: SEL_ALLOWANCE + addr32(owner) + addr32(spender) });
  return first32(res);
}

async function waitReceipt(hash, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await mmCall('eth_getTransactionReceipt', [hash]); if (r) return r; } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

// Quote token -> WMON from the user's own address (allowance must already exist).
async function quoteSell(route, from, tokenIn, amountInWei, fee, deadline) {
  const data = encodeExactInputSingle(route, {
    tokenIn, tokenOut: CONTRACTS.WMON, fee, recipient: from, deadline, amountIn: amountInWei, amountOutMinimum: 0n,
  });
  const res = await rpcEthCall({ from, to: route.router, data });
  return first32(res);
}

/**
 * Sell a token back to native MON (closes/reduces a copied position).
 * Real on-chain flow: approve router (once) → multicall[ exactInputSingle(token→WMON, keep in router), unwrapWETH9(→ user) ].
 * opts: { slippageBps, preferredDex, amountRaw }  (amountRaw = token wei to sell; defaults to full balance)
 * Returns { hash, dex, fee, amountIn, expectedOut, amountOutMin }.
 */
export async function sellToken(from, tokenIn, opts = {}) {
  if (!tokenIn || !/^0x[0-9a-fA-F]{40}$/.test(tokenIn)) throw new Error('NO_TOKEN_ADDRESS');
  await ensureMonadMainnet(); // sells settle on Monad mainnet — never testnet
  const slippageBps = opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS;

  const { raw: balance } = await getTokenInfo(from, tokenIn);
  if (balance <= 0n) throw new Error('NO_BALANCE');

  let amountIn = balance;
  if (opts.amountRaw) {
    try { const want = BigInt(opts.amountRaw); if (want > 0n && want < balance) amountIn = want; } catch { /* use full balance */ }
  }

  const deadline = Math.floor(Date.now() / 1000) + 600;
  const order = opts.preferredDex && ROUTES[opts.preferredDex]
    ? [opts.preferredDex, ...Object.keys(ROUTES).filter((k) => k !== opts.preferredDex)]
    : Object.keys(ROUTES);

  let chosen = null;
  for (const routeKey of order) {
    const route = ROUTES[routeKey];
    // Router must be allowed to pull the token. Approve once (max) if needed.
    const allowance = await getAllowance(tokenIn, from, route.router);
    if (allowance < amountIn) {
      const approveData = SEL_APPROVE + addr32(route.router) + pad32(hexBig(MAX_UINT));
      const approveHash = await mmCall('eth_sendTransaction', [{ from, to: tokenIn, data: approveData }]);
      const rec = await waitReceipt(approveHash);
      if (!rec || rec.status === '0x0') throw new Error('APPROVE_FAILED');
    }
    let best = { fee: null, out: 0n };
    for (const fee of route.feeTiers) {
      const out = await quoteSell(route, from, tokenIn, amountIn, fee, deadline);
      if (out > best.out) best = { fee, out };
    }
    if (best.out > 0n) { chosen = { routeKey, route, fee: best.fee, out: best.out }; break; }
  }
  if (!chosen || chosen.out === 0n) throw new Error('NO_LIQUIDITY');

  const amountOutMin = (chosen.out * BigInt(10000 - slippageBps)) / 10000n;
  // Keep WMON in the router (recipient = router), then unwrap it to native MON for the user.
  const swapCall = encodeExactInputSingle(chosen.route, {
    tokenIn, tokenOut: CONTRACTS.WMON, fee: chosen.fee, recipient: chosen.route.router,
    deadline, amountIn, amountOutMinimum: amountOutMin,
  });
  const unwrapCall = SEL_UNWRAP + pad32(hexBig(amountOutMin)) + addr32(from);
  const tx = { from, to: chosen.route.router, data: encodeMulticall([swapCall, unwrapCall]) };

  try {
    await mmCall('eth_estimateGas', [tx]);
  } catch (e) {
    throw Object.assign(new Error('SELL_REVERT'), { cause: e });
  }
  const hash = await mmCall('eth_sendTransaction', [tx]);
  const rec = await waitReceipt(hash);
  if (!rec) throw Object.assign(new Error('TX_TIMEOUT'), { hash });
  if (rec.status === '0x0') throw Object.assign(new Error('TX_FAILED'), { hash });
  return { hash, dex: chosen.routeKey, fee: chosen.fee, amountIn: amountIn.toString(), expectedOut: chosen.out.toString(), amountOutMin: amountOutMin.toString() };
}
