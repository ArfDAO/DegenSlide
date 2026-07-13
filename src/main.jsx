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
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);