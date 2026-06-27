import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SwipeCard from './components/SwipeCard';
import Leaderboard from './components/Leaderboard';
import Portfolio from './components/Portfolio';
import Inbox from './components/Inbox';
import Chat from './components/Chat';
import { BlockieAvatar } from './components/SwipeCard';
import mockTraders from './data/mockTraders.json';
import { fetchTopTraders, fetchMonadStats, EXPLORER_ADDR_URL } from './services/monadApi';
import { fetchMONPrice, fetchMonadTrendingTokens } from './services/dexscreenerApi';
import {
  connectWallet,
  getConnectedAccount,
  executeTradeTransaction,
  isMetaMaskAvailable,
  EXPLORER_URL,
  SWAP_TOKENS,
} from './services/wallet';

/* ── Clock hook ── */
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

/* ── Toast config ── */
const TOASTS = {
  pass:       { msg: 'Skipped',              icon: '✕', color: 'rgba(255,71,87,0.95)',   border: 'rgba(255,71,87,0.3)' },
  copy:       { msg: 'Copy Trade Sent!',     icon: '✓', color: 'rgba(0,192,135,0.95)',  border: 'rgba(0,192,135,0.3)' },
  ape:        { msg: 'All In!',             icon: '💸', color: 'rgba(255,181,71,0.95)', border: 'rgba(255,181,71,0.3)' },
  connect:    { msg: 'Wallet Connected',    icon: '🟢', color: 'rgba(0,192,135,0.95)',  border: 'rgba(0,192,135,0.3)' },
  tx_sent:    { msg: 'Tx Sent!',           icon: '⛓',  color: 'rgba(123,97,255,0.95)', border: 'rgba(123,97,255,0.3)' },
  tx_error:   { msg: 'Tx Failed',          icon: '⚠',  color: 'rgba(255,71,87,0.95)',  border: 'rgba(255,71,87,0.3)' },
  no_wallet:  { msg: 'Install MetaMask!',  icon: '🦊', color: 'rgba(255,181,71,0.95)', border: 'rgba(255,181,71,0.3)' },
};

/* ── SVG Nav Icons ── */
function IconDeck({ active }) {
  const c = active ? '#f72585' : 'rgba(255,255,255,0.3)';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="8" width="16" height="13" rx="3" stroke={c} strokeWidth="1.6"
        fill={active ? 'rgba(247,37,133,0.15)' : 'none'}/>
      <rect x="7" y="5" width="13" height="12" rx="3" stroke={c} strokeWidth="1.6"
        fill={active ? 'rgba(247,37,133,0.08)' : 'none'}/>
    </svg>
  );
}

function IconPortfolio({ active }) {
  const c = active ? '#7b61ff' : 'rgba(255,255,255,0.3)';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="12" width="4" height="9" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/>
      <rect x="10" y="7" width="4" height="14" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/>
      <rect x="17" y="3" width="4" height="18" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/>
    </svg>
  );
}

function IconLeaderboard({ active }) {
  const c = active ? '#4cc9f0' : 'rgba(255,255,255,0.3)';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"
        stroke={c} strokeWidth="1.6" strokeLinejoin="round"
        fill={active ? 'rgba(76,201,240,0.2)' : 'none'}/>
    </svg>
  );
}

function IconProfile({ active }) {
  const c = active ? '#00f5a0' : 'rgba(255,255,255,0.3)';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.6"
        fill={active ? 'rgba(0,245,160,0.15)' : 'none'}/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

function IconInbox({ active }) {
  const c = active ? '#ff9f1c' : 'rgba(255,255,255,0.3)';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke={c} strokeWidth="1.6" fill={active ? 'rgba(255,159,28,0.15)' : 'none'}/>
      <path d="M22 6l-10 7L2 6" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

const TABS = [
  { id: 'deck',         Icon: IconDeck,        label: 'Deck' },
  { id: 'portfolio',    Icon: IconPortfolio,   label: 'Portfolio' },
  { id: 'inbox',        Icon: IconInbox,       label: 'Inbox' },
  { id: 'leaderboard',  Icon: IconLeaderboard, label: 'Top' },
  { id: 'profile',      Icon: IconProfile,     label: 'Profile' },
];

/* ── Empty tab placeholder ── */
function EmptyTab({ icon, title, desc, badge }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center px-8">
      <div className="relative">
        <div className="grid h-20 w-20 place-items-center rounded-[24px] text-4xl"
          style={{ background: 'var(--s2)', border: '1px solid var(--border)' }}>
          {icon}
        </div>
        {badge && (
          <span className="absolute -top-1 -right-1 rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
            style={{ background: 'var(--volt)', color: '#fff' }}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <h3 className="text-base font-black" style={{ color: 'var(--text-1)' }}>{title}</h3>
        <p className="mt-1.5 text-sm leading-relaxed max-w-[220px]" style={{ color: 'var(--text-3)' }}>{desc}</p>
      </div>
    </div>
  );
}

/* ── Stat chip ── */
function StatChip({ label, value, accent }) {
  return (
    <div className="stat-chip flex-1 min-w-0">
      <p className="text-[9px] font-semibold uppercase tracking-widest truncate" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-[12px] font-black mt-0.5 truncate" style={{ color: accent ?? 'var(--text-1)' }}>{value}</p>
    </div>
  );
}

/* ── Signal dots (status bar) ── */
function SignalDots() {
  return (
    <div className="flex items-end gap-[2px]">
      {[8, 12, 16, 20].map((h, i) => (
        <div key={i} className="w-1 rounded-sm" style={{ height: h, background: i < 3 ? 'var(--text-2)' : 'var(--text-3)' }} />
      ))}
    </div>
  );
}

/* ── localStorage helpers ── */
function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/* ── Trade Amount Tier Selector ── */
const TIERS = [
  { label: '0.001', value: 0.001 },
  { label: '0.01',  value: 0.01  },
  { label: '0.05',  value: 0.05  },
];

function TierSelector({ amount, onChange }) {
  const [manualVal, setManualVal] = useState('');

  const isManual = !TIERS.some(t => t.value === amount);

  const handleManualChange = (e) => {
    const raw = e.target.value.replace(/[^0-9.]/g, '');
    setManualVal(raw);
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) onChange(num);
  };

  const handleTierClick = (val) => {
    setManualVal('');
    onChange(val);
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      padding: '8px 12px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16,
      marginBottom: 10,
    }}>
      <span style={{ fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.12em', whiteSpace: 'nowrap', marginRight: 2 }}>MON</span>
      <div style={{ display: 'flex', gap: 5, flex: 1 }}>
        {TIERS.map(tier => {
          const active = !isManual && amount === tier.value;
          return (
            <button
              key={tier.value}
              type="button"
              onClick={() => handleTierClick(tier.value)}
              style={{
                flex: 1, padding: '6px 0', borderRadius: 10, border: 'none',
                fontSize: 11, fontWeight: 800, cursor: 'pointer',
                transition: 'all 0.18s',
                background: active
                  ? 'linear-gradient(135deg,#f72585,#7b61ff)'
                  : 'rgba(255,255,255,0.07)',
                color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                boxShadow: active ? '0 2px 12px rgba(247,37,133,0.35)' : 'none',
                transform: active ? 'scale(1.05)' : 'scale(1)',
              }}
            >
              {tier.label}
            </button>
          );
        })}
        {/* Manuel input */}
        <input
          type="text"
          inputMode="decimal"
          placeholder="custom"
          value={manualVal}
          onFocus={() => {
            if (isManual) setManualVal(String(amount));
          }}
          onChange={handleManualChange}
          style={{
            flex: 1.2, padding: '6px 6px', borderRadius: 10,
            border: `1px solid ${isManual ? 'rgba(123,97,255,0.7)' : 'rgba(255,255,255,0.1)'}`,
            background: isManual ? 'rgba(123,97,255,0.15)' : 'rgba(255,255,255,0.05)',
            color: isManual ? '#c4b5fd' : 'rgba(255,255,255,0.4)',
            fontSize: 11, fontWeight: 800, textAlign: 'center',
            outline: 'none', transition: 'all 0.18s', minWidth: 0,
          }}
        />
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>
        ≈ ${(amount * 3.2).toFixed(4)}
      </span>
    </div>
  );
}

function TokenSelector({ selected, onChange, tokens }) {
  return (
    <div className="hide-scrollbar" style={{ display: 'flex', gap: 6, marginBottom: 8, overflowX: 'auto', paddingBottom: 4 }}>
      {tokens.map(t => (
        <button
          key={t.symbol}
          type="button"
          onClick={() => onChange(t.symbol)}
          style={{
            flex: '0 0 auto', padding: '8px 14px', borderRadius: 12,
            fontSize: 12, fontWeight: 800, cursor: 'pointer',
            transition: 'all 0.18s', display: 'flex', alignItems: 'center', gap: 6,
            background: selected === t.symbol ? `${t.color || '#fff'}20` : 'rgba(255,255,255,0.05)',
            color: selected === t.symbol ? (t.color || '#fff') : 'rgba(255,255,255,0.4)',
            border: `1px solid ${selected === t.symbol ? (t.color || '#fff') : 'transparent'}`,
            boxShadow: selected === t.symbol ? `0 2px 8px ${t.color || '#fff'}40` : 'none',
          }}
        >
          {t.imageUrl ? <img src={t.imageUrl} alt={t.symbol} style={{ width: 14, height: 14, borderRadius: '50%' }} /> : t.icon} {t.symbol}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const clock = useClock();
  const [isConnected, setIsConnected]   = useState(false);
  const [walletAddress, setWalletAddress] = useState(() => loadLS('monad_wallet', null));
  const [isConnecting, setIsConnecting] = useState(false);
  const [cards, setCards]               = useState(mockTraders.map(t => ({ ...t, isLive: false })));
  const [toast, setToast]               = useState(null);
  const [matchTrader, setMatchTrader]   = useState(null);
  const [showApe, setShowApe]           = useState(false);
  const [portfolio, setPortfolio]       = useState(() => loadLS('monad_portfolio', []));
  const [activeTab, setActiveTab]       = useState(() => loadLS('monad_tab', 'deck'));
  const [isLoading, setIsLoading]       = useState(false);
  const [isLiveData, setIsLiveData]     = useState(false);
  const [stats, setStats]               = useState(null);
  const [trendingTokens, setTrendingTokens] = useState([]);
  const [tradeAmount, setTradeAmount]   = useState(() => loadLS('monad_tradeAmount', 0.001));
  const [tradeToken, setTradeToken]     = useState(() => loadLS('monad_tradeToken', 'MON'));
  const [lastTxHash, setLastTxHash]     = useState(() => loadLS('monad_lastTx', null));
  const [favorites, setFavorites]       = useState(() => loadLS('monad_favorites', []));
  const [matches, setMatches]           = useState(() => loadLS('monad_matches', []));
  const [messages, setMessages]         = useState(() => loadLS('monad_messages', {}));
  const [activeChat, setActiveChat]     = useState(null);
  const topCardRef  = useRef(null);
  const matchTimer  = useRef(null);

  const allTokens = useMemo(() => {
    const base = [...SWAP_TOKENS];
    const seen = new Set(base.map(t => t.symbol));
    for (const pt of trendingTokens) {
      const sym = pt.baseToken?.symbol;
      if (sym && !seen.has(sym)) {
        seen.add(sym);
        base.push({
          symbol: sym,
          label: sym,
          icon: null,
          imageUrl: pt.imageUrl,
          color: '#ffffff', // default if no specific color
          address: pt.baseToken.address,
          pairAddress: pt.pairAddress,
        });
      }
    }
    return base;
  }, [trendingTokens]);

  // ── Dinamik scale: viewport yüksekliğine tam sığdır ──
  useEffect(() => {
    const CONTAINER_H = 852;
    const PADDING = 16; // üst+alt boşluk
    const updateScale = () => {
      const vh = window.innerHeight;
      const scale = Math.min(1, (vh - PADDING) / CONTAINER_H);
      document.documentElement.style.setProperty('--app-scale', scale);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  // Auto-reconnect if MetaMask already authorized
  useEffect(() => {
    getConnectedAccount().then((addr) => {
      if (addr) {
        setWalletAddress(addr);
        setIsConnected(true);
        saveLS('monad_wallet', addr);
      }
    });

    if (isMetaMaskAvailable()) {
      const handleAccountsChanged = (accounts) => {
        if (!accounts.length) {
          setIsConnected(false);
          setWalletAddress(null);
          saveLS('monad_wallet', null);
        } else {
          const addr = accounts[0].toLowerCase();
          setWalletAddress(addr);
          saveLS('monad_wallet', addr);
        }
      };
      const handleChainChanged = () => window.location.reload();
      window.ethereum.on('accountsChanged', handleAccountsChanged);
      window.ethereum.on('chainChanged', handleChainChanged);
      return () => {
        window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        window.ethereum.removeListener('chainChanged', handleChainChanged);
      };
    }
  }, []);

  // Cüzdan adresi değişince localStorage'a kaydet + bağlantı durumunu güncelle
  useEffect(() => {
    if (walletAddress) {
      saveLS('monad_wallet', walletAddress);
      setIsConnected(true);
    }
  }, [walletAddress]);

  // Portfolio değişince kaydet
  useEffect(() => {
    saveLS('monad_portfolio', portfolio);
  }, [portfolio]);

  // Son tx hash değişince kaydet
  useEffect(() => {
    if (lastTxHash) saveLS('monad_lastTx', lastTxHash);
  }, [lastTxHash]);

  // Aktif sekme değişince kaydet
  useEffect(() => {
    saveLS('monad_tab', activeTab);
  }, [activeTab]);

  // Trade miktarı değişince kaydet
  useEffect(() => {
    saveLS('monad_tradeAmount', tradeAmount);
  }, [tradeAmount]);

  // Seçili token değişince kaydet
  useEffect(() => {
    saveLS('monad_tradeToken', tradeToken);
  }, [tradeToken]);

  // Favoriler değişince kaydet
  useEffect(() => {
    saveLS('monad_favorites', favorites);
  }, [favorites]);

  // Eşleşmeler ve Mesajlar
  useEffect(() => {
    saveLS('monad_matches', matches);
  }, [matches]);
  useEffect(() => {
    saveLS('monad_messages', messages);
  }, [messages]);

  const toggleFavorite = useCallback((trader) => {
    setFavorites(prev => {
      const exists = prev.find(f => f.address === trader.address);
      if (exists) return prev.filter(f => f.address !== trader.address);
      return [{ ...trader }, ...prev];
    });
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    setIsLoading(true);
    Promise.all([fetchTopTraders(), fetchMonadStats(), fetchMonadTrendingTokens(15)]).then(([result, statsData, trendingData]) => {
      if (result.traders) { setCards(result.traders); setIsLiveData(true); }
      if (statsData) setStats(statsData);
      if (trendingData) setTrendingTokens(trendingData);
    }).finally(() => setIsLoading(false));
  }, [isConnected]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => () => clearTimeout(matchTimer.current), []);

  const showToast = (type) => setToast({ type, key: Date.now() });

  const removeCard = useCallback((trader) => {
    setCards((prev) => prev.filter((c) => c.id !== trader.id));
  }, []);

  const sendTx = useCallback(async (trader, amountMon, tokenObj) => {
    if (!walletAddress || !trader.address) return;
    try {
      const txHash = await executeTradeTransaction(walletAddress, trader.address, amountMon, tokenObj?.symbol, tokenObj?.address);
      setLastTxHash(txHash);
      showToast('tx_sent');
    } catch (err) {
      if (err.code !== 4001) showToast('tx_error');
    }
  }, [walletAddress]);

  const handleSwipeLeft  = useCallback((t) => { removeCard(t); showToast('pass'); }, [removeCard]);
  const handleSwipeRight = useCallback(async (t) => {
    removeCard(t); showToast('copy');
    const tokenObj = allTokens.find(tk => tk.symbol === tradeToken) || { symbol: tradeToken };
    sendTx(t, tradeAmount, tokenObj);
    // Snapshot entry price at trade time for PnL tracking
    const monPriceData = await fetchMONPrice().catch(() => null);
    const entryPriceUsd = monPriceData?.priceUsd ?? null;
    setPortfolio(prev => [{ trader: t, action: 'COPY', amount: tradeAmount, token: tokenObj, time: Date.now(), entryPriceUsd }, ...prev]);
    if (Math.random() < 0.65) {
      matchTimer.current = setTimeout(() => setMatchTrader(t), 1200);
    }
  }, [removeCard, sendTx, tradeAmount, tradeToken, allTokens]);
  const handleSwipeUp = useCallback(async (t) => {
    removeCard(t); showToast('ape');
    setShowApe(true);
    setTimeout(() => setShowApe(false), 1200);
    const tokenObj = allTokens.find(tk => tk.symbol === tradeToken) || { symbol: tradeToken };
    sendTx(t, tradeAmount, tokenObj);
    // Snapshot entry price at trade time for PnL tracking
    const monPriceData = await fetchMONPrice().catch(() => null);
    const entryPriceUsd = monPriceData?.priceUsd ?? null;
    setPortfolio(prev => [{ trader: t, action: 'ALL IN', amount: tradeAmount, token: tokenObj, time: Date.now(), entryPriceUsd }, ...prev]);
  }, [removeCard, sendTx, tradeAmount, tradeToken, allTokens]);

  const swipe = (dir) => topCardRef.current?.swipe(dir);

  const resetDeck = () => {
    setCards(mockTraders.map(t => ({ ...t, isLive: false })));
    setIsLiveData(false);
    if (isConnected) {
      setIsLoading(true);
      fetchTopTraders().then((result) => {
        if (result.traders) { setCards(result.traders); setIsLiveData(true); }
      }).finally(() => setIsLoading(false));
    }
  };

  const t = toast ? TOASTS[toast.type] : null;

  return (
    <div className="app-container">

      {/* ── MATCH MODAL — rendered via portal so transform on app-container doesn't break fixed positioning ── */}
      {matchTrader && createPortal(
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(10,10,26,0.95)', backdropFilter: 'blur(20px)' }}>
          <div className="animate-slide-up" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '100%', maxWidth: 340 }}>
            <h2 style={{ fontSize: 44, fontWeight: 900, color: '#f72585', margin: 0, textShadow: '0 0 32px rgba(247,37,133,0.6)', fontStyle: 'italic', letterSpacing: '-0.05em' }}>
              IT'S A MATCH!
            </h2>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', marginTop: 12 }}>
              You and <span style={{ color: '#fff', fontWeight: 800 }}>{matchTrader.address.slice(0,6)}…{matchTrader.address.slice(-4)}</span> liked each other.
            </p>

            <div style={{ display: 'flex', gap: 16, margin: '32px 0' }}>
              <div style={{ width: 90, height: 90, borderRadius: '50%', border: '4px solid #f72585', overflow: 'hidden', boxShadow: '0 0 30px rgba(247,37,133,0.3)', background: 'linear-gradient(135deg, #f72585, #ff6b35)' }}>
                 <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>🦊</div>
              </div>
              <div style={{ width: 90, height: 90, borderRadius: '50%', border: '4px solid #00f5a0', overflow: 'hidden', boxShadow: '0 0 30px rgba(0,245,160,0.3)' }}>
                 <BlockieAvatar addr={matchTrader.address} size={90} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
              <button
                onClick={() => {
                  setMatches(prev => {
                     if (!prev.find(m => m.address === matchTrader.address)) return [matchTrader, ...prev];
                     return prev;
                  });
                  setActiveTab('inbox');
                  setActiveChat(matchTrader);
                  setMatchTrader(null);
                }}
                style={{ padding: '16px', borderRadius: 24, background: 'linear-gradient(135deg, #f72585, #7b61ff)', border: 'none', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer', boxShadow: '0 8px 24px rgba(247,37,133,0.4)' }}
              >
                Send a Message
              </button>
              <button
                onClick={() => {
                  setMatches(prev => {
                     if (!prev.find(m => m.address === matchTrader.address)) return [matchTrader, ...prev];
                     return prev;
                  });
                  setMatchTrader(null);
                }}
                style={{ padding: '16px', borderRadius: 24, background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', fontSize: 16, fontWeight: 800, cursor: 'pointer' }}
              >
                Keep Swiping
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── APE BURST ── */}
      {showApe && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
          <div className="animate-rocket flex flex-col items-center gap-3">
            <span className="text-8xl">🚀</span>
            <span className="text-2xl font-black uppercase tracking-widest" style={{ color: 'var(--warn)' }}>All In!</span>
          </div>
        </div>
      )}

      {/* ── TOAST ── */}
      {t && (
        <div
          key={toast.key}
          className="animate-slide-up pointer-events-none fixed top-16 left-1/2 z-[70] -translate-x-1/2 flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm font-bold shadow-lg"
          style={{
            background: t.color,
            border: `1px solid ${t.border}`,
            color: '#fff',
            backdropFilter: 'blur(16px)',
            whiteSpace: 'nowrap',
          }}
        >
          <span>{t.icon}</span>
          <span>{t.msg}</span>
        </div>
      )}

      {/* ── STATUS BAR ── */}
      <div className="status-bar">
        <span>{clock}</span>
        <div className="dynamic-island" />
        <div className="flex items-center gap-1.5">
          <SignalDots />
          <svg width="14" height="12" viewBox="0 0 16 12" fill="currentColor">
            <path d="M12 2C13.1 2 14 2.9 14 4V8C14 9.1 13.1 10 12 10H4C2.9 10 2 9.1 2 8V4C2 2.9 2.9 2 4 2H12ZM12 0H4C1.8 0 0 1.8 0 4V8C0 10.2 1.8 12 4 12H12C14.2 12 16 10.2 16 8V4C16 1.8 14.2 0 12 0ZM18 4V8C18.6 8 19 7.6 19 7V5C19 4.4 18.6 4 18 4Z" />
            <rect x="2" y="2" width="10" height="8" rx="1" fill="currentColor"/>
          </svg>
        </div>
      </div>

      {/* ── MOBILE HEADER ── */}
      <header className="mobile-header" style={activeChat ? { display: 'none' } : {}}>
        <div>
          <div className="mobile-header-subtitle">MONAD SWIPE</div>
          <div className="mobile-header-title">
            {activeTab === 'deck' ? 'Trade Deck' : activeTab === 'leaderboard' ? 'Leaderboard' : activeTab === 'portfolio' ? 'Portfolio' : 'Profile'}
          </div>
        </div>
        <button
          onClick={async () => {
            if (isConnected) return;
            if (!isMetaMaskAvailable()) {
              showToast('no_wallet');
              window.open('https://metamask.io/download/', '_blank');
              return;
            }
            setIsConnecting(true);
            try {
              const addr = await connectWallet();
              setWalletAddress(addr);
              setIsConnected(true);
              saveLS('monad_wallet', addr);
              showToast('connect');
            } catch (err) {
              if (err.message !== 'NO_METAMASK' && err.code !== 4001) showToast('tx_error');
            } finally {
              setIsConnecting(false);
            }
          }}
          className={`connect-btn ${isConnected ? 'connected' : ''}`}
        >
          {isConnected ? (
            <>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00f5a0', boxShadow: '0 0 8px #00f5a0' }} />
              {walletAddress.slice(0, 5)}…{walletAddress.slice(-4)}
            </>
          ) : (
            isConnecting ? '⏳ Connecting…' : '🦊 Connect'
          )}
        </button>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="main-content">
        {!isConnected ? (
          <div className="flex flex-col items-center justify-center h-full text-center pb-20" style={{ gap: 16 }}>
            <div style={{ fontSize: 64, filter: 'drop-shadow(0 0 24px rgba(247,37,133,0.5))' }}>🦊</div>
            <h3 style={{ fontSize: 20, fontWeight: 900, color: '#ffffff', margin: 0 }}>Connect to Swipe</h3>
            <p style={{ color: 'rgba(255,255,255,0.45)', margin: 0, maxWidth: 240, fontSize: 13, lineHeight: 1.5 }}>Connect your MetaMask wallet to view live traders and start copy-trading.</p>
          </div>
        ) : activeTab === 'deck' ? (
          <div className="flex flex-col h-full w-full relative">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full pb-20" style={{ gap: 16 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', border: '3px solid transparent', borderTopColor: '#f72585', borderRightColor: '#7b61ff', animation: 'spin 0.8s linear infinite', boxShadow: '0 0 20px rgba(247,37,133,0.4)' }} />
                <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.45)', margin: 0 }}>Loading traders…</p>
              </div>
            ) : cards.length > 0 ? (
              <>
                <div className="card-deck-area">
                  {[...cards.slice(0, 4)].reverse().map((trader, i, arr) => {
                    const stackIndex = arr.length - 1 - i;
                    return (
                      <SwipeCard
                        key={trader.id}
                        ref={stackIndex === 0 ? topCardRef : null}
                        trader={trader}
                        stackIndex={stackIndex}
                        isTopCard={stackIndex === 0}
                        onSwipeLeft={handleSwipeLeft}
                        onSwipeRight={handleSwipeRight}
                        onSwipeUp={handleSwipeUp}
                        isFavorite={favorites.some(f => f.address === trader.address)}
                        onToggleFavorite={toggleFavorite}
                      />
                    );
                  })}
                </div>
                <TokenSelector selected={tradeToken} onChange={setTradeToken} tokens={allTokens} />
                <TierSelector amount={tradeAmount} onChange={setTradeAmount} />
                <div className="action-row">
                  <button type="button" className="btn-pass" onClick={() => swipe('left')} title="Pass">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </button>
                  <button type="button" className="btn-ape" onClick={() => swipe('up')}>ALL IN 💸</button>
                  <button type="button" className="btn-copy" onClick={() => swipe('right')} title="Copy Trade">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center pb-20" style={{ gap: 12 }}>
                <span style={{ fontSize: 48, filter: 'drop-shadow(0 0 20px rgba(247,37,133,0.5))' }}>🃏</span>
                <h3 style={{ fontWeight: 900, color: '#ffffff', fontSize: 18, margin: 0 }}>Deck Empty</h3>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', margin: 0 }}>You've seen all live traders.</p>
                <button onClick={resetDeck} style={{
                  marginTop: 8, padding: '10px 28px',
                  background: 'linear-gradient(135deg, #f72585, #7b61ff)',
                  border: 'none', borderRadius: 50,
                  fontSize: 12, fontWeight: 800, color: '#fff',
                  cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase',
                  boxShadow: '0 8px 24px rgba(247,37,133,0.4)',
                }}>
                  Reload Deck
                </button>
              </div>
            )}
          </div>
        ) : activeTab === 'inbox' ? (
          <div className="h-full overflow-hidden -mx-4" style={activeChat ? { marginBottom: -16 } : {}}>
            {activeChat ? (
              <Chat
                trader={activeChat}
                initialMessages={messages[activeChat.address] || []}
                onBack={() => setActiveChat(null)}
                onUpdateMessages={(addr, msgs) => setMessages(prev => ({ ...prev, [addr]: msgs }))}
              />
            ) : (
              <Inbox matches={matches} lastMessages={messages} onOpenChat={setActiveChat} />
            )}
          </div>
        ) : activeTab === 'leaderboard' ? (
          <div className="h-full overflow-hidden -mx-4">
            <Leaderboard traders={cards.length > 0 ? cards : mockTraders} />
          </div>
        ) : activeTab === 'portfolio' ? (
          <div className="h-full px-1">
            <Portfolio portfolio={portfolio} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16, paddingBottom: 24 }}>
            <div style={{ padding: '14px 16px', background: 'rgba(123,97,255,0.1)', border: '1px solid rgba(123,97,255,0.25)', borderRadius: 16 }}>
              <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#7b61ff', margin: 0 }}>Connected Wallet</p>
              <p style={{ marginTop: 6, fontFamily: 'monospace', fontWeight: 700, color: '#ffffff', wordBreak: 'break-all', fontSize: 12, margin: '6px 0 0' }}>{walletAddress}</p>
            </div>
            
            {/* FAVORITES LIST */}
            <div style={{ padding: '14px 16px', background: 'rgba(247,37,133,0.05)', border: '1px solid rgba(247,37,133,0.15)', borderRadius: 16 }}>
              <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#f72585', margin: 0 }}>Favorited Traders</p>
              {favorites.length === 0 ? (
                <p style={{ marginTop: 6, fontSize: 11, color: 'rgba(255,255,255,0.3)', margin: '6px 0 0' }}>No favorites yet. Swipe or use the heart icon to save traders.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                  {favorites.map(fav => (
                    <div
                      key={fav.address}
                      onClick={() => window.open(EXPLORER_ADDR_URL(fav.address), '_blank')}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s'
                      }}
                    >
                      <div style={{
                        width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                        background: 'linear-gradient(135deg, #f72585, #7b61ff)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 900, color: '#fff', fontFamily: 'monospace'
                      }}>
                        {fav.address.slice(2, 4).toUpperCase()}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: '#fff', fontFamily: 'monospace' }}>
                          {fav.address.slice(0, 6)}…{fav.address.slice(-4)}
                        </div>
                        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {fav.actionText || 'Active on Monad'}
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFavorite(fav);
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, fontSize: 16 }}
                      >
                        ❤️
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {lastTxHash ? (
              <div style={{ padding: '14px 16px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16 }}>
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.4)', margin: 0 }}>Last Transaction</p>
                <p style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.7)', wordBreak: 'break-all', margin: '6px 0 0' }}>{lastTxHash}</p>
                <a href={`${EXPLORER_URL}/tx/${lastTxHash}`} target="_blank" rel="noreferrer" style={{ marginTop: 10, display: 'inline-block', fontSize: 11, fontWeight: 700, color: '#7b61ff', textDecoration: 'none' }}>
                  View on SocialScan ↗
                </a>
              </div>
            ) : (
              <div style={{ padding: '32px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 16, textAlign: 'center' }}>
                <span style={{ fontSize: 32, display: 'block', marginBottom: 8, opacity: 0.4 }}>⛓</span>
                <p style={{ fontSize: 14, fontWeight: 700, color: '#ffffff', margin: 0 }}>No Transactions</p>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4, margin: '4px 0 0' }}>Swipe right on a trader to send a transaction.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── BOTTOM NAV ── */}
      <nav className="bottom-nav" style={activeChat ? { display: 'none' } : {}}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
              style={isActive ? {
                background: 'rgba(255,255,255,0.06)',
              } : {}}
            >
              <div className="nav-icon">
                <tab.Icon active={isActive} />
              </div>
              <span>{tab.label}</span>
              {isActive && <div className="nav-dot" />}
            </button>
          );
        })}
      </nav>

    </div>
  );
}
