/**
 * Solana FREE network-wide whale detection (Phase-2B).
 *
 * The registry model only ever SEES roster wallets (the Helius webhook + poller
 * are address-scoped). This module breaks that ceiling for FREE: it subscribes
 * (standard `logsSubscribe`) to the pump.fun program and decodes the `TradeEvent`
 * that pump.fun emits INLINE in every swap's `Program data:` log — so we learn
 * (user, mint, SOL size, buy/sell) for EVERY pump.fun trade network-wide WITHOUT
 * a getTransaction per swap (a full firehose of getTransaction calls is what
 * makes network-wide detection "need paid RPC" — decoding the event straight from
 * the log sidesteps that entirely). pump.fun is where the overwhelming majority
 * of fresh Solana degen/whale activity starts, so this is the single highest-value
 * free coverage expansion. Graduated tokens (Raydium/pumpswap) still surface once
 * the wallet is promoted, because Helius then tracks it like any roster whale.
 *
 * The default WS endpoint is a PUBLIC node (logsSubscribe-capable, no key) so this
 * never consumes Helius credits. Override with SOL_WS for a dedicated endpoint.
 *
 * Verified against live mainnet: discriminator sha256("event:TradeEvent")[..8] =
 * bddb7fd34ee661ee; layout decodes real users/mints/sizes.
 */
import { WebSocket } from 'ws';
import crypto from 'node:crypto';

export const PUMP_FUN_PROGRAM = process.env.PUMP_FUN_PROGRAM || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
// Anchor event discriminator = first 8 bytes of sha256("event:<Name>").
const TRADE_EVENT_DISC = crypto.createHash('sha256').update('event:TradeEvent').digest().subarray(0, 8);

// ── base58 encode (Bitcoin alphabet) — the backend ships no bs58/web3 dep, and
// pump.fun events carry pubkeys as 32 raw bytes; addresses everywhere else are
// base58 strings, so we must encode. Standard leading-zero-aware algorithm (same
// approach as the reference `bs58`/base-x implementations): each leading 0x00
// byte maps to exactly one '1', and the remaining bytes are converted as one
// big-endian big integer — NOT double-counted the way a naive "seed digits=[0]"
// version would (that undercounts real addresses starting with 0x00 and, in the
// degenerate all-zero case, over-counts by one spurious digit). ──
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(buf) {
  if (buf.length === 0) return '';
  let zeros = 0;
  while (zeros < buf.length && buf[zeros] === 0) zeros++;
  const size = Math.ceil((buf.length - zeros) * 138 / 100) + 1; // log(256)/log(58) ≈ 1.365, safe upper bound
  const b58 = new Uint8Array(size);
  let length = 0;
  for (let i = zeros; i < buf.length; i++) {
    let carry = buf[i], j = 0;
    for (let k = size - 1; (carry !== 0 || j < length) && k >= 0; k--, j++) {
      carry += 256 * b58[k];
      b58[k] = carry % 58;
      carry = (carry / 58) | 0;
    }
    length = j;
  }
  let it = size - length;
  while (it < size && b58[it] === 0) it++; // skip any leftover zero digits from the conversion itself
  let str = '1'.repeat(zeros);
  for (; it < size; it++) str += B58[b58[it]];
  return str;
}

// Decode one pump.fun TradeEvent from the base64 payload of a `Program data:` log.
// Layout (borsh, after the 8-byte discriminator): mint(32) solAmount(u64)
// tokenAmount(u64) isBuy(u8) user(32) … (reserves follow — unused).
export function decodeTradeEvent(b64) {
  let buf;
  try { buf = Buffer.from(b64, 'base64'); } catch { return null; }
  if (buf.length < 8 + 32 + 8 + 8 + 1 + 32) return null;
  if (!buf.subarray(0, 8).equals(TRADE_EVENT_DISC)) return null;
  let o = 8;
  const mint = base58(buf.subarray(o, o + 32)); o += 32;
  const solAmount = Number(buf.readBigUInt64LE(o)) / 1e9; o += 8; // lamports → SOL
  const tokenAmount = Number(buf.readBigUInt64LE(o)); o += 8;
  const isBuy = buf[o] === 1; o += 1;
  const user = base58(buf.subarray(o, o + 32));
  return { user, mint, solAmount, tokenAmount, side: isBuy ? 'BUY' : 'SELL' };
}

export function eventsFromLogs(logs) {
  const out = [];
  for (const line of logs || []) {
    if (typeof line !== 'string' || !line.startsWith('Program data: ')) continue;
    const ev = decodeTradeEvent(line.slice('Program data: '.length));
    if (ev) out.push(ev);
  }
  return out;
}

/**
 * Open the pump.fun log subscription. Calls onSwap({user,mint,solAmount,side,
 * signature}) for every decoded trade; the caller applies the size filter +
 * quality gate + promotion. Auto-reconnects with backoff; a ping keeps the
 * socket alive behind proxies. Returns { stats(), close() }.
 */
export function startNetworkScan({ wsUrl, onSwap, onStatus, log = console }) {
  let ws = null, reconnectTimer = null, pingTimer = null, closed = false;
  const stats = { alive: false, events: 0, connects: 0, reconnects: 0, lastEventAt: 0, connectedAt: 0 };

  function connect() {
    if (closed) return;
    try { ws = new WebSocket(wsUrl); } catch (e) { onStatus?.('ctor-error:' + (e?.message || e)); return scheduleReconnect(); }
    ws.on('open', () => {
      stats.alive = true; stats.connects += 1; stats.connectedAt = Date.now();
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PUMP_FUN_PROGRAM] }, { commitment: 'confirmed' }] }));
      onStatus?.('connected');
      clearInterval(pingTimer);
      pingTimer = setInterval(() => { try { ws.ping(); } catch {} }, 25000);
    });
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.id === 1) return;                      // subscribe ack (m.result = subscription id)
      if (m.method !== 'logsNotification') return;
      const val = m.params?.result?.value;
      if (!val || val.err) return;                 // failed tx → not a real fill
      for (const ev of eventsFromLogs(val.logs)) {
        stats.events += 1; stats.lastEventAt = Date.now();
        try { onSwap?.({ ...ev, signature: val.signature }); } catch (e) { log.warn?.('[netscan] onSwap error:', e?.message || e); }
      }
    });
    ws.on('close', () => { stats.alive = false; clearInterval(pingTimer); scheduleReconnect(); });
    ws.on('error', (e) => { onStatus?.('error:' + (e?.message || e)); try { ws.close(); } catch {} });
  }
  function scheduleReconnect() {
    if (closed) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => { stats.reconnects += 1; connect(); }, 3000);
  }
  connect();
  return {
    stats: () => ({ ...stats }),
    close: () => { closed = true; clearTimeout(reconnectTimer); clearInterval(pingTimer); try { ws?.close(); } catch {} },
  };
}
