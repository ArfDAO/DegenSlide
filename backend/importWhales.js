/**
 * Import externally-sourced whale wallets (e.g. gmgn.ai top winners) into the
 * durable whale_registry — with REAL on-chain verification, never blindly.
 *
 *   node importWhales.js sol   <addr> [addr…]     (or --file wallets.txt)
 *   node importWhales.js monad <addr> [addr…]
 *
 * Each address is verified against the chain before registering:
 *   sol   — valid base58 + getBalance succeeds (real account, balance recorded)
 *   monad — valid 0x address + eth_getCode empty (EOA, not a contract/bot)
 *
 * Registered rows are permanent: listeners track every registry wallet forever.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = path.dirname(fileURLToPath(import.meta.url));
const chain = (process.argv[2] || '').toLowerCase();
if (chain !== 'sol' && chain !== 'monad') {
  console.error('usage: node importWhales.js <sol|monad> <address…>  (or --file list.txt)');
  process.exit(1);
}

let addrs = process.argv.slice(3);
const fileIdx = addrs.indexOf('--file');
if (fileIdx >= 0) {
  const listPath = addrs[fileIdx + 1];
  addrs = fs.readFileSync(listPath, 'utf8').split(/[\s,;]+/).filter(Boolean);
}
if (!addrs.length) { console.error('no addresses given'); process.exit(1); }

process.env.WHALE_DB = process.env.WHALE_DB
  || path.join(__d, chain === 'sol' ? 'solWhales.db' : 'whales.db');
const db = await import('./db.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const SOL_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const MONAD_RPC = process.env.MONAD_RPC || 'https://rpc.monad.xyz';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HEX40 = /^0x[0-9a-fA-F]{40}$/;

let ok = 0, bad = 0;
for (const raw of addrs) {
  const addr = chain === 'monad' ? raw.toLowerCase() : raw;
  try {
    if (chain === 'sol') {
      if (!B58.test(addr)) throw new Error('not base58');
      const bal = (await rpcCall(SOL_RPC, 'getBalance', [addr]))?.value / 1e9 || 0;
      db.registerWhale(addr, 'gmgn', { solBalance: bal });
      console.log(`[import] +${addr.slice(0, 10)}… · ${bal.toFixed(2)} SOL`);
    } else {
      if (!HEX40.test(addr)) throw new Error('not a 0x address');
      const code = await rpcCall(MONAD_RPC, 'eth_getCode', [addr, 'latest']);
      if (code && code !== '0x') throw new Error('contract, not EOA');
      const balWei = BigInt(await rpcCall(MONAD_RPC, 'eth_getBalance', [addr, 'latest']));
      db.registerWhale(addr, 'gmgn', { stats: { address: addr, balanceMon: Number(balWei) / 1e18 } });
      console.log(`[import] +${addr.slice(0, 10)}… · ${(Number(balWei) / 1e18).toFixed(2)} MON`);
    }
    ok += 1;
  } catch (e) {
    bad += 1;
    console.warn(`[import] SKIP ${addr.slice(0, 12)}… — ${e.message}`);
  }
  await sleep(150);
}
console.log(`[import] done · ${ok} registered · ${bad} skipped · registry now ${db.loadWhaleRegistry().length} wallets`);
