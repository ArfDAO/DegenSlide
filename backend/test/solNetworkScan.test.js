import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { base58, decodeTradeEvent, eventsFromLogs } from '../solNetworkScan.js';
import crypto from 'node:crypto';

const TRADE_EVENT_DISC = crypto.createHash('sha256').update('event:TradeEvent').digest().subarray(0, 8);

describe('base58', () => {
  test('encodes an all-zero 32-byte buffer as exactly 32 "1"s (matches the real System Program ID)', () => {
    const enc = base58(Buffer.alloc(32));
    assert.equal(enc, '11111111111111111111111111111111'.slice(0, 32));
    assert.equal(enc.length, 32);
  });
  test('known base58 test vector: 0x0001 → "12"', () => {
    assert.equal(base58(Buffer.from([0x00, 0x01])), '12');
  });
  test('known base58 test vector: 0x000000287fb4cd → leading zeros produce leading "1"s', () => {
    // 3 leading zero bytes → 3 leading '1's, then the big-endian value encoded.
    const enc = base58(Buffer.from([0x00, 0x00, 0x00, 0x28, 0x7f, 0xb4, 0xcd]));
    assert.ok(enc.startsWith('111'), `expected 3 leading 1s, got ${enc}`);
  });
  test('empty buffer encodes to empty string', () => {
    assert.equal(base58(Buffer.alloc(0)), '');
  });
  test('a single non-zero byte encodes without a spurious leading zero digit', () => {
    assert.equal(base58(Buffer.from([58])), base58(Buffer.from([58]))); // self-consistency
    assert.equal(base58(Buffer.from([0])), '1'); // single zero byte → single '1', not '11'
  });
  test('output never contains ambiguous base58 characters (0 O I l)', () => {
    const enc = base58(crypto.randomBytes(32));
    assert.doesNotMatch(enc, /[0OIl]/);
  });
  test('is deterministic for the same input', () => {
    const buf = crypto.randomBytes(32);
    assert.equal(base58(buf), base58(buf));
  });
});

// Build a valid raw pump.fun TradeEvent payload matching the on-chain layout:
// disc(8) mint(32) solAmount(u64 LE lamports) tokenAmount(u64 LE) isBuy(u8) user(32)
function buildTradeEventB64({ mintByte = 7, solLamports = 1_500_000_000n, tokenAmount = 42_000n, isBuy = true, userByte = 9 }) {
  const buf = Buffer.alloc(8 + 32 + 8 + 8 + 1 + 32);
  TRADE_EVENT_DISC.copy(buf, 0);
  buf.fill(mintByte, 8, 40);
  buf.writeBigUInt64LE(solLamports, 40);
  buf.writeBigUInt64LE(tokenAmount, 48);
  buf.writeUInt8(isBuy ? 1 : 0, 56);
  buf.fill(userByte, 57, 89);
  return buf.toString('base64');
}

describe('decodeTradeEvent', () => {
  test('decodes a well-formed BUY event with correct fields', () => {
    const ev = decodeTradeEvent(buildTradeEventB64({ isBuy: true, solLamports: 2_000_000_000n, tokenAmount: 123n }));
    assert.ok(ev);
    assert.equal(ev.side, 'BUY');
    assert.equal(ev.solAmount, 2); // 2e9 lamports → 2 SOL
    assert.equal(ev.tokenAmount, 123);
    // base58-encoded 32 raw bytes is ~43-44 chars (verified against real live
    // pump.fun addresses), NOT 32 — that would be the raw byte count, not the
    // encoded string length.
    assert.ok(ev.user.length >= 32 && ev.user.length <= 44, `unexpected user length ${ev.user.length}`);
    assert.ok(ev.mint.length >= 32 && ev.mint.length <= 44, `unexpected mint length ${ev.mint.length}`);
    assert.doesNotMatch(ev.user, /[0OIl]/); // valid base58 alphabet only
  });
  test('decodes a well-formed SELL event', () => {
    const ev = decodeTradeEvent(buildTradeEventB64({ isBuy: false }));
    assert.equal(ev.side, 'SELL');
  });
  test('rejects a payload with the wrong discriminator (not a TradeEvent)', () => {
    const buf = Buffer.alloc(8 + 32 + 8 + 8 + 1 + 32);
    buf.fill(0xff, 0, 8); // wrong disc
    assert.equal(decodeTradeEvent(buf.toString('base64')), null);
  });
  test('rejects a truncated payload (shorter than the minimum layout)', () => {
    const buf = Buffer.concat([TRADE_EVENT_DISC, Buffer.alloc(10)]); // way short of mint+amounts+flag+user
    assert.equal(decodeTradeEvent(buf.toString('base64')), null);
  });
  test('rejects invalid base64 without throwing', () => {
    assert.doesNotThrow(() => decodeTradeEvent('%%%not-base64%%%'));
  });
  test('rejects empty string', () => {
    assert.equal(decodeTradeEvent(''), null);
  });
  test('correctly decodes a mint pubkey with a leading zero byte (real-world ~0.4%/position case) with no base58 over/under-count', () => {
    const buf = Buffer.alloc(8 + 32 + 8 + 8 + 1 + 32);
    TRADE_EVENT_DISC.copy(buf, 0);
    // mint: EXACTLY one leading zero byte, then distinct non-zero bytes.
    buf[8] = 0x00; for (let i = 9; i < 40; i++) buf[i] = i;
    buf.writeBigUInt64LE(1_000_000_000n, 40);
    buf.writeBigUInt64LE(1n, 48);
    buf.writeUInt8(1, 56);
    for (let i = 57; i < 89; i++) buf[i] = 200 + (i % 10);
    const ev = decodeTradeEvent(buf.toString('base64'));
    assert.ok(ev);
    // The number of LEADING '1' characters must equal the number of leading
    // zero BYTES (1) — no more (would be the double-count bug this fix
    // resolved), no fewer. A '1' appearing later in the string is a normal
    // base58 digit and irrelevant here, so we only count the leading run.
    const leadingOnes = ev.mint.match(/^1+/)?.[0]?.length || 0;
    assert.equal(leadingOnes, 1, `expected exactly 1 leading '1', got mint=${ev.mint}`);
  });
});

describe('eventsFromLogs', () => {
  test('extracts decodable events from mixed log lines, ignoring everything else', () => {
    const logs = [
      'Program 6EF8... invoke [1]',
      `Program data: ${buildTradeEventB64({})}`,
      'Program log: some unrelated instruction log',
      `Program data: ${buildTradeEventB64({ isBuy: false })}`,
      'Program 6EF8... success',
    ];
    const events = eventsFromLogs(logs);
    assert.equal(events.length, 2);
    assert.equal(events[0].side, 'BUY');
    assert.equal(events[1].side, 'SELL');
  });
  test('a Program-data line that fails to decode (wrong disc) is silently skipped', () => {
    const garbage = Buffer.alloc(89, 0xff).toString('base64');
    const logs = ['Program data: ' + garbage, `Program data: ${buildTradeEventB64({})}`];
    const events = eventsFromLogs(logs);
    assert.equal(events.length, 1);
  });
  test('empty or missing logs array returns an empty list, not a throw', () => {
    assert.deepEqual(eventsFromLogs([]), []);
    assert.deepEqual(eventsFromLogs(undefined), []);
    assert.deepEqual(eventsFromLogs(null), []);
  });
});
