import { useCallback, useEffect, useRef, useState } from 'react';
import SwipeCard from './components/SwipeCard';
import Leaderboard from './components/Leaderboard';
import mockTraders from './data/mockTraders.json';
import { fetchTopTraders, fetchMonadStats } from './services/monadApi';
import {
  connectWallet,
  getConnectedAccount,
  sendTradeTransaction,
  isMetaMaskAvailable,
  EXPLORER_URL,
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
  const c = active ? '#FFB547' : '#4B5568';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="8" width="16" height="13" rx="3" stroke={c} strokeWidth="1.6"/>
      <rect x="7" y="5" width="13" height="12" rx="3" stroke={c} strokeWidth="1.6"/>
      {active && <rect x="4" y="8" width="16" height="13" rx="3" fill="#FFB547" fillOpacity="0.2"/>}
    </svg>
  );
}

function IconPortfolio({ active }) {
  const c = active ? '#1BC7B3' : '#4B5568';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="12" width="4" height="9" rx="1.5" fill={c} fillOpacity={active ? 1 : 0.6}/>
      <rect x="10" y="7" width="4" height="14" rx="1.5" fill={c} fillOpacity={active ? 1 : 0.6}/>
      <rect x="17" y="3" width="4" height="18" rx="1.5" fill={c} fillOpacity={active ? 1 : 0.6}/>
    </svg>
  );
}

function IconLeaderboard({ active }) {
  const c = active ? '#FFB547' : '#4B5568';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z"
        stroke={c} strokeWidth="1.6" strokeLinejoin="round"
        fill={active ? c : 'none'} fillOpacity={active ? 0.2 : 0}/>
    </svg>
  );
}

function IconProfile({ active }) {
  const c = active ? '#1BC7B3' : '#4B5568';
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.6"
        fill={active ? c : 'none'} fillOpacity={active ? 0.2 : 0}/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={c} strokeWidth="1.6" strokeLinecap="round"/>
    </svg>
  );
}

const TABS = [
  { id: 'deck',         Icon: IconDeck,        label: 'Deck' },
  { id: 'portfolio',    Icon: IconPortfolio,   label: 'Portfolio' },
  { id: 'leaderboard', Icon: IconLeaderboard,  label: 'Top' },
  { id: 'profile',     Icon: IconProfile,      label: 'Profile' },
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

export default function App() {
  const clock = useClock();
  const [isConnected, setIsConnected]   = useState(false);
  const [walletAddress, setWalletAddress] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [cards, setCards]               = useState(mockTraders.map(t => ({ ...t, isLive: false })));
  const [toast, setToast]               = useState(null);
  const [matchTrader, setMatchTrader]   = useState(null);
  const [showApe, setShowApe]           = useState(false);
  const [portfolio, setPortfolio]       = useState([]);
  const [activeTab, setActiveTab]       = useState('deck');
  const [isLoading, setIsLoading]       = useState(false);
  const [isLiveData, setIsLiveData]     = useState(false);
  const [stats, setStats]               = useState(null);
  const [lastTxHash, setLastTxHash]     = useState(null);
  const topCardRef  = useRef(null);
  const matchTimer  = useRef(null);

  // Auto-reconnect if MetaMask already authorized
  useEffect(() => {
    getConnectedAccount().then((addr) => {
      if (addr) { setWalletAddress(addr); setIsConnected(true); }
    });

    if (isMetaMaskAvailable()) {
      const handleAccountsChanged = (accounts) => {
        if (!accounts.length) { setIsConnected(false); setWalletAddress(null); }
        else { setWalletAddress(accounts[0].toLowerCase()); }
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

  useEffect(() => {
    if (!isConnected) return;
    setIsLoading(true);
    Promise.all([fetchTopTraders(), fetchMonadStats()]).then(([result, statsData]) => {
      if (result.traders) { setCards(result.traders); setIsLiveData(true); }
      if (statsData) setStats(statsData);
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

  const sendTx = useCallback(async (trader, amountMon) => {
    if (!walletAddress || !trader.address) return;
    try {
      const txHash = await sendTradeTransaction(walletAddress, trader.address, amountMon);
      setLastTxHash(txHash);
      showToast('tx_sent');
    } catch (err) {
      if (err.code !== 4001) showToast('tx_error');
    }
  }, [walletAddress]);

  const handleSwipeLeft  = useCallback((t) => { removeCard(t); showToast('pass'); }, [removeCard]);
  const handleSwipeRight = useCallback((t) => {
    removeCard(t); showToast('copy');
    sendTx(t, 0.001);
    setPortfolio(prev => [{ trader: t, action: 'COPY', amount: 0.001, time: Date.now() }, ...prev]);
    if (Math.random() < 0.35) {
      matchTimer.current = setTimeout(() => setMatchTrader(t), 2400);
    }
  }, [removeCard, sendTx]);
  const handleSwipeUp = useCallback((t) => {
    removeCard(t); showToast('ape');
    setShowApe(true);
    setTimeout(() => setShowApe(false), 1200);
    sendTx(t, 0.005);
    setPortfolio(prev => [{ trader: t, action: 'ALL IN', amount: 0.005, time: Date.now() }, ...prev]);
  }, [removeCard, sendTx]);

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
      <header className="mobile-header">
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
              showToast('connect');
            } catch (err) {
              if (err.message !== 'NO_METAMASK' && err.code !== 4001) showToast('tx_error');
            } finally {
              setIsConnecting(false);
            }
          }}
          className="flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-gray-700 bg-white shadow-sm"
        >
          {isConnected ? (
            <>
              <div className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-live-pulse" />
              {walletAddress.slice(0, 5)}…{walletAddress.slice(-4)}
            </>
          ) : (
            isConnecting ? '⏳ Connect' : '🦊 Connect'
          )}
        </button>
      </header>

      {/* ── MAIN CONTENT ── */}
      <main className="main-content">
        {!isConnected ? (
          <div className="flex flex-col items-center justify-center h-full text-center pb-20">
            <div className="text-6xl mb-6 grayscale opacity-50">🦊</div>
            <h3 className="text-xl font-bold text-gray-900">Connect to Swipe</h3>
            <p className="text-gray-500 mt-2 max-w-sm">Connect your MetaMask wallet to view live traders and start copy-trading.</p>
          </div>
        ) : activeTab === 'deck' ? (
          <div className="flex flex-col h-full w-full relative">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center h-full pb-20">
                <div className="w-8 h-8 rounded-full border-2 border-transparent border-t-purple-500 border-r-purple-200 animate-spin" />
                <p className="mt-4 text-sm font-semibold text-gray-500">Loading traders…</p>
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
                      />
                    );
                  })}
                </div>
                <div className="action-row">
                  <button type="button" className="btn-pass" onClick={() => swipe('left')}>✕</button>
                  <button type="button" className="btn-ape" onClick={() => swipe('up')}>ALL IN</button>
                  <button type="button" className="btn-copy" onClick={() => swipe('right')}>✓</button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center pb-20">
                <span className="text-4xl mb-4">🃏</span>
                <h3 className="font-bold text-gray-900">Deck Empty</h3>
                <p className="text-sm text-gray-500 mt-1">You've seen all live traders.</p>
                <button onClick={resetDeck} className="mt-6 px-6 py-2 bg-white border border-gray-200 shadow-sm rounded-full text-sm font-bold text-gray-700 hover:bg-gray-50">
                  Reload Deck
                </button>
              </div>
            )}
          </div>
        ) : activeTab === 'leaderboard' ? (
          <div className="h-full overflow-hidden -mx-4">
            <Leaderboard traders={cards.length > 0 ? cards : mockTraders} />
          </div>
        ) : activeTab === 'portfolio' ? (
          portfolio.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center pb-20">
              <span className="text-4xl mb-4 grayscale opacity-50">📊</span>
              <h3 className="font-bold text-gray-900">Portfolio Empty</h3>
              <p className="text-sm text-gray-500 mt-1">Copied trades will appear here.</p>
            </div>
          ) : (
            <div className="h-full overflow-y-auto px-1 pb-4" style={{ scrollbarWidth: 'none' }}>
              {portfolio.map((item, i) => (
                <div key={i} className="flex items-center justify-between p-4 mb-3 bg-white border border-gray-200 rounded-2xl shadow-sm hover:border-purple-300 transition">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center border border-purple-100 text-purple-600 font-bold">
                      {item.action === 'COPY' ? '✓' : '💸'}
                    </div>
                    <div>
                      <div className="text-sm font-bold text-gray-900">{item.trader.address.slice(0, 8)}…{item.trader.address.slice(-4)}</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">{new Date(item.time).toLocaleTimeString()} · {item.action}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-gray-900">{item.amount} MON</div>
                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">Pending</div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="space-y-4 pt-4">
            <div className="p-4 bg-purple-50 border border-purple-100 rounded-xl">
              <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600">Connected Wallet</p>
              <p className="mt-1 font-mono font-bold text-gray-900 break-all">{walletAddress}</p>
            </div>
            {lastTxHash ? (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500">Last Transaction</p>
                <p className="mt-1 font-mono text-sm text-gray-700 break-all">{lastTxHash}</p>
                <a href={`${EXPLORER_URL}/tx/${lastTxHash}`} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-bold text-purple-600 hover:underline">
                  View on SocialScan ↗
                </a>
              </div>
            ) : (
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl text-center py-8">
                <span className="text-3xl mb-2 block grayscale opacity-50">⛓</span>
                <p className="text-sm font-bold text-gray-900">No Transactions</p>
                <p className="text-xs text-gray-500 mt-1">Swipe right on a trader to send a transaction.</p>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ── BOTTOM NAV ── */}
      <nav className="bottom-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`nav-item ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <div className="nav-icon">
              <tab.Icon active={activeTab === tab.id} />
            </div>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

    </div>
  );
}
