import { useEffect, useState } from 'react';
import { X, ExternalLink, Eye, EyeOff } from 'lucide-react';
import { fetchAddressInfo } from '../services/indexerApi';
import { whalePerf, fmtUsdSigned } from '../services/whaleStats';
import { EXPLORER_ADDR_URL, EXPLORER_TX_URL, ACTIVE } from '../config/chain.js';
import { BlockieAvatar, generateAlias as alias } from './SwipeCard';

/**
 * Whale Dossier — the full, honest record of one wallet, opened from anywhere
 * a whale appears (deck card, leaderboard). Live indexer data + roster stats;
 * Watch and AUTO actions right where the decision happens.
 */

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const fmtUsd = (v) => {
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
};

function StatCell({ label, value, color }) {
  return (
    <div style={{ textAlign: 'center', padding: '10px 4px', borderRadius: 0, background: 'var(--color-frost-shadow)' }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: color || 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace' }}>{value}</div>
      <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-pebble)', marginTop: 3 }}>{label}</div>
    </div>
  );
}

export default function WhaleDossier({
  address, onClose, monPriceUsd, rosterEntry,
  isWatched, onToggleWatch, isAuto, onToggleAuto, autoEnabled,
}) {
  const [info, setInfo] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setInfo(null); setLoaded(false);
    fetchAddressInfo(address).then((d) => { if (alive) { setInfo(d); setLoaded(true); } });
    return () => { alive = false; };
  }, [address]);

  if (!address) return null;

  // Best stats source: roster (GMGN/scan) first, then the live observed score.
  const perf = whalePerf(rosterEntry, monPriceUsd);
  const score = info?.score;
  const winRate = perf.winRate ?? score?.winRate ?? null;
  const pnlUsd = perf.pnlUsd ?? (score?.realizedMon != null && monPriceUsd ? score.realizedMon * monPriceUsd : null);
  const trades = (info?.trades || []).slice(0, 12);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(5,7,12,0.72)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: '100%', maxWidth: 430, maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        borderRadius: 0, overflow: 'hidden', background: 'var(--color-paper-white)',
        border: '1px solid var(--color-silver-lining)',
      }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '16px 18px', borderBottom: '1px solid var(--color-frost-shadow)' }}>
          <BlockieAvatar addr={address} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-midnight-ink)' }}>{alias(address)}</div>
            <a href={EXPLORER_ADDR_URL(address)} target="_blank" rel="noreferrer"
              style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-tidewater-navy)', fontFamily: '"JetBrains Mono", monospace', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {address.slice(0, 8)}…{address.slice(-6)} <ExternalLink size={10} />
            </a>
          </div>
          <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--color-frost-shadow)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-pebble)', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {/* stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <StatCell label="Balance" value={info?.balanceMon != null ? `${info.balanceMon >= 1000 ? (info.balanceMon / 1000).toFixed(1) + 'K' : info.balanceMon.toFixed(2)}` : (loaded ? '—' : '…')} />
            <StatCell label={perf.source === 'gmgn7d' ? 'PnL 7d' : 'Realized PnL'} value={pnlUsd != null ? fmtUsdSigned(pnlUsd) : '—'} color={pnlUsd != null ? (pnlUsd >= 0 ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)') : undefined} />
            <StatCell label="Win rate" value={winRate != null ? `${Math.round(winRate * 100)}%` : '—'} color={winRate != null && winRate >= 0.5 ? 'var(--color-aurora-green)' : undefined} />
          </div>
          {perf.sourceLabel && (
            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-pebble)', textAlign: 'right', marginTop: 5 }}>{perf.sourceLabel}</div>
          )}

          {/* actions */}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button onClick={() => onToggleWatch?.(address)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, padding: '11px 0', borderRadius: 9999, cursor: 'pointer', fontSize: 12.5, fontWeight: 800,
                border: `1px solid ${isWatched ? 'rgba(160, 107, 255,0.5)' : 'var(--color-silver-lining)'}`,
                background: isWatched ? 'rgba(160, 107, 255,0.1)' : 'var(--color-frost-shadow)',
                color: isWatched ? 'var(--accent-2)' : 'var(--color-midnight-ink)',
              }}>
              {isWatched ? <><EyeOff size={14} /> Watching</> : <><Eye size={14} /> Watch</>}
            </button>
            {onToggleAuto && (
              <button onClick={() => onToggleAuto(address)}
                title={autoEnabled ? '' : 'Auto-Copy master switch is off — enable it in Profile'}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '11px 0', borderRadius: 9999, cursor: 'pointer', fontSize: 12.5, fontWeight: 800,
                  border: `1px solid ${isAuto ? 'rgba(240, 81, 30,0.6)' : 'var(--color-silver-lining)'}`,
                  background: isAuto ? 'var(--accent)' : 'var(--color-frost-shadow)',
                  color: isAuto ? '#fff' : 'var(--color-midnight-ink)',
                  opacity: isAuto && !autoEnabled ? 0.6 : 1,
                }}>
                🤖 {isAuto ? 'AUTO ON' : 'Auto-copy'}
              </button>
            )}
          </div>

          {/* recent trades — straight from the indexer */}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.12em', margin: '18px 0 8px' }}>Recent trades</div>
          {!loaded ? (
            <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--color-pebble)' }}>Loading on-chain history…</div>
          ) : trades.length === 0 ? (
            <div style={{ padding: '18px 0', textAlign: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--color-pebble)' }}>No trades captured by the indexer yet.</div>
          ) : (
            <div style={{ background: 'var(--color-frost-shadow)', borderRadius: 0, padding: '2px 13px' }}>
              {trades.map((t, i) => {
                const buy = t.side === 'BUY';
                return (
                  <a key={t.id || i} href={EXPLORER_TX_URL(t.txHash)} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 0', textDecoration: 'none', borderBottom: i < trades.length - 1 ? '1px solid var(--color-silver-lining)' : 'none' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, padding: '2px 7px', borderRadius: 6, flexShrink: 0, color: buy ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)', background: buy ? 'rgba(70, 209, 107,0.1)' : 'rgba(255, 77, 106,0.1)' }}>
                      {buy ? 'BUY' : 'SELL'}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${t.tokenSymbol}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace', flexShrink: 0 }}>{t.amountUsd != null ? fmtUsd(t.amountUsd) : `${(t.amountMon ?? 0).toFixed(2)} ${ACTIVE.nativeSymbol}`}</span>
                    <span style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--color-pebble)', fontFamily: '"JetBrains Mono", monospace', flexShrink: 0, width: 30, textAlign: 'right' }}>{timeAgo(t.ts)}</span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
