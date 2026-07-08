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
async function rpcEthCall(tx) {
  try {
    const res = await fetch(MONAD_MAINNET.rpcUrls[0], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [tx, 'latest'] }),
    });
    const j = await res.json();
    return j.error ? '0x' : (j.result || '0x');
  } catch {
    return '0x';
  }
}

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
  const res = await rpcEthCall({ from: CONTRACTS.WMON, to: route.router, value: hexBig(amountInWei), data });
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

  const slippageBps = opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS;
  const { routeKey, fee, amountOut, amountInWei, deadline } = await bestCopyQuote(tokenOut, amountMon, opts);
  if (!routeKey || amountOut === 0n) throw new Error('NO_LIQUIDITY');

  const route = ROUTES[routeKey];
  const amountOutMin = (amountOut * BigInt(10000 - slippageBps)) / 10000n;

  const data = encodeExactInputSingle(route, {
    tokenOut, fee, recipient: from, deadline, amountIn: amountInWei, amountOutMinimum: amountOutMin,
  });
  const tx = { from, to: route.router, value: hexBig(amountInWei), data };

  // Pre-flight: on mainnet gas is paid in MON ON TOP of the swap value, so the
  // wallet needs value + gas. Check up-front and fail with clear numbers instead
  // of prompting a doomed MetaMask confirmation.
  const balance = BigInt(await mmCall('eth_getBalance', [from, 'latest']));
  if (balance <= amountInWei) {
    throw insufficient(amountInWei, balance, 0n);
  }
  let gasLimit;
  try {
    gasLimit = BigInt(await mmCall('eth_estimateGas', [tx]));
  } catch (e) {
    const m = (e.message || '').toLowerCase();
    if (m.includes('insufficient funds')) throw insufficient(amountInWei, balance, 0n);
    throw Object.assign(new Error('SWAP_REVERT'), { cause: e }); // slippage / pool issue
  }
  const gasPrice = BigInt(await mmCall('eth_gasPrice'));
  const gasCost = gasLimit * gasPrice;
  if (balance < amountInWei + gasCost) {
    throw insufficient(amountInWei, balance, gasCost);
  }

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
