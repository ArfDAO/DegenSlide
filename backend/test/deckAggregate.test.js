import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { aggregateDeck } from '../deckAggregate.js';

function card(over = {}) {
  return {
    trader: 'W1', tokenAddress: 'TOKEN_A', side: 'BUY',
    amountUsd: 100, amountMon: 1, tokenAmount: 10,
    txHash: 'tx1', ts: 1000, blockNumber: 1,
    ...over,
  };
}

describe('aggregateDeck', () => {
  test('a single card becomes a group of one with buyCount 1', () => {
    const out = aggregateDeck([card()]);
    assert.equal(out.length, 1);
    assert.equal(out[0].buyCount, 1);
    assert.equal(out[0].amountUsd, 100);
    assert.equal(out[0].legs.length, 1);
  });

  test('repeat buys by the same whale of the same token SUM into one card', () => {
    const cards = [
      card({ txHash: 'tx1', amountUsd: 100, amountMon: 1, tokenAmount: 10, ts: 1000 }),
      card({ txHash: 'tx2', amountUsd: 50, amountMon: 0.5, tokenAmount: 5, ts: 2000 }),
      card({ txHash: 'tx3', amountUsd: 25, amountMon: 0.25, tokenAmount: 2.5, ts: 3000 }),
    ];
    const out = aggregateDeck(cards);
    assert.equal(out.length, 1);
    assert.equal(out[0].buyCount, 3);
    assert.equal(out[0].amountUsd, 175);
    assert.equal(out[0].amountMon, 1.75);
    assert.equal(out[0].tokenAmount, 17.5);
    assert.equal(out[0].legs.length, 3);
  });

  test('legs preserve each buy\'s own txHash/amounts/ts (detail view accuracy)', () => {
    const cards = [
      card({ txHash: 'tx1', amountUsd: 100, ts: 1000 }),
      card({ txHash: 'tx2', amountUsd: 50, ts: 2000 }),
    ];
    const out = aggregateDeck(cards);
    const legHashes = out[0].legs.map((l) => l.txHash);
    assert.deepEqual(legHashes, ['tx1', 'tx2']);
    assert.equal(out[0].legs[0].amountUsd, 100);
    assert.equal(out[0].legs[1].amountUsd, 50);
  });

  test('different tokens for the same trader stay SEPARATE cards', () => {
    const cards = [card({ tokenAddress: 'TOKEN_A' }), card({ tokenAddress: 'TOKEN_B' })];
    const out = aggregateDeck(cards);
    assert.equal(out.length, 2);
  });

  test('different traders for the same token stay SEPARATE cards', () => {
    const cards = [card({ trader: 'W1' }), card({ trader: 'W2' })];
    const out = aggregateDeck(cards);
    assert.equal(out.length, 2);
  });

  test('BUY and SELL of the same token by the same whale stay SEPARATE (side is part of the group key)', () => {
    const cards = [card({ side: 'BUY' }), card({ side: 'SELL' })];
    const out = aggregateDeck(cards);
    assert.equal(out.length, 2);
  });

  test('explicit groupId overrides the derived key (used by live cards)', () => {
    const cards = [
      card({ groupId: 'custom:group', trader: 'W1', tokenAddress: 'TOKEN_A' }),
      card({ groupId: 'custom:group', trader: 'W2', tokenAddress: 'TOKEN_B' }), // would NOT match by derived key
    ];
    const out = aggregateDeck(cards);
    assert.equal(out.length, 1); // folded because groupId matches explicitly
    assert.equal(out[0].buyCount, 2);
  });

  test('output is sorted newest-first by the most recent leg timestamp', () => {
    const cards = [
      card({ trader: 'OLD', tokenAddress: 'X', ts: 1000 }),
      card({ trader: 'NEW', tokenAddress: 'Y', ts: 5000 }),
      card({ trader: 'MID', tokenAddress: 'Z', ts: 3000 }),
    ];
    const out = aggregateDeck(cards);
    assert.deepEqual(out.map((c) => c.trader), ['NEW', 'MID', 'OLD']);
  });

  // NOTE: the group's `ts` is set ONCE, from the first card the loop encounters
  // for that groupId (via the `{...c}` spread on group creation) — it is never
  // updated as later legs are folded in. This is safe ONLY because every real
  // caller feeds `cards` newest-first (recentWhales is built with `unshift`),
  // so the FIRST occurrence of a group in iteration order is always its most
  // recent trade. This test constructs input the same way production does —
  // NOT in chronological order — to correctly exercise that invariant.
  test('a repeat-buy group bubbles to the position of its NEWEST leg (given newest-first input, as production feeds it)', () => {
    const cards = [
      card({ trader: 'W1', tokenAddress: 'A', txHash: 't3', ts: 4000 }), // W1's latest buy — newest overall, first in the array
      card({ trader: 'W2', tokenAddress: 'B', txHash: 't2', ts: 2000 }), // unrelated whale, mid-age
      card({ trader: 'W1', tokenAddress: 'A', txHash: 't1', ts: 1000 }), // W1's earlier buy of the same token — appears later (older)
    ];
    const out = aggregateDeck(cards);
    assert.equal(out[0].trader, 'W1'); // the folded W1 card is newest (ts 4000, from the first-encountered occurrence)
    assert.equal(out[0].buyCount, 2);
    assert.equal(out[1].trader, 'W2');
  });
  test('feeding cards OUT of newest-first order breaks ts-based sort position for a folded group (documents the invariant above)', () => {
    const cards = [
      card({ trader: 'W1', tokenAddress: 'A', txHash: 't1', ts: 1000 }), // encountered FIRST → group.ts locks to 1000
      card({ trader: 'W2', tokenAddress: 'B', txHash: 't2', ts: 2000 }),
      card({ trader: 'W1', tokenAddress: 'A', txHash: 't3', ts: 4000 }), // folded in later — does NOT bump group.ts
    ];
    const out = aggregateDeck(cards);
    assert.equal(out[0].trader, 'W2'); // W2(2000) now sorts ABOVE W1's group, which is stuck at ts=1000 — wrong-order input, wrong-order result
  });

  test('missing amount fields default to 0 rather than producing NaN', () => {
    const out = aggregateDeck([{ trader: 'W1', tokenAddress: 'A', side: 'BUY', txHash: 't1', ts: 1 }]);
    assert.equal(out[0].amountUsd, 0);
    assert.equal(out[0].amountMon, 0);
    assert.equal(out[0].tokenAmount, 0);
  });

  test('empty input returns an empty array', () => {
    assert.deepEqual(aggregateDeck([]), []);
  });

  test('the first-seen card in a group supplies the base metadata (symbol/liquidity)', () => {
    const cards = [
      card({ txHash: 't1', ts: 1000, tokenSymbol: 'FIRSTSEEN', liquidityUsd: 1234 }),
      card({ txHash: 't2', ts: 2000, tokenSymbol: 'SHOULD_NOT_OVERRIDE', liquidityUsd: 9999 }),
    ];
    const out = aggregateDeck(cards);
    assert.equal(out[0].tokenSymbol, 'FIRSTSEEN');
    assert.equal(out[0].liquidityUsd, 1234);
  });
});
