/**
 * Deck card aggregation — shared, pure logic (extracted from listener.js /
 * solListener.js; both indexers had byte-identical copies).
 *
 * Collapses a whale's repeat buys of the same token (same groupId) into ONE
 * card: amounts are SUMMED, and each individual buy is preserved as a `leg`
 * for the card's detail view. `cards` is newest-first; the first card seen
 * per group carries the freshest metadata/price, then legs/totals accumulate
 * from every subsequent occurrence.
 */
export function aggregateDeck(cards) {
  const groups = new Map();
  for (const c of cards) {
    const gid = c.groupId || (c.trader + ':' + c.tokenAddress + ':' + c.side);
    let g = groups.get(gid);
    if (!g) {
      g = { ...c, id: gid, groupId: gid, buyCount: 0, amountUsd: 0, amountMon: 0, tokenAmount: 0, legs: [] };
      groups.set(gid, g);
    }
    g.buyCount += 1;
    g.amountUsd += c.amountUsd || 0;
    g.amountMon += c.amountMon || 0;
    g.tokenAmount += c.tokenAmount || 0;
    g.legs.push({ txHash: c.txHash, amountUsd: c.amountUsd, amountMon: c.amountMon, tokenAmount: c.tokenAmount, ts: c.ts, blockNumber: c.blockNumber });
  }
  // Preserve the deck's newest-first ordering by the most recent leg.
  return [...groups.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
