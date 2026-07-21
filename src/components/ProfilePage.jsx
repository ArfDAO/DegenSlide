import { useState } from 'react';
import { Copy, Radio, ExternalLink, Trash2, LogOut, Check, SlidersHorizontal, Filter, History, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { MONAD_MAINNET, EXPLORER_URL, EXPLORER_ADDR_URL, INDEXER_HTTP, ACTIVE, CHAINS } from '../config/chain.js';
import { WALLET_NAME } from '../services/activeWallet';
import TurboActions from './TurboPanel';

/* ═══════════════════════════════════════════════════════════════════
   PROFILE — Yinger terminal styling: flat midnight cards, charcoal
   hairlines, bone-white type, mono telemetry labels, pill interactives.
   No shadows, no gradients, 0px card radius, 4/8/12px rhythm.
   ═══════════════════════════════════════════════════════════════════ */

/* ── shared shells ── */
const CARD = {
  background: 'var(--color-midnight-carbon)',
  border: '1px solid var(--color-charcoal-vein)',
  borderRadius: 0,
};
const LABEL = {
  fontSize: 11, fontWeight: 400, textTransform: 'uppercase',
  letterSpacing: '-0.6px', color: 'var(--color-bone-dim)', margin: 0,
  fontFamily: 'var(--font-arbeit-technik)', lineHeight: '15px',
};
const MONO = 'var(--font-arbeit-technik)';

/* pill interactives — the only rounded elements in the system */
const PILL = {
  borderRadius: 9999, border: '1px solid var(--color-charcoal-vein)',
  background: 'transparent', color: 'var(--color-bone-glow)',
  fontSize: 11, fontWeight: 400, fontFamily: MONO, letterSpacing: '-0.3px',
  cursor: 'pointer',
};
const PILL_ON = {
  ...PILL,
  background: 'var(--color-bone-glow)', border: '1px solid var(--color-bone-glow)',
  color: 'var(--color-midnight-carbon)', cursor: 'default',
};

function SectionTitle({ icon, children, accent }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 2 }}>
      {icon}
      <p style={{ ...LABEL, color: accent || LABEL.color }}>{children}</p>
    </div>
  );
}

/* ── pill toggle: bone track when on, charcoal when off ── */
function Toggle({ on, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!on)} style={{
      width: 44, height: 26, borderRadius: 13, cursor: 'pointer', flexShrink: 0,
      background: on ? 'var(--color-bone-glow)' : 'transparent',
      border: `1px solid ${on ? 'var(--color-bone-glow)' : 'var(--color-charcoal-vein)'}`,
      position: 'relative', transition: 'background 0.18s, border-color 0.18s',
    }}>
      <span style={{
        position: 'absolute', top: 2, left: on ? 20 : 2, width: 20, height: 20, borderRadius: '50%',
        background: on ? 'var(--color-midnight-carbon)' : 'var(--color-bone-dim)',
        transition: 'left 0.18s, background 0.18s',
      }} />
    </button>
  );
}

function SettingRow({ title, desc, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>{title}</div>
        {desc && <div style={{ fontSize: 10.5, color: 'var(--color-bone-dim)', fontWeight: 400, marginTop: 2, lineHeight: 1.25 }}>{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/* ── Balance history sparkline (real snapshots) — monochrome bone line ── */
function BalanceChart({ history }) {
  if (!history || history.length < 2) {
    return (
      <div style={{ marginTop: 12, height: 64, border: '1px solid var(--color-charcoal-vein)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ ...LABEL, fontSize: 10 }}>Balance history builds as you use the app…</span>
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
  const col = 'var(--color-bone-glow)';
  const changePct = vals[0] ? ((vals[n - 1] - vals[0]) / vals[0]) * 100 : 0;
  return (
    <div style={{ marginTop: 12 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="balGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e4dfda" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#e4dfda" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#balGrad)" />
        <path d={line} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(n - 1)} cy={y(vals[n - 1])} r="2.5" fill={col} />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 10, fontFamily: MONO, letterSpacing: '-0.3px' }}>
        <span style={{ color: 'var(--color-bone-dim)' }}>{n} snapshots</span>
        <span style={{ color: up ? 'var(--color-bone-glow)' : 'var(--color-bone-dim)' }}>{changePct >= 0 ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%</span>
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
    <div style={{ ...CARD, padding: 12 }}>
      <SectionTitle icon={<History size={12} color="var(--color-bone-dim)" />}>Activity</SectionTitle>
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column' }}>
        {shown.map((a, i) => {
          const buy = a.kind === 'BUY';
          const detail = buy
            ? `${(a.amountNative ?? 0) > 0 ? `${a.amountNative} ${ACTIVE.nativeSymbol}` : ''}${a.usd ? ` · $${a.usd.toFixed(2)}` : ''}${a.auto ? ` · ${AUTO_LABELS[a.auto] || 'auto'}` : ''}`
            : `${a.fraction != null && a.fraction < 0.999 ? `${Math.round(a.fraction * 100)}%` : 'all'}${a.auto ? ` · auto (${AUTO_LABELS[a.auto] || a.auto})` : ''}`;
          return (
            <div key={a.id || i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-charcoal-vein)' }}>
              <div style={{ width: 24, height: 24, flexShrink: 0, display: 'grid', placeItems: 'center', border: '1px solid var(--color-charcoal-vein)' }}>
                {buy ? <ArrowUpRight size={13} color="var(--color-bone-glow)" /> : <ArrowDownRight size={13} color="var(--color-bone-dim)" />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: MONO, letterSpacing: '-0.3px', textTransform: 'uppercase' }}>
                  {buy ? 'Copied' : 'Sold'} ${a.symbol}
                </div>
                {detail && <div style={{ fontSize: 10, color: 'var(--color-bone-dim)', marginTop: 1, fontFamily: MONO, letterSpacing: '-0.3px' }}>{detail}</div>}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--color-bone-dim)', fontFamily: MONO, letterSpacing: '-0.3px' }}>{timeAgo(a.time)}</div>
                {a.hash && (
                  <a href={`${EXPLORER_URL}/${ACTIVE.txPath}/${a.hash}`} target="_blank" rel="noreferrer"
                    style={{ fontSize: 10, color: 'var(--color-bone-glow)', textDecoration: 'underline', textUnderlineOffset: 2, display: 'inline-flex', alignItems: 'center', gap: 3, fontFamily: MONO }}>
                    tx <ExternalLink size={9} />
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {activity.length > 6 && (
        <button onClick={() => setExpanded((v) => !v)} style={{ ...PILL, marginTop: 8, width: '100%', padding: '8px 0', textTransform: 'uppercase' }}>
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
    { label: 'Copies', value: totalCopies },
    { label: `${ACTIVE.nativeSymbol} Used`, value: monDeployed.toFixed(monDeployed >= 100 ? 0 : 2) },
    { label: 'Watchlist', value: watchlistCount },
    { label: 'Tokens', value: uniqueTokens },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 12px 32px' }}>

        {/* ── Wallet identity — flat terminal card ── */}
        <div data-tour="turbo-card" style={{ ...CARD, padding: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, flexShrink: 0, display: 'grid', placeItems: 'center',
              border: '1px solid var(--color-charcoal-vein)',
              fontSize: 14, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: MONO, letterSpacing: '-0.6px',
            }}>
              {walletAddress ? walletAddress.slice(ACTIVE.kind === 'evm' ? 2 : 0, ACTIVE.kind === 'evm' ? 4 : 2).toUpperCase() : '··'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: MONO, letterSpacing: '-0.6px' }}>
                  {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Not connected'}
                </span>
                {walletAddress && (
                  <button onClick={copyAddr} title="Copy address" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: copied ? 'var(--color-bone-glow)' : 'var(--color-bone-dim)' }}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                )}
              </div>
              <div style={{ ...LABEL, fontSize: 10, marginTop: 4 }}>
                {ACTIVE.kind === 'evm' ? `${MONAD_MAINNET.chainName} · id ${MONAD_MAINNET.chainIdNum}` : `${ACTIVE.label} · mainnet-beta`}
              </div>
            </div>
            {walletAddress && (
              <a href={EXPLORER_ADDR_URL(walletAddress)} target="_blank" rel="noreferrer"
                style={{ ...PILL, display: 'flex', alignItems: 'center', gap: 5, textDecoration: 'none', padding: '7px 14px', flexShrink: 0, textTransform: 'uppercase' }}>
                Explorer <ExternalLink size={11} />
              </a>
            )}
          </div>

          {/* balance + chart */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-charcoal-vein)' }}>
            <p style={LABEL}>Balance</p>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontFamily: 'var(--font-inline-vf)', fontSize: 40, fontWeight: 400, letterSpacing: '-0.04em', color: 'var(--color-bone-glow)', lineHeight: 0.9 }}>
                {monBalance != null ? monBalance.toFixed(3) : '—'}
              </span>
              <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: MONO, letterSpacing: '-0.6px', textTransform: 'uppercase' }}>{ACTIVE.nativeSymbol}</span>
              {balanceUsd != null && (
                <span style={{ fontSize: 11, color: 'var(--color-bone-dim)', fontFamily: MONO, letterSpacing: '-0.3px' }}>≈ ${balanceUsd.toFixed(2)}</span>
              )}
            </div>
            <BalanceChart history={balanceHistory} />

            {/* Turbo actions live right here — agreement once, then deposit/withdraw/export */}
            <TurboActions externalWallet={externalWallet} onConnect={onConnect} showToast={showToast} onChanged={onTurboChanged} turboBalance={monBalance} turboAddress={walletAddress} />
          </div>
        </div>

        {/* ── Stats grid ── */}
        <div data-tour="profile-stats" style={{ ...CARD, padding: '12px 0', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {STATS.map((s, i) => (
            <div key={s.label} style={{ textAlign: 'center', borderLeft: i === 0 ? 'none' : '1px solid var(--color-charcoal-vein)' }}>
              <div style={{ fontFamily: MONO, fontSize: 18, fontWeight: 400, letterSpacing: '-0.6px', color: 'var(--color-bone-glow)' }}>{s.value}</div>
              <div style={{ ...LABEL, fontSize: 9, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Auto-Copy (follow mode) — hands-free copying with hard budgets ── */}
        {autoCopy && (
          <div data-tour="autocopy-card" style={{ ...CARD, padding: 12, borderColor: autoCopy.enabled ? 'var(--color-bone-dim)' : 'var(--color-charcoal-vein)' }}>
            <SectionTitle icon={<Radio size={12} color={autoCopy.enabled ? 'var(--color-bone-glow)' : 'var(--color-bone-dim)'} />} accent={autoCopy.enabled ? 'var(--color-bone-glow)' : undefined}>Auto-Copy</SectionTitle>
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
                      <button key={v} onClick={() => updateAutoCopy({ amount: v })} style={{ ...(active ? PILL_ON : PILL), flex: 1, padding: '9px 0' }}>
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
                      <button key={v} onClick={() => updateAutoCopy({ dailyCap: v })} style={{ ...(active ? PILL_ON : PILL), flex: 1, padding: '9px 0' }}>
                        {v}
                      </button>
                    );
                  })}
                </div>
                <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', fontSize: 10, fontFamily: MONO, letterSpacing: '-0.3px' }}>
                  <span style={{ color: 'var(--color-bone-dim)' }}>Today: {(autoSpentToday ?? 0).toFixed(2)} / {(autoCopy.dailyCap || autoCopyDefaults.dailyCap)} {ACTIVE.nativeSymbol}</span>
                  <span style={{ color: 'var(--color-bone-glow)' }}>{autoCopy.whales.length} whale{autoCopy.whales.length === 1 ? '' : 's'} on AUTO</span>
                </div>
                <p style={{ fontSize: 10, color: 'var(--color-bone-dim)', margin: '8px 0 0', fontWeight: 400, lineHeight: 1.25 }}>
                  Mark whales AUTO in Top → Watchlist. Same token from the same whale is copied at most once per 30 min; the daily budget counts every attempt and resets at midnight.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Activity — the audit trail of every executed trade ── */}
        <ActivityList activity={activity} />

        {/* ── Settings ── */}
        <div style={{ ...CARD, padding: 12 }}>
          <SectionTitle icon={<SlidersHorizontal size={12} color="var(--color-bone-dim)" />}>Settings</SectionTitle>
          <div style={{ marginTop: 4 }}>
            <SettingRow title="Live whale feed" desc="Stream new whale trades into the deck in real time.">
              <Toggle on={!!settings.liveFeed} onChange={(v) => updateSetting('liveFeed', v)} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-charcoal-vein)' }} />
            <SettingRow title="Whale alerts" desc="Get a browser notification when a whale-sized buy lands while the app is in the background.">
              <Toggle on={!!settings.whaleAlerts} onChange={(v) => (onToggleWhaleAlerts ? onToggleWhaleAlerts(v) : updateSetting('whaleAlerts', v))} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-charcoal-vein)' }} />
            <SettingRow title="Hide stablecoin trades" desc="Skip USDC/USDT swaps — focus on real token bets.">
              <Toggle on={!!settings.hideStables} onChange={(v) => updateSetting('hideStables', v)} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-charcoal-vein)' }} />
            <SettingRow title="Auto-sell on SL / TP" desc={`When a position hits its stop-loss or take-profit, sell it back to ${ACTIVE.nativeSymbol} automatically (${WALLET_NAME} confirms each).`}>
              <Toggle on={!!settings.autoSell} onChange={(v) => updateSetting('autoSell', v)} />
            </SettingRow>
            <div style={{ borderTop: '1px solid var(--color-charcoal-vein)' }} />
            <div style={{ padding: '12px 0 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <Filter size={13} color="var(--color-bone-dim)" />
                <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>Minimum whale size</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--color-bone-dim)', fontWeight: 400, margin: '2px 0 10px', lineHeight: 1.25 }}>Only show trades of at least this many {ACTIVE.nativeSymbol} in the deck.</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {MIN_WHALE_TIERS.map((v) => {
                  const active = (settings.minWhaleMon || 0) === v;
                  return (
                    <button key={v} onClick={() => updateSetting('minWhaleMon', v)} style={{ ...(active ? PILL_ON : PILL), flex: 1, padding: '9px 0' }}>
                      {v === 0 ? 'All' : `${v}+`}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-bone-dim)', marginTop: 8, fontWeight: 400, lineHeight: 1.25 }}>
            Copy amount &amp; slippage live in the deck&rsquo;s settings button (bottom-left on the swipe screen).
          </div>
          {onReplayTours && (
            <button onClick={onReplayTours} style={{ ...PILL, marginTop: 10, width: '100%', padding: '10px 0', fontSize: 11.5, textTransform: 'uppercase' }}>
              Replay the guided tour
            </button>
          )}
        </div>

        {/* ── Network + indexer status ── */}
        <div style={{ ...CARD, padding: 12 }}>
          <SectionTitle icon={<Radio size={12} color={indexerUp ? 'var(--color-bone-glow)' : 'var(--color-bone-dim)'} />}>Connections</SectionTitle>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Row label="Network" value={ACTIVE.label} sub={ACTIVE.kind === 'evm' ? `chainId ${MONAD_MAINNET.chainIdNum}` : 'mainnet-beta'} />
            <Row label="RPC" value={(ACTIVE.kind === 'evm' ? MONAD_MAINNET.rpcUrls[0] : CHAINS.solana.rpcUrl).replace('https://', '')} />
            <Row label="Whale feed" value={indexerUp ? 'Live' : 'Offline'} valueColor={indexerUp ? 'var(--color-bone-glow)' : 'var(--color-bone-dim)'} sub={INDEXER_HTTP.replace(/^https?:\/\//, '')} dot={indexerUp} />
            <Row label={`${ACTIVE.nativeSymbol} price`} value={monPriceUsd ? `$${monPriceUsd.toFixed(3)}` : '—'} sub="DexScreener" />
          </div>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 12, fontSize: 11, fontFamily: MONO, letterSpacing: '-0.3px', color: 'var(--color-bone-glow)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
            Open {EXPLORER_URL.replace('https://', '')} <ExternalLink size={12} />
          </a>
        </div>

        {/* ── Last tx ── */}
        {lastTxHash && (
          <div style={{ ...CARD, padding: 12 }}>
            <SectionTitle>Last Copy Tx</SectionTitle>
            <p style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '-0.3px', color: 'var(--color-bone-glow)', wordBreak: 'break-all', margin: '8px 0 0' }}>{lastTxHash}</p>
            <a href={`${EXPLORER_URL}/${ACTIVE.txPath}/${lastTxHash}`} target="_blank" rel="noreferrer" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: MONO, letterSpacing: '-0.3px', color: 'var(--color-bone-glow)', textDecoration: 'underline', textUnderlineOffset: 2 }}>
              View on {EXPLORER_URL.replace('https://', '')} <ExternalLink size={12} />
            </a>
          </div>
        )}

        {/* ── Manage ── */}
        <div style={{ ...CARD, padding: 12 }}>
          <SectionTitle icon={<Trash2 size={12} color="var(--color-bone-dim)" />}>Manage</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
            <button onClick={onDisconnect} style={{ ...PILL, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', fontSize: 12, textTransform: 'uppercase' }}>
              <LogOut size={14} /> Disconnect Wallet
            </button>
            {!confirmClear ? (
              <button onClick={() => setConfirmClear(true)} style={{ ...PILL, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', fontSize: 12, textTransform: 'uppercase', color: 'var(--down)', borderColor: 'rgba(255, 77, 106, 0.4)' }}>
                <Trash2 size={14} /> Clear Local Data
              </button>
            ) : (
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { onClearData(); setConfirmClear(false); }} style={{ ...PILL, flex: 1, padding: '11px 0', fontSize: 12, textTransform: 'uppercase', background: 'var(--down)', borderColor: 'var(--down)', color: '#fff' }}>Confirm clear</button>
                <button onClick={() => setConfirmClear(false)} style={{ ...PILL, flex: 1, padding: '11px 0', fontSize: 12, textTransform: 'uppercase' }}>Cancel</button>
              </div>
            )}
            <p style={{ fontSize: 10, color: 'var(--color-bone-dim)', margin: '2px 0 0', fontWeight: 400, lineHeight: 1.25 }}>
              Clears copy history, watchlist, balance chart &amp; settings on this device. On-chain trades are never affected.
            </p>
          </div>
        </div>

        <div style={{ ...LABEL, textAlign: 'center', fontSize: 10 }}>
          DegenSlide · Swipe to Copy-Trade Whales
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, valueColor, sub, dot }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <span style={{ ...LABEL, fontSize: 10.5 }}>{label}</span>
      <div style={{ textAlign: 'right', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'flex-end' }}>
          {dot != null && <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot ? 'var(--up)' : 'var(--color-bone-dim)' }} />}
          <span style={{ fontSize: 12, fontWeight: 400, fontFamily: MONO, letterSpacing: '-0.3px', color: valueColor || 'var(--color-bone-glow)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</span>
        </div>
        {sub && <div style={{ fontSize: 9, color: 'var(--color-bone-dim)', fontFamily: MONO, letterSpacing: '-0.3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>{sub}</div>}
      </div>
    </div>
  );
}
