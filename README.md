# DegenSlide —- Monad Mainnet Whale Copy-Trade

Tinder-style copy trading on **Monad mainnet**. The app surfaces real whales
the moment they trade and lets you copy their buys with a swipe — **no mock,
fake, or static data anywhere**. Every card is a real on-chain swap; every copy
is a real PancakeSwap v3 transaction.

---

## How it works

1. **On-chain indexer** (`backend/listener.js`) polls Monad mainnet for Uniswap v3
   and PancakeSwap v3 `Swap` logs, resolves each pool's tokens on-chain, isolates
   WMON-paired trades, and surfaces whale-sized buys/sells. It backfills recent
   history at boot and then streams new trades live.
2. **Deck** — each card is a real whale trade (real wallet, token, MON size),
   enriched with live **DexScreener** market data (price, liquidity, FDV, volume).
3. **Swipe right = copy** — buys the whale's token with MON on **PancakeSwap v3**
   (where Monad's liquidity lives). The minimum output is quoted live via an
   on-chain `eth_call` simulation of the real router, with a 2% slippage floor.
4. **Swipe up = all-in**, swipe left = skip.
5. **Leaderboard** ranks wallets by real indexed swap volume; **Watchlist** tracks
   any wallet's balance + indexed trades; **Portfolio** tracks your copies + live PnL.

---

## Real mainnet addresses used

| What | Address |
|------|---------|
| Chain | Monad mainnet — chainId `143` (`0x8f`), RPC `https://rpc.monad.xyz` |
| WMON | `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` |
| PancakeSwap v3 SwapRouter (copy exec) | `0x1b81D678ffb9C0263b24A97847620C99d213eB14` |
| Uniswap v3 SwapRouter02 | `0xfe31f71c1b106eac32f1a19239c9a9a72ddfb900` |
| Explorer | https://monadscan.com |

---

## Run it

**1. Start the whale indexer** (the deck depends on it):

```bash
cd backend
npm install
npm start          # serves WS :8081 (live feed) + HTTP :8082 (API)
```

Tune via env (see `backend/.env.example`), e.g. `WHALE_MIN_MON=5`,
`INCLUDE_STABLES=1` to also show MON/stablecoin whale flow.

**2. Start the frontend:**

```bash
npm install
cp .env.example .env   # points at the local indexer by default
npm run dev            # http://localhost:5173
```

Connect MetaMask (it will prompt to add/switch to Monad mainnet) and start swiping.

> **Real money:** copies execute real swaps on mainnet with your own funds.
> Start with a small copy amount in the ⚙️ settings.

---

## Tech

React 18 · Vite · Tailwind · react-tinder-card · framer-motion ·
ethers (backend indexer) · ws · DexScreener API · PancakeSwap v3 / Uniswap v3.

## Status / roadmap

- ✅ Phase 1 — mainnet, live whale indexer, per-swipe copy via MetaMask (this build).
- ⏳ Phase 2 — session-key SmartAccount + relayer (`contracts/`) for gasless,
  popup-free "seamless" copying. Contracts are written but not yet wired in.
