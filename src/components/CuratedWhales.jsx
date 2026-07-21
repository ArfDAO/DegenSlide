import { useMemo, useState } from 'react';
import { Heart, ExternalLink, Search, Waves } from 'lucide-react';
import { EXPLORER_ADDR_URL, ACTIVE } from '../config/chain.js';
import { whalePerf, fmtUsdSigned } from '../services/whaleStats.js';

function fmtMon(v) {
  if (v == null) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

const SORTS = [
  { id: 'pnl', label: 'PnL' },
  { id: 'winrate', label: 'Win rate' },
  { id: 'volume', label: 'Volume' },
];

/**
 * Verified Smart Money roster for the active chain. Solana rows carry GMGN 7d
 * portfolio stats (winrate / realized PnL, refreshed by the indexer); Monad
 * rows carry the deep on-chain scan stats. whalePerf() picks the best real
 * source per wallet — nothing is fabricated.
 */
export default function CuratedWhales({ whales = [], favorites = [], onToggleFavorite, onSaveAll, monPriceUsd }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('pnl');
  const favSet = useMemo(() => new Set(favorites.map((f) => (f.address || '').toLowerCase())), [favorites]);

  const ranked = useMemo(() => {
    const withPerf = whales.map((w) => ({ w, perf: whalePerf(w, monPriceUsd) }));
    withPerf.sort((a, b) => {
      if (sort === 'volume') return (b.w.volumeUsd || 0) - (a.w.volumeUsd || 0);
      if (sort === 'winrate') {
        const aw = a.perf.winRate ?? -1, bw = b.perf.winRate ?? -1;
        if (bw !== aw) return bw - aw;
        return (b.perf.pnlUsd ?? -Infinity) - (a.perf.pnlUsd ?? -Infinity);
      }
      // pnl (default): wallets with real PnL data first, best earners on top
      const ap = a.perf.pnlUsd ?? -Infinity, bp = b.perf.pnlUsd ?? -Infinity;
      if (bp !== ap) return bp - ap;
      return (b.w.volumeUsd || 0) - (a.w.volumeUsd || 0);
    });
    return withPerf;
  }, [whales, sort, monPriceUsd]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ranked;
    return ranked.filter(({ w }) => w.address.toLowerCase().includes(s)
      || (w.tokens || []).some((t) => (t || '').toLowerCase().includes(s))
      || (w.lastToken || '').toLowerCase().includes(s)
      || (w.twitter || '').toLowerCase().includes(s));
  }, [ranked, q]);

  if (!whales.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 40, textAlign: 'center' }}>
        <Waves size={40} strokeWidth={1.5} color="var(--color-pebble)" />
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-midnight-ink)', margin: 0 }}>Smart Money loading…</p>
        <p style={{ fontSize: 12, color: 'var(--color-pebble)', margin: 0, maxWidth: 250, lineHeight: 1.6, fontWeight: 600 }}>
          The registry grows automatically as GMGN discovery finds new whales.
        </p>
      </div>
    );
  }

  const savedCount = whales.filter((w) => favSet.has(w.address.toLowerCase())).length;
  const allSaved = savedCount === whales.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '0 16px 10px', flexShrink: 0 }}>
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search size={14} color="var(--color-pebble)" style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address, token or KOL…"
            style={{ width: '100%', padding: '9px 11px 9px 32px', borderRadius: 12, border: '1px solid var(--color-silver-lining)', background: 'var(--color-paper-white)', color: 'var(--color-midnight-ink)', fontSize: 12, fontWeight: 600, outline: 'none', boxShadow: 'none', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {SORTS.map((s) => {
            const active = sort === s.id;
            return (
              <button key={s.id} type="button" onClick={() => setSort(s.id)}
                style={{ flexShrink: 0, borderRadius: 100, padding: '6px 12px', fontSize: 11, fontWeight: 600, cursor: 'pointer', background: active ? 'var(--accent)' : 'var(--color-paper-white)', border: active ? '1px solid var(--accent)' : '1px solid var(--color-silver-lining)', color: active ? '#fff' : 'var(--color-pebble)', boxShadow: 'none' }}>
                {s.label}
              </button>
            );
          })}
          <button onClick={() => onSaveAll?.(!allSaved)} style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: allSaved ? 'var(--color-aurora-magenta)' : 'var(--color-tidewater-navy)', background: 'var(--color-frost-shadow)', border: 'none', borderRadius: 9, padding: '6px 12px', cursor: 'pointer', flexShrink: 0 }}>
            {allSaved ? 'Remove all' : 'Save all'}
          </button>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', letterSpacing: '0.04em', marginTop: 6 }}>
          {whales.length} whales · {savedCount} saved
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 8px', scrollbarWidth: 'none' }}>
        {filtered.map(({ w, perf }, i) => {
          const saved = favSet.has(w.address.toLowerCase());
          const rank = ranked.findIndex((r) => r.w === w) + 1;
          const win = perf.winRate != null ? Math.round(perf.winRate * 100) : null;
          return (
            <div key={w.address} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 6, background: 'var(--color-paper-white)', border: '1px solid var(--color-silver-lining)', borderRadius: 0, boxShadow: 'none' }}>
              <div style={{ width: 28, height: 28, borderRadius: 0, flexShrink: 0, display: 'grid', placeItems: 'center', background: rank <= 3 ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: rank <= 3 ? '#fff' : 'var(--color-pebble)', fontSize: 11, fontWeight: 700 }}>{rank}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <a href={EXPLORER_ADDR_URL(w.address)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: 'monospace', textDecoration: 'none' }}>
                    {w.address.slice(0, 8)}…{w.address.slice(-4)}
                  </a>
                  <a href={EXPLORER_ADDR_URL(w.address)} target="_blank" rel="noreferrer" style={{ color: 'var(--color-pebble)', display: 'flex' }}><ExternalLink size={11} /></a>
                  {perf.twitter && (
                    <a href={`https://x.com/${perf.twitter}`} target="_blank" rel="noreferrer" style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--color-deep-iris)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>@{perf.twitter}</a>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  {w.isMarketMaker ? (
                    <>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>${fmtMon(w.lpAddedUsd)} LP</span>
                      <span style={{ fontSize: 8, fontWeight: 800, color: 'var(--accent-2)', border: '1px solid var(--line-1)', borderRadius: 6, padding: '1px 5px', letterSpacing: '0.04em' }}>MARKET MAKER</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>${fmtMon(w.volumeUsd || 0)} vol</span>
                      {perf.trades != null && <span style={{ fontSize: 9.5, color: 'var(--color-pebble)', fontWeight: 600 }}>{perf.trades} tx</span>}
                      {perf.tokens != null && <span style={{ fontSize: 9.5, color: 'var(--color-pebble)', fontWeight: 600 }}>{perf.tokens} tokens</span>}
                    </>
                  )}
                  {(w.tags || []).filter((t) => ['smart_degen', 'kol', 'renowned'].includes(t)).slice(0, 2).map((t) => (
                    <span key={t} style={{ fontSize: 8, fontWeight: 800, color: 'var(--color-deep-iris)', background: 'var(--color-frost-shadow)', borderRadius: 6, padding: '1px 5px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t === 'smart_degen' ? 'Smart' : t === 'renowned' ? 'Renowned' : 'KOL'}</span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 68 }}>
                {perf.pnlUsd != null ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: perf.pnlUsd >= 0 ? 'var(--up)' : 'var(--down)' }}>{fmtUsdSigned(perf.pnlUsd)}</div>
                    <div style={{ fontSize: 8.5, color: 'var(--color-pebble)', fontWeight: 700 }}>
                      {win != null ? <span style={{ color: win >= 50 ? 'var(--up)' : 'var(--color-pebble)' }}>{win}% win · </span> : null}
                      {perf.source === 'gmgn7d' ? '7d' : 'realized'}
                    </div>
                  </>
                ) : win != null ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, color: win >= 50 ? 'var(--up)' : 'var(--color-pebble)' }}>{win}%</div>
                    <div style={{ fontSize: 8.5, color: 'var(--color-pebble)', fontWeight: 700 }}>win rate</div>
                  </>
                ) : (
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-pebble)' }}>No stats yet</div>
                )}
              </div>
              <button onClick={() => onToggleFavorite?.({ address: w.address, tokenSymbol: w.lastToken })} title={saved ? 'Remove from watchlist' : 'Save to watchlist'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'flex', flexShrink: 0 }}>
                <Heart size={17} color={saved ? 'var(--down)' : 'var(--color-pebble)'} fill={saved ? 'var(--down)' : 'none'} />
              </button>
            </div>
          );
        })}
        <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 8, marginBottom: 4 }}>
          {ACTIVE.kind === 'svm' ? 'Win rate & PnL from GMGN 7-day portfolio stats · refreshed automatically' : 'Win rate & PnL from the on-chain scan · bots & MM/arb wallets removed'}
        </p>
      </div>
    </div>
  );
}
