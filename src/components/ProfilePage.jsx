import { useState } from 'react';
import { Copy, Radio, ExternalLink, Trash2, LogOut, Check, SlidersHorizontal, Filter } from 'lucide-react';
import { MONAD_MAINNET, EXPLORER_URL, EXPLORER_ADDR_URL, INDEXER_HTTP, ACTIVE, CHAINS } from '../config/chain.js';
import { WALLET_NAME } from '../services/activeWallet';

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

const MIN_WHALE_TIERS = [0, 5, 25, 100];

export default function ProfilePage({
  walletAddress, monBalance, monPriceUsd,
  portfolio, watchlistCount, balanceHistory,
  settings, updateSetting,
  lastTxHash, indexerUp,
  onDisconnect, onClearData,
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
    { label: `${ACTIVE.nativeSymbol} Used`, value: monDeployed.toFixed(monDeployed >= 100 ? 0 : 2), color: 'var(--color-aurora-magenta)' },
    { label: 'Watchlist', value: watchlistCount, color: 'var(--color-tidewater-navy)' },
    { label: 'Tokens', value: uniqueTokens, color: 'var(--color-midnight-ink)' },
  ];

  return (
    <div style={{ height: '100%', overflowY: 'auto', scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 16, paddingBottom: 32 }}>

        {/* ── Wallet header ── */}
        <div style={{ ...CARD, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 46, height: 46, borderRadius: 14, flexShrink: 0, background: 'var(--color-tidewater-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 700, color: '#fff', fontFamily: 'monospace' }}>
              {walletAddress ? walletAddress.slice(ACTIVE.kind === 'evm' ? 2 : 0, ACTIVE.kind === 'evm' ? 4 : 2).toUpperCase() : '··'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: 'monospace' }}>
                  {walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'Not connected'}
                </span>
                {walletAddress && (
                  <button onClick={copyAddr} title="Copy address" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'flex', color: copied ? 'var(--color-aurora-green)' : 'var(--color-pebble)' }}>
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-aurora-green)', border: '1px solid var(--color-aurora-green)', borderRadius: 6, padding: '1px 5px', letterSpacing: '0.06em' }}>{WALLET_NAME.toUpperCase()}</span>
                <span style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600 }}>{ACTIVE.kind === 'evm' ? `${MONAD_MAINNET.chainName} · id ${MONAD_MAINNET.chainIdNum}` : `${ACTIVE.label} · mainnet-beta`}</span>
              </div>
            </div>
          </div>

          {/* balance + chart */}
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--color-silver-lining)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
              <div>
                <p style={LABEL}>Balance</p>
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 5 }}>
                  <span style={{ fontFamily: '"averta standard", sans-serif', fontSize: 24, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>
                    {monBalance != null ? monBalance.toFixed(3) : '—'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-aurora-magenta)' }}>{ACTIVE.nativeSymbol}</span>
                </div>
                {balanceUsd != null && (
                  <div style={{ fontSize: 11, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 1 }}>≈ ${balanceUsd.toFixed(2)} USD</div>
                )}
              </div>
              {walletAddress && (
                <a href={EXPLORER_ADDR_URL(walletAddress)} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--color-tidewater-navy)', textDecoration: 'none', background: 'var(--color-frost-shadow)', padding: '7px 12px', borderRadius: 10 }}>
                  Explorer <ExternalLink size={12} />
                </a>
              )}
            </div>
            <BalanceChart history={balanceHistory} />
          </div>
        </div>

        {/* ── Stats grid ── */}
        <div style={{ ...CARD, padding: '14px 4px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
          {STATS.map((s, i) => (
            <div key={s.label} style={{ textAlign: 'center', borderLeft: i === 0 ? 'none' : '1px solid var(--color-silver-lining)' }}>
              <div style={{ fontFamily: '"averta standard", sans-serif', fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-pebble)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ── Settings ── */}
        <div style={{ ...CARD, padding: '14px 16px' }}>
          <SectionTitle icon={<SlidersHorizontal size={12} color="var(--color-pebble)" />}>Settings</SectionTitle>
          <div style={{ marginTop: 4 }}>
            <SettingRow title="Live whale feed" desc="Stream new whale trades into the deck in real time.">
              <Toggle on={!!settings.liveFeed} onChange={(v) => updateSetting('liveFeed', v)} />
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
            <a href={`${EXPLORER_URL}/tx/${lastTxHash}`} target="_blank" rel="noreferrer" style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--color-tidewater-navy)', textDecoration: 'none' }}>
              View on MonadScan <ExternalLink size={12} />
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
          DegenSlide · Monad Whale Copy-Trade
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
