import { useCallback, useEffect, useRef, useState } from 'react';
import SwipeCard from './components/SwipeCard';
import Leaderboard from './components/Leaderboard';
import Portfolio from './components/Portfolio';
import WatchlistPanel from './components/WatchlistPanel';
import CuratedWhales from './components/CuratedWhales';
import ProfilePage from './components/ProfilePage';
import Onboarding from './components/Onboarding';
import WhaleDossier from './components/WhaleDossier';
import Tour from './components/Tour';
import WhaleRail from './components/WhaleRail';

// ── Interactive guided tours (SyncSwap-intro style) — one short spotlight
// walkthrough per page, auto-shown once. Targets are [data-tour] elements. ──
const TOURS = {
  deck: [
    { icon: '🐋', title: 'Live whale signals', target: '[data-tour="deck-card"]', text: 'Every card is a REAL on-chain buy from a tracked whale, streaming in live. Tap a card to flip it — entry price, Degen Score breakdown, momentum and risk flags are on the back.' },
    { icon: '🎚️', title: 'Whale size tiers', target: '[data-tour="deck-tiers"]', text: 'Filter the deck by trade size — Big, Shark or Whale. The counters show how many live signals sit in each tier right now.' },
    { icon: '👆', title: 'Swipe to act', target: '[data-tour="deck-actions"]', text: 'Swipe right (or ✓) to copy the trade instantly from your Turbo wallet — no popups. Swipe left (✕) to skip, swipe up (♥) to save the whale to your watchlist.' },
    { icon: '⚙️', title: 'Your copy size', target: '[data-tour="trade-settings"]', text: 'Set how much each copy spends — a fixed amount, or Mirror mode to copy a % of the whale’s own size. Slippage lives here too.' },
    { icon: '🌐', title: 'Switch chains', target: '[data-tour="chain-switch"]', text: 'One tap swaps the whole app between Monad and Solana — separate decks, whales and balances per chain.' },
  ],
  portfolio: [
    { icon: '📊', title: 'Your copies live here', target: '[data-tour="portfolio-head"]', text: 'Every copied trade becomes a position with live PnL. Buy more, close any % of it, or share a PnL card with one tap.' },
    { icon: '🛡️', title: 'Exits run themselves', target: '[data-tour="portfolio-head"]', text: 'Open a position to set stop-loss / take-profit, or arm “sell when the whale sells” — your exits execute automatically, even while you sleep.' },
  ],
  leaderboard: [
    { icon: '🏆', title: 'Who’s actually good', target: '[data-tour="lb-tabs"]', text: 'Whales ranks tracked wallets by real performance. 🔥 Hot shows tokens that MULTIPLE whales are buying right now — the strongest signal in the app.' },
    { icon: '🤖', title: 'Watchlist & Auto-Copy', target: '[data-tour="lb-tabs"]', text: 'Save whales to your Watchlist, tap one for its full dossier, and arm 🤖 AUTO to copy their buys hands-free within your daily budget.' },
  ],
  profile: [
    { icon: '⚡', title: 'Turbo wallet', target: '[data-tour="turbo-card"]', text: 'This wallet powers 1-swipe trading — deposit here and swipes spend from it with zero popups. Export the key to back it up; withdraw any time.' },
    { icon: '🤖', title: 'Auto-Copy budgets', target: '[data-tour="autocopy-card"]', text: 'The master switch for hands-free copying: per-copy amount and a hard daily budget. Whales you mark AUTO in the watchlist trade within these limits.' },
    { icon: '🧾', title: 'Everything on record', target: '[data-tour="profile-stats"]', text: 'Your stats, full trade activity with explorer links, and settings — including whale alerts and auto-sell — all live on this page.' },
  ],
};
const TOUR_KEY = (tab) => `tour_${tab}_v1`;
import { hasTurboAgreement, turboWalletExists, turboCopyBuy, turboSellToken, turboTokenInfo, getTurboAddress, getTurboBalance } from './services/turboWallet';
import curatedWhalesData from './data/curatedWhales.json';
import { X, Settings, Check, AlertTriangle, Info, Layers, WifiOff, Star } from 'lucide-react';
import { fetchMONPrice, fetchTokensByAddresses } from './services/dexscreenerApi';
import {
  fetchWhaleDeck,
  fetchWhaleLeaderboard,
  openWhaleFeed,
  indexerHealth,
} from './services/indexerApi';
import { EXPLORER_URL, EXPLORER_ADDR_URL, DEFAULT_SLIPPAGE_BPS, ACTIVE, CHAINS, setActiveChainId, INDEXER_HTTP, DEXSCREENER_CHAIN } from './config/chain.js';
import {
  connectWallet,
  getConnectedAccount,
  sellToken,
  getTokenInfo,
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
const ACTIVITY_LS = LSK('activity', 'monad_activity');
const AUTOCOPY_LS = LSK('autoCopy', 'monad_autoCopy');
const SIZING_LS = LSK('sizing', 'monad_sizing');
const AUTOCOPY_SPEND_LS = LSK('autoCopySpend', 'monad_autoCopySpend');

// Auto-Copy defaults are conservative and chain-native (MON vs SOL scale).
const AUTOCOPY_DEFAULTS = ACTIVE.id === 'monad'
  ? { amount: 1, dailyCap: 10, amountPresets: [0.5, 1, 2, 5], capPresets: [5, 10, 25, 50] }
  : { amount: 0.1, dailyCap: 1, amountPresets: [0.05, 0.1, 0.25, 0.5], capPresets: [0.5, 1, 2.5, 5] };

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
  pass:       { msg: 'Skipped',            kind: 'info', color: 'var(--surface-2)' },
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
  sell_cancel: { msg: 'Sell cancelled',    kind: 'info', color: 'var(--surface-2)' },
  sell_fail:  { msg: 'Sell failed',        kind: 'err',  color: 'var(--color-obsidian)' },
  sell_nobal: { msg: 'No tokens to sell',  kind: 'err',  color: 'var(--color-obsidian)' },
  whale_exit: { msg: 'Whale exited — closing your copy', kind: 'info', color: 'var(--color-tidewater-navy)' },
};
const TOAST_ICON = { ok: Check, err: AlertTriangle, info: Info };

/* ── Nav icons ── */
function IconDeck({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="4" y="8" width="16" height="13" rx="3" stroke={c} strokeWidth="1.6" fill={active ? 'rgba(160, 107, 255,0.14)' : 'none'}/><rect x="7" y="5" width="13" height="12" rx="3" stroke={c} strokeWidth="1.6" fill={active ? 'rgba(160, 107, 255,0.07)' : 'none'}/></svg>);
}
function IconPortfolio({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><rect x="3" y="12" width="4" height="9" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/><rect x="10" y="7" width="4" height="14" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/><rect x="17" y="3" width="4" height="18" rx="1.5" fill={c} fillOpacity={active ? 0.9 : 0.4}/></svg>);
}
function IconLeaderboard({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6L12 2z" stroke={c} strokeWidth="1.6" strokeLinejoin="round" fill={active ? 'rgba(160, 107, 255,0.18)' : 'none'}/></svg>);
}
function IconProfile({ active }) {
  const c = active ? 'var(--accent-2)' : 'var(--text-3)';
  return (<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1.6" fill={active ? 'rgba(160, 107, 255,0.14)' : 'none'}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={c} strokeWidth="1.6" strokeLinecap="round"/></svg>);
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
function TradeSettingsPopover({ open, onClose, amount, onChangeAmount, slippageBps, onChangeSlippage, monPriceUsd, monBalance, sizing, onChangeSizing }) {
  const [manualVal, setManualVal] = useState('');
  const isManual = !TIERS.some((t) => t.value === amount);
  if (!open) return null;
  const GAS_BUFFER = ACTIVE.gasBuffer; // leave native funds for gas/rent
  const maxCopy = monBalance != null ? Math.max(0, monBalance - GAS_BUFFER) : null;
  const mirror = sizing?.mode === 'mirror';
  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 80, background: 'rgba(2,4,10,0.55)', backdropFilter: 'blur(6px)', borderRadius: 'inherit' }} />
      <div className="animate-slide-up-modal" style={{ position: 'absolute', bottom: 90, left: 16, right: 16, zIndex: 81, background: 'var(--surface-1)', borderRadius: 24, padding: 20, boxShadow: 'var(--shadow-lg)', border: '1px solid var(--line-1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>Copy Amount</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: 14, border: 'none', background: 'var(--color-frost-shadow)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-pebble)' }}><X size={15} /></button>
        </div>

        {/* sizing mode: fixed spend vs proportional mirror of the whale's size */}
        {onChangeSizing && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, background: 'var(--color-frost-shadow)', borderRadius: 12, padding: 4 }}>
            {[{ id: 'fixed', label: 'Fixed amount' }, { id: 'mirror', label: '⚖️ Mirror whale' }].map((m) => {
              const on = (sizing?.mode || 'fixed') === m.id;
              return (
                <button key={m.id} type="button" onClick={() => onChangeSizing({ mode: m.id })}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 9, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: on ? 'var(--color-tidewater-navy)' : 'transparent', color: on ? '#fff' : 'var(--color-pebble)' }}>
                  {m.label}
                </button>
              );
            })}
          </div>
        )}
        {mirror && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>% of the whale&apos;s size</label>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              {[1, 2, 5, 10].map((p) => {
                const on = (sizing?.mirrorPct || 5) === p;
                return (
                  <button key={p} type="button" onClick={() => onChangeSizing({ mirrorPct: p })}
                    style={{ flex: 1, padding: '9px 0', borderRadius: 12, border: 'none', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: on ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: on ? '#fff' : 'var(--color-midnight-ink)' }}>
                    {p}%
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--color-pebble)', marginTop: 6, fontWeight: 600, lineHeight: 1.5 }}>
              A whale buying 100 {ACTIVE.nativeSymbol} → you copy {(100 * (sizing?.mirrorPct || 5) / 100).toFixed(1)} {ACTIVE.nativeSymbol}. The amount below is your hard cap per copy.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{mirror ? `max ${ACTIVE.nativeSymbol} per copy (cap)` : `${ACTIVE.nativeSymbol} spent per copy`}</label>
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
  { id: 'big', label: 'Big', color: '#ff9d4d' },
  { id: 'shark', label: 'Shark', color: '#b98cff' },
  { id: 'whale', label: 'Whale', color: '#a06bff' },
];
function inTier(usd, id) {
  if (usd < (TIERS_USD.all || 0)) return false; // global floor, every tier
  if (id === 'big') return usd >= TIERS_USD.big && usd < TIERS_USD.shark;
  if (id === 'shark') return usd >= TIERS_USD.shark && usd < TIERS_USD.whale;
  if (id === 'whale') return usd >= TIERS_USD.whale;
  return true; // 'all'
}

// Deck loading placeholder — mirrors the card shape so the layout doesn't jump.
const Sk = ({ w, h, r = 8, style }) => (
  <div className="shimmer" style={{ width: w, height: h, borderRadius: r, ...style }} />
);
function DeckSkeleton() {
  return (
    <div className="card-deck-area">
      <div style={{ height: '100%', borderRadius: 24, border: '1px solid var(--color-silver-lining)', background: 'var(--color-paper-white)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px', borderBottom: '1px solid var(--line-2)' }}>
          <Sk w={64} h={22} r={100} /><Sk w={90} h={12} /><Sk w={40} h={12} style={{ marginLeft: 'auto' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px 0' }}>
          <Sk w={46} h={46} r={12} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><Sk w={120} h={16} /><Sk w={90} h={11} /></div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '22px 18px 0' }}>
          <Sk w={140} h={30} r={10} /><Sk w={180} h={38} r={12} /><Sk w={150} h={12} />
        </div>
        <div style={{ margin: '16px 18px 0' }}><Sk w="100%" h={54} r={16} /></div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '10px 18px 0' }}>
          <Sk w="100%" h={46} r={12} /><Sk w="100%" h={46} r={12} /><Sk w="100%" h={46} r={12} /><Sk w="100%" h={46} r={12} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const clock = useClock();
  // One-time risk disclaimer — a public tool that executes real trades with a
  // local hot wallet must gate first use behind an explicit acknowledgement.
  const [disclaimerOk, setDisclaimerOk] = useState(() => loadLS('degen_disclaimer_v1', false));
  const [onboardOk, setOnboardOk] = useState(() => loadLS('degen_onboard_v1', false));
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
  // Copy sizing: 'fixed' spends tradeAmount per copy; 'mirror' spends a % of the
  // whale's own size, capped at tradeAmount (pro proportional copy-trading).
  const [sizing, setSizing] = useState(() => loadLS(SIZING_LS, { mode: 'fixed', mirrorPct: 5 }));
  const updateSizing = useCallback((patch) => {
    setSizing((prev) => { const next = { ...prev, ...patch }; saveLS(SIZING_LS, next); return next; });
  }, []);
  const copyAmountFor = useCallback((card) => {
    if (sizing.mode !== 'mirror') return tradeAmount;
    const whaleNative = (card.amountMon || 0) > 0
      ? card.amountMon
      : (card.amountUsd && monPriceUsd ? card.amountUsd / monPriceUsd : 0);
    if (!(whaleNative > 0)) return tradeAmount;
    const minCopy = ACTIVE.id === 'monad' ? 0.05 : 0.005; // dust floor so swaps don't revert
    return +Math.max(minCopy, Math.min(tradeAmount, whaleNative * (sizing.mirrorPct / 100))).toFixed(4);
  }, [sizing, tradeAmount, monPriceUsd]);
  const [slippageBps, setSlippageBps] = useState(() => loadLS('monad_slippage', DEFAULT_SLIPPAGE_BPS));
  const [lastTxHash, setLastTxHash] = useState(() => loadLS(LASTTX_LS, null));
  // Favorites/watchlist are address-format-specific → stored per chain
  // (Monad keeps its original keys; other chains get prefixed ones).
  const FAV_KEY = ACTIVE.id === 'monad' ? 'monad_favorites' : `${ACTIVE.id}_favorites`;
  const WATCH_KEY = ACTIVE.id === 'monad' ? 'monad_watchlist' : `${ACTIVE.id}_watchlist`;
  const [favorites, setFavorites] = useState(() => loadLS(FAV_KEY, []));
  const [watchlist, setWatchlist] = useState(() => loadLS(WATCH_KEY, []));

  // ── Auto-Copy (follow mode): whales the user marked AUTO are copied hands-free
  // when their BUY lands on the live feed — bounded by amount + daily cap. ──
  const [autoCopy, setAutoCopy] = useState(() => loadLS(AUTOCOPY_LS, { enabled: false, amount: AUTOCOPY_DEFAULTS.amount, dailyCap: AUTOCOPY_DEFAULTS.dailyCap, whales: [] }));
  const updateAutoCopy = useCallback((patch) => {
    setAutoCopy((prev) => { const next = { ...prev, ...patch }; saveLS(AUTOCOPY_LS, next); return next; });
  }, []);
  const toggleAutoWhale = useCallback((addr) => {
    const norm = ACTIVE.kind === 'evm' ? (addr || '').toLowerCase() : (addr || '');
    setAutoCopy((prev) => {
      const has = prev.whales.includes(norm);
      const next = { ...prev, whales: has ? prev.whales.filter((w) => w !== norm) : [...prev.whales, norm] };
      saveLS(AUTOCOPY_LS, next);
      return next;
    });
  }, []);
  // Daily spend ledger (attempted-native per calendar day, chain-local)
  const todayKey = () => new Date().toISOString().slice(0, 10);
  const autoSpentToday = () => {
    const s = loadLS(AUTOCOPY_SPEND_LS, null);
    return s && s.date === todayKey() ? s.spent : 0;
  };
  const addAutoSpend = (amt) => {
    const cur = autoSpentToday();
    saveLS(AUTOCOPY_SPEND_LS, { date: todayKey(), spent: cur + amt });
  };
  // re-render tick so the settings UI shows fresh "spent today" numbers
  const [autoSpendTick, setAutoSpendTick] = useState(0);
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
  // Settings are PER CHAIN — minWhaleMon is in native units (MON vs SOL differ
  // ~100x), so sharing one key across chains silently filtered out every card.
  const SETTINGS_LS = LSK('settings', 'monad_settings');
  const [settings, setSettings] = useState(() => ({ liveFeed: true, hideStables: false, minWhaleMon: 0, autoSell: true, whaleAlerts: false, ...loadLS(SETTINGS_LS, {}) }));
  const [balanceHistory, setBalanceHistory] = useState(() => loadLS(BALHIST_LS, []));
  // Every executed trade (buys, sells, auto SL/TP/whale-exit closes) — the
  // user-visible audit trail rendered on the Profile page. Per-chain, capped.
  const [activity, setActivity] = useState(() => loadLS(ACTIVITY_LS, []));
  const logActivity = useCallback((entry) => {
    setActivity((prev) => {
      const next = [{ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, time: Date.now(), ...entry }, ...prev].slice(0, 100);
      saveLS(ACTIVITY_LS, next);
      return next;
    });
  }, []);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const sellingRef = useRef(new Set());
  // After a failed auto-sell, back off (id → retry-after ms) so SL/TP and
  // whale-exit don't retry every cycle and spam the deck with errors.
  const sellCooldownRef = useRef(new Map());
  const AUTO_SELL_COOLDOWN_MS = 5 * 60 * 1000;
  const whaleExitRef = useRef(null); // "whale sold → close my copy" handler (wired below)
  // Cards the user already swiped/dismissed — so the live feed and the safety
  // poll never re-add a trade the user has already dealt with.
  const dismissedRef = useRef(new Set());
  // Auto-Copy plumbing: executor lives in a ref (the feed effect runs once),
  // recent whale+token pairs are deduped, and failures back the feature off.
  const autoCopyRef = useRef(null);
  const autoDedupeRef = useRef(new Map());   // `${whale}-${token}` → last copy ts
  const autoBackoffRef = useRef(0);          // wallet-level cooldown after a failure
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbMode, setLbMode] = useState('rankings');
  const [showTradeSettings, setShowTradeSettings] = useState(false);
  const [isOffline, setIsOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine);
  const [dossierAddr, setDossierAddr] = useState(null); // Whale Dossier overlay

  // ── Guided tour: auto-start each page's walkthrough on first visit ──
  const [tourSteps, setTourSteps] = useState(null);
  const tourTabRef = useRef(null);
  const startTour = useCallback((tab, force = false) => {
    if (!TOURS[tab]) return;
    if (!force && loadLS(TOUR_KEY(tab), false)) return;
    tourTabRef.current = tab;
    // let the page render/settle before measuring spotlight targets
    setTimeout(() => setTourSteps(TOURS[tab]), 450);
  }, []);
  const endTour = useCallback(() => {
    if (tourTabRef.current) saveLS(TOUR_KEY(tourTabRef.current), true);
    setTourSteps(null);
  }, []);
  const replayTours = useCallback(() => {
    Object.keys(TOURS).forEach((t) => saveLS(TOUR_KEY(t), false));
    startTour(activeTab === 'profile' ? 'profile' : activeTab, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, startTour]);
  // Turbo 1-swipe trading: agreement + local trading wallet → no per-trade popups.
  // The Turbo wallet IS the app's primary account on both chains — the external
  // wallet (MetaMask/Phantom) is only a funding source / withdraw destination.
  // Setup & management live in the Profile identity card (TurboActions).
  const [turboAddr, setTurboAddr] = useState(() => getTurboAddress());
  // USD scale differs per chain, so the tier choice is stored per chain too
  const DECKTIER_LS = LSK('deckTier', 'monad_deckTier');
  const [deckTier, setDeckTier] = useState(() => loadLS(DECKTIER_LS, 'all'));
  useEffect(() => { saveLS(DECKTIER_LS, deckTier); }, [deckTier]);
  const topCardRef = useRef(null);

  // Viewport scale — the phone shell is 393×852. On mobile it fills the screen
  // (~1). On desktop we ZOOM IN to fill the available height (up to 1.6×) so it
  // doesn't sit tiny in the middle of a big monitor, while never overflowing
  // the viewport width or height.
  useEffect(() => {
    const CONTAINER_W = 393, CONTAINER_H = 852;
    const update = () => {
      const mobile = window.innerWidth < 480;
      const pad = mobile ? 0 : 40;
      const byH = (window.innerHeight - pad) / CONTAINER_H;
      const byW = (window.innerWidth - pad) / CONTAINER_W;
      const scale = Math.max(0.6, Math.min(byH, byW, mobile ? 1 : 1.6));
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
  useEffect(() => { saveLS(SETTINGS_LS, settings); }, [settings]);

  const updateSetting = useCallback((key, value) => setSettings((s) => ({ ...s, [key]: value })), []);
  // Whale alerts need OS notification permission — request it on enable (user gesture).
  const toggleWhaleAlerts = useCallback(async (v) => {
    if (v && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      let perm = Notification.permission;
      try { if (perm !== 'denied') perm = await Notification.requestPermission(); } catch { /* unsupported */ }
      if (perm !== 'granted') { showToast('tx_error', 'Allow notifications in your browser to enable alerts'); return; }
    }
    updateSetting('whaleAlerts', v);
  }, [updateSetting]);

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

  // ── Opt-in browser alert for the biggest whale buys (throttled, background only) ──
  const lastNotifyRef = useRef(0);
  const maybeNotifyWhale = useCallback((card) => {
    if (!settingsRef.current.whaleAlerts) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (card.side !== 'BUY') return;
    const usd = card.amountUsd != null ? card.amountUsd : 0;
    if (usd < (ACTIVE.tiers.whale || Infinity)) return;   // only WHALE-tier trades
    if (!document.hidden) return;                          // don't nag while they're watching
    const now = Date.now();
    if (now - lastNotifyRef.current < 30000) return;       // at most one / 30s
    lastNotifyRef.current = now;
    try {
      new Notification(`🐋 Whale bought $${card.tokenSymbol}`, {
        body: `$${Math.round(usd).toLocaleString()} on ${ACTIVE.label} · tap to copy`,
        icon: '/favicon.svg', tag: 'degen-whale',
      }).onclick = () => { window.focus(); };
    } catch { /* notifications unavailable */ }
  }, []);

  // ── Load real whale deck + MON price + leaderboard; open live feed ──
  useEffect(() => {
    const state = { alive: true };
    setIsLoading(true);
    indexerHealth().then((h) => { if (state.alive) setIndexerUp(!!h); });

    // The indexers run on Render's free tier, which sleeps after inactivity — a
    // cold start can take 30-60s. A single deck fetch would time out (7s) and
    // return empty, so users had to reload 2-3 times until the server woke.
    // Instead we retry with backoff so one page load waits the server out; the
    // skeleton keeps showing until cards arrive (or we exhaust the attempts).
    const loadDeckResilient = async () => {
      const delays = [0, 2500, 4000, 6000, 8000, 10000, 12000];
      for (let i = 0; i < delays.length; i++) {
        if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
        if (!state.alive) return;
        const deck = await fetchWhaleDeck(40);
        if (!state.alive) return;
        if (deck.length > 0) {
          setCards(deck);
          setIndexerUp(true);
          setIsLoading(false);
          return;
        }
      }
      if (state.alive) setIsLoading(false); // server still cold — show empty state
    };

    loadDeckResilient();
    Promise.all([fetchMONPrice(), fetchWhaleLeaderboard()])
      .then(([mon, lb]) => {
        if (!state.alive) return;
        if (mon) setMonPriceUsd(mon.priceUsd);
        setLeaderboard(lb);
      });

    const closeFeed = openWhaleFeed((card) => {
      // Whale SELLs never become deck cards (you can't "copy" an exit you don't
      // hold) — but they DO drive the per-position "sell when the whale sells"
      // automation below.
      if (card.side === 'SELL') { whaleExitRef.current?.(card); return; }
      autoCopyRef.current?.(card); // hands-free copy for whales marked AUTO (guarded)
      if (!settingsRef.current.liveFeed) return; // live feed paused in settings
      if (dismissedRef.current.has(card.id)) return; // already swiped away
      setCards((prev) => (prev.find((c) => c.id === card.id) ? prev : [card, ...prev].slice(0, 60)));
      maybeNotifyWhale(card); // opt-in browser alert for the biggest whale buys
    });

    // Safety-net poll: the WebSocket delivers trades instantly, but Render's free
    // tier can silently drop an idle socket (onclose never fires), so live cards
    // would stall until a reload. This poll re-fetches the snapshot every 15s and
    // merges any trades the socket missed — so new whale activity always lands in
    // the deck on its own, no reload needed. Dismissed/known ids are skipped.
    const pollTimer = setInterval(async () => {
      if (!state.alive || !settingsRef.current.liveFeed) return;
      const deck = await fetchWhaleDeck(40);
      if (!state.alive || !deck.length) return;
      setIndexerUp(true);
      setCards((prev) => {
        const known = new Set(prev.map((c) => c.id));
        const fresh = deck.filter((c) => !known.has(c.id) && !dismissedRef.current.has(c.id));
        // trades the socket missed still auto-copy — the executor's own 90s
        // freshness guard rejects anything that's actually old
        for (const c of fresh) autoCopyRef.current?.(c);
        return fresh.length ? [...fresh, ...prev].slice(0, 60) : prev;
      });
    }, 15000);

    const lbTimer = setInterval(() => fetchWhaleLeaderboard().then((lb) => { if (state.alive && lb.length) setLeaderboard(lb); }), 20000);
    const monTimer = setInterval(() => fetchMONPrice().then((m) => { if (state.alive && m) setMonPriceUsd(m.priceUsd); }), 30000);

    return () => { state.alive = false; closeFeed(); clearInterval(pollTimer); clearInterval(lbTimer); clearInterval(monTimer); };
  }, []);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2800); return () => clearTimeout(t); }, [toast]);
  const showToast = (type, msg) => setToast({ type, key: Date.now(), msg });

  const removeCard = useCallback((trader) => {
    if (trader?.id != null) dismissedRef.current.add(trader.id);
    setCards((prev) => prev.filter((c) => c.id !== trader.id));
  }, []);

  // The balance the app runs on is the TURBO wallet's — it's what swipes spend.
  const refreshBalance = useCallback(() => {
    if (!turboAddr) { setMonBalance(null); return; }
    getTurboBalance().then((b) => {
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
  }, [turboAddr]);

  useEffect(() => {
    refreshBalance();
    const id = setInterval(refreshBalance, 20000);
    return () => clearInterval(id);
  }, [refreshBalance]);

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
    try { navigator.vibrate?.([10, 30, 45]); } catch { /* unsupported */ } // trade confirmed on-chain
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
    logActivity({ kind: 'BUY', symbol: trader.tokenSymbol, tokenAddress: trader.tokenAddress, amountNative: amountMon, usd: invested || null, hash, whale: trader.address || null, auto: action === 'AUTO' ? 'FOLLOW' : null });
  }, [monPriceUsd, logActivity]);

  // ── Copy execution: TURBO 1-swipe — the swap is signed locally by the Turbo
  // trading wallet and broadcast immediately. No wallet popup per trade; the
  // one-time agreement + funding happen in TurboPanel. ──
  const sendCopy = useCallback(async (trader, amountMon, action = 'COPY') => {
    // Safety net for any future chain without in-app execution
    if (!ACTIVE.copySupported) {
      if (action === 'AUTO') return false; // background copies never open tabs
      if (trader?.tokenAddress) window.open(`https://jup.ag/swap/SOL-${trader.tokenAddress}`, '_blank');
      showToast('copy', 'Opened on Jupiter — in-app copy not live on this chain yet');
      return false;
    }
    // First swipe ever → Turbo setup lives on the Profile page; send them there.
    if (!hasTurboAgreement() || !turboWalletExists()) {
      if (action === 'AUTO') return false;
      showToast('copy', '⚡ Set up Turbo in Profile to start 1-swipe trading');
      setActiveTab('profile');
      return false;
    }
    try {
      showToast('copy_pending', `${action === 'AUTO' ? '🤖 Auto-copying' : '⚡ Copying'} $${trader.tokenSymbol}…`);
      const res = await turboCopyBuy(trader.tokenAddress, amountMon, { preferredFee: trader.feeTier, preferredDex: trader.dex, slippageBps });
      recordBuy(trader, amountMon, action, res);
      refreshBalance();
      return true;
    } catch (err) {
      console.error('[Turbo] copy failed:', err.message, err);
      if (err.message === 'INSUFFICIENT_FUNDS') {
        showToast('no_funds', `Turbo balance low — deposit ${ACTIVE.nativeSymbol} in Profile`);
        if (action !== 'AUTO') setActiveTab('profile'); // never yank the user mid-flow for a background copy
      }
      else if (err.message === 'NO_LIQUIDITY') showToast('no_liq');
      else if (err.message === 'TX_FAILED' || err.message === 'TX_TIMEOUT') showToast('tx_failed');
      else if (err.message === 'SWAP_REVERT') showToast('tx_failed', 'Swap reverted — try higher slippage');
      else showToast('tx_error');
      return false;
    }
  }, [monPriceUsd, slippageBps, recordBuy, refreshBalance]);

  // ── Auto-Copy executor: called for every fresh BUY landing on the live feed.
  // Every guard is a real-money guard — err on the side of NOT trading. ──
  useEffect(() => {
    autoCopyRef.current = async (card) => {
      if (!autoCopy.enabled || !autoCopy.whales.length) return;
      if (card.side !== 'BUY' || card.copyable === false || card.isStable) return;
      const whale = ACTIVE.kind === 'evm' ? (card.address || '').toLowerCase() : (card.address || '');
      if (!autoCopy.whales.includes(whale)) return;
      const now = Date.now();
      if (card.ts && now - card.ts > 90_000) return;            // stale (reconnect backfill) — never chase old entries
      if (now < autoBackoffRef.current) return;                  // recent failure → cool off
      if (!hasTurboAgreement() || !turboWalletExists()) return;  // Turbo not set up
      const key = `${whale}-${(card.tokenAddress || '').toLowerCase()}`;
      if ((autoDedupeRef.current.get(key) ?? 0) > now - 30 * 60_000) return; // same whale+token within 30 min
      const amount = autoCopy.amount || AUTOCOPY_DEFAULTS.amount;
      const cap = autoCopy.dailyCap || AUTOCOPY_DEFAULTS.dailyCap;
      if (autoSpentToday() + amount > cap + 1e-9) return;        // daily budget spent
      autoDedupeRef.current.set(key, now);
      addAutoSpend(amount);                                      // count the attempt — caps must be unbeatable
      setAutoSpendTick((t) => t + 1);
      const ok = await sendCopy(card, amount, 'AUTO');
      if (!ok) autoBackoffRef.current = Date.now() + 10 * 60_000; // don't burn the budget on a broken state
    };
  }, [autoCopy, sendCopy]);

  const handleDisconnect = useCallback(() => {
    disconnectWallet();
    setWalletAddress(null); setIsConnected(false); setMonBalance(null);
    saveLS(WALLET_LS, null);
  }, []);

  const handleClearData = useCallback(() => {
    setPortfolio([]); setFavorites([]); setWatchlist([]); setLastTxHash(null); setBalanceHistory([]); setActivity([]);
    saveLS(PORTFOLIO_LS, []); saveLS(FAV_KEY, []);
    saveLS(WATCH_KEY, []); saveLS(LASTTX_LS, null); saveLS(BALHIST_LS, []); saveLS(ACTIVITY_LS, []);
    // auto-copy targets point at the (now empty) watchlist — disarm the bot too
    setAutoCopy((prev) => { const next = { ...prev, enabled: false, whales: [] }; saveLS(AUTOCOPY_LS, next); return next; });
  }, []);

  const removePosition = useCallback((id) => setPortfolio((prev) => prev.filter((p) => p.id !== id)), []);
  const setPositionTargets = useCallback((id, targets) =>
    setPortfolio((prev) => prev.map((p) => (p.id === id ? { ...p, ...targets } : p))), []);
  // Shrink a position by a fraction (0–1) after a partial sell — scales the
  // recorded token amount, cost basis and native size so PnL stays correct.
  const reducePosition = useCallback((id, fraction) => {
    const keep = Math.max(0, Math.min(1, 1 - fraction));
    setPortfolio((prev) => prev.map((p) => {
      if (p.id !== id) return p;
      let tokensRaw = p.tokensRaw;
      try { tokensRaw = ((BigInt(p.tokensRaw || '0') * BigInt(Math.round(keep * 1e6))) / 1000000n).toString(); } catch { /* keep */ }
      return {
        ...p, tokensRaw,
        investedUsd: (p.investedUsd ?? 0) * keep,
        amountMon: (p.amountMon ?? p.amount ?? 0) * keep,
      };
    }));
  }, []);
  const buyMorePosition = useCallback((item, amount) => {
    if (!item?.token?.address || !(amount > 0)) { showToast('tx_error'); return; }
    sendCopy({ address: item.trader?.address, tokenAddress: item.token.address, tokenSymbol: item.token.symbol, tokenDecimals: item.token.decimals }, amount);
  }, [sendCopy]);

  // Sell a position back to native (manual "Close", partial close, or auto
  // SL/TP / whale-exit). Real on-chain swap. Whenever a Turbo wallet exists the
  // swap is signed locally (no popup, works identically on Monad + Solana);
  // otherwise it falls back to the connected external wallet.
  // opts.fraction (0–1, default 1) closes only part of the position.
  const sellPosition = useCallback(async (p, opts = {}) => {
    const fraction = Math.max(0, Math.min(1, opts.fraction ?? 1));
    if (!(fraction > 0)) return;
    const sellAll = fraction >= 0.999;
    const useTurbo = p.turbo || turboWalletExists();

    if (useTurbo) {
      showToast('sell_pending', `⚡ ${sellAll ? 'Closing' : `Selling ${Math.round(fraction * 100)}% of`} $${p.token.symbol}…`);
      try {
        // partial → sell a fraction of the ACTUAL on-chain balance (accurate)
        let amountRaw;
        if (!sellAll) {
          const { raw } = await turboTokenInfo(p.token.address);
          amountRaw = ((raw * BigInt(Math.round(fraction * 1e6))) / 1000000n).toString();
          if (amountRaw === '0') throw new Error('NO_BALANCE');
        }
        const { hash } = await turboSellToken(p.token.address, { slippageBps, preferredDex: p.dex, amountRaw });
        setLastTxHash(hash);
        showToast('sell_sent', sellAll ? 'Position closed' : `Sold ${Math.round(fraction * 100)}%`);
        logActivity({ kind: 'SELL', symbol: p.token.symbol, tokenAddress: p.token.address, fraction, usd: (p.investedUsd ?? 0) * fraction || null, hash, auto: opts.auto || null });
        if (sellAll) setPortfolio((prev) => prev.filter((x) => x.id !== p.id));
        else reducePosition(p.id, fraction);
        refreshBalance();
      } catch (err) {
        const m = err.message;
        if (m === 'NO_BALANCE') showToast('sell_nobal');
        else if (m === 'NO_LIQUIDITY') showToast('no_liq');
        else if (m === 'TX_FAILED' || m === 'TX_TIMEOUT') showToast('tx_failed');
        else showToast('sell_fail');
        throw err;
      }
      return;
    }

    // legacy path: tokens live in the connected external wallet
    let from = walletAddress;
    if (!from) { const ok = await doConnect(); if (!ok) throw new Error('NO_WALLET'); from = await getConnectedAccount(); if (!from) throw new Error('NO_WALLET'); }
    showToast('sell_pending');
    try {
      let amountRaw;
      if (!sellAll) {
        const { raw } = await getTokenInfo(from, p.token.address);
        amountRaw = ((BigInt(raw) * BigInt(Math.round(fraction * 1e6))) / 1000000n).toString();
      }
      const { hash } = await sellToken(from, p.token.address, { slippageBps, preferredDex: p.dex, amountRaw });
      setLastTxHash(hash);
      showToast('sell_sent', sellAll ? 'Position closed' : `Sold ${Math.round(fraction * 100)}%`);
      logActivity({ kind: 'SELL', symbol: p.token.symbol, tokenAddress: p.token.address, fraction, usd: (p.investedUsd ?? 0) * fraction || null, hash, auto: opts.auto || null });
      if (sellAll) setPortfolio((prev) => prev.filter((x) => x.id !== p.id));
      else reducePosition(p.id, fraction);
      refreshBalance(from);
    } catch (err) {
      if (err.code === 4001) { showToast('sell_cancel'); throw err; }
      const m = err.message;
      if (m === 'NO_BALANCE') showToast('sell_nobal');
      else if (m === 'NO_LIQUIDITY') showToast('no_liq');
      else showToast('sell_fail');
      throw err;
    }
  }, [walletAddress, slippageBps, doConnect, refreshBalance, reducePosition, logActivity]);

  // ── "Whale exited → close my copy": a live SELL from the whale you copied,
  // in the token you copied, auto-closes the position (per-position opt-in). ──
  useEffect(() => {
    whaleExitRef.current = (card) => {
      const norm = (s) => (ACTIVE.kind === 'evm' ? (s || '').toLowerCase() : (s || ''));
      const now = Date.now();
      const matches = portfolio.filter((p) =>
        p.sellOnWhaleExit &&
        p.token?.address && norm(p.token.address) === norm(card.tokenAddress) &&
        p.trader?.address && norm(p.trader.address) === norm(card.trader) &&
        !sellingRef.current.has(p.id) &&
        (sellCooldownRef.current.get(p.id) ?? 0) < now);
      for (const p of matches) {
        sellingRef.current.add(p.id); // guard against duplicate sells
        showToast('whale_exit', `Whale sold $${p.token.symbol} — closing your copy…`);
        sellPosition(p, { auto: 'WHALE_EXIT' }).catch(() => { sellingRef.current.delete(p.id); sellCooldownRef.current.set(p.id, Date.now() + AUTO_SELL_COOLDOWN_MS); });
      }
    };
  }, [portfolio, sellPosition]);

  // ── Auto stop-loss / take-profit: watch live token prices, sell when a target is crossed ──
  useEffect(() => {
    if (!turboAddr && !walletAddress) return; // turbo positions sell keyless; legacy ones need the wallet
    let alive = true;
    const check = async () => {
      if (!settingsRef.current.autoSell) return;
      const nowTs = Date.now();
      const open = portfolio.filter((p) => p.token?.address && p.tokensRaw && (p.stopLossPct != null || p.takeProfitPct != null) && !sellingRef.current.has(p.id) && (sellCooldownRef.current.get(p.id) ?? 0) < nowTs);
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
        try { await sellPosition(p, { auto: hitSL ? 'SL' : 'TP' }); }
        catch { sellingRef.current.delete(p.id); sellCooldownRef.current.set(p.id, Date.now() + AUTO_SELL_COOLDOWN_MS); } // back off before retrying
      }
    };
    const id = setInterval(check, 25000);
    check();
    return () => { alive = false; clearInterval(id); };
  }, [walletAddress, portfolio, sellPosition]);

  // Haptic feedback on swipe decisions — no-op where unsupported (desktop/iOS Safari).
  const haptic = (pattern) => { try { navigator.vibrate?.(pattern); } catch { /* unsupported */ } };

  const handleSwipeLeft = useCallback((t) => { haptic(8); removeCard(t); showToast('pass'); }, [removeCard]);
  // No optimistic "sent" toast — sendCopy reports real wallet/chain status only.
  const handleSwipeRight = useCallback((t) => { haptic([12, 40, 18]); removeCard(t); sendCopy(t, copyAmountFor(t)); }, [removeCard, sendCopy, copyAmountFor]);
  // Swipe up = SAVE the whale to the watchlist (favorite), then advance.
  const handleSwipeUp = useCallback((t) => {
    haptic(12);
    const wasSaved = favorites.some((f) => (f.address || '').toLowerCase() === (t.address || '').toLowerCase());
    if (!wasSaved) toggleFavorite({ address: t.address, tokenSymbol: t.tokenSymbol });
    removeCard(t);
    setShowApe(true); setTimeout(() => setShowApe(false), 900);
    showToast('copy', wasSaved ? 'Already in watchlist' : 'Saved to watchlist');
  }, [removeCard, favorites, toggleFavorite]);

  // Self-heal a stale tier choice: if the saved tier filters out EVERY card
  // while 'All' has cards, fall back to 'All' after the initial load — the
  // deck must never look broken while the backend is streaming real trades.
  const tierHealedRef = useRef(false);
  useEffect(() => {
    if (isLoading || tierHealedRef.current || deckTier === 'all' || !cards.length) return;
    tierHealedRef.current = true;
    const buys = cards.filter((c) => c.side !== 'SELL');
    if (buys.some((c) => inTier(usdOf(c), 'all')) && !buys.some((c) => inTier(usdOf(c), deckTier))) setDeckTier('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, cards]);

  const swipe = (dir) => topCardRef.current?.swipe(dir);
  const reloadDeck = useCallback(() => { setIsLoading(true); fetchWhaleDeck(40).then((d) => setCards(d)).finally(() => setIsLoading(false)); }, []);

  // ── Connection resilience: tell the user when the device is offline, and
  // snap everything back to live the moment the connection returns. ──
  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => {
      setIsOffline(false);
      showToast('copy', 'Back online — refreshing live data');
      reloadDeck();
      refreshBalance();
      indexerHealth().then((h) => setIndexerUp(!!h));
    };
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => { window.removeEventListener('offline', goOffline); window.removeEventListener('online', goOnline); };
  }, [reloadDeck, refreshBalance]);

  // First visit to each page → run its guided tour (after the gates clear and
  // the deck's initial load settles so spotlight targets actually exist).
  useEffect(() => {
    if (!disclaimerOk || !onboardOk) return;
    if (activeTab === 'deck' && isLoading) return;
    startTour(activeTab);
  }, [activeTab, disclaimerOk, onboardOk, isLoading, startTour]);

  // ── Desktop keyboard shortcuts: ← skip · → copy · ↑ save · Space/Enter flip ──
  useEffect(() => {
    const onKey = (e) => {
      if (activeTab !== 'deck' || showTradeSettings || tourSteps) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // never steal keys from form fields (custom deposit amount, withdraw address…)
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = e.key;
      if (key === 'ArrowLeft')       { e.preventDefault(); swipe('left'); }
      else if (key === 'ArrowRight') { e.preventDefault(); swipe('right'); }
      else if (key === 'ArrowUp')    { e.preventDefault(); swipe('up'); }
      else if (key === ' ' || key === 'Enter') { e.preventDefault(); window.dispatchEvent(new CustomEvent('deck:flip')); }
      else if (key === 'Escape')     { window.dispatchEvent(new CustomEvent('deck:flip', { detail: false })); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, showTradeSettings, tourSteps]);

  const t = toast ? TOASTS[toast.type] : null;

  // ── Hot Tokens consensus: which tokens are MULTIPLE whales buying right now?
  // Aggregated purely from the live feed window (real trades, last 24h). ──
  const hotByToken = (() => {
    const map = new Map();
    const cutoff = Date.now() - 24 * 3600e3;
    for (const c of cards) {
      if (c.side !== 'BUY' || !c.tokenAddress || (c.ts || 0) < cutoff) continue;
      const key = c.tokenAddress.toLowerCase();
      const e = map.get(key) || { symbol: c.tokenSymbol, tokenAddress: c.tokenAddress, whales: new Set(), totalUsd: 0, lastTs: 0, lastCard: null };
      e.whales.add((c.address || '').toLowerCase());
      e.totalUsd += c.amountUsd != null ? c.amountUsd : (c.amountMon || 0) * (monPriceUsd || 0);
      if ((c.ts || 0) > e.lastTs) { e.lastTs = c.ts || 0; e.lastCard = c; }
      map.set(key, e);
    }
    return map;
  })();
  const hotTokens = [...hotByToken.values()].filter((e) => e.whales.size >= 2).sort((a, b) => b.whales.size - a.whales.size || b.totalUsd - a.totalUsd);

  // Deck respects the pro settings + the size-tier filter (Whale / Shark / Big / All).
  const usdOf = (c) => (c.amountUsd != null ? c.amountUsd : (c.amountMon || 0) * (monPriceUsd || 0));
  const deckCards = cards.filter((c) =>
    c.side !== 'SELL' && // exits aren't copyable — they only power per-position auto-close
    c.copyable !== false && // never show trades we can't act on ("watch only")
    (!settings.hideStables || !c.isStable) &&
    (c.amountMon ?? 0) >= (settings.minWhaleMon || 0) &&
    inTier(usdOf(c), deckTier)
  );

  if (!disclaimerOk) {
    return (
      <div className="app-container">
        <div style={{ position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
          <div style={{ maxWidth: 440, width: '100%', background: 'var(--surface-1)', border: '1px solid var(--line-1)', borderRadius: 24, padding: 24, boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div className="brand-mark" style={{ width: 34, height: 34 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2L20 8.5V15.5L12 22L4 15.5V8.5L12 2Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(255,255,255,0.14)"/><path d="M8.5 12.5L11 15L15.5 9.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'var(--font-display)' }}>Before you start</span>
            </div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
              <li style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500, lineHeight: 1.55 }}>DegenSlide is an experimental tool for copying on-chain whale trades. It is <b>not financial advice</b> — every trade is your own decision and responsibility.</li>
              <li style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500, lineHeight: 1.55 }}>Meme-token trading is extremely high risk. You can lose <b>all</b> of what you deposit. Only trade funds you can afford to lose.</li>
              <li style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500, lineHeight: 1.55 }}>Turbo trading uses a wallet stored <b>in this browser</b>. Back up its key and keep only active funds in it — clearing browser data or a compromised device means lost funds.</li>
              <li style={{ fontSize: 12.5, color: 'var(--text-2)', fontWeight: 500, lineHeight: 1.55 }}>Provided “as is”, no warranty. Nothing here is a solicitation to trade where restricted — using it is your responsibility.</li>
            </ul>
            <button onClick={() => { setDisclaimerOk(true); saveLS('degen_disclaimer_v1', true); }}
              style={{ width: '100%', marginTop: 18, padding: '13px 0', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer', background: 'var(--color-tidewater-navy)', color: '#fff' }}>
              I understand &amp; accept the risks
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!onboardOk) {
    return <Onboarding onDone={() => { setOnboardOk(true); saveLS('degen_onboard_v1', true); }} />;
  }

  return (
    <div className="app-container">
      {showApe && (
        <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center">
          <div className="animate-rocket flex flex-col items-center gap-3"><Star size={72} strokeWidth={1.5} fill="#9b6bff" style={{ color: '#9b6bff' }} /><span className="text-2xl font-black uppercase tracking-widest" style={{ color: '#9b6bff' }}>Saved</span></div>
        </div>
      )}

      {t && (
        <div key={toast.key} className="animate-slide-up pointer-events-none fixed top-16 left-1/2 z-[70] -translate-x-1/2 flex items-center gap-2.5 rounded-full px-5 py-2.5 text-sm font-bold shadow-lg" style={{ background: t.color, border: '1px solid var(--color-silver-lining)', color: '#fff', backdropFilter: 'blur(16px)', whiteSpace: 'nowrap' }}>
          {(() => { const I = TOAST_ICON[t.kind] || Info; return <I size={15} strokeWidth={2.5} />; })()}<span>{toast.msg || t.msg}</span>
        </div>
      )}

      {isOffline && (
        <div className="pointer-events-none fixed top-0 left-0 right-0 z-[80] flex justify-center">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 8, padding: '7px 16px', borderRadius: 100, background: 'rgba(255, 176, 46,0.95)', color: '#1a1508', fontSize: 12, fontWeight: 800, boxShadow: '0 4px 18px rgba(0,0,0,0.4)' }}>
            <WifiOff size={14} strokeWidth={2.5} /> No internet — live feed paused
          </div>
        </div>
      )}

      {tourSteps && <Tour steps={tourSteps} onDone={endTour} />}

      {dossierAddr && (
        <WhaleDossier
          address={dossierAddr}
          onClose={() => setDossierAddr(null)}
          monPriceUsd={monPriceUsd}
          rosterEntry={curatedWhalesList.find((w) => (ACTIVE.kind === 'evm' ? (w.address || '').toLowerCase() === dossierAddr.toLowerCase() : w.address === dossierAddr)) || null}
          isWatched={watchlistView.includes(dossierAddr) || watchlistView.includes(dossierAddr.toLowerCase())}
          onToggleWatch={(a) => {
            const norm = ACTIVE.kind === 'evm' ? a.toLowerCase() : a;
            if (watchlistView.includes(norm) || watchlistView.includes(norm.toLowerCase())) removeFromWatchlist(norm);
            else { addWatchWallet(norm); showToast('copy', 'Added to watchlist'); }
          }}
          isAuto={autoCopy.whales.includes(ACTIVE.kind === 'evm' ? dossierAddr.toLowerCase() : dossierAddr)}
          onToggleAuto={toggleAutoWhale}
          autoEnabled={autoCopy.enabled}
        />
      )}

      {/* ── Desktop sidebar (hidden on mobile) — brand, vertical nav, Turbo ── */}
      <aside className="side-nav">
        <div className="brand" style={{ padding: '4px 6px 0' }}>
          <div className="brand-mark">
            <img src="/favicon.png" alt="DegenSlide" className="brand-logo-img" />
          </div>
          <div>
            <div className="brand-word">DegenSlide</div>
            <div className="brand-sub">
              <span className={`live-dot ${indexerUp ? 'on' : ''}`} />
              {indexerUp ? `${ACTIVE.label} live` : 'feed offline'} · {clock}
            </div>
          </div>
        </div>
        <nav className="side-nav-list">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} type="button" className={`side-nav-item ${isActive ? 'active' : ''}`} onClick={() => setActiveTab(tab.id)}>
                <div className="nav-icon"><tab.Icon active={isActive} /></div>
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
        <button onClick={() => setActiveTab('profile')} className={`side-turbo ${turboAddr ? 'connected' : ''}`} title={turboAddr ? `Turbo wallet ${turboAddr}` : 'Set up Turbo 1-swipe trading'}>
          <span style={{ fontSize: 13 }}>⚡</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {turboAddr ? (monBalance != null ? `${monBalance.toFixed(3)} ${ACTIVE.nativeSymbol}` : `${turboAddr.slice(0, 5)}…${turboAddr.slice(-4)}`) : 'Turbo'}
          </span>
        </button>
      </aside>

      <div className="app-main-col">
      {/* ── App bar: brand identity + wallet ── */}
      <header className="app-bar">
        <div className="brand">
          <div className="brand-mark">
            <img src="/favicon.png" alt="DegenSlide" className="brand-logo-img" />
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
          {/* Turbo wallet IS the account — the button jumps to its home on the Profile page */}
          <button onClick={() => setActiveTab('profile')} className={`connect-btn ${turboAddr ? 'connected' : ''}`} title={turboAddr ? `Turbo wallet ${turboAddr}` : 'Set up Turbo 1-swipe trading'}>
            {turboAddr
              ? (<><span style={{ fontSize: 11 }}>⚡</span>{monBalance != null ? `${monBalance.toFixed(2)} ${ACTIVE.nativeSymbol}` : `${turboAddr.slice(0, 5)}…${turboAddr.slice(-4)}`}</>)
              : (<><span style={{ fontSize: 11 }}>⚡</span>Turbo</>)}
          </button>
        </div>
      </header>

      {/* ── Contextual page head — deck: live-signal count + network switcher ── */}
      <div className="page-head" data-tour={activeTab === 'portfolio' ? 'portfolio-head' : undefined}>
        {activeTab === 'deck' ? (
          <span className="page-meta">{deckCards.length} live signals</span>
        ) : (
          <h1 className="page-title">
            {activeTab === 'leaderboard' ? 'Leaderboard' : activeTab === 'portfolio' ? 'Portfolio' : 'Profile'}
          </h1>
        )}
        {activeTab === 'deck' ? (
          /* Network switcher — persists choice, reloads onto the selected chain's indexer */
          <div className="seg-track" data-tour="chain-switch">
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
        ) : (
          <span className="page-meta">
            {activeTab === 'leaderboard' ? `${curatedWhalesList.length} tracked whales` :
             activeTab === 'portfolio' ? `${portfolio.length} position${portfolio.length === 1 ? '' : 's'}` :
             (turboAddr ? `⚡ ${turboAddr.slice(0, 5)}…${turboAddr.slice(-4)}` : 'turbo not set up')}
          </span>
        )}
      </div>

      <main className="main-content">
        {activeTab === 'leaderboard' ? (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', margin: '0 -16px' }}>
            <div className="seg-track wide lb-seg" data-tour="lb-tabs" style={{ margin: '0 16px 10px', flexShrink: 0 }}>
              {[{ id: 'rankings', label: 'Whales' }, { id: 'hot', label: '🔥 Hot' }, { id: 'curated', label: 'Smart Money' }, { id: 'watchlist', label: 'Watchlist' }].map((m) => (
                <button key={m.id} type="button" className={`seg-item ${lbMode === m.id ? 'on' : ''}`} onClick={() => setLbMode(m.id)}>
                  {m.label}
                  {m.id === 'watchlist' && watchlistView.length > 0 && (<span className="seg-badge">{watchlistView.length}</span>)}
                  {m.id === 'curated' && curatedWhalesList.length > 0 && (<span className="seg-badge">{curatedWhalesList.length}</span>)}
                  {m.id === 'hot' && hotTokens.length > 0 && (<span className="seg-badge">{hotTokens.length}</span>)}
                </button>
              ))}
            </div>
            {lbMode === 'rankings' ? (
              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}><Leaderboard traders={leaderboard} roster={curatedWhalesList} monPriceUsd={monPriceUsd} onWatch={addWatchWallet} watchlist={watchlist} onOpenDossier={setDossierAddr} /></div>
            ) : lbMode === 'hot' ? (
              <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 16px' }}>
                {hotTokens.length === 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 40, textAlign: 'center' }}>
                    <span style={{ fontSize: 34 }}>🔥</span>
                    <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-midnight-ink)', margin: 0 }}>No consensus plays right now</p>
                    <p style={{ fontSize: 12, color: 'var(--color-pebble)', margin: 0, maxWidth: 250, lineHeight: 1.6, fontWeight: 600 }}>
                      When two or more tracked whales buy the same token within 24h, it shows up here.
                    </p>
                  </div>
                ) : hotTokens.map((h) => (
                  <div key={h.tokenAddress} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '13px 14px', marginBottom: 8, borderRadius: 16, background: 'var(--color-paper-white)', border: '1px solid rgba(255,157,77,0.3)', boxShadow: 'var(--shadow-md)' }}>
                    <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'rgba(255,157,77,0.1)', fontSize: 16 }}>🔥</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--color-midnight-ink)' }}>${h.symbol}</div>
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-pebble)', fontFamily: '"JetBrains Mono", monospace', marginTop: 2 }}>
                        {h.whales.size} whales · ${h.totalUsd >= 1000 ? (h.totalUsd / 1000).toFixed(1) + 'K' : h.totalUsd.toFixed(0)} total · {Math.max(1, Math.floor((Date.now() - h.lastTs) / 60000))}m ago
                      </div>
                    </div>
                    <a href={`https://dexscreener.com/${DEXSCREENER_CHAIN}/${h.tokenAddress}`} target="_blank" rel="noreferrer"
                      style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 700, color: 'var(--color-tidewater-navy)', textDecoration: 'none', padding: '7px 11px', borderRadius: 100, border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)' }}>
                      Chart ↗
                    </a>
                    {h.lastCard && h.lastCard.copyable !== false && (
                      <button onClick={() => sendCopy(h.lastCard, tradeAmount)}
                        style={{ flexShrink: 0, fontSize: 10.5, fontWeight: 800, color: '#fff', border: 'none', cursor: 'pointer', padding: '7px 13px', borderRadius: 100, background: 'linear-gradient(135deg, #ff6a3d 0%, #f0511e 100%)', boxShadow: '0 3px 12px rgba(240, 81, 30,0.4)' }}>
                        Copy
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : lbMode === 'curated' ? (
              <CuratedWhales whales={curatedWhalesList} favorites={favorites} onToggleFavorite={toggleFavorite} onSaveAll={saveAllCurated} monPriceUsd={monPriceUsd} />
            ) : (
              <WatchlistPanel wallets={watchlistView} onAdd={addWatchWallet} onRemove={removeFromWatchlist}
                autoWhales={autoCopy.whales} onToggleAuto={toggleAutoWhale} autoEnabled={autoCopy.enabled}
                onOpenDossier={setDossierAddr} />
            )}
          </div>
        ) : activeTab === 'deck' ? (
          <div className="deck-view flex flex-col h-full w-full relative">
            <WhaleRail
              watched={watchlistView}
              curated={curatedWhalesList}
              onOpenDossier={setDossierAddr}
              onAdd={() => { setActiveTab('leaderboard'); setLbMode('watchlist'); }}
            />
            <div className="seg-track wide" data-tour="deck-tiers" style={{ marginBottom: 12, flexShrink: 0 }}>
              {DECK_TIERS.map((tier) => {
                const active = deckTier === tier.id;
                const cnt = cards.filter((c) => c.side !== 'SELL' && c.copyable !== false && (!settings.hideStables || !c.isStable) && (c.amountMon ?? 0) >= (settings.minWhaleMon || 0) && inTier(usdOf(c), tier.id)).length;
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
              <DeckSkeleton />
            ) : deckCards.length > 0 ? (
              <>
                <TradeSettingsPopover open={showTradeSettings} onClose={() => setShowTradeSettings(false)} amount={tradeAmount} onChangeAmount={setTradeAmount} slippageBps={slippageBps} onChangeSlippage={setSlippageBps} monPriceUsd={monPriceUsd} monBalance={monBalance} sizing={sizing} onChangeSizing={updateSizing} />
                <div className="card-deck-area" data-tour="deck-card">
                  {[...deckCards.slice(0, 4)].reverse().map((trader, i, arr) => {
                    const stackIndex = arr.length - 1 - i;
                    return (
                      <SwipeCard key={trader.id} ref={stackIndex === 0 ? topCardRef : null} trader={trader} stackIndex={stackIndex} isTopCard={stackIndex === 0}
                        onSwipeLeft={handleSwipeLeft} onSwipeRight={handleSwipeRight} onSwipeUp={handleSwipeUp} monPriceUsd={monPriceUsd}
                        isFavorite={favorites.some((f) => f.address === trader.address)} onToggleFavorite={toggleFavorite}
                        isCurated={curatedSet.has((trader.address || '').toLowerCase())}
                        onOpenDossier={setDossierAddr}
                        consensusCount={hotByToken.get((trader.tokenAddress || '').toLowerCase())?.whales?.size || 0} />
                    );
                  })}
                </div>
                <div className="action-row" data-tour="deck-actions">
                  <button type="button" data-tour="trade-settings" onClick={() => setShowTradeSettings(true)} title={sizing.mode === 'mirror' ? `Mirror ${sizing.mirrorPct}% of whale size (cap ${tradeAmount} ${ACTIVE.nativeSymbol})` : `${tradeAmount} ${ACTIVE.nativeSymbol} / copy`}
                    style={{ width: 40, height: 40, borderRadius: 20, background: 'var(--color-paper-white)', border: '1px solid var(--color-silver-lining)', boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}>
                    <Settings size={18} color="var(--color-pebble)" />
                    <span style={{ position: 'absolute', top: -2, right: -2, fontSize: 8, fontWeight: 700, background: 'var(--color-tidewater-navy)', color: '#fff', borderRadius: 8, padding: '1px 5px', lineHeight: '14px' }}>{sizing.mode === 'mirror' ? `${sizing.mirrorPct}%` : tradeAmount}</span>
                  </button>
                  <button type="button" className="btn-pass" onClick={() => swipe('left')} title="Skip"><X size={24} strokeWidth={2.6} /></button>
                  {/* Copy is the hero action — largest disc, dead centre */}
                  <button type="button" className="btn-copy" onClick={() => swipe('right')} title="Copy Trade"><Check size={28} strokeWidth={2.8} /></button>
                  {(() => {
                    const top = deckCards[0];
                    const saved = top && favorites.some((f) => (f.address || '').toLowerCase() === (top.address || '').toLowerCase());
                    return (
                      <button type="button" className={`btn-like ${saved ? 'saved' : ''}`} title={saved ? 'Saved to watchlist' : 'Save whale to watchlist'}
                        onClick={() => {
                          if (!top) return;
                          const wasSaved = favorites.some((f) => (f.address || '').toLowerCase() === (top.address || '').toLowerCase());
                          toggleFavorite({ address: top.address, tokenSymbol: top.tokenSymbol });
                          showToast('copy', wasSaved ? 'Removed from watchlist' : 'Saved to watchlist');
                        }}>
                        <Star size={22} fill={saved ? '#fff' : 'none'} strokeWidth={2.2} />
                      </button>
                    );
                  })()}
                </div>
                <div className="kbd-hints" aria-hidden="true">
                  <span><kbd>←</kbd> skip</span>
                  <span><kbd>→</kbd> copy</span>
                  <span><kbd>↑</kbd> save</span>
                  <span><kbd>space</kbd> details</span>
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
            walletAddress={turboAddr} monBalance={monBalance} monPriceUsd={monPriceUsd}
            portfolio={portfolio} watchlistCount={watchlistView.length} balanceHistory={balanceHistory} activity={activity}
            settings={settings} updateSetting={updateSetting} onToggleWhaleAlerts={toggleWhaleAlerts}
            lastTxHash={lastTxHash} indexerUp={indexerUp}
            onDisconnect={handleDisconnect} onClearData={handleClearData}
            externalWallet={walletAddress} onConnect={doConnect} showToast={showToast}
            onTurboChanged={() => { setTurboAddr(getTurboAddress()); refreshBalance(); }}
            autoCopy={autoCopy} updateAutoCopy={updateAutoCopy} autoCopyDefaults={AUTOCOPY_DEFAULTS}
            autoSpentToday={autoSpentToday()} autoSpendTick={autoSpendTick} onReplayTours={replayTours}
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
      </div>{/* /app-main-col */}
    </div>
  );
}
