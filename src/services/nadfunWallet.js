/**
 * nad.fun execution — buy/sell memecoins launched on Monad's nad.fun launchpad.
 *
 * nad.fun graduated tokens trade on nad.fun's OWN Uniswap-v3-fork DEX (and
 * pre-graduation ones on a bonding curve). The standard PancakeSwap/Uniswap
 * routers can't reach these pools, so copy-trading them needs nad.fun's own
 * router. This module wraps that, in pure ethers, so the Turbo wallet can sign
 * nad.fun trades locally with no popups — exactly like the v3 path in wallet.js.
 *
 * The nad.fun LENS contract is the single source of truth: getAmountOut(token,
 * amountIn, isBuy) returns BOTH the correct router (curve vs graduated DEX) AND
 * the expected output. A revert means "not a nad.fun token" — that's also how we
 * detect which execution engine a card needs.
 *
 * Addresses: official @nadfun/sdk mainnet constants (Monad chain 143).
 */
import { Contract, Interface, JsonRpcProvider } from 'ethers';
import { MONAD_MAINNET, DEFAULT_SLIPPAGE_BPS } from '../config/chain.js';

// ── nad.fun mainnet contracts (from @nadfun/sdk) ──
export const NADFUN = {
  LENS: '0x7e78A8DE94f21804F7a17F4E8BF9EC2c872187ea',
  DEX_ROUTER: '0x0B79d71AE99528D1dB24A4148b5f4F865cc2b137',        // graduated tokens (v3-fork DEX)
  BONDING_CURVE_ROUTER: '0x6F6B8F1a20703309951a5127c45B49b1CD981A22', // pre-graduation curve
  WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
};

const LENS_ABI = [
  'function getAmountOut(address token, uint256 amountIn, bool isBuy) view returns (address router, uint256 amount)',
];
// Both the DEX router and the bonding-curve router share this buy/sell shape.
const ROUTER_ABI = [
  'function buy(tuple(uint256 amountOutMin, address token, address to, uint256 deadline) params) payable',
  'function sell(tuple(uint256 amountIn, uint256 amountOutMin, address token, address to, uint256 deadline) params)',
];
const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
];

const routerIface = new Interface(ROUTER_ABI);
const erc20Iface = new Interface(ERC20_ABI);

let _provider = null;
function provider() {
  if (!_provider) _provider = new JsonRpcProvider(MONAD_MAINNET.rpcUrls[0], MONAD_MAINNET.chainIdNum);
  return _provider;
}
function lens() { return new Contract(NADFUN.LENS, LENS_ABI, provider()); }

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600);
const applySlippage = (amount, bps) => (amount * BigInt(10000 - (bps ?? Number(DEFAULT_SLIPPAGE_BPS)))) / 10000n;

/**
 * Quote via the nad.fun LENS. Returns { router, amount } — router is whichever
 * (curve or DEX) actually holds this token's liquidity. Throws on non-nad.fun
 * tokens (LENS reverts), which callers use to route to the v3 engine instead.
 */
export async function nadfunQuote(token, amountInWei, isBuy) {
  const [router, amount] = await lens().getAmountOut(token, amountInWei, isBuy);
  return { router, amount };
}

/** True if `token` is a nad.fun token (curve or graduated). Cheap LENS probe. */
export async function isNadfunToken(token) {
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) return false;
  try {
    // A tiny probe amount is enough to learn tradeability + which router.
    await nadfunQuote(token, 10n ** 15n, true); // 0.001 MON
    return true;
  } catch {
    return false;
  }
}

/**
 * Build an unsigned nad.fun BUY (MON → token). Returns { tx, router, meta }.
 * `to` receives the tokens; `amountMonWei` is spent as msg.value.
 */
export async function buildNadfunBuy(to, token, amountMonWei, opts = {}) {
  const { router, amount } = await nadfunQuote(token, amountMonWei, true);
  if (amount <= 0n) throw new Error('NO_LIQUIDITY');
  const amountOutMin = applySlippage(amount, opts.slippageBps);
  const data = routerIface.encodeFunctionData('buy', [{ amountOutMin, token, to, deadline: deadline() }]);
  return {
    tx: { to: router, value: amountMonWei, data },
    router,
    meta: { dex: 'NadFun', expectedOut: amount.toString(), amountOutMin: amountOutMin.toString() },
  };
}

/**
 * Build an unsigned nad.fun SELL (token → MON) plan. Returns { approveTx|null,
 * tx, router, meta }. approveTx (if present) must be mined before tx.
 */
export async function buildNadfunSell(from, token, amountRaw, opts = {}) {
  const amountIn = BigInt(amountRaw);
  if (amountIn <= 0n) throw new Error('NO_BALANCE');
  const { router, amount } = await nadfunQuote(token, amountIn, false);
  if (amount <= 0n) throw new Error('NO_LIQUIDITY');
  const amountOutMin = applySlippage(amount, opts.slippageBps);

  // Router must be allowed to pull the token.
  let approveTx = null;
  try {
    const erc = new Contract(token, ERC20_ABI, provider());
    const allowance = await erc.allowance(from, router);
    if (allowance < amountIn) {
      approveTx = { to: token, data: erc20Iface.encodeFunctionData('approve', [router, (1n << 256n) - 1n]) };
    }
  } catch { /* if allowance read fails, approve defensively below */ approveTx = { to: token, data: erc20Iface.encodeFunctionData('approve', [router, (1n << 256n) - 1n]) }; }

  const data = routerIface.encodeFunctionData('sell', [{ amountIn, amountOutMin, token, to: from, deadline: deadline() }]);
  return {
    approveTx,
    tx: { to: router, value: 0n, data },
    router,
    meta: { dex: 'NadFun', amountIn: amountIn.toString(), expectedOut: amount.toString(), amountOutMin: amountOutMin.toString() },
  };
}
