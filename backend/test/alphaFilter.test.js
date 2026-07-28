import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { isChurnBot, isBotAgg, isAlphaCard, isAlphaAgg, DEFAULT_CHURN_BUYS_MAX } from '../alphaFilter.js';

describe('isChurnBot — balanced two-way churn with net ≈ 0', () => {
  test('flags a basket bot (many balanced trades, tiny net)', () => {
    assert.equal(isChurnBot({ buys: 50, sells: 48, trades: 98, netMon: 5, volumeMon: 1000 }), true);
  });
  test('flags a high-volume churner', () => {
    assert.equal(isChurnBot({ buys: 20, sells: 22, trades: 42, netMon: 30, volumeMon: 900 }), true);
  });
  test('does NOT flag an accumulator whale (buy-only)', () => {
    assert.equal(isChurnBot({ buys: 12, sells: 0, trades: 12, netMon: -500, volumeMon: 500 }), false);
  });
  test('does NOT flag an exiter whale (mostly sells)', () => {
    assert.equal(isChurnBot({ buys: 2, sells: 15, trades: 17, netMon: 600, volumeMon: 800 }), false);
  });
  test('does NOT flag a directional swing trader', () => {
    assert.equal(isChurnBot({ buys: 8, sells: 2, trades: 10, netMon: -400, volumeMon: 600 }), false);
  });
  test('does NOT flag a small balanced whale below the trade-count floor', () => {
    assert.equal(isChurnBot({ buys: 2, sells: 2, trades: 4, netMon: 1, volumeMon: 200 }), false);
  });
  test('does NOT flag a big net-long trader (balanced count, large net)', () => {
    assert.equal(isChurnBot({ buys: 10, sells: 8, trades: 18, netMon: -500, volumeMon: 700 }), false);
  });
  test('does NOT flag a fresh whale (single trade)', () => {
    assert.equal(isChurnBot({ buys: 1, sells: 0, trades: 1, netMon: -300, volumeMon: 300 }), false);
  });
  test('handles missing/null agg safely', () => {
    assert.equal(isChurnBot(null), false);
    assert.equal(isChurnBot(undefined), false);
  });
  test('handles zero volume without dividing by zero', () => {
    assert.equal(isChurnBot({ buys: 5, sells: 5, trades: 10, netMon: 0, volumeMon: 0 }), false);
  });
  test('falls back to volumeUsd when volumeMon is absent (Solana agg shape)', () => {
    assert.equal(isChurnBot({ buys: 10, sells: 10, trades: 20, netMon: 1, volumeUsd: 500 }), true);
  });
  test('respects custom minTrades/netRatio options', () => {
    const agg = { buys: 3, sells: 3, trades: 6, netMon: 50, volumeMon: 100 }; // netRatio 0.5 — not "tiny" by default (0.15)
    assert.equal(isChurnBot(agg), false);
    assert.equal(isChurnBot(agg, { netRatio: 0.6 }), true); // widen the net-ratio tolerance → now flagged
    assert.equal(isChurnBot(agg, { minTrades: 10 }), false); // raise the trade floor above this agg's 6 → never flagged
  });
});

describe('isBotAgg — arb (same-slot) OR churn, with a missing-agg guard', () => {
  test('flags via arbHits regardless of churn shape', () => {
    assert.equal(isBotAgg({ buys: 1, sells: 0, trades: 1, netMon: -10, volumeMon: 10, arbHits: 5 }), true);
  });
  test('flags via churn when arbHits is absent/zero', () => {
    assert.equal(isBotAgg({ buys: 20, sells: 22, trades: 42, netMon: 5, volumeMon: 900, arbHits: 0 }), true);
  });
  test('a directional whale with zero arbHits is never flagged', () => {
    assert.equal(isBotAgg({ buys: 12, sells: 0, trades: 12, netMon: -500, volumeMon: 500, arbHits: 0 }), false);
  });
  test('an unknown trader (no agg on record) is not a bot by this signal', () => {
    assert.equal(isBotAgg(undefined), false);
    assert.equal(isBotAgg(null), false);
  });
  test('custom arbHitsMax raises the bar', () => {
    const agg = { buys: 1, sells: 0, trades: 1, netMon: -10, volumeMon: 10, arbHits: 2 };
    assert.equal(isBotAgg(agg, { arbHitsMax: 3 }), false); // below the raised threshold
    assert.equal(isBotAgg(agg, { arbHitsMax: 2 }), true);  // meets it
  });
});

describe('isAlphaCard — single-card gate (stablecoin + bot flag)', () => {
  test('rejects a stablecoin buy even for a non-bot trader', () => {
    assert.equal(isAlphaCard({ isStable: true }, { isBot: false }), false);
  });
  test('rejects any card from a flagged bot', () => {
    assert.equal(isAlphaCard({ isStable: false }, { isBot: true }), false);
  });
  test('accepts a normal alpha buy', () => {
    assert.equal(isAlphaCard({ isStable: false }, { isBot: false }), true);
  });
  test('defaults isBot to false when options omitted', () => {
    assert.equal(isAlphaCard({ isStable: false }), true);
  });
});

describe('isAlphaAgg — aggregated-card gate (adds the churn-buys-count cap)', () => {
  test('rejects a card at/above the churn-buys ceiling', () => {
    assert.equal(isAlphaAgg({ isStable: false, buyCount: DEFAULT_CHURN_BUYS_MAX }, { isBot: false }), false);
    assert.equal(isAlphaAgg({ isStable: false, buyCount: DEFAULT_CHURN_BUYS_MAX + 5 }, { isBot: false }), false);
  });
  test('accepts a card just below the ceiling', () => {
    assert.equal(isAlphaAgg({ isStable: false, buyCount: DEFAULT_CHURN_BUYS_MAX - 1 }, { isBot: false }), true);
  });
  test('treats a missing buyCount as 1 (single buy, never capped)', () => {
    assert.equal(isAlphaAgg({ isStable: false }, { isBot: false }), true);
  });
  test('still rejects on isBot even with a low buyCount', () => {
    assert.equal(isAlphaAgg({ isStable: false, buyCount: 1 }, { isBot: true }), false);
  });
  test('still rejects a stablecoin card even with a low buyCount', () => {
    assert.equal(isAlphaAgg({ isStable: true, buyCount: 1 }, { isBot: false }), false);
  });
  test('respects a custom churnBuysMax', () => {
    assert.equal(isAlphaAgg({ isStable: false, buyCount: 5 }, { isBot: false, churnBuysMax: 5 }), false);
    assert.equal(isAlphaAgg({ isStable: false, buyCount: 5 }, { isBot: false, churnBuysMax: 6 }), true);
  });
});
