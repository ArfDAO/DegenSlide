/**
 * TURBO trading wallet — one-swipe execution with NO per-trade wallet popups.
 *
 * How it works (the same model GMGN / Photon / BullX use):
 *   1. The user accepts the Turbo agreement ONCE.
 *   2. A dedicated trading keypair is generated locally and stored ONLY in
 *      this browser's localStorage (self-custodial; exportable any time).
 *   3. The user funds it with ONE normal wallet-approved transfer.
 *   4. Every subsequent swipe signs the swap locally with the Turbo key and
 *      broadcasts straight to the chain — zero confirmations, zero popups.
 *
 * All execution is 100% real on-chain: same routing/quoting as the
 * interactive path (wallet.js / solWallet.js builders), just a different
 * signer. Withdraw sweeps funds back to any address, signed locally.
 *
 * SECURITY MODEL (stated in the agreement the user accepts): the key lives in
 * localStorage on this device — deposit only an amount you accept losing if
 * the device/browser profile is compromised.
 */
import { Keypair, VersionedTransaction, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { Wallet as EthWallet, JsonRpcProvider } from 'ethers';
import { ACTIVE, MONAD_MAINNET, DEFAULT_SLIPPAGE_BPS } from '../config/chain.js';
import { buildBuyTx, buildSellPlan, getTokenInfo as evmTokenInfo } from './wallet.js';
import {
  rpc as solRpc, jupQuote, jupSwapTx, confirmOnChain, actualTokenDelta,
  mintDecimals, dexLabel, getTokenInfo as solTokenInfo,
} from './solWallet.js';

const AGREED_LS = 'turbo_agreed_v1';           // agreement is global (per device)
const KEY_LS = `${ACTIVE.id}_turbo_key_v1`;    // keypair is per chain
const IS_SVM = ACTIVE.kind === 'svm';
const WSOL = 'So11111111111111111111111111111111111111112';
const SOL_FEE_LAMPORTS = 5000n;                // base tx fee
const SOL_TURBO_BUFFER = 0.01;                 // fee + ATA rent headroom per swap
const EVM_GAS_BUFFER_WEI = 20000000000000000n; // 0.02 MON headroom

/* ── agreement ── */
export function hasTurboAgreement() {
  try { return localStorage.getItem(AGREED_LS) === '1'; } catch { return false; }
}
export function acceptTurboAgreement() {
  try { localStorage.setItem(AGREED_LS, '1'); } catch {}
}

/* ── keypair lifecycle (local only — never leaves the device) ── */
function loadKey() {
  try { return localStorage.getItem(KEY_LS) || null; } catch { return null; }
}
export function turboWalletExists() { return !!loadKey(); }

export function ensureTurboWallet() {
  let secret = loadKey();
  if (!secret) {
    secret = IS_SVM
      ? btoa(String.fromCharCode(...Keypair.generate().secretKey))
      : EthWallet.createRandom().privateKey;
    try { localStorage.setItem(KEY_LS, secret); } catch { throw new Error('STORAGE_UNAVAILABLE'); }
  }
  return getTurboAddress();
}

function solKeypair() {
  const secret = loadKey();
  if (!secret) throw new Error('NO_TURBO_WALLET');
  return Keypair.fromSecretKey(Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)));
}
function evmWallet() {
  const secret = loadKey();
  if (!secret) throw new Error('NO_TURBO_WALLET');
  return new EthWallet(secret, new JsonRpcProvider(MONAD_MAINNET.rpcUrls[0], MONAD_MAINNET.chainIdNum));
}

export function getTurboAddress() {
  const secret = loadKey();
  if (!secret) return null;
  return IS_SVM ? solKeypair().publicKey.toString() : new EthWallet(secret).address.toLowerCase();
}

/** Private key export — shown once to the user for backup. */
export function exportTurboKey() {
  const secret = loadKey();
  if (!secret) throw new Error('NO_TURBO_WALLET');
  if (!IS_SVM) return secret; // hex private key
  return JSON.stringify([...solKeypair().secretKey]); // standard Solana JSON keypair
}

/* ── balance ── */
export async function getTurboBalance() {
  const addr = getTurboAddress();
  if (!addr) return null;
  try {
    if (IS_SVM) return ((await solRpc('getBalance', [addr]))?.value ?? 0) / 1e9;
    const w = evmWallet();
    return Number(await w.provider.getBalance(addr)) / 1e18;
  } catch { return null; }
}

/* ── deposit: ONE wallet-approved transfer from the user's main wallet ── */
export async function depositToTurbo(fromMain, amountNative) {
  const to = ensureTurboWallet();
  if (!(amountNative > 0)) throw new Error('BAD_AMOUNT');
  if (IS_SVM) {
    const p = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : null);
    if (!p) throw new Error('NO_METAMASK');
    const { value } = await solRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const tx = new Transaction({
      recentBlockhash: value.blockhash,
      feePayer: new PublicKey(fromMain),
    }).add(SystemProgram.transfer({
      fromPubkey: new PublicKey(fromMain),
      toPubkey: new PublicKey(to),
      lamports: Math.round(amountNative * 1e9),
    }));
    const { signature } = await p.signAndSendTransaction(tx);
    await confirmOnChain(signature);
    return { hash: signature };
  }
  const wei = BigInt(Math.round(amountNative * 1e9)) * 10n ** 9n;
  const hash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: fromMain, to, value: '0x' + wei.toString(16) }],
  });
  await evmWallet().provider.waitForTransaction(hash, 1, 120000);
  return { hash };
}

/* ── withdraw: sweep Turbo funds back out, signed locally (no popup) ── */
export async function withdrawTurbo(toAddress) {
  if (IS_SVM) {
    const kp = solKeypair();
    const bal = BigInt((await solRpc('getBalance', [kp.publicKey.toString()]))?.value ?? 0);
    const lamports = bal - SOL_FEE_LAMPORTS;
    if (lamports <= 0n) throw new Error('NO_BALANCE');
    const { value } = await solRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const tx = new Transaction({ recentBlockhash: value.blockhash, feePayer: kp.publicKey })
      .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(toAddress), lamports: Number(lamports) }));
    tx.sign(kp);
    const sig = await solRpc('sendTransaction', [btoa(String.fromCharCode(...tx.serialize())), { encoding: 'base64', maxRetries: 3 }]);
    await confirmOnChain(sig);
    return { hash: sig, amount: Number(lamports) / 1e9 };
  }
  const w = evmWallet();
  const bal = await w.provider.getBalance(w.address);
  const fee = await w.provider.getFeeData();
  const gasPrice = fee.gasPrice ?? 100000000000n;
  const gasCost = 21000n * gasPrice;
  const value = bal - gasCost;
  if (value <= 0n) throw new Error('NO_BALANCE');
  const tx = await w.sendTransaction({ to: toAddress, value, gasLimit: 21000n, gasPrice });
  await tx.wait();
  return { hash: tx.hash, amount: Number(value) / 1e18 };
}

/* ── TURBO BUY: swipe → signed locally → broadcast. No popup, ever. ── */
export async function turboCopyBuy(tokenAddress, amountNative, opts = {}) {
  if (IS_SVM) {
    const kp = solKeypair();
    const from = kp.publicKey.toString();
    const bal = ((await solRpc('getBalance', [from]))?.value ?? 0) / 1e9;
    if (bal < amountNative + SOL_TURBO_BUFFER) {
      throw Object.assign(new Error('INSUFFICIENT_FUNDS'), { needMon: amountNative + SOL_TURBO_BUFFER, haveMon: bal, turbo: true });
    }
    const quote = await jupQuote(WSOL, tokenAddress, Math.round(amountNative * 1e9), opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    if (!quote) throw new Error('NO_LIQUIDITY');
    const [swapB64, decimals] = await Promise.all([jupSwapTx(quote, from), mintDecimals(tokenAddress)]);
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapB64), (c) => c.charCodeAt(0)));
    tx.sign([kp]);
    const hash = await solRpc('sendTransaction', [btoa(String.fromCharCode(...tx.serialize())), { encoding: 'base64', maxRetries: 3 }]);
    await confirmOnChain(hash);
    const realOut = await actualTokenDelta(hash, from, tokenAddress);
    return { hash, dex: dexLabel(quote), fee: null, expectedOut: realOut ?? quote.outAmount, amountOutMin: quote.otherAmountThreshold, decimals, turbo: true, turboAddress: from };
  }
  const w = evmWallet();
  const bal = await w.provider.getBalance(w.address);
  const { tx, meta } = await buildBuyTx(w.address, tokenAddress, amountNative, opts);
  if (bal < tx.value + EVM_GAS_BUFFER_WEI) {
    throw Object.assign(new Error('INSUFFICIENT_FUNDS'), { needMon: Number(tx.value + EVM_GAS_BUFFER_WEI) / 1e18, haveMon: Number(bal) / 1e18, turbo: true });
  }
  let gasLimit;
  try { gasLimit = await w.provider.estimateGas({ ...tx, from: w.address }); }
  catch (e) {
    const s = String(e?.message || '').toLowerCase();
    if (s.includes('reserve balance')) gasLimit = 800000n; // known Monad RPC quirk
    else throw Object.assign(new Error('SWAP_REVERT'), { cause: e });
  }
  const sent = await w.sendTransaction({ ...tx, gasLimit });
  const rec = await sent.wait();
  if (!rec || rec.status === 0) throw Object.assign(new Error('TX_FAILED'), { hash: sent.hash });
  return { hash: sent.hash, ...meta, decimals: null, turbo: true, turboAddress: w.address.toLowerCase() };
}

/* ── TURBO SELL: close a Turbo position, signed locally ── */
export async function turboSellToken(tokenAddress, opts = {}) {
  if (IS_SVM) {
    const kp = solKeypair();
    const from = kp.publicKey.toString();
    const { raw: balance } = await solTokenInfo(from, tokenAddress);
    if (balance <= 0n) throw new Error('NO_BALANCE');
    let amountIn = balance;
    if (opts.amountRaw) { try { const want = BigInt(opts.amountRaw); if (want > 0n && want < balance) amountIn = want; } catch {} }
    const quote = await jupQuote(tokenAddress, WSOL, amountIn.toString(), opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
    if (!quote) throw new Error('NO_LIQUIDITY');
    const swapB64 = await jupSwapTx(quote, from);
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapB64), (c) => c.charCodeAt(0)));
    tx.sign([kp]);
    const hash = await solRpc('sendTransaction', [btoa(String.fromCharCode(...tx.serialize())), { encoding: 'base64', maxRetries: 3 }]);
    await confirmOnChain(hash);
    return { hash, dex: dexLabel(quote), amountIn: amountIn.toString(), expectedOut: quote.outAmount, turbo: true };
  }
  const w = evmWallet();
  const plan = await buildSellPlan(w.address, tokenAddress, opts);
  if (plan.approveTx) {
    const a = await w.sendTransaction({ ...plan.approveTx });
    const rec = await a.wait();
    if (!rec || rec.status === 0) throw new Error('APPROVE_FAILED');
  }
  let gasLimit;
  try { gasLimit = await w.provider.estimateGas({ ...plan.tx, from: w.address }); }
  catch (e) { throw Object.assign(new Error('SELL_REVERT'), { cause: e }); }
  const sent = await w.sendTransaction({ ...plan.tx, gasLimit });
  const rec = await sent.wait();
  if (!rec || rec.status === 0) throw Object.assign(new Error('TX_FAILED'), { hash: sent.hash });
  return { hash: sent.hash, ...plan.meta, turbo: true };
}

/** Token balance held by the TURBO wallet (for sells of turbo positions). */
export async function turboTokenInfo(tokenAddress) {
  const addr = getTurboAddress();
  if (!addr) return { raw: 0n, decimals: null };
  return IS_SVM ? solTokenInfo(addr, tokenAddress) : evmTokenInfo(addr, tokenAddress);
}
