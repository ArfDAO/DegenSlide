/**
 * Wallet bridge — routes every wallet call to the ACTIVE chain's implementation.
 *
 * The networks use different wallets entirely (Monad/EVM -> MetaMask,
 * Solana/SVM -> Phantom), so the app imports from here and never cares which
 * one is behind it. A network switch does a full page reload, so this
 * module-level selection is always correct.
 */
import { ACTIVE } from '../config/chain.js';
import * as evm from './wallet.js';
import * as svm from './solWallet.js';

const impl = ACTIVE.kind === 'svm' ? svm : evm;

export const WALLET_NAME = impl.WALLET_NAME;
export const WALLET_INSTALL_URL = impl.WALLET_INSTALL_URL;
export const isWalletAvailable = impl.isWalletAvailable;
export const connectWallet = impl.connectWallet;
export const getConnectedAccount = impl.getConnectedAccount;
export const disconnectWallet = impl.disconnectWallet;
export const onAccountsChanged = impl.onAccountsChanged;
export const getMonBalance = impl.getMonBalance; // native balance (MON or SOL)
export const getTokenInfo = impl.getTokenInfo;
export const copyBuy = impl.copyBuy;
export const sellToken = impl.sellToken;
