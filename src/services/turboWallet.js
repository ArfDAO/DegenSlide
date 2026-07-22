/**
 * TURBO trading wallet — one-swipe execution with NO per-trade wallet popups.
 *
 * How it works (the same model GMGN / Photon / BullX use):
 *   1. The user connects their external wallet (MetaMask / Phantom) and signs
 *      ONE gasless message. The Turbo trading key is DERIVED from that
 *      signature — so the external wallet permanently "owns" it.
 *   2. Because the derivation is deterministic, signing the same message with
 *      the same wallet on ANY device / browser restores the exact same trading
 *      wallet and its funds. Clearing localStorage never loses the account.
 *   3. The user funds it with ONE normal wallet-approved transfer.
 *   4. Every subsequent swipe signs the swap locally with the Turbo key and
 *      broadcasts straight to the chain — zero confirmations, zero popups.
 *
 * All execution is 100% real on-chain: same routing/quoting as the
 * interactive path (wallet.js / solWallet.js builders), just a different
 * signer. Withdraw sweeps funds back to any address, signed locally.
 *
 * RECOVERY MODEL: the key is cached in localStorage for a popup-free session,
 * but it is never the source of truth — the external wallet's signature is.
 * Lose the device, connect the same wallet elsewhere, re-sign → same wallet.
 */
import { Keypair, VersionedTransaction, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { Wallet as EthWallet, JsonRpcProvider, keccak256, sha256, getBytes } from 'ethers';
import { ACTIVE, MONAD_MAINNET, DEFAULT_SLIPPAGE_BPS } from '../config/chain.js';
import { buildBuyTx, buildSellPlan, getTokenInfo as evmTokenInfo, sellAllowance, buildApproveTx, signMessage as evmSignMessage, ensureMonadMainnet } from './wallet.js';
import { buildNadfunBuy, buildNadfunSell, isNadfunToken } from './nadfunWallet.js';
import {
  rpc as solRpc, jupQuote, jupSwapTx, confirmOnChain, actualTokenDelta,
  mintDecimals, dexLabel, getTokenInfo as solTokenInfo, sendRawTransaction, signMessage as solSignMessage,
} from './solWallet.js';

const AGREED_LS = 'turbo_agreed_v1';           // agreement is global (per device)
const KEY_LS = `${ACTIVE.id}_turbo_key_v1`;    // keypair is per chain
const LINKED_LS = `${ACTIVE.id}_turbo_linked_v1`; // external wallet the key is derived from
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

/* ── account linking: derive the Turbo key from an external-wallet signature ──
 *
 * This is the "save / recover your account" step. The message is FIXED (no
 * nonce, no timestamp) so the signature — and therefore the derived key — is
 * identical every time the same wallet signs it, on any device. It is
 * chain-scoped so Monad and Solana get distinct keys (they must: different
 * curves / key formats).
 */
function linkMessage() {
  return (
    'DegenSlide — Trading Wallet\n\n' +
    'Sign to create and recover your in-app trading wallet.\n' +
    'This signature IS your account key: signing this same message with this ' +
    'same wallet always restores the same trading wallet and its funds.\n\n' +
    'This request is free and gasless. It will NOT send a transaction, ' +
    'approve spending, or move any funds.\n\n' +
    `Network: ${ACTIVE.label}`
  );
}

/** The external wallet address the local Turbo key is derived from (or null). */
export function getLinkedAddress() {
  try { return localStorage.getItem(LINKED_LS) || null; } catch { return null; }
}
/** True once a derived key AND its external-wallet link are both present. */
export function isTurboLinked() { return !!getLinkedAddress() && turboWalletExists(); }

/**
 * Forget the Turbo wallet on THIS device (log out). Safe only for a LINKED
 * wallet — the key is deterministically recoverable by reconnecting and
 * re-signing, so nothing is lost. Refuses on an unlinked legacy key (that key
 * exists nowhere else — clearing it would strand its funds; export it first).
 */
export function unlinkTurbo() {
  if (turboWalletExists() && !isTurboLinked()) throw new Error('UNLINKED_KEY_EXPORT_FIRST');
  try {
    localStorage.removeItem(KEY_LS);
    localStorage.removeItem(LINKED_LS);
  } catch { /* ignore */ }
}

/**
 * Link (or recover) the Turbo wallet from `externalAddress`.
 * Prompts ONE gasless signature via the external wallet, derives the trading
 * key deterministically from it, and caches both the key and the link locally.
 * Returns the Turbo address (same value every time for a given wallet+chain).
 */
export async function linkTurboWallet(externalAddress) {
  if (!externalAddress) throw new Error('NO_WALLET');
  const msg = linkMessage();
  let secret;
  if (IS_SVM) {
    const sig = await solSignMessage(externalAddress, msg);   // 64-byte Ed25519 signature
    if (!sig || sig.length < 32) throw new Error('SIGN_FAILED');
    const seed = getBytes(sha256(sig));                        // 32-byte deterministic seed
    secret = btoa(String.fromCharCode(...Keypair.fromSeed(seed).secretKey));
  } else {
    const sig = await evmSignMessage(externalAddress, msg);    // 0x-hex secp256k1 signature
    if (!sig || sig.length < 66) throw new Error('SIGN_FAILED');
    secret = keccak256(sig);                                   // 32-byte private key
  }
  try {
    localStorage.setItem(KEY_LS, secret);
    localStorage.setItem(LINKED_LS, IS_SVM ? externalAddress : externalAddress.toLowerCase());
    localStorage.setItem(AGREED_LS, '1');
  } catch { throw new Error('STORAGE_UNAVAILABLE'); }
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
  await ensureMonadMainnet(); // NEVER deposit on testnet — force Monad mainnet (143) first
  const wei = BigInt(Math.round(amountNative * 1e9)) * 10n ** 9n;
  const hash = await window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [{ from: fromMain, to, value: '0x' + wei.toString(16) }],
  });
  await evmWallet().provider.waitForTransaction(hash, 1, 120000);
  return { hash };
}

/* ── withdraw: send Turbo funds back out, signed locally (no popup) ──
 * amountNative:
 *   • a positive number  → withdraw EXACTLY that much (the rest stays for gas/fees)
 *   • omitted / falsy     → sweep the MAX withdrawable (balance minus the network fee)
 */
export async function withdrawTurbo(toAddress, amountNative) {
  const wantExact = typeof amountNative === 'number' && amountNative > 0;

  if (IS_SVM) {
    if (!toAddress) throw new Error('BAD_ADDRESS');
    try { new PublicKey(toAddress); } catch { throw new Error('BAD_ADDRESS'); }
    const kp = solKeypair();
    const bal = BigInt((await solRpc('getBalance', [kp.publicKey.toString()]))?.value ?? 0);
    let lamports;
    if (wantExact) {
      lamports = BigInt(Math.round(amountNative * 1e9));
      if (lamports <= 0n) throw new Error('BAD_AMOUNT');
      if (lamports + SOL_FEE_LAMPORTS > bal) {
        throw Object.assign(new Error('INSUFFICIENT_FUNDS'), { needMon: Number(lamports + SOL_FEE_LAMPORTS) / 1e9, haveMon: Number(bal) / 1e9 });
      }
    } else {
      lamports = bal - SOL_FEE_LAMPORTS;
      if (lamports <= 0n) throw new Error('NO_BALANCE');
    }
    const { value } = await solRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const tx = new Transaction({ recentBlockhash: value.blockhash, feePayer: kp.publicKey })
      .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(toAddress), lamports: Number(lamports) }));
    tx.sign(kp);
    const sig = await solRpc('sendTransaction', [btoa(String.fromCharCode(...tx.serialize())), { encoding: 'base64', maxRetries: 3 }]);
    await confirmOnChain(sig);
    return { hash: sig, amount: Number(lamports) / 1e9 };
  }

  if (!toAddress || !/^0x[0-9a-fA-F]{40}$/.test(toAddress)) throw new Error('BAD_ADDRESS');
  const w = evmWallet();
  const bal = await w.provider.getBalance(w.address);

  // Pin the fee fields explicitly (same EIP-1559 model the working turbo swaps
  // use). Pinning legacy gasPrice on an EIP-1559 chain like Monad is one revert
  // cause; the other is gas: a bare EOA transfer is 21000, but a contract or
  // EIP-7702-delegated destination (what modern MetaMask accounts often are on
  // Monad) runs code on receive and needs MORE — hardcoding 21000 makes those
  // run out of gas and revert. So we ESTIMATE gas against the real destination.
  const fee = await w.provider.getFeeData();
  let feeFields, unitFee;
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    unitFee = fee.maxFeePerGas;
    feeFields = { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas };
  } else {
    unitFee = fee.gasPrice ?? 100000000000n;
    feeFields = { gasPrice: unitFee };
  }

  let gasLimit;
  try {
    const est = await w.provider.estimateGas({ from: w.address, to: toAddress, value: 1n });
    gasLimit = est < 21000n ? 21000n : (est * 3n) / 2n; // +50% headroom for delegated-account receive paths
  } catch (e) {
    const s = (String(e?.shortMessage || '') + String(e?.message || '')).toLowerCase();
    if (s.includes('reserve balance')) gasLimit = 200000n; // known Monad RPC estimate quirk — use a generous limit
    else throw Object.assign(new Error('DEST_REJECTS'), { cause: e }); // destination reverts on ANY native transfer
  }
  const gasReserve = gasLimit * unitFee;

  let value;
  if (wantExact) {
    value = BigInt(Math.round(amountNative * 1e9)) * 10n ** 9n; // native → wei (18 dp)
    if (value <= 0n) throw new Error('BAD_AMOUNT');
    if (value + gasReserve > bal) {
      throw Object.assign(new Error('INSUFFICIENT_FUNDS'), { needMon: Number(value + gasReserve) / 1e18, haveMon: Number(bal) / 1e18 });
    }
  } else {
    value = bal - gasReserve;
    if (value <= 0n) throw new Error('NO_BALANCE');
  }

  let tx;
  try {
    tx = await w.sendTransaction({ to: toAddress, value, gasLimit, ...feeFields });
  } catch (e) {
    throw Object.assign(new Error('WITHDRAW_REVERT'), { reason: e?.shortMessage || e?.info?.error?.message || e?.message || 'send failed', cause: e });
  }
  const rec = await tx.wait();
  if (!rec || rec.status === 0) throw Object.assign(new Error('TX_FAILED'), { hash: tx.hash });
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
    const [{ swapTransaction, lastValidBlockHeight }, decimals] = await Promise.all([jupSwapTx(quote, from), mintDecimals(tokenAddress)]);
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0)));
    tx.sign([kp]);
    const hash = await sendRawTransaction(tx.serialize(), lastValidBlockHeight);
    const realOut = await actualTokenDelta(hash, from, tokenAddress);
    return { hash, dex: dexLabel(quote), fee: null, expectedOut: realOut ?? quote.outAmount, amountOutMin: quote.otherAmountThreshold, decimals, turbo: true, turboAddress: from };
  }
  const w = evmWallet();
  const bal = await w.provider.getBalance(w.address);

  // nad.fun memecoins can't route through Uniswap/Pancake — they need nad.fun's
  // own router. The card's `source` tells us; if unknown, probe the LENS.
  const wantNadfun = opts.source === 'nadfun' || (opts.source !== 'v3' && await isNadfunToken(tokenAddress));
  let tx, meta;
  if (wantNadfun) {
    const amountWei = BigInt(Math.round(amountNative * 1e9)) * 10n ** 9n;
    ({ tx, meta } = await buildNadfunBuy(w.address, tokenAddress, amountWei, opts));
  } else {
    ({ tx, meta } = await buildBuyTx(w.address, tokenAddress, amountNative, opts));
  }

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
  return { hash: sent.hash, ...meta, decimals: null, turbo: true, turboAddress: w.address.toLowerCase(), source: wantNadfun ? 'nadfun' : 'v3' };
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
    const { swapTransaction, lastValidBlockHeight } = await jupSwapTx(quote, from);
    const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0)));
    tx.sign([kp]);
    const hash = await sendRawTransaction(tx.serialize(), lastValidBlockHeight);
    return { hash, dex: dexLabel(quote), amountIn: amountIn.toString(), expectedOut: quote.outAmount, turbo: true };
  }
  const w = evmWallet();
  const from = w.address;
  // Determine how much we're selling (the v3 quote needs allowance to succeed,
  // so we must know the amount and approve BEFORE quoting).
  const { raw: balance } = await evmTokenInfo(from, tokenAddress);
  if (balance <= 0n) throw new Error('NO_BALANCE');
  let amountIn = balance;
  if (opts.amountRaw) { try { const want = BigInt(opts.amountRaw); if (want > 0n && want < balance) amountIn = want; } catch {} }

  // nad.fun memecoins sell through nad.fun's own router (approve → sell).
  const wantNadfun = opts.source === 'nadfun' || (opts.source !== 'v3' && await isNadfunToken(tokenAddress));
  if (wantNadfun) {
    const plan = await buildNadfunSell(from, tokenAddress, amountIn.toString(), opts);
    if (plan.approveTx) {
      const a = await w.sendTransaction({ to: plan.approveTx.to, data: plan.approveTx.data });
      const arec = await a.wait();
      if (!arec || arec.status === 0) throw new Error('APPROVE_FAILED');
    }
    let gl;
    try { gl = await w.provider.estimateGas({ ...plan.tx, from }); }
    catch (e) { const s = String(e?.message || '').toLowerCase(); if (s.includes('reserve balance')) gl = 800000n; else throw Object.assign(new Error('SELL_REVERT'), { cause: e }); }
    const sent = await w.sendTransaction({ ...plan.tx, gasLimit: gl });
    const rec = await sent.wait();
    if (!rec || rec.status === 0) throw Object.assign(new Error('TX_FAILED'), { hash: sent.hash });
    return { hash: sent.hash, ...plan.meta, turbo: true };
  }

  // Approve the sell router FIRST — otherwise the quote's simulated transferFrom
  // reverts and every route reads as 0 ("no liquidity"). Approve the DEX the
  // position was bought on (falls back to PancakeV3).
  const dexKey = (opts.preferredDex === 'PancakeV3' || opts.preferredDex === 'UniswapV3') ? opts.preferredDex : 'PancakeV3';
  const allow = await sellAllowance(tokenAddress, from, dexKey);
  if (allow < amountIn) {
    const ap = buildApproveTx(tokenAddress, dexKey);
    const a = await w.sendTransaction({ to: ap.to, data: ap.data });
    const rec = await a.wait();
    if (!rec || rec.status === 0) throw new Error('APPROVE_FAILED');
  }

  const plan = await buildSellPlan(from, tokenAddress, { ...opts, amountRaw: amountIn.toString() });
  // If a fallback route was chosen that still needs approval, cover it too.
  if (plan.approveTx) {
    const a = await w.sendTransaction({ to: plan.approveTx.to, data: plan.approveTx.data });
    const rec = await a.wait();
    if (!rec || rec.status === 0) throw new Error('APPROVE_FAILED');
  }
  let gasLimit;
  try { gasLimit = await w.provider.estimateGas({ ...plan.tx, from }); }
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
