import { JsonRpcProvider, formatUnits } from 'ethers';

const MONAD_RPC = 'https://rpc.monad.xyz';
const provider = new JsonRpcProvider(MONAD_RPC);

const POOLS = [
  { name: 'PancakeSwap V3 WMON/USDC', address: '0x63e48B725540A3Db24ACF6682a29f877808C53F2' },
  { name: 'Uniswap V3 WMON/USDC', address: '0x659bD0BC4167BA25c62E05656F78043E7eD4a9da' },
  { name: 'PancakeSwap V3 WMON/USDT0', address: '0x47BAe1454139Da12d7541c8D5f2B97364da67568' }
];

const V3_SWAP_TOPIC = '0xc42079f94a6350f1a2cf73efd65a4d103d6d4a46513037101b0f199f1746e32d'; // Uniswap v3 Swap
const PANCAKE_V3_SWAP_TOPIC = '0x19b47279256b2a23a1665c810c8d55a1758940ee09377d4f8d26497a3577dc83'; // PancakeSwap v3 Swap

const KNOWN_CONTRACTS = new Set([
  '0x1b81d678ffb9c0263b24a97847620c99d213eb14', // PancakeSwap Router
  '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900', // Uniswap Router
  '0x3bd359c1119da7da1d913d1c4d2b7c461115433a', // WMON
  '0x63e48b725540a3db24acf6682a29f877808c53f2', // Pancake WMON/USDC Pool
  '0x659bd0bc4167ba25c62e05656f78043e7ed4a9da', // Uniswap WMON/USDC Pool
  '0x47bae1454139da12d7541c8d5f2b97364da67568', // Pancake WMON/USDT0 Pool
  '0x0000000000000000000000000000000000000000', // Zero address
]);

async function main() {
  console.log('[Scanner] Starting Comprehensive Monad Mainnet Whale Scan...');
  const latestBlock = await provider.getBlockNumber();
  console.log(`[Scanner] Latest block: ${latestBlock}`);

  const blockSpan = 120000; // Scan last ~33 hours
  const startBlock = latestBlock - blockSpan;
  const rpcChunkSize = 90;
  
  const tradersMap = new Map(); // address -> { swapCount, poolDetails: Set }

  for (const pool of POOLS) {
    console.log(`[Scanner] Scanning ${pool.name} (${pool.address}) for the last ${blockSpan} blocks...`);
    let poolLogsCount = 0;
    
    for (let from = startBlock; from <= latestBlock; from += rpcChunkSize) {
      const to = Math.min(latestBlock, from + rpcChunkSize - 1);
      try {
        const chunkLogs = await provider.getLogs({
          address: pool.address,
          topics: [[V3_SWAP_TOPIC, PANCAKE_V3_SWAP_TOPIC]],
          fromBlock: from,
          toBlock: to
        });
        
        poolLogsCount += chunkLogs.length;

        for (const log of chunkLogs) {
          if (log.topics.length < 3) continue;
          const recipientTopic = log.topics[2];
          const traderAddress = '0x' + recipientTopic.slice(26).toLowerCase();

          if (KNOWN_CONTRACTS.has(traderAddress)) continue;

          if (!tradersMap.has(traderAddress)) {
            tradersMap.set(traderAddress, { swapCount: 0, pools: new Set() });
          }
          const info = tradersMap.get(traderAddress);
          info.swapCount += 1;
          info.pools.add(pool.name);
        }
        
        // Add progress log every 20,000 blocks to show status
        if ((from - startBlock) % 20000 < rpcChunkSize) {
          console.log(`[Scanner] Progress: Scanned blocks ${from} to ${to}...`);
        }

        // Rate limit throttle
        await new Promise((r) => setTimeout(r, 30));
      } catch (err) {
        // Skip log fetch errors
      }
    }
    console.log(`[Scanner] Finished ${pool.name}. Found ${poolLogsCount} swap events.`);
  }

  const uniqueTraders = Array.from(tradersMap.keys());
  console.log(`[Scanner] Found a total of ${uniqueTraders.length} unique trader addresses across all pools.`);

  console.log('[Scanner] Filtering out contract addresses and querying balances...');
  const wallets = [];

  // Query in chunks of 50
  const chunkSize = 50;
  for (let i = 0; i < uniqueTraders.length; i += chunkSize) {
    const chunk = uniqueTraders.slice(i, i + chunkSize);
    console.log(`[Scanner] Checking balances for chunk ${i + 1} to ${Math.min(i + chunkSize, uniqueTraders.length)}...`);

    await Promise.all(chunk.map(async (addr) => {
      try {
        const code = await provider.getCode(addr);
        if (code !== '0x') {
          // Contract, skip
          return;
        }

        const balance = await provider.getBalance(addr);
        const balanceMon = parseFloat(formatUnits(balance, 18));

        wallets.push({
          address: addr,
          balance: balanceMon,
          swapCount: tradersMap.get(addr).swapCount,
          pools: Array.from(tradersMap.get(addr).pools).join(', ')
        });
      } catch (err) {
        // Ignore single errors
      }
    }));
    await new Promise((r) => setTimeout(r, 100)); // Delay between chunks
  }

  console.log('[Scanner] Sorting wallets by balance...');
  wallets.sort((a, b) => b.balance - a.balance);

  const top50 = wallets.slice(0, 50);

  console.log('\n========================================================================');
  console.log('             TOP 50 RICHEST ACTIVE WHALES ON MONAD MAINNET              ');
  console.log('========================================================================');
  top50.forEach((w, index) => {
    console.log(`${(index + 1).toString().padEnd(3)} Address: ${w.address} | Balance: ${w.balance.toFixed(2).padStart(10)} MON | Swaps: ${w.swapCount.toString().padStart(3)} | Pools: ${w.pools}`);
  });
  console.log('========================================================================\n');
}

main().catch(console.error);
