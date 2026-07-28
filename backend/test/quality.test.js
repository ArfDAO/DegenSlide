import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { qualityScore, recencyMultiplier, daysSince } from '../quality.js';

describe('recencyMultiplier', () => {
  test('unknown recency (null) is NOT penalized — no data ≠ stale', () => {
    assert.equal(recencyMultiplier(null), 1);
    assert.equal(recencyMultiplier(undefined), 1);
  });
  test('bucket boundaries: <=7d full, <=30d 0.7x, <=90d 0.4x, beyond 0.15x', () => {
    assert.equal(recencyMultiplier(0), 1);
    assert.equal(recencyMultiplier(7), 1);
    assert.equal(recencyMultiplier(7.1), 0.7);
    assert.equal(recencyMultiplier(30), 0.7);
    assert.equal(recencyMultiplier(30.1), 0.4);
    assert.equal(recencyMultiplier(90), 0.4);
    assert.equal(recencyMultiplier(90.1), 0.15);
    assert.equal(recencyMultiplier(365), 0.15);
  });
});

describe('daysSince', () => {
  test('returns null for falsy/non-finite input', () => {
    assert.equal(daysSince(null), null);
    assert.equal(daysSince(undefined), null);
    assert.equal(daysSince(0), null);
    assert.equal(daysSince(NaN), null);
  });
  test('a timestamp ~7 days ago returns ≈7', () => {
    const d = daysSince(Date.now() - 7 * 86400000);
    assert.ok(d > 6.9 && d < 7.1, `expected ≈7, got ${d}`);
  });
  test('a future timestamp (clock skew) returns null, not a negative day count', () => {
    assert.equal(daysSince(Date.now() + 86400000), null);
  });
});

describe('qualityScore', () => {
  test('a profitable, fresh, high-volume whale scores far above a stale unprofitable high-volume one', () => {
    const goodWhale = qualityScore({ realizedUsd: 8000, volumeUsd: 100000, winRate: 0.7, closedTokens: 10, recencyDays: 2 });
    const staleWhale = qualityScore({ realizedUsd: 0, volumeUsd: 200000, winRate: null, closedTokens: 0, recencyDays: 120 });
    assert.ok(goodWhale > staleWhale * 10, `expected goodWhale (${goodWhale}) to be >10x staleWhale (${staleWhale})`);
  });

  test('at similar volume scale, the profitable high-win-rate whale outranks the unprofitable low-win-rate one', () => {
    // Same order-of-magnitude volume — isolates the realized-PnL/win-rate signal
    // from the volume floor (a 100x volume gap would let the floor dominate
    // regardless of profitability, which is the formula's documented, intended
    // behavior — see the goodWhale/staleWhale test above for that case).
    const profitable = qualityScore({ realizedUsd: 2000, volumeUsd: 5000, winRate: 0.8, closedTokens: 5, recencyDays: 1 });
    const unprofitable = qualityScore({ realizedUsd: -500, volumeUsd: 6000, winRate: 0.3, closedTokens: 5, recencyDays: 1 });
    assert.ok(profitable > unprofitable, `expected profitable (${profitable}) > unprofitable (${unprofitable})`);
  });

  test('negative realized PnL floors to a small positive volume-only score (never deeply negative)', () => {
    const s = qualityScore({ realizedUsd: -10000, volumeUsd: 100000, recencyDays: 1 });
    assert.ok(s > 0, `expected a positive floor, got ${s}`);
    assert.ok(s <= 100000 * 0.01 + 0.0001, `expected the 1% volume floor, got ${s}`);
  });

  test('win-rate multiplier only applies once MIN_CLOSED_FOR_WINRATE is met', () => {
    const base = { realizedUsd: 1000, volumeUsd: 1000, recencyDays: 1 };
    const noWinRateYet = qualityScore({ ...base, winRate: 0.9, closedTokens: 2 }); // below the floor (3)
    const noWinRateAtAll = qualityScore({ ...base, winRate: null, closedTokens: 0 });
    assert.equal(noWinRateYet, noWinRateAtAll); // identical — winRate ignored below the closed-position floor
    const withWinRate = qualityScore({ ...base, winRate: 0.9, closedTokens: 3 }); // meets the floor
    assert.ok(withWinRate > noWinRateAtAll); // 0.9 winRate → 1.32x multiplier kicks in
  });

  test('win-rate multiplier range is clamped 0.6x–1.4x', () => {
    const base = { realizedUsd: 1000, volumeUsd: 0, recencyDays: 1, closedTokens: 5 };
    const zero = qualityScore({ ...base, winRate: 0 });
    const perfect = qualityScore({ ...base, winRate: 1 });
    assert.ok(Math.abs(zero - 1000 * 0.6) < 1e-9);
    assert.ok(Math.abs(perfect - 1000 * 1.4) < 1e-9);
  });

  test('win rate outside [0,1] is clamped rather than distorting the score', () => {
    const base = { realizedUsd: 1000, volumeUsd: 0, recencyDays: 1, closedTokens: 5 };
    const over = qualityScore({ ...base, winRate: 5 });    // clamps to 1
    const under = qualityScore({ ...base, winRate: -3 });  // clamps to 0
    assert.ok(Math.abs(over - 1000 * 1.4) < 1e-9);
    assert.ok(Math.abs(under - 1000 * 0.6) < 1e-9);
  });

  test('recency decay is applied AFTER the win-rate multiplier (multiplicative, not additive)', () => {
    const base = { realizedUsd: 1000, volumeUsd: 0, winRate: 1, closedTokens: 5 };
    const fresh = qualityScore({ ...base, recencyDays: 1 });
    const stale = qualityScore({ ...base, recencyDays: 120 }); // 0.15x decay
    assert.ok(Math.abs(stale - fresh * 0.15) < 1e-6, `expected stale ≈ fresh*0.15 (fresh=${fresh}, stale=${stale})`);
  });

  test('all-default (no args) does not throw and returns 0', () => {
    assert.equal(qualityScore(), 0);
    assert.equal(qualityScore({}), 0);
  });
});
