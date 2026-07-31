import { Buffer } from 'buffer';
// @solana/web3.js (Phantom tx signing) expects a Node-style global Buffer
if (!globalThis.Buffer) globalThis.Buffer = Buffer;

// Polyfill SVGAnimatedString to prevent react-tinder-card crashes on mobile
if (typeof window !== 'undefined' && window.SVGAnimatedString) {
  if (!window.SVGAnimatedString.prototype.includes) {
    window.SVGAnimatedString.prototype.includes = function(search, start) {
      return (this.baseVal || '').includes(search, start);
    };
  }
}

import React from 'react';
import ReactDOM from 'react-dom/client';
import { PrivyProvider } from '@privy-io/react-auth';
// Privy throws on switchChain / sendTransaction for a chain that isn't in its
// supported list, so Monad has to be declared here or every deposit from a
// linked external wallet fails.
import { monad } from 'viem/chains';
// Solana external wallets (Phantom etc.) only appear in Privy's connect modal
// when these connectors are supplied — without them the SVM side of the app
// could never link a funding wallet.
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';

const appId = import.meta.env.VITE_PRIVY_APP_ID || '';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PrivyProvider
        appId={appId}
        config={{
          loginMethods: ['email', 'wallet', 'google', 'twitter', 'discord', 'github'],
          // Monad must be declared, or Privy rejects switchChain/sendTransaction
          // on it and deposits from a linked external wallet fail. Solana is
          // configured separately (it is not an EVM `Chain`).
          supportedChains: [monad],
          defaultChain: monad,
          externalWallets: {
            // shouldAutoConnect defaults to TRUE, which lets a detected wallet
            // attach itself on load — exactly the silent auto-connect this app
            // must never do. Connecting is always a deliberate user action.
            solana: { connectors: toSolanaWalletConnectors({ shouldAutoConnect: false }) },
          },
          appearance: {
            theme: 'dark',
            accentColor: '#6db48a',
            logo: 'https://degenslide.com/logo.png', // Replace with your actual logo later
          },
          // Privy v3 reads embeddedWallets.<chain>.createOnLogin — the flat
          // `createOnLogin` of v1/v2 is an unknown key here and was silently
          // ignored, leaving both chains at the 'off' default. That is why no
          // embedded wallet ever existed and the app fell back to MetaMask.
          embeddedWallets: {
            // 'all-users' (not 'users-without-wallets'): the account's trading
            // wallet must exist even when the user ALSO links an external
            // wallet — linking a wallet must never cost them their Turbo wallet.
            ethereum: { createOnLogin: 'all-users' },
            solana: { createOnLogin: 'all-users' },
            // The one gasless signature that derives the Turbo key is signed
            // silently — logging in with a social account is the approval, so
            // there is no second confirmation modal on top of it.
            showWalletUIs: false,
          }
        }}
      >
        <App />
      </PrivyProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);