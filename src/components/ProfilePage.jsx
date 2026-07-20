import { useState } from 'react';
import { Copy, Radio, ExternalLink, Trash2, LogOut, Check, SlidersHorizontal, Filter, History, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { MONAD_MAINNET, EXPLORER_URL, EXPLORER_ADDR_URL, INDEXER_HTTP, ACTIVE, CHAINS } from '../config/chain.js';
import { WALLET_NAME } from '../services/activeWallet';
import TurboActions from './TurboPanel';

/* ── shared shells ── */
const CARD = {
  background: 'var(--color-paper-white)',
  border: '1px solid var(--color-silver-lining)',
  borderRadius: 18,
  boxShadow: 'var(--shadow-md)',
};
const LABEL = {
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.15em', color: 'var(--color-pebble)', margin: 0,
};

function SectionTitle({ icon, children, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
      {icon}
      <p style={{ ...LABEL, color: accent || 'var(--color-pebble)' }}>{children}</p>
    </div>
  );
}

/* ── iOS-style toggle ── */
function Toggle({ on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{
      width: 44, height: 26, borderRadius: 13, border: 'none', cursor: 'pointer', flexShrink: 0,
      background: on ? 'var(--color-tidewater-navy)' : 'var(--color-silver-lining)',
      position: 'relative', transition: 'background 0.18s',
    }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }} />
    </button>
  );
}

function SettingRow({ title, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>{title}</div>
        {desc && <div style={{ fontSize: 10.5, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Balance history sparkline (real snapshots) ── */
function BalanceChart({ history }) {
  if (!history || history.length < 2) {
    return (
      <div style={{ marginTop: 12, height: 64, borderRadius: 12, background: 'var(--color-frost-shadow)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 10.5, color: 'var(--color-pebble)', fontWeight: 600 }}>Balance history builds as you use the app…</span>
      </div>
    );
  }
  const W = 320, H = 64, PAD = 4;
  const vals = history.map((p) => p.v);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const n = history.length;
  const x = (i) => PAD + (i / (n - 1)) * (W - PAD * 2);
  const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
  const line = history.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L ${x(n - 1).toFixed(1)} ${H} L ${x(0).toFixed(1)} ${H} Z`;
  const up = vals[n - 1] >= vals[0];
  const col = up ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)';
  const changePct = vals[0] ? ((vals[n - 1] - vals[0]) / vals[0]) * 100 : 0;
  return (
    <div style={{ marginTop: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.22" />
            <stop offset="100%" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#balGrad)" />
        <path d={line} fill="none" stroke={col} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(n - 1)} cy={y(vals[n - 1])} r="3" fill={col} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, fontWeight: 700 }}>
        <span style={{ color: 'var(--color-pebble)' }}>{n} snapshots</span>
        <span style={{ color: col }}>{changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%</span>
      </div>
    </div>
  );
}

/* ── Activity feed: every trade the app executed, newest first ── */
function timeAgo(t) {
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const AUTO_LABELS = { SL: 'stop-loss', TP: 'take-profit', WHALE_EXIT: 'whale exited', FOLLOW: 'auto-copy' };

function ActivityList({ activity }) {
  const [expanded, setExpanded] = useState(false);
  if (!activity?.length) return null;
  const shown = expanded ? activity.slice(0, 50) : activity.slice(0, 6);
  return (
    <div style={{ ...CARD, padding: '14px 16px' }}>
      <SectionTitle icon={<History size={12} color="var(--color-pebble)" />}>Activity</SectionTitle>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
        {shown.map((a, i) => {
          const buy = a.kind === 'BUY';
          const col = buy ? 'var(--up)' : 'var(--down)';
          const detail = buy
            ? `${(a.amountNative ?? 0) > 0 ? `${a.amountNative} ${ACTIVE.nativeSymbol}` : ''}${a.usd ? ` · $${a.usd.toFixed(2)}` : ''}${a.auto ? ` · 🤖 ${AUTO_LABELS[a.auto] || 'auto'}` : ''}`
            : `${a.fraction != null && a.fraction < 0.999 ? `${Math.round(a.fraction * 100)}%` : 'all'}${a.auto ? ` · auto (${AUTO_LABELS[a.auto] || a.auto})` : ''}`;
          return (
            <div key={a.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-silver-lining)' }}>
              <div style={{ width: 26, height: 26, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: buy ? 'rgba(70, 209, 107,0.12)' : 'rgba(255, 77, 106,0.12)' }}>
                {buy ? <ArrowUpRight size={14} color={col} /> : <ArrowDownRight size={14} color={col} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>
                  {buy ? 'Copied' : 'Sold'} ${a.symbol}
                </div>
                {detail && <div style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 1, fontFamily: '"JetBrains Mono", monospace' }}>{detail}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 9.5, color: 'var(--color-pebble)', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{timeAgo(a.time)}</div>
                {a.hash && (
                  <a href={`${EXPLORER_URL}/${ACTIVE.txPath}/${a.hash}`} target="_blank" rel="noreferrer"
                    style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--color-tidewater-navy)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                    tx <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {activity.length > 6 && (
        <button onClick={() => setExpanded((v) => !v)} style={{ marginTop: 8, width: '100%', padding: '8px 0', borderRadius: 10, border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)', color: 'var(--color-midnight-ink)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
          {expanded ? 'Show less' : `Show all (${Math.min(activity.length, 50)})`}
        </button>
      )}
    </div>
  );
}

const MIN_WHALE_TIERS = [0, 5, 25, 100];

export default function ProfilePage({
  walletAddress, monBalance, monPriceUsd,
  portfolio, watchlistCount, balanceHistory,
  settings, updateSetting, onToggleWhaleAlerts,
  lastTxHash, indexerUp,
  onDisconnect, onClearData,
  externalWallet, onConnect, showToast, onTurboChanged, activity,
  autoCopy, updateAutoCopy, autoCopyDefaults, autoSpentToday, onReplayTours,
}) {
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const copyAddr = () => {
    if (!walletAddress) return;
    navigator.clipboard?.writeText(walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  };

  // ── real stats from copy history ──
  const totalCopies = portfolio.length;
  const monDeployed = portfolio.reduce((s, i) => s + (i.amountMon ?? i.amount ?? 0), 0);
  const uniqueTokens = new Set(portfolio.map((i) => i.token?.address).filter(Boolean)).size;
  const balanceUsd = monBalance != null && monPriceUsd ? monBalance * monPriceUsd : null;

  const STATS = [
    { label: 'Copies', value: totalCopies, color: 'var(--color-midnight-ink)' },
    { label: `${ACTIVE.nativeSymbol} Used`, value: monDeployed.toFixed(monDeployed >= 100 ? 0 : 2), color: 'var(--accent-2)' },
    { label: 'Watchlist', value: watchlistCount, color: 'var(--color-tidewater-navy)' },
    { label: 'Tokens', value: uniqueTokens, color: 'var(--color-midnight-ink)' },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16, paddingBottom: 32 }}>

        {/* ── Wallet hero — gradient identity card ── */}
        <div data-tour="turbo-card" style={{
          position: 'relative', overflow: 'hidden', borderRadius: 24, padding: 18,
          background: 'radial-gradient(140% 110% at 15% 0%, rgba(240, 81, 30,0.22) 0%, rgba(160, 107, 255,0.06) 45%, transparent 70%), var(--surface-1)',
          border: '1px solid rgba(240, 81, 30,0.25)', boxShadow: 'var(--shadow-md)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 16, flexShrink: 0, display: 'grid', placeItems: 'center',
              background: 'linear-gradient(135deg, #ff6a3d 0%, #f0511e 60%, #a06bff 140%)',
              boxShadow: '0 5px 18px rgba(240, 81, 30,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
              fontSize: 15, fontWeight: 800, color: '#fff', fontFamily: '"JetBrains Mono", monospace',
            }}>
              {walletAddress ? walletAddress.slice(ACTIVE.kind === 'evm' ? 2 : 0, ACTIVE.kind === 'evm' ? 4 : 2).toUpperCase() : '··'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-1)', fontFamily: '"JetBrains Mono", monospace' }}>
                  {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Not connected'}
                </span>
                {walletAddress && (
                  <button onClick={copyAddr} title="Copy address" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: copied ? 'var(--up)' : 'var(--text-3)' }}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{ACTIVE.kind === 'evm' ? `${MONAD_MAINNET.chainName} · id ${MONAD_MAINNET.chainIdNum}` : `${ACTIVE.label} · mainnet-beta`}</span>
              </div>
            </div>
            {walletAddress && (
              <a href={EXPLORER_ADDR_URL(walletAddress)} target="_blank" rel="noreferrer"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, color: 'var(--text-2)', textDecoration: 'none', background: 'rgba(255,255,255,0.05)', border: '1px solid var(--line-1)', padding: '7px 11px', borderRadius: 100, flexShrink: 0 }}>
                Explorer <ExternalLink size={11} />
              </a>
            )}
          </div>

          {/* balance + chart */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line-2)' }}>
            <p style={LABEL}>Balance</p>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-1)', lineHeight: 1 }}>
                {monBalance != null ? monBalance.toFixed(3) : '—'}
              </span>
              <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent-2)', fontFamily: '"JetBrains Mono", monospace' }}>{ACTIVE.nativeSymbol}</span>
              {balanceUsd != null && (
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>≈ ${balanceUsd.toFixed(2)}</span>
              )}
            </div>
            <BalanceChart history={balanceHistory} />

            {/* Turbo actions live right here — agreement once, then deposit/withdraw/export */}
            <TurboActions externalWallet={externalWallet} onConnect={onConnect} showToast={showToast} onChanged={onTurboChanged} />
          </div>
        </div>

        {/* ── Stats grid ── */}
        <div data-tour="profile-stats" style={{ ...CARD, padding: '14px 4px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {STATS.map((s, i) => (
            <div key={s.label} style={{ textAlign: 'center', borderLeft: i === 0 ? 'none' : '1px solid var(--color-silver-lining)' }}>
              <div style={{ fontFamily: '"Space Grotesk", "Inter", sans-serif', fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-pebble)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Auto-Copy (follow mode) — hands-free copying with hard budgets ── */}
        {autoCopy && (
          <div data-tour="autocopy-card" style={{ ...CARD, padding: '14px 16px', border: autoCopy.enabled ? '1px solid rgba(240, 81, 30,0.45)' : CARD.border }}>
            <SectionTitle icon={<span style={{ fontSize: 12 }}>🤖</span>} accent={autoCopy.enabled ? 'var(--color-deep-iris)' : undefined}>Auto-Copy</SectionTitle>
            <SettingRow title="Follow whales hands-free" desc="Instantly copy every BUY from whales marked AUTO in your watchlist. Spends from the Turbo wallet — bounded by the budget below.">
              <Toggle on={!!autoCopy.enabled} onChange={(v) => updateAutoCopy({ enabled: v })} />
            </SettingRow>
            {autoCopy.enabled && (
              <div style={{ marginTop: 6 }}>
                <p style={{ ...LABEL, marginBottom: 8 }}>Per copy ({ACTIVE.nativeSymbol})</p>
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {autoCopyDefaults.amountPresets.map((v) => {
                    const active = (autoCopy.amount || autoCopyDefaults.amount) === v;
                    return (
                      <button key={v} onClick={() => updateAutoCopy({ amount: v })} style={{ flex: 1, padding: '9px 0', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: active ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: active ? '#fff' : 'var(--color-midnight-ink)' }}>
                        {v}
                      </button>
                    );
                  })}
                </div>
                <p style={{ ...LABEL, marginBottom: 8 }}>Daily budget ({ACTIVE.nativeSymbol})</p>
                <div style={{ display: 'flex', gap: 6 }}>
                  {autoCopyDefaults.capPresets.map((v) => {
                    const active = (autoCopy.dailyCap || autoCopyDefaults.dailyCap) === v;
                    return (
                      <button key={v} onClick={() => updateAutoCopy({ dailyCap: v })} style={{ flex: 1, padding: '9px 0', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: active ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: active ? '#fff' : 'var(--color-midnight-ink)' }}>
                        {v}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>
                  <span style={{ color: 'var(--color-pebble)' }}>Today: {(autoSpentToday ?? 0).toFixed(2)} / {(autoCopy.dailyCap || autoCopyDefaults.dailyCap)} {ACTIVE.nativeSymbol}</span>
                  <span style={{ color: 'var(--color-deep-iris)' }}>{autoCopy.whales.length} whale{autoCopy.whales.length === 1 ? '' : 's'} on AUTO</span>
                </div>
                <p style={{ fontSize: 10, color: 'var(--color-pebble)', margin: '8px 0 0', fontWeight: 600, lineHeight: 1.5 }}>
                  Mark whales AUTO in Top → Watchlist. Same token from the same whale is copied at most once per 30 min; the daily budget counts every attempt and resets at midnight.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Activity — the audit trail of every executed trade ── */}
        <ActivityList activity={activity} />

        {/* ── Settings ── */}
        <div style={{ ...CARD, padding: '14px 16px' }}>
          <SectionTitle icon={<SlidersHorizontal size={12} color="var(--color-pebble)" />}>Settings</SectionTitle>
          <div style={{ marginTop: 4 }}>
            <SettingRow title="Live whale feed" desc="Stream new whale trades into the deck in real time.">
              <Toggle on={!!settings.liveFeed} onChange={(v) => updateSetting('liveFeed', v)} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-silver-lining)' }} />
            <SettingRow title="Whale alerts" desc="Get a browser notification when a whale-sized buy lands while the app is in the background.">
              <Toggle on={!!settings.whaleAlerts} onChange={(v) => (onToggleWhaleAlerts ? onToggleWhaleAlerts(v) : updateSetting('whaleAlerts', v))} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-silver-lining)' }} />
            <SettingRow title="Hide stablecoin trades" desc="Skip USDC/USDT swaps — focus on real token bets.">
              <Toggle on={!!settings.hideStables} onChange={(v) => updateSetting('hideStables', v)} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-silver-lining)' }} />
            <SettingRow title="Auto-sell on SL / TP" desc={`When a position hits its stop-loss or take-profit, sell it back to ${ACTIVE.nativeSymbol} automatically (${WALLET_NAME} confirms each).`}>
              <Toggle on={!!settings.autoSell} onChange={(v) => updateSetting('autoSell', v)} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-silver-lining)' }} />
            <div style={{ padding: '12px 0 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Filter size={13} color="var(--color-pebble)" />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>Minimum whale size</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--color-pebble)', fontWeight: 600, margin: '2px 0 10px', lineHeight: 1.4 }}>Only show trades of at least this many {ACTIVE.nativeSymbol} in the deck.</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {MIN_WHALE_TIERS.map((v) => {
                  const active = (settings.minWhaleMon || 0) === v;
                  return (
                    <button key={v} onClick={() => updateSetting('minWhaleMon', v)} style={{ flex: 1, padding: '9px 0', borderRadius: 12, border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer', background: active ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: active ? '#fff' : 'var(--color-midnight-ink)' }}>
                      {v === 0 ? 'All' : `${v}+`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-pebble)', marginTop: 8, fontWeight: 600, lineHeight: 1.5 }}>
            Copy amount & slippage live in the deck’s settings button (bottom-left on the swipe screen).
          </div>
          {onReplayTours && (
            <button onClick={onReplayTours} style={{ marginTop: 10, width: '100%', padding: '10px 0', borderRadius: 12, border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)', color: 'var(--color-midnight-ink)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              🎓 Replay the guided tour
            </button>
          )}
        </div>

        {/* ── Network + indexer status ── */}
        <div style={{ ...CARD, padding: '14px 16px' }}>
          <SectionTitle icon={<Radio size={12} color={indexerUp ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)'} />}>Connections</SectionTitle>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Network" value={ACTIVE.label} sub={ACTIVE.kind === 'evm' ? `chainId ${MONAD_MAINNET.chainIdNum}` : 'mainnet-beta'} />
            <Row label="RPC" value={(ACTIVE.kind === 'evm' ? MONAD_MAINNET.rpcUrls[0] : CHAINS.solana.rpcUrl).replace('https://', '')} />
            <Row label="Whale feed" value={indexerUp ? 'Live' : 'Offline'} valueColor={indexerUp ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)'} sub={INDEXER_HTTP.replace(/^https?:\/\//, '')} dot={indexerUp} />
            <Row label={`${ACTIVE.nativeSymbol} price`} value={monPriceUsd ? `$${monPriceUsd.toFixed(3)}` : '—'} sub="DexScreener" />
          </div>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, fontSize: 11, fontWeight: 700, color: 'var(--color-tidewater-navy)', textDecoration: 'none' }}>
            Open {EXPLORER_URL.replace('https://', '')} <ExternalLink size={12} />
          </a>
        </div>

        {/* ── Last tx ── */}
        {lastTxHash && (
          <div style={{ ...CARD, padding: '14px 16px' }}>
            <SectionTitle>Last Copy Tx</SectionTitle>
            <p style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11, color: 'var(--color-midnight-ink)', wordBreak: 'break-all', margin: '8px 0 0' }}>{lastTxHash}</p>
            <a href={`${EXPLORER_URL}/${ACTIVE.txPath}/${lastTxHash}`} target="_blank" rel="noreferrer" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--color-tidewater-navy)', textDecoration: 'none' }}>
              View on {EXPLORER_URL.replace('https://', '')} <ExternalLink size={12} />
            </a>
          </div>
        )}

        {/* ── Manage ── */}
        <div style={{ ...CARD, padding: '14px 16px', borderColor: 'rgba(239,68,68,0.25)' }}>
          <SectionTitle icon={<Trash2 size={12} color="var(--color-aurora-magenta)" />} accent="var(--color-aurora-magenta)">Manage</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <button onClick={onDisconnect} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', borderRadius: 12, border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)', color: 'var(--color-midnight-ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              <LogOut size={15} /> Disconnect Wallet
            </button>
            {!confirmClear ? (
              <button onClick={() => setConfirmClear(true)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', borderRadius: 12, border: '1px solid rgba(239,68,68,0.4)', background: 'transparent', color: 'var(--color-aurora-magenta)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                <Trash2 size={15} /> Clear Local Data
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { onClearData(); setConfirmClear(false); }} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: 'var(--color-aurora-magenta)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Confirm clear</button>
                <button onClick={() => setConfirmClear(false)} style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)', color: 'var(--color-midnight-ink)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
              </div>
            )}
            <p style={{ fontSize: 10, color: 'var(--color-pebble)', margin: '2px 0 0', fontWeight: 600, lineHeight: 1.5 }}>
              Clears copy history, watchlist, balance chart & settings on this device. On-chain trades are never affected.
            </p>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600, letterSpacing: '0.04em' }}>
          DegenSlide · Swipe to Copy-Trade Whales
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, valueColor, sub, dot }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-pebble)' }}>{label}</span>
      <div style={{ textAlign: 'right', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
          {dot != null && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)', boxShadow: dot ? '0 0 6px var(--color-aurora-green)' : 'none' }} />}
          <span style={{ fontSize: 12, fontWeight: 700, color: valueColor || 'var(--color-midnight-ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
        {sub && <div style={{ fontSize: 9, color: 'var(--color-pebble)', fontWeight: 600, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{sub}</div>}
      </div>
    </div>
  );
}
