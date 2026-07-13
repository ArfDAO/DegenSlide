import { useCallback, useEffect, useRef, useState } from 'react';
import SwipeCard from './components/SwipeCard';
import Leaderboard from './components/Leaderboard';
import Portfolio from './components/Portfolio';
import WatchlistPanel from './components/WatchlistPanel';
import CuratedWhales from './components/CuratedWhales';
import ProfilePage from './components/ProfilePage';
import TurboPanel from './components/TurboPanel';
import { hasTurboAgreement, turboWalletExists, turboCopyBuy, turboSellToken } from './services/turboWallet';
import curatedWhalesData from './data/curatedWhales.json';
import { X, Copy, Zap, Settings, Check, AlertTriangle, Info, Layers, WifiOff } from 'lucide-react';
import { fetchMONPrice, fetchTokensByAddresses } from './services/dexscreenerApi';
import {
  fetchWhaleDeck,
  fetchWhaleLeaderboard,
  openWhaleFeed,
  indexerHealth,
} from './services/indexerApi';
import { EXPLORER_URL, EXPLORER_ADDR_URL, DEFAULT_SLIPPAGE_BPS, ACTIVE, CHAINS, setActiveChainId, INDEXER_HTTP } from './config/chain.js';
import {
  connectWallet,
  getConnectedAccount,
  sellToken,
  getMonBalance,
  isWalletAvailable,
  onAccountsChanged,
  disconnectWallet,
  WALLET_NAME,
  WALLET_INSTALL_URL,
} from './services/activeWallet';

// Per-chain localStorage keys — positions/balances/amounts are chain-specific.
// (Monad keeps its original keys so existing users lose nothing.)
const LSK = (name, legacy) => (ACTIVE.id === 'monad' ? legacy : `${ACTIVE.id}_${name}`);
const WALLET_LS = LSK('wallet', 'monad_wallet');
const PORTFOLIO_LS = LSK('portfolio', 'monad_portfolio');
const LASTTX_LS = LSK('lastTx', 'monad_lastTx');
const BALHIST_LS = LSK('balHist', 'monad_balHist');
const AMOUNT_LS = LSK('tradeAmount', 'monad_tradeAmount');

/* ── Clock ── */
function useClock() {
  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  });
  useEffect(() => {
    const id = setInterval(() => {
      const d = new Date();
      setTime(`${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`);
    }, 10000);
    return () => clearInterval(id);
  }, []);
  return time;
}

/* ── Toasts ── */
const TOASTS = {
  pass:       { msg: 'Skipped',            kind: 'info', color: 'var(--color-midnight-ink)' },
  copy:       { msg: 'Copy sent',          kind: 'ok',   color: 'var(--color-tidewater-navy)' },
  connect:    { msg: 'Wallet connected',   kind: 'ok',   color: 'var(--color-tidewater-navy)' },
  copy_pending: { msg: 'Confirm in wallet…', kind: 'info', color: 'var(--color-tidewater-navy)' },
  tx_sent:    { msg: 'Copy confirmed on-chain', kind: 'ok', color: 'var(--color-tidewater-navy)' },
  tx_failed:  { msg: 'Transaction failed on-chain', kind: 'err', color: 'var(--color-obsidian)' },
  tx_error:   { msg: 'Copy failed',        kind: 'err',  color: 'var(--color-obsidian)' },
  no_balance: { msg: 'Can’t verify balance — trade blocked', kind: 'err', color: 'var(--color-obsidian)' },
  no_liq:     { msg: 'No liquidity to copy', kind: 'err', color: 'var(--color-obsidian)' },
  no_funds:   { msg: `Not enough ${ACTIVE.nativeSymbol}`, kind: 'err',  color: 'var(--color-obsidian)' },
  no_wallet:  { msg: `Install ${WALLET_NAME}`, kind: 'err',  color: 'var(--color-obsidian)' },
  no_indexer: { msg: 'Whale feed offline', kind: 'err',  color: 'var(--color-obsidian)' },
  sl_hit:     { msg: 'Stop-loss hit',      kind: 'err',  color: 'var(--color-obsidian)' },
  tp_hit:     { msg: 'Take-profit hit',    kind: 'ok',   color: 'var(--color-tidewater-navy)' },
  sell_pending: { msg: 'Approve sell…',    kind: 'info', color: 'var(--color-tidewater-navy)' },
  sell_sent:  { msg: 'Position closed',    kind: 'ok',   color: 'var(--color-tidewater-navy)' },
  sell_cancel: { msg: 'Sell cancelled',    kind: 'info', color: 'var(--color-midnight-ink)' },
  sell_fail:  { msg: 'Sell failed',        kind: 'err',  color: 'var(--color-obsidian)' },
  sell_nobal: { msg: 'No tokens to sell',  kind: 'err',  color: 'var(--color-obsidian)' },
  whale_exit: { msg: 'Whale exited — closing your copy', kind: 'info', color: 'var(--color-tidewater-navy)' },
};
const TOAST_ICON = { ok: Check, err: AlertTriangle, info: Info };

/* ── Nav icons ── */
function IconDeck({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="13" rx="3" stroke={c} strokeWidth="1.6" fill={active ? 'rgba(34,211,238,0.14)' : 'none'}/><rect x="7" y="5" width="13" height="12" rx="3" stroke={c} strokeWidth="1.6" fill={active ? 'rgba(34,211,238,0.07)' : 'none'}/></svg>);
}
function IconPortfolio({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="12" width="4" height="9" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/><rect x="10" y="7" width="4" height="14" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/><rect x="17" y="3" width="4" height="18" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/></svg>);
}
function IconLeaderboard({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" stroke={c} strokeWidth="1.6" strokeLinejoin="round" fill={active ? 'rgba(34,211,238,0.18)' : 'none'}/></svg>);
}
function IconProfile({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.6" fill={active ? 'rgba(34,211,238,0.14)' : 'none'}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg>);
}
const TABS = [
  { id: 'deck', Icon: IconDeck, label: 'Deck' },
  { id: 'portfolio', Icon: IconPortfolio, label: 'Portfolio' },
  { id: 'leaderboard', Icon: IconLeaderboard, label: 'Top' },
  { id: 'profile', Icon: IconProfile, label: 'Profile' },
];

/* ── localStorage helpers ── */
function loadLS(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw !== null ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function saveLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }

// Quick-pick copy amounts in the chain's native unit (MON vs SOL scale differs ~100x)
const TIERS = ACTIVE.copyTiers;

const SLIPPAGE_TIERS = [
  { label: '0.5%', bps: 50 },
  { label: '1%', bps: 100 },
  { label: '2%', bps: 200 },
  { label: '5%', bps: 500 },
];

/* ── Trade settings popover: copy amount + slippage (token is dictated by the whale) ── */
function TradeSettingsPopover({ open, onClose, amount, onChangeAmount, slippageBps, onChangeSlippage, monPriceUsd, monBalance }) {
  const [manualVal, setManualVal] = useState('');
  const isManual = !TIERS.some((t) => t.value === amount);
  if (!open) return null;
  const GAS_BUFFER = ACTIVE.gasBuffer; // leave native funds for gas/rent
  const maxCopy = monBalance != null ? Math.max(0, monBalance - GAS_BUFFER) : null;
  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'rgba(2,4,10,0.55)', backdropFilter: 'blur(6px)', borderRadius: 'inherit' }} />
      <div className="animate-slide-up-modal" style={{ position: 'absolute', bottom: 90, left: 16, right: 16, zIndex: 81, background: 'var(--surface-1)', borderRadius: 24, padding: 20, boxShadow: 'var(--shadow-lg)', border: '1px solid var(--line-1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>Copy Amount</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 14, border: 'none', background: 'var(--color-frost-shadow)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-pebble)' }}><X size={15} /></button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{ACTIVE.nativeSymbol} spent per copy</label>
          {monBalance != null && (
            <button type="button" onClick={() => { if (maxCopy > 0) { setManualVal(String(+maxCopy.toFixed(3))); onChangeAmount(+maxCopy.toFixed(3)); } }}
              style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-tidewater-navy)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Balance: {monBalance.toFixed(3)} {ACTIVE.nativeSymbol} · Max
            </button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {TIERS.map((tier) => {
            const active = !isManual && amount === tier.value;
            return (
              <button key={tier.value} type="button" onClick={() => { setManualVal(''); onChangeAmount(tier.value); }}
                style={{ flex: 1, padding: '10px 0', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: active ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: active ? '#fff' : 'var(--color-midnight-ink)' }}>
                {tier.label}
              </button>
            );
          })}
          <input type="text" inputMode="decimal" placeholder="Custom" value={manualVal}
            onFocus={() => { if (isManual) setManualVal(String(amount)); }}
            onChange={(e) => { const raw = e.target.value.replace(/[^0-9.]/g, ''); setManualVal(raw); const num = parseFloat(raw); if (!isNaN(num) && num > 0) onChangeAmount(num); }}
            style={{ flex: 1, padding: '10px 8px', borderRadius: 12, border: `1px solid ${isManual ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)'}`, background: 'var(--color-frost-shadow)', color: 'var(--color-midnight-ink)', fontSize: 13, fontWeight: 600, textAlign: 'center', outline: 'none', minWidth: 0 }} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-pebble)', marginTop: 8, fontWeight: 600 }}>
          {monPriceUsd ? `≈ $${(amount * monPriceUsd).toFixed(4)} USD per copy` : `Each swipe buys the whale’s token with this much ${ACTIVE.nativeSymbol}`}
        </div>
        {maxCopy != null && amount > maxCopy && (
          <div style={{ fontSize: 11, color: 'var(--color-aurora-magenta)', marginTop: 4, fontWeight: 700 }}>
            Over balance — need {ACTIVE.nativeSymbol} for gas too. Max ≈ {maxCopy.toFixed(3)}.
          </div>
        )}

        {/* Slippage tolerance */}
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--color-silver-lining)' }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Slippage tolerance</label>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {SLIPPAGE_TIERS.map((s) => {
              const active = slippageBps === s.bps;
              return (
                <button key={s.bps} type="button" onClick={() => onChangeSlippage(s.bps)}
                  style={{ flex: 1, padding: '9px 0', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: active ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: active ? '#fff' : 'var(--color-midnight-ink)' }}>
                  {s.label}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-pebble)', marginTop: 6, fontWeight: 600 }}>
            Max price move tolerated per swap. Higher fills in volatile pools; lower is safer.
          </div>
        </div>
      </div>
    </>
  );
}

// Verified whale roster for the ACTIVE chain: Monad ships the on-chain-scanned
// file (backend/scanWhales.js); Solana serves its live-promoted roster over
// HTTP (/roster). Both are real, bot-filtered on-chain wallets.
const STATIC_CURATED = ACTIVE.id === 'monad' ? (curatedWhalesData.whales || []) : [];

// Deck size-tier filter (USD value of the trade) — thresholds are per-chain.
// Tiers are EXCLUSIVE ranges: Big = [big, shark), Shark = [shark, whale),
// Whale = [whale, ∞). 'All' shows everything above the hard floor (tiers.all)
// — nothing below that floor ever reaches the deck.
const TIERS_USD = ACTIVE.tiers;
const DECK_TIERS = [
  { id: 'all', label: 'All', color: 'var(--text-3)' },
  { id: 'big', label: 'Big', color: '#38bdf8' },
  { id: 'shark', label: 'Shark', color: '#a78bfa' },
  { id: 'whale', label: 'Whale', color: '#22d3ee' },
];
function inTier(usd, id) {
  if (usd < (TIERS_USD.all || 0)) return false; // global floor, every tier
  if (id === 'big') return usd >= TIERS_USD.big && usd < TIERS_USD.shark;
  if (id === 'shark') return usd >= TIERS_USD.shark && usd < TIERS_USD.whale;
  if (id === 'whale') return usd >= TIERS_USD.whale;
  return true; // 'all'
}

export default function App() {
  const clock = useClock();
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState(() => loadLS(WALLET_LS, null));
  const [isConnecting, setIsConnecting] = useState(false);
  const [cards, setCards] = useState([]);
  const [toast, setToast] = useState(null);
  const [showApe, setShowApe] = useState(false);
  const [portfolio, setPortfolio] = useState(() =>
    loadLS(PORTFOLIO_LS, []).map((p, i) => (p.id ? p : { ...p, id: `${p.token?.address || 'pos'}-${p.time || 0}-${i}` }))
  );
  const [activeTab, setActiveTab] = useState(() => loadLS('monad_tab', 'deck'));
  const [isLoading, setIsLoading] = useState(true);
  const [indexerUp, setIndexerUp] = useState(true);
  const [monPriceUsd, setMonPriceUsd] = useState(null);
  const [monBalance, setMonBalance] = useState(null);
  const [tradeAmount, setTradeAmount] = useState(() => loadLS(AMOUNT_LS, TIERS[1].value));
  const [slippageBps, setSlippageBps] = useState(() => loadLS('monad_slippage', DEFAULT_SLIPPAGE_BPS));
  const [lastTxHash, setLastTxHash] = useState(() => loadLS(LASTTX_LS, null));
  // Favorites/watchlist are address-format-specific → stored per chain
  // (Monad keeps its original keys; other chains get prefixed ones).
  const FAV_KEY = ACTIVE.id === 'monad' ? 'monad_favorites' : `${ACTIVE.id}_favorites`;
  const WATCH_KEY = ACTIVE.id === 'monad' ? 'monad_watchlist' : `${ACTIVE.id}_watchlist`;
  const [favorites, setFavorites] = useState(() => loadLS(FAV_KEY, []));
  const [watchlist, setWatchlist] = useState(() => loadLS(WATCH_KEY, []));
  // Verified roster for this chain (Solana: fetched live from the indexer)
  const [curatedWhalesList, setCuratedWhalesList] = useState(STATIC_CURATED);
  const curatedSet = curatedWhalesList.reduce((s, w) => (s.add((w.address || '').toLowerCase()), s), new Set());
  useEffect(() => {
    // Both chains serve a live /roster that MERGES the scanned/curated file with
    // this session's live-promoted whales, so Smart Money grows over time.
    // Monad seeds instantly from the bundled file, then the fetch takes over.
    let alive = true;
    const load = () => fetch(`${INDEXER_HTTP}/roster`).then((r) => r.json())
      .then((d) => { if (alive && Array.isArray(d.whales) && d.whales.length) setCuratedWhalesList(d.whales); })
      .catch(() => {});
    load();
    const id = setInterval(load, 60000); // live-promoted roster keeps growing
    return () => { alive = false; clearInterval(id); };
  }, []);
  const [settings, setSettings] = useState(() => ({ liveFeed: true, hideStables: false, minWhaleMon: 0, autoSell: true, ...loadLS('monad_settings', {}) }));
  const [balanceHistory, setBalanceHistory] = useState(() => loadLS(BALHIST_LS, []));
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const sellingRef = useRef(new Set());
  const whaleExitRef = useRef(null); // "whale sold → close my copy" handler (wired below)
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbMode, setLbMode] = useState('rankings');
  const [showTradeSettings, setShowTradeSettings] = useState(false);
  // Turbo 1-swipe trading: agreement + local trading wallet → no per-trade popups
  const [turboOpen, setTurboOpen] = useState(false);
  const pendingTradeRef = useRef(null); // swipe that triggered first-time Turbo setup — replayed after funding
  // USD scale differs per chain, so the tier choice is stored per chain too
  const DECKTIER_LS = LSK('deckTier', 'monad_deckTier');
  const [deckTier, setDeckTier] = useState(() => loadLS(DECKTIER_LS, 'all'));
  useEffect(() => { saveLS(DECKTIER_LS, deckTier); }, [deckTier]);
  const topCardRef = useRef(null);

  // Viewport scale
  useEffect(() => {
    const CONTAINER_H = 852, PADDING = 16;
    const update = () => {
      const scale = Math.min(1, (window.innerHeight - PADDING) / CONTAINER_H);
      document.documentElement.style.setProperty('--app-scale', scale);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // Auto-reconnect the ACTIVE chain's wallet (MetaMask on Monad, Phantom on Solana)
  useEffect(() => {
    getConnectedAccount().then((addr) => {
      if (addr) { setWalletAddress(addr); setIsConnected(true); saveLS(WALLET_LS, addr); }
    });
    return onAccountsChanged((accounts) => {
      if (!accounts.length) { setIsConnected(false); setWalletAddress(null); saveLS(WALLET_LS, null); }
      else { setWalletAddress(accounts[0]); saveLS(WALLET_LS, accounts[0]); }
    });
  }, []);

  useEffect(() => { if (walletAddress) { saveLS(WALLET_LS, walletAddress); setIsConnected(true); } }, [walletAddress]);
  useEffect(() => { saveLS(PORTFOLIO_LS, portfolio); }, [portfolio]);
  useEffect(() => { if (lastTxHash) saveLS(LASTTX_LS, lastTxHash); }, [lastTxHash]);
  useEffect(() => { saveLS('monad_tab', activeTab); }, [activeTab]);
  useEffect(() => { saveLS(AMOUNT_LS, tradeAmount); }, [tradeAmount]);
  useEffect(() => { saveLS('monad_slippage', slippageBps); }, [slippageBps]);
  useEffect(() => { saveLS(FAV_KEY, favorites); }, [favorites]);
  useEffect(() => { saveLS(WATCH_KEY, watchlist); }, [watchlist]);
  useEffect(() => { saveLS('monad_settings', settings); }, [settings]);

  const updateSetting = useCallback((key, value) => setSettings((s) => ({ ...s, [key]: value })), []);

  const addWatchWallet = useCallback((addr) => setWatchlist((p) => (p.includes(addr) ? p : [addr, ...p])), []);
  const toggleFavorite = useCallback((trader) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.address === trader.address);
      return exists ? prev.filter((f) => f.address !== trader.address) : [{ ...trader }, ...prev];
    });
  }, []);

  // The Watchlist view always shows favorited whales plus any manually
  // added wallets — so anything you save on a card appears here too.
  const watchlistView = (() => {
    const favAddrs = favorites.map((f) => (f.address || '').toLowerCase()).filter(Boolean);
    return [...new Set([...favAddrs, ...watchlist])];
  })();
  const isFavAddr = (addr) => favorites.some((f) => (f.address || '').toLowerCase() === addr);
  const removeFromWatchlist = useCallback((addr) => {
    const a = (addr || '').toLowerCase();
    setWatchlist((prev) => prev.filter((w) => w !== a));
    // if it's only here because it's favorited, un-favorite it too
    setFavorites((prev) => prev.filter((f) => (f.address || '').toLowerCase() !== a));
  }, []);
  const saveAllCurated = useCallback((save) => {
    setFavorites((prev) => {
      if (!save) return prev.filter((f) => !curatedSet.has((f.address || '').toLowerCase()));
      const have = new Set(prev.map((f) => (f.address || '').toLowerCase()));
      const adds = curatedWhalesList.filter((w) => !have.has(w.address.toLowerCase())).map((w) => ({ address: w.address, tokenSymbol: w.lastToken }));
      return [...adds, ...prev];
    });
  }, []);

  // ── Load real whale deck + MON price + leaderboard; open live feed ──
  useEffect(() => {
    let alive = true;
    setIsLoading(true);
    indexerHealth().then((h) => { if (alive) setIndexerUp(!!h); });
    Promise.all([fetchWhaleDeck(40), fetchMONPrice(), fetchWhaleLeaderboard()])
      .then(([deck, mon, lb]) => {
        if (!alive) return;
        setCards(deck);
        if (mon) setMonPriceUsd(mon.priceUsd);
        setLeaderboard(lb);
        setIndexerUp(deck.length > 0 || indexerUp);
      })
      .finally(() => { if (alive) setIsLoading(false); });

    const closeFeed = openWhaleFeed((card) => {
      // Whale SELLs never become deck cards (you can't "copy" an exit you don't
      // hold) — but they DO drive the per-position "sell when the whale sells"
      // automation below.
      if (card.side === 'SELL') { whaleExitRef.current?.(card); return; }
      if (!settingsRef.current.liveFeed) return; // live feed paused in settings
      setCards((prev) => (prev.find((c) => c.id === card.id) ? prev : [card, ...prev].slice(0, 60)));
    });

    const lbTimer = setInterval(() => fetchWhaleLeaderboard().then((lb) => { if (alive && lb.length) setLeaderboard(lb); }), 20000);
    const monTimer = setInterval(() => fetchMONPrice().then((m) => { if (alive && m) setMonPriceUsd(m.priceUsd); }), 30000);

    return () => { alive = false; closeFeed(); clearInterval(lbTimer); clearInterval(monTimer); };
  }, []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2800); return () => clearTimeout(t); }, [toast]);
  const showToast = (type, msg) => setToast({ type, key: Date.now(), msg });

  const removeCard = useCallback((trader) => setCards((prev) => prev.filter((c) => c.id !== trader.id)), []);

  const refreshBalance = useCallback((addr) => {
    const a = addr || walletAddress;
    if (!a) return;
    getMonBalance(a).then((b) => {
      if (b == null) return;
      setMonBalance(b);
      // record a real balance snapshot for the history chart (throttled to ~1/min)
      setBalanceHistory((prev) => {
        const last = prev[prev.length - 1];
        const now = Date.now();
        if (last && now - last.t < 60000 && Math.abs(last.v - b) < 1e-9) return prev;
        const next = [...prev, { t: now, v: b }].slice(-80);
        saveLS(BALHIST_LS, next);
        return next;
      });
    });
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) { setMonBalance(null); return; }
    refreshBalance(walletAddress);
    const id = setInterval(() => refreshBalance(walletAddress), 20000);
    return () => clearInterval(id);
  }, [walletAddress, refreshBalance]);

  const doConnect = useCallback(async () => {
    if (!isWalletAvailable()) { showToast('no_wallet'); window.open(WALLET_INSTALL_URL, '_blank'); return false; }
    setIsConnecting(true);
    try {
      const addr = await connectWallet();
      setWalletAddress(addr); setIsConnected(true); saveLS(WALLET_LS, addr);
      showToast('connect');
      return true;
    } catch (err) {
      if (err.message !== 'NO_METAMASK' && err.code !== 4001) showToast('tx_error');
      return false;
    } finally { setIsConnecting(false); }
  }, []);

  // Record a confirmed buy into the portfolio (shared by every execution path).
  // Turbo and wallet positions never merge — their tokens sit in different wallets.
  const recordBuy = useCallback((trader, amountMon, action, { hash, expectedOut, dex, decimals: liveDecimals, turbo }) => {
    setLastTxHash(hash);
    showToast('tx_sent');
    const addr = (trader.tokenAddress || '').toLowerCase();
    const decimals = liveDecimals ?? trader.tokenDecimals ?? 18;
    const invested = monPriceUsd ? amountMon * monPriceUsd : 0;
    const gotTokens = (expectedOut || '0').toString();
    // Upsert: buying the same token again averages into one position (real DCA).
    setPortfolio((prev) => {
      const i = prev.findIndex((p) => (p.token?.address || '').toLowerCase() === addr && !!p.turbo === !!turbo);
      if (i >= 0) {
        const p = prev[i];
        const merged = {
          ...p,
          amountMon: (p.amountMon ?? p.amount ?? 0) + amountMon,
          tokensRaw: (BigInt(p.tokensRaw || '0') + BigInt(gotTokens)).toString(),
          investedUsd: (p.investedUsd ?? 0) + invested,
          lastTime: Date.now(),
        };
        const copy = [...prev]; copy[i] = merged; return copy;
      }
      const entry = {
        id: `${addr}-${Date.now()}`,
        trader: { address: trader.address },
        action,
        token: { symbol: trader.tokenSymbol, address: trader.tokenAddress, decimals },
        dex: dex || trader.dex || null,
        amountMon,
        tokensRaw: gotTokens,
        investedUsd: invested,
        monPriceUsd: monPriceUsd ?? null,
        time: Date.now(),
        stopLossPct: null,
        takeProfitPct: null,
        sellOnWhaleExit: false, // per-position "sell when the whale sells" toggle
        turbo: !!turbo, // executed & held by the Turbo trading wallet
      };
      return [entry, ...prev];
    });
    setFavorites((prev) => (prev.find((f) => f.address === trader.address) ? prev : [{ address: trader.address, tokenSymbol: trader.tokenSymbol }, ...prev]));
  }, [monPriceUsd]);

  // ── Copy execution: TURBO 1-swipe — the swap is signed locally by the Turbo
  // trading wallet and broadcast immediately. No wallet popup per trade; the
  // one-time agreement + funding happen in TurboPanel. ──
  const sendCopy = useCallback(async (trader, amountMon, action = 'COPY') => {
    // Safety net for any future chain without in-app execution
    if (!ACTIVE.copySupported) {
      if (trader?.tokenAddress) window.open(`https://jup.ag/swap/SOL-${trader.tokenAddress}`, '_blank');
      showToast('copy', 'Opened on Jupiter — in-app copy not live on this chain yet');
      return;
    }
    // First swipe ever → run the one-time agreement + funding flow, then replay.
    if (!hasTurboAgreement() || !turboWalletExists()) {
      pendingTradeRef.current = { trader, amountMon, action };
      setTurboOpen(true);
      return;
    }
    try {
      showToast('copy_pending', `⚡ Copying $${trader.tokenSymbol}…`);
      const res = await turboCopyBuy(trader.tokenAddress, amountMon, { preferredFee: trader.feeTier, preferredDex: trader.dex, slippageBps });
      recordBuy(trader, amountMon, action, res);
    } catch (err) {
      console.error('[Turbo] copy failed:', err.message, err);
      if (err.message === 'INSUFFICIENT_FUNDS') {
        showToast('no_funds', `Turbo balance low — deposit ${ACTIVE.nativeSymbol}`);
        pendingTradeRef.current = { trader, amountMon, action };
        setTurboOpen(true);
      }
      else if (err.message === 'NO_LIQUIDITY') showToast('no_liq');
      else if (err.message === 'TX_FAILED' || err.message === 'TX_TIMEOUT') showToast('tx_failed');
      else if (err.message === 'SWAP_REVERT') showToast('tx_failed', 'Swap reverted — try higher slippage');
      else showToast('tx_error');
    }
  }, [monPriceUsd, slippageBps, recordBuy]);

  const handleDisconnect = useCallback(() => {
    disconnectWallet();
    setWalletAddress(null); setIsConnected(false); setMonBalance(null);
    saveLS(WALLET_LS, null);
  }, []);

  const handleClearData = useCallback(() => {
    setPortfolio([]); setFavorites([]); setWatchlist([]); setLastTxHash(null); setBalanceHistory([]);
    saveLS(PORTFOLIO_LS, []); saveLS(FAV_KEY, []);
    saveLS(WATCH_KEY, []); saveLS(LASTTX_LS, null); saveLS(BALHIST_LS, []);
  }, []);

  const removePosition = useCallback((id) => setPortfolio((prev) => prev.filter((p) => p.id !== id)), []);
  const setPositionTargets = useCallback((id, targets) =>
    setPortfolio((prev) => prev.map((p) => (p.id === id ? { ...p, ...targets } : p))), []);
  const buyMorePosition = useCallback((item, amount) => {
    if (!item?.token?.address || !(amount > 0)) { showToast('tx_error'); return; }
    sendCopy({ address: item.trader?.address, tokenAddress: item.token.address, tokenSymbol: item.token.symbol, tokenDecimals: item.token.decimals }, amount);
  }, [sendCopy]);

  // Sell a position back to native (manual "Close" or auto SL/TP). Real on-chain swap.
  // Turbo positions are signed locally (no popup — SL/TP & whale-exit are fully
  // automatic); wallet positions still go through the connected wallet.
  const sellPosition = useCallback(async (p) => {
    if (p.turbo) {
      showToast('sell_pending', `⚡ Closing $${p.token.symbol}…`);
      try {
        const { hash } = await turboSellToken(p.token.address, { slippageBps, preferredDex: p.dex, amountRaw: p.tokensRaw });
        setLastTxHash(hash);
        showToast('sell_sent');
        setPortfolio((prev) => prev.filter((x) => x.id !== p.id));
      } catch (err) {
        const m = err.message;
        if (m === 'NO_BALANCE') showToast('sell_nobal');
        else if (m === 'NO_LIQUIDITY') showToast('no_liq');
        else showToast('sell_fail');
        throw err;
      }
      return;
    }
    let from = walletAddress;
    if (!from) { const ok = await doConnect(); if (!ok) throw new Error('NO_WALLET'); from = await getConnectedAccount(); if (!from) throw new Error('NO_WALLET'); }
    showToast('sell_pending');
    try {
      const { hash } = await sellToken(from, p.token.address, { slippageBps, preferredDex: p.dex, amountRaw: p.tokensRaw });
      setLastTxHash(hash);
      showToast('sell_sent');
      setPortfolio((prev) => prev.filter((x) => x.id !== p.id));
      refreshBalance(from);
    } catch (err) {
      if (err.code === 4001) { showToast('sell_cancel'); throw err; }
      const m = err.message;
      if (m === 'NO_BALANCE') showToast('sell_nobal');
      else if (m === 'NO_LIQUIDITY') showToast('no_liq');
      else showToast('sell_fail');
      throw err;
    }
  }, [walletAddress, slippageBps, doConnect, refreshBalance]);

  // ── "Whale exited → close my copy": a live SELL from the whale you copied,
  // in the token you copied, auto-closes the position (per-position opt-in). ──
  useEffect(() => {
    whaleExitRef.current = (card) => {
      const norm = (s) => (ACTIVE.kind === 'evm' ? (s || '').toLowerCase() : (s || ''));
      const matches = portfolio.filter((p) =>
        p.sellOnWhaleExit &&
        p.token?.address && norm(p.token.address) === norm(card.tokenAddress) &&
        p.trader?.address && norm(p.trader.address) === norm(card.trader) &&
        !sellingRef.current.has(p.id));
      for (const p of matches) {
        sellingRef.current.add(p.id); // guard against duplicate sells
        showToast('whale_exit', `Whale sold $${p.token.symbol} — closing your copy…`);
        sellPosition(p).catch(() => sellingRef.current.delete(p.id)); // allow retry on the whale's next sell
      }
    };
  }, [portfolio, sellPosition]);

  // ── Auto stop-loss / take-profit: watch live token prices, sell when a target is crossed ──
  useEffect(() => {
    if (!walletAddress) return;
    let alive = true;
    const check = async () => {
      if (!settingsRef.current.autoSell) return;
      const open = portfolio.filter((p) => p.token?.address && p.tokensRaw && (p.stopLossPct != null || p.takeProfitPct != null) && !sellingRef.current.has(p.id));
      if (!open.length) return;
      const addrs = [...new Set(open.map((p) => p.token.address))];
      let priceMap = {};
      try {
        const pairs = await fetchTokensByAddresses(addrs);
        pairs.forEach((pr) => { if (pr.baseToken?.address) priceMap[pr.baseToken.address.toLowerCase()] = pr.priceUsd; });
      } catch { return; }
      if (!alive) return;
      for (const p of open) {
        const price = priceMap[(p.token.address || '').toLowerCase()];
        if (price == null || !p.investedUsd) continue;
        const dec = p.token?.decimals ?? 18;
        let tokens;
        try { tokens = Number(BigInt(p.tokensRaw)) / 10 ** dec; } catch { continue; }
        if (!tokens) continue;
        const pnlPct = ((tokens * price) / p.investedUsd - 1) * 100;
        const hitSL = p.stopLossPct != null && pnlPct <= p.stopLossPct;
        const hitTP = p.takeProfitPct != null && pnlPct >= p.takeProfitPct;
        if (!hitSL && !hitTP) continue;
        sellingRef.current.add(p.id); // guard against duplicate popups
        showToast(hitSL ? 'sl_hit' : 'tp_hit', `$${p.token.symbol} ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}% — closing…`);
        try { await sellPosition(p); }
        catch { sellingRef.current.delete(p.id); } // let it retry on the next crossing
      }
    };
    const id = setInterval(check, 25000);
    check();
    return () => { alive = false; clearInterval(id); };
  }, [walletAddress, portfolio, sellPosition]);

  const handleSwipeLeft = useCallback((t) => { removeCard(t); showToast('pass'); }, [removeCard]);
  // No optimistic "sent" toast — sendCopy reports real wallet/chain status only.
  const handleSwipeRight = useCallback((t) => { removeCard(t); sendCopy(t, tradeAmount); }, [removeCard, sendCopy, tradeAmount]);
  const handleSwipeUp = useCallback((t) => {
    removeCard(t); setShowApe(true); setTimeout(() => setShowApe(false), 1200);
    sendCopy(t, tradeAmount * 5, 'APE');
  }, [removeCard, sendCopy, tradeAmount]);

  const swipe = (dir) => topCardRef.current?.swipe(dir);
  const reloadDeck = useCallback(() => { setIsLoading(true); fetchWhaleDeck(40).then((d) => setCards(d)).finally(() => setIsLoading(false)); }, []);

  const t = toast ? TOASTS[toast.type] : null;

  // Deck respects the pro settings + the size-tier filter (Whale / Shark / Big / All).
  const usdOf = (c) => (c.amountUsd != null ? c.amountUsd : (c.amountMon || 0) * (monPriceUsd || 0));
  const deckCards = cards.filter((c) =>
    c.side !== 'SELL' && // exits aren't copyable — they only power per-position auto-close
    (!settings.hideStables || !c.isStable) &&
    (c.amountMon ?? 0) >= (settings.minWhaleMon || 0) &&
    inTier(usdOf(c), deckTier)
  );

  return (
    <div className="app-container">
      <TurboPanel
        open={turboOpen}
        onClose={() => setTurboOpen(false)}
        walletAddress={walletAddress}
        onConnect={doConnect}
        showToast={showToast}
        onReady={() => {
          // funded → replay the swipe that opened the setup, then close
          const pending = pendingTradeRef.current;
          pendingTradeRef.current = null;
          setTurboOpen(false);
          if (pending) sendCopy(pending.trader, pending.amountMon, pending.action);
        }}
      />
      {showApe && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
          <div className="animate-rocket flex flex-col items-center gap-3"><Zap size={72} strokeWidth={1.5} style={{ color: 'var(--color-tag-violet)' }} /><span className="text-2xl font-black uppercase tracking-widest" style={{ color: 'var(--color-tag-violet)' }}>All In</span></div>
        </div>
      )}

      {t && (
        <div key={toast.key} className="animate-slide-up pointer-events-none fixed top-16 left-1/2 z-[70] -translate-x-1/2 flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm font-bold shadow-lg" style={{ background: t.color, border: '1px solid var(--color-silver-lining)', color: '#fff', backdropFilter: 'blur(16px)', whiteSpace: 'nowrap' }}>
          {(() => { const I = TOAST_ICON[t.kind] || Info; return <I size={15} strokeWidth={2.5} />; })()}<span>{toast.msg || t.msg}</span>
        </div>
      )}

      {/* ── App bar: brand identity + wallet ── */}
      <header className="app-bar">
        <div className="brand">
          <div className="brand-mark">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L20 8.5V15.5L12 22L4 15.5V8.5L12 2Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(255,255,255,0.14)" />
              <path d="M8.5 12.5L11 15L15.5 9.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <div className="brand-word">DegenSlide</div>
            <div className="brand-sub">
              <span className={`live-dot ${indexerUp ? 'on' : ''}`} />
              {indexerUp ? `${ACTIVE.label} live` : 'feed offline'} · {clock}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Network switcher — persists choice, reloads onto the selected chain's indexer */}
          <div className="seg-track">
            {Object.values(CHAINS).map((c) => {
              const on = ACTIVE.id === c.id;
              return (
                <button key={c.id} type="button" className={`seg-item ${on ? 'on' : ''}`}
                  onClick={() => { if (!on) { setActiveChainId(c.id); window.location.reload(); } }}>
                  {c.nativeSymbol}
                </button>
              );
            })}
          </div>
          <button onClick={() => { if (!isConnected) doConnect(); }} className={`connect-btn ${isConnected ? 'connected' : ''}`} title={isConnected ? walletAddress : `Connect ${WALLET_NAME}`}>
            {isConnected ? (<><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00f5a0', boxShadow: '0 0 8px #00f5a0' }} />{walletAddress.slice(0, 5)}…{walletAddress.slice(-4)}</>) : (isConnecting ? 'Connecting…' : 'Connect')}
          </button>
        </div>
      </header>

      {/* ── Contextual page head ── */}
      <div className="page-head">
        <h1 className="page-title">
          {activeTab === 'deck' ? 'Whale Deck' : activeTab === 'leaderboard' ? 'Leaderboard' : activeTab === 'portfolio' ? 'Portfolio' : 'Profile'}
        </h1>
        <span className="page-meta">
          {activeTab === 'deck' ? `${deckCards.length} live signals` :
           activeTab === 'leaderboard' ? `${curatedWhalesList.length} tracked whales` :
           activeTab === 'portfolio' ? `${portfolio.length} position${portfolio.length === 1 ? '' : 's'}` :
           (walletAddress ? `${walletAddress.slice(0, 5)}…${walletAddress.slice(-4)}` : 'not connected')}
        </span>
      </div>

      <main className="main-content">
        {activeTab === 'leaderboard' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', margin: '0 -16px' }}>
            <div className="seg-track wide" style={{ margin: '0 16px 10px', flexShrink: 0 }}>
              {[{ id: 'rankings', label: 'Whales' }, { id: 'curated', label: 'Smart Money' }, { id: 'watchlist', label: 'Watchlist' }].map((m) => (
                <button key={m.id} type="button" className={`seg-item ${lbMode === m.id ? 'on' : ''}`} onClick={() => setLbMode(m.id)}>
                  {m.label}
                  {m.id === 'watchlist' && watchlistView.length > 0 && (<span className="seg-badge">{watchlistView.length}</span>)}
                  {m.id === 'curated' && curatedWhalesList.length > 0 && (<span className="seg-badge">{curatedWhalesList.length}</span>)}
                </button>
              ))}
            </div>
            {lbMode === 'rankings' ? (
              <div style={{ flex: 1, overflow: 'hidden' }}><Leaderboard traders={leaderboard} roster={curatedWhalesList} monPriceUsd={monPriceUsd} onWatch={addWatchWallet} watchlist={watchlist} /></div>
            ) : lbMode === 'curated' ? (
              <CuratedWhales whales={curatedWhalesList} favorites={favorites} onToggleFavorite={toggleFavorite} onSaveAll={saveAllCurated} monPriceUsd={monPriceUsd} />
            ) : (
              <WatchlistPanel wallets={watchlistView} onAdd={addWatchWallet} onRemove={removeFromWatchlist} />
            )}
          </div>
        ) : activeTab === 'deck' ? (
          <div className="flex flex-col h-full w-full relative">
            <div className="seg-track wide" style={{ marginBottom: 12, flexShrink: 0 }}>
              {DECK_TIERS.map((tier) => {
                const active = deckTier === tier.id;
                const cnt = cards.filter((c) => c.side !== 'SELL' && (!settings.hideStables || !c.isStable) && (c.amountMon ?? 0) >= (settings.minWhaleMon || 0) && inTier(usdOf(c), tier.id)).length;
                return (
                  <button key={tier.id} type="button" className={`seg-item ${active ? 'on' : ''}`} onClick={() => setDeckTier(tier.id)}>
                    {tier.id !== 'all' && <span style={{ width: 6, height: 6, borderRadius: '50%', background: active ? '#fff' : tier.color, display: 'inline-block', marginRight: 5 }} />}
                    {tier.label}
                    <span style={{ fontSize: 9, fontWeight: 700, opacity: 0.6, marginLeft: 4 }}>{cnt}</span>
                  </button>
                );
              })}
            </div>
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full pb-20" style={{ gap: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid transparent', borderTopColor: 'var(--accent)', borderRightColor: 'var(--accent-2)', animation: 'spin 0.8s linear infinite' }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-pebble)', margin: 0 }}>Scanning {ACTIVE.label} for whales…</p>
              </div>
            ) : deckCards.length > 0 ? (
              <>
                <TradeSettingsPopover open={showTradeSettings} onClose={() => setShowTradeSettings(false)} amount={tradeAmount} onChangeAmount={setTradeAmount} slippageBps={slippageBps} onChangeSlippage={setSlippageBps} monPriceUsd={monPriceUsd} monBalance={monBalance} />
                <div className="card-deck-area">
                  {[...deckCards.slice(0, 4)].reverse().map((trader, i, arr) => {
                    const stackIndex = arr.length - 1 - i;
                    return (
                      <SwipeCard key={trader.id} ref={stackIndex === 0 ? topCardRef : null} trader={trader} stackIndex={stackIndex} isTopCard={stackIndex === 0}
                        onSwipeLeft={handleSwipeLeft} onSwipeRight={handleSwipeRight} onSwipeUp={handleSwipeUp} monPriceUsd={monPriceUsd}
                        isFavorite={favorites.some((f) => f.address === trader.address)} onToggleFavorite={toggleFavorite}
                        isCurated={curatedSet.has((trader.address || '').toLowerCase())} />
                    );
                  })}
                </div>
                <div className="action-row">
                  <button type="button" onClick={() => setShowTradeSettings(true)} title={`${tradeAmount} ${ACTIVE.nativeSymbol} / copy`}
                    style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--color-paper-white)', border: '1px solid var(--color-silver-lining)', boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
                    <Settings size={18} color="var(--color-pebble)" />
                    <span style={{ position: 'absolute', top: -2, right: -2, fontSize: 8, fontWeight: 700, background: 'var(--color-tidewater-navy)', color: '#fff', borderRadius: 8, padding: '1px 5px', lineHeight: '14px' }}>{tradeAmount}</span>
                  </button>
                  <button type="button" className="btn-pass" onClick={() => swipe('left')} title="Skip"><X size={24} /></button>
                  <button type="button" className="btn-ape" onClick={() => swipe('up')}><Zap size={14} style={{ marginRight: 6 }} /> ALL IN</button>
                  <button type="button" className="btn-copy" onClick={() => swipe('right')} title="Copy Trade"><Copy size={22} /></button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center pb-20" style={{ gap: 12 }}>
                {indexerUp ? <Layers size={40} strokeWidth={1.5} color="var(--color-pebble)" /> : <WifiOff size={40} strokeWidth={1.5} color="var(--color-pebble)" />}
                <h3 style={{ fontWeight: 600, color: 'var(--color-midnight-ink)', fontSize: 19, margin: 0 }}>{indexerUp ? 'Waiting for whales…' : 'Whale feed offline'}</h3>
                <p style={{ fontSize: 14, color: 'var(--color-pebble)', margin: 0, maxWidth: 240 }}>{indexerUp ? `New large trades on ${ACTIVE.label} will appear here live.` : `Start the indexer (backend/${ACTIVE.kind === 'svm' ? 'solListener.js' : 'listener.js'}) to stream live whale trades.`}</p>
                <button onClick={reloadDeck} style={{ marginTop: 8, padding: '10px 28px', background: 'var(--color-tidewater-navy)', border: 'none', borderRadius: 100, fontSize: 14, fontWeight: 600, color: 'var(--color-paper-white)', cursor: 'pointer' }}>Reload</button>
              </div>
            )}
          </div>
        ) : activeTab === 'portfolio' ? (
          <div className="h-full px-1"><Portfolio portfolio={portfolio} monPriceUsd={monPriceUsd} tradeAmount={tradeAmount} autoSell={settings.autoSell} onRemove={removePosition} onBuyMore={buyMorePosition} onSetTargets={setPositionTargets} onSell={sellPosition} /></div>
        ) : (
          <ProfilePage
            walletAddress={walletAddress} monBalance={monBalance} monPriceUsd={monPriceUsd}
            portfolio={portfolio} watchlistCount={watchlistView.length} balanceHistory={balanceHistory}
            settings={settings} updateSetting={updateSetting}
            lastTxHash={lastTxHash} indexerUp={indexerUp}
            onDisconnect={handleDisconnect} onClearData={handleClearData}
            onOpenTurbo={() => setTurboOpen(true)}
          />
        )}
      </main>

      <nav className="bottom-nav">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button key={tab.id} type="button" className={`nav-item ${isActive ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
              <div className="nav-icon"><tab.Icon active={isActive} /></div>
              <span>{tab.label}</span>
              {isActive && <div className="nav-dot" />}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
