/**
 * Multi-chain config — single source of truth.
 * All values verified against official docs / live on-chain probes.
 * NO mock data: every address here is a real mainnet deployment.
 *
 * The app is single-active-chain: switching networks persists the choice and
 * reloads, so module-level exports below always reflect the ACTIVE chain.
 */

const env2 = typeof import.meta !== 'undefined' ? (import.meta.env ?? {}) : {};

export const CHAINS = {
  monad: {
    id: 'monad', label: 'Monad', kind: 'evm',
    nativeSymbol: 'MON',
    dexSlug: 'monad',                                  // DexScreener chain slug
    explorer: 'https://monadscan.com', txPath: 'tx', addrPath: 'address',
    indexerHttp: env2.VITE_INDEXER_HTTP || 'https://deepswap-monad-bot2.onrender.com',
    indexerWs: env2.VITE_INDEXER_WS || 'wss://deepswap-monad-bot2.onrender.com',
    // Deck size tiers (USD) — EXCLUSIVE ranges (big < shark < whale); 'all' is
    // the hard floor: nothing under $100 ever reaches the deck (whale app).
    tiers: { all: 100, big: 100, shark: 250, whale: 500 },
    copySupported: true,                               // MetaMask + PancakeSwap/Uniswap v3
    // Quick-pick copy amounts (native units) + gas headroom kept out of Max
    copyTiers: [{ label: '0.1', value: 0.1 }, { label: '1', value: 1 }, { label: '5', value: 5 }],
    gasBuffer: 0.05,
  },
  solana: {
    id: 'solana', label: 'Solana', kind: 'svm',
    nativeSymbol: 'SOL',
    nativeToken: 'So11111111111111111111111111111111111111112',
    dexSlug: 'solana',
    explorer: 'https://solscan.io', txPath: 'tx', addrPath: 'account',
    indexerHttp: env2.VITE_SOL_INDEXER_HTTP || 'https://deepswap-solana-bot.onrender.com',
    indexerWs: env2.VITE_SOL_INDEXER_WS || 'wss://deepswap-solana-bot.onrender.com',
    rpcUrl: env2.VITE_SOL_RPC || 'https://api.mainnet-beta.solana.com',
    jupiterApi: 'https://lite-api.jup.ag/swap/v1', // live Jupiter aggregator (quote + swap tx)
    // Solana tiers — exclusive ranges calibrated to the REAL size distribution
    // of tracked-whale swaps (most fall $150–1000); 'all' floor mirrors the
    // indexer's TRACK_MIN_USD.
    tiers: { all: 150, big: 300, shark: 1000, whale: 5000 },
    copySupported: true,                               // Phantom + Jupiter aggregator
    // SOL trades ~100x MON's unit value — quick picks scaled accordingly
    copyTiers: [{ label: '0.05', value: 0.05 }, { label: '0.25', value: 0.25 }, { label: '1', value: 1 }],
    gasBuffer: 0.01,
  },
};

export function activeChainId() {
  try {
    const v = JSON.parse(localStorage.getItem('degen_network'));
    return CHAINS[v] ? v : 'monad';
  } catch { return 'monad'; }
}
export function setActiveChainId(id) {
  try { localStorage.setItem('degen_network', JSON.stringify(CHAINS[id] ? id : 'monad')); } catch {}
}
export const ACTIVE = CHAINS[activeChainId()];

export const MONAD_MAINNET = {
  chainId: '0x8f', // 143
  chainIdNum: 143,
  chainName: 'Monad',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: ['https://rpc.monad.xyz'],
  blockExplorerUrls: ['https://monadscan.com'],
};

// Public explorer used for human-facing tx/address links (follows ACTIVE chain)
export const EXPLORER_URL = ACTIVE.explorer;
export const EXPLORER_TX_URL = (hash) => `${ACTIVE.explorer}/${ACTIVE.txPath}/${hash}`;
export const EXPLORER_ADDR_URL = (addr) => `${ACTIVE.explorer}/${ACTIVE.addrPath}/${addr}`;

// ── Real DEX contracts on Monad mainnet (chain id 143) ──
// Copy buys route through PancakeSwap v3 — that is where the liquidity lives
// (~$537k/24h vs Uniswap's ~$194k). Router verified on-chain + MonadScan label.
export const CONTRACTS = {
  // PancakeSwap v3 SwapRouter (classic Uniswap-v3 fork: exactInputSingle 0x414bf389, has deadline)
  PANCAKE_SWAP_ROUTER: '0x1b81D678ffb9C0263b24A97847620C99d213eB14',
  // Uniswap v3 (verified from official deployments) — kept for reference / fallback
  UNISWAP_SWAP_ROUTER_02: '0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900',
  UNISWAP_QUOTER_V2: '0x661e93cca42afacb172121ef892830ca3b70f08d',
  WMON: '0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A',
};

// PancakeSwap v3 fee tiers (note: 2500, not Uniswap's 3000), probed in this order.
export const FEE_TIERS = [500, 2500, 10000, 100];

// Default slippage tolerance for copy swaps (basis points). 200 = 2%.
export const DEFAULT_SLIPPAGE_BPS = 1000; // 10% default for volatile meme coins

// ── Backend indexer endpoints — follow the ACTIVE chain ──
// (env-overridable per chain: VITE_INDEXER_* for Monad, VITE_SOL_INDEXER_* for Solana)
export const INDEXER_WS = ACTIVE.indexerWs;
export const INDEXER_HTTP = ACTIVE.indexerHttp;

// DexScreener chain slug for the ACTIVE chain
export const DEXSCREENER_CHAIN = ACTIVE.dexSlug;
