import { useMemo, useState } from 'react';
import { Check, Eye, Waves, BadgeCheck } from 'lucide-react';
import { EXPLORER_ADDR_URL, ACTIVE } from '../config/chain.js';

/* All values come from the on-chain whale indexer aggregate:
   { address, trades, buys, sells, volumeMon, netMon, lastSeen, lastToken } */

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

function Row({ t, rank, monPriceUsd, onWatch, watched }) {
  const volUsd = monPriceUsd ? t.volumeMon * monPriceUsd : null;
  const hasRealized = (t.closedTokens || 0) > 0;
  const realized = t.realizedMon || 0;
  const pnlUp = realized >= 0;
  const win = t.winRate != null ? Math.round(t.winRate * 100) : null;
  return (
    <div className="flex items-center gap-3 rounded-[16px] px-3 py-3" style={{ background: rank <= 3 ? 'var(--color-paper-white)' : 'transparent', borderTop: rank <= 3 ? '1px solid var(--color-silver-lining)' : 'none', borderLeft: rank <= 3 ? '1px solid var(--color-silver-lining)' : 'none', borderRight: rank <= 3 ? '1px solid var(--color-silver-lining)' : 'none', borderBottom: '1px solid var(--color-silver-lining)', boxShadow: rank <= 3 ? 'var(--shadow-md)' : 'none' }}>
      <div className="grid place-items-center rounded-xl flex-shrink-0" style={{ width: 32, height: 32, background: rank <= 3 ? 'var(--color-tidewater-navy)' : 'var(--color-paper-white)', border: rank <= 3 ? 'none' : '1px solid var(--color-silver-lining)', color: rank <= 3 ? '#fff' : 'var(--color-midnight-ink)', fontSize: rank <= 3 ? 15 : 11, fontWeight: 700 }}>
        {rank}
      </div>
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <a href={EXPLORER_ADDR_URL(t.address)} target="_blank" rel="noreferrer" className="text-xs font-mono truncate" style={{ color: 'var(--color-midnight-ink)', fontWeight: 700, textDecoration: 'none' }}>
            {t.address.slice(0, 8)}…{t.address.slice(-4)}
          </a>
          {t.verified && (<span title="Verified whale (bot-filtered)" className="flex-shrink-0" style={{ display: 'inline-flex', alignItems: 'center', color: '#2563eb' }}><BadgeCheck size={13} /></span>)}
          {t.lastToken && (<span className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[8px] uppercase" style={{ background: 'var(--color-frost-shadow)', color: 'var(--color-aurora-magenta)', fontWeight: 700 }}>${t.lastToken}</span>)}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {win != null && (
            <span className="text-[10px]" style={{ color: win >= 50 ? 'var(--color-aurora-green)' : 'var(--color-pebble)', fontWeight: 700 }}>{win}% win</span>
          )}
          <span className="text-[10px]" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>{t.trades} trades</span>
          <span className="text-[10px]" style={{ color: 'var(--color-pebble)' }}>·</span>
          <span className="text-[10px]" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>{timeAgo(t.lastSeen)} ago</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
        {hasRealized ? (
          <>
            <span className="text-xs" style={{ fontWeight: 800, color: pnlUp ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)' }}>{pnlUp ? '+' : ''}{fmtMon(realized)} {ACTIVE.nativeSymbol}</span>
            <span className="text-[9px]" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>realized · {t.closedTokens} closed</span>
          </>
        ) : (
          <span className="text-[10px]" style={{ color: 'var(--color-pebble)', fontWeight: 700 }}>no exits yet</span>
        )}
        <span className="text-[9px]" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>{fmtMon(t.volumeMon)} {ACTIVE.nativeSymbol} vol</span>
      </div>
      <button onClick={() => onWatch?.(t.address)} disabled={watched} title="Add to watchlist" style={{ background: 'none', border: 'none', cursor: watched ? 'default' : 'pointer', fontSize: 14, color: watched ? 'var(--color-aurora-green)' : 'var(--color-pebble)', padding: 4 }}>
        {watched ? <Check size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export default function Leaderboard({ traders = [], monPriceUsd, onWatch, watchlist = [] }) {
  const [sort, setSort] = useState('profit');
  const [verifiedOnly, setVerifiedOnly] = useState(true);

  const hasVerified = useMemo(() => traders.some((t) => t.verified), [traders]);

  const sorted = useMemo(() => {
    let list = [...traders];
    if (verifiedOnly && hasVerified) list = list.filter((t) => t.verified);
    list.sort((a, b) => {
      if (sort === 'volume') return b.volumeMon - a.volumeMon;
      if (sort === 'trades') return b.trades - a.trades;
      if (sort === 'winrate') {
        // rank real, proven win rates first; wallets with no closed trades sink
        const aw = a.closedTokens > 0 ? a.winRate : -1;
        const bw = b.closedTokens > 0 ? b.winRate : -1;
        if (bw !== aw) return bw - aw;
        return (b.closedTokens || 0) - (a.closedTokens || 0);
      }
      // profit (default): realized MON, closed-trade wallets ranked above open-only
      const ap = a.closedTokens > 0 ? a.realizedMon : -Infinity;
      const bp = b.closedTokens > 0 ? b.realizedMon : -Infinity;
      if (bp !== ap) return bp - ap;
      return b.volumeMon - a.volumeMon;
    });
    return list;
  }, [traders, sort, verifiedOnly, hasVerified]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto items-center" style={{ scrollbarWidth: 'none' }}>
        {SORTS.map((s) => {
          const active = sort === s.id;
          return (
            <button key={s.id} type="button" onClick={() => setSort(s.id)} className="flex-shrink-0 rounded-full px-3 py-1.5 text-[11px]" style={{ background: active ? 'var(--color-aurora-magenta)' : 'var(--color-paper-white)', border: active ? '1px solid var(--color-aurora-magenta)' : '1px solid var(--color-silver-lining)', color: active ? '#fff' : 'var(--color-pebble)', fontWeight: 600, boxShadow: active ? 'none' : 'var(--shadow-md)' }}>
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

      <div className="flex-1 overflow-y-auto px-4 pb-2" style={{ scrollbarWidth: 'none' }}>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 pt-12 text-center">
            <Waves size={40} strokeWidth={1.5} color="var(--color-pebble)" />
            <p className="text-sm" style={{ color: 'var(--color-midnight-ink)', fontWeight: 700 }}>No whales indexed yet</p>
            <p className="text-xs" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>The indexer ranks wallets as live whale trades stream in.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {sorted.map((t, i) => (
              <Row key={t.address} t={t} rank={i + 1} monPriceUsd={monPriceUsd} onWatch={onWatch} watched={watchlist.includes(t.address)} />
            ))}
          </div>
        )}
        <p className="text-center text-[10px] mt-4 mb-1" style={{ color: 'var(--color-pebble)', fontWeight: 600 }}>Realized PnL from observed on-chain buy/sell round-trips · Monad mainnet</p>
      </div>
    </div>
  );
}
