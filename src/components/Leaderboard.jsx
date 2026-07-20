import { useMemo, useState } from 'react';
import { Check, Eye, Waves, BadgeCheck } from 'lucide-react';
import { EXPLORER_ADDR_URL, ACTIVE } from '../config/chain.js';
import { whalePerf, fmtUsdSigned } from '../services/whaleStats.js';

/* Rows come from the live indexer aggregate, ENRICHED with the registry's
   authoritative stats (GMGN 7d on Solana, deep on-chain scan on Monad) via
   whalePerf() — the live agg only fills the gaps. */

function fmtMon(v) {
  if (v == null) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(1);
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const SORTS = [
  { id: 'profit', label: 'Profit' },
  { id: 'winrate', label: 'Win rate' },
  { id: 'volume', label: 'Volume' },
  { id: 'trades', label: 'Trades' },
];

function alias(addr, i) {
  return `Whale #${i + 1}`;
}

const RANK_STYLE = {
  1: { bg: 'linear-gradient(135deg, #ffb02e, #d98e1f)', glow: '0 3px 12px rgba(255, 176, 46,0.4)' },
  2: { bg: 'linear-gradient(135deg, #c7cede, #8d96ac)', glow: '0 3px 12px rgba(199,206,222,0.25)' },
  3: { bg: 'linear-gradient(135deg, #d99e6d, #a96b3c)', glow: '0 3px 12px rgba(217,158,109,0.3)' },
};

function Row({ t, rank, monPriceUsd, onWatch, watched, maxVol, onOpenDossier }) {
  const perf = t.perf || whalePerf(t, monPriceUsd);
  const pnlUp = (perf.pnlUsd ?? 0) >= 0;
  const win = perf.winRate != null ? Math.round(perf.winRate * 100) : null;
  const medal = RANK_STYLE[rank];
  const volShare = maxVol > 0 ? Math.max(0.03, (t.volumeMon || 0) / maxVol) : 0;
  return (
    <div style={{
      position: 'relative', overflow: 'hidden', borderRadius: 18, padding: '12px 14px 13px',
      background: 'var(--surface-1)', border: '1px solid var(--line-2)',
      boxShadow: medal ? 'var(--shadow-md)' : 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center',
          background: medal ? medal.bg : 'var(--surface-2)',
          boxShadow: medal?.glow || 'none',
          color: medal ? '#1a0507' : 'var(--text-3)', fontSize: medal ? 14 : 11, fontWeight: 800,
          fontFamily: 'var(--font-display)',
        }}>
          {rank}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <a href={onOpenDossier ? undefined : EXPLORER_ADDR_URL(t.address)} target="_blank" rel="noreferrer"
              onClick={(e) => { if (onOpenDossier) { e.preventDefault(); onOpenDossier(t.address); } }}
              title={onOpenDossier ? 'Open whale dossier' : undefined}
              style={{ fontSize: 12, fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-1)', fontWeight: 700, textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}>
              {t.address.slice(0, 7)}…{t.address.slice(-4)}
            </a>
            {t.verified && (<span title="Verified whale (bot-filtered)" style={{ display: 'inline-flex', alignItems: 'center', color: '#a06bff', flexShrink: 0 }}><BadgeCheck size={13} /></span>)}
            {t.lastToken && (<span style={{ flexShrink: 0, borderRadius: 100, padding: '1px 7px', fontSize: 8, textTransform: 'uppercase', background: 'var(--accent-soft)', color: 'var(--color-deep-iris)', fontWeight: 800, letterSpacing: '0.04em' }}>${t.lastToken}</span>)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
            {win != null && (
              <span style={{ fontSize: 9.5, color: win >= 50 ? 'var(--up)' : 'var(--text-3)', fontWeight: 700, fontFamily: '"JetBrains Mono", monospace' }}>{win}% win</span>
            )}
            <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{(perf.trades ?? t.trades) || 0} tx · {timeAgo(t.lastSeen)} ago</span>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 1, flexShrink: 0 }}>
          {perf.pnlUsd != null ? (
            <>
              <span style={{ fontSize: 12.5, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: pnlUp ? 'var(--up)' : 'var(--down)' }}>{fmtUsdSigned(perf.pnlUsd)}</span>
              <span style={{ fontSize: 8.5, color: 'var(--text-3)', fontWeight: 600 }}>{perf.source === 'gmgn7d' ? '7d PnL · verified' : perf.source === 'scan' ? 'realized · scan' : `realized · ${perf.tokens} closed`}</span>
            </>
          ) : (
            <span style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 700 }}>no closed trades</span>
          )}
          <span style={{ fontSize: 8.5, color: 'var(--text-3)', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{fmtMon(t.volumeMon)} {ACTIVE.nativeSymbol} vol</span>
        </div>
        <button onClick={() => onWatch?.(t.address)} disabled={watched} title="Add to watchlist"
          style={{ background: 'none', border: 'none', cursor: watched ? 'default' : 'pointer', color: watched ? 'var(--up)' : 'var(--text-3)', padding: 4, flexShrink: 0 }}>
          {watched ? <Check size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {/* relative volume bar — instantly shows who moves real size */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ width: `${volShare * 100}%`, height: '100%', background: medal ? 'linear-gradient(90deg, var(--accent), var(--accent-2))' : 'rgba(240, 81, 30,0.35)' }} />
      </div>
    </div>
  );
}

export default function Leaderboard({ traders = [], roster = [], monPriceUsd, onWatch, watchlist = [], onOpenDossier }) {
  const [sort, setSort] = useState('profit');
  const [verifiedOnly, setVerifiedOnly] = useState(true);

  const hasVerified = useMemo(() => traders.some((t) => t.verified), [traders]);

  // Registry stats by address — the authoritative winrate/PnL source. The live
  // trader aggregate only fills the gaps (recency, volume, last token).
  const rosterByAddr = useMemo(() => {
    const m = new Map();
    for (const w of roster) if (w.address) m.set(w.address, w);
    return m;
  }, [roster]);

  const sorted = useMemo(() => {
    let list = traders.map((t) => {
      const reg = rosterByAddr.get(t.address);
      return { ...t, perf: whalePerf(reg && (reg.realizedUsd7d != null || reg.statsAt != null || reg.realizedUsd != null) ? reg : t, monPriceUsd) };
    });
    if (verifiedOnly && hasVerified) list = list.filter((t) => t.verified);
    list.sort((a, b) => {
      if (sort === 'volume') return b.volumeMon - a.volumeMon;
      if (sort === 'trades') return (b.perf.trades ?? b.trades ?? 0) - (a.perf.trades ?? a.trades ?? 0);
      if (sort === 'winrate') {
        // rank real, proven win rates first; wallets without stats sink
        const aw = a.perf.winRate ?? -1;
        const bw = b.perf.winRate ?? -1;
        if (bw !== aw) return bw - aw;
        return (b.perf.pnlUsd ?? -Infinity) - (a.perf.pnlUsd ?? -Infinity);
      }
      // profit (default): unified USD PnL, wallets with real stats ranked above
      const ap = a.perf.pnlUsd ?? -Infinity;
      const bp = b.perf.pnlUsd ?? -Infinity;
      if (bp !== ap) return bp - ap;
      return b.volumeMon - a.volumeMon;
    });
    return list;
  }, [traders, rosterByAddr, sort, verifiedOnly, hasVerified, monPriceUsd]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: 0 }}>
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto items-center" style={{ scrollbarWidth: 'none' }}>
        {SORTS.map((s) => {
          const active = sort === s.id;
          return (
            <button key={s.id} type="button" onClick={() => setSort(s.id)} className="flex-shrink-0 rounded-full px-3 py-1.5 text-[11px]" style={{ background: active ? 'var(--accent)' : 'var(--color-paper-white)', border: active ? '1px solid var(--accent)' : '1px solid var(--color-silver-lining)', color: active ? '#fff' : 'var(--color-pebble)', fontWeight: 600, boxShadow: active ? 'none' : 'var(--shadow-md)' }}>
              {s.label}
            </button>
          );
        })}
        {hasVerified && (
          <button type="button" onClick={() => setVerifiedOnly((v) => !v)} className="flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] flex items-center gap-1" style={{ marginLeft: 'auto', background: verifiedOnly ? 'var(--color-tidewater-navy)' : 'var(--color-paper-white)', border: verifiedOnly ? '1px solid var(--color-tidewater-navy)' : '1px solid var(--color-silver-lining)', color: verifiedOnly ? '#fff' : 'var(--color-pebble)', fontWeight: 600, boxShadow: verifiedOnly ? 'none' : 'var(--shadow-md)' }}>
            <BadgeCheck size={12} /> Verified
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2" style={{ scrollbarWidth: 'none', minHeight: 0 }}>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 pt-12 text-center">
            <Waves size={40} strokeWidth={1.5} color="var(--color-pebble)" />
            <p className="text-sm" style={{ color: 'var(--color-midnight-ink)', fontWeight: 700 }}>No whales indexed yet</p>
            <p className="text-xs" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>The indexer ranks wallets as live whale trades stream in.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {(() => { const maxVol = Math.max(...sorted.map((x) => x.volumeMon || 0), 0); return sorted.map((t, i) => (
              <Row key={t.address} t={t} rank={i + 1} monPriceUsd={monPriceUsd} onWatch={onWatch} watched={watchlist.includes(t.address)} maxVol={maxVol} onOpenDossier={onOpenDossier} />
            )); })()}
          </div>
        )}
        <p className="text-center text-[10px] mt-4 mb-1" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>
          {ACTIVE.kind === 'svm' ? 'Win rate & PnL from GMGN 7-day portfolio stats · live trades fill the gaps' : 'Win rate & PnL from the deep on-chain scan · live trades fill the gaps'}
        </p>
      </div>
    </div>
  );
}
