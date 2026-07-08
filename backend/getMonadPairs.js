async function test() {
  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/search?q=monad');
    const j = await res.json();
    const pairs = j.pairs || [];
    console.log(`Found ${pairs.length} pairs matching "monad"`);
    pairs.slice(0, 10).forEach((p) => {
      console.log(`- ${p.baseToken.symbol}/${p.quoteToken.symbol} | Dex: ${p.dexId} | Vol 24h: $${p.volume?.h24} | Pool: ${p.pairAddress}`);
    });
  } catch (err) {
    console.error('Error fetching pairs:', err);
  }
}
test();
