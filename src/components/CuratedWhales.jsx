import { useMemo, useState } from 'react';
import { Heart, ExternalLink, Search, Waves } from 'lucide-react';
import { EXPLORER_ADDR_URL } from '../config/chain.js';

function fmtMon(v) {
  if (v == null) return '—';
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

/**
 * Built-in roster of real Monad whales discovered by an on-chain swap scan
 * (src/data/curatedWhales.json). Lightweight: shows the scanned stats, no live
 * polling. Heart a whale to add it to your personal watchlist; when any of them
 * trade whale-sized, they surface in the deck like every other whale.
 */
export default function CuratedWhales({ whales = [], favorites = [], onToggleFavorite, onSaveAll }) {
  const [q, setQ] = useState('');
  const favSet = useMemo(() => new Set(favorites.map((f) => (f.address || '').toLowerCase())), [favorites]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return whales;
    return whales.filter((w) => w.address.toLowerCase().includes(s) || (w.tokens || []).some((t) => (t || '').toLowerCase().includes(s)) || (w.lastToken || '').toLowerCase().includes(s));
  }, [whales, q]);

  if (!whales.length) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 40, textAlign: 'center' }}>
        <Waves size={40} strokeWidth={1.5} color="var(--color-pebble)" />
        <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-midnight-ink)', margin: 0 }}>Curated whales loading…</p>
        <p style={{ fontSize: 12, color: 'var(--color-pebble)', margin: 0, maxWidth: 250, lineHeight: 1.6, fontWeight: 600 }}>
          Run <code style={{ fontFamily: 'monospace' }}>node backend/scanWhales.js</code> to populate the on-chain whale roster.
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
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address or token…"
            style={{ width: '100%', padding: '9px 11px 9px 32px', borderRadius: 12, border: '1px solid var(--color-silver-lining)', background: 'var(--color-paper-white)', color: 'var(--color-midnight-ink)', fontSize: 12, fontWeight: 600, outline: 'none', boxShadow: 'var(--shadow-md)', boxSizing: 'border-box' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', letterSpacing: '0.04em' }}>
            {whales.length} whales · {savedCount} saved
          </span>
          <button onClick={() => onSaveAll?.(!allSaved)} style={{ fontSize: 11, fontWeight: 700, color: allSaved ? 'var(--color-aurora-magenta)' : 'var(--color-tidewater-navy)', background: 'var(--color-frost-shadow)', border: 'none', borderRadius: 9, padding: '6px 12px', cursor: 'pointer' }}>
            {allSaved ? 'Remove all' : 'Save all to watchlist'}
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px 8px', scrollbarWidth: 'none' }}>
        {filtered.map((w, i) => {
          const saved = favSet.has(w.address.toLowerCase());
          const rank = whales.indexOf(w) + 1;
          return (
            <div key={w.address} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 6, background: 'var(--color-paper-white)', border: '1px solid var(--color-silver-lining)', borderRadius: 14, boxShadow: 'var(--shadow-md)' }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center', background: rank <= 3 ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: rank <= 3 ? '#fff' : 'var(--color-pebble)', fontSize: 11, fontWeight: 700 }}>{rank}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <a href={EXPLORER_ADDR_URL(w.address)} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: 'monospace', textDecoration: 'none' }}>
                    {w.address.slice(0, 8)}…{w.address.slice(-4)}
                  </a>
                  <a href={EXPLORER_ADDR_URL(w.address)} target="_blank" rel="noreferrer" style={{ color: 'var(--color-pebble)', display: 'flex' }}><ExternalLink size={11} /></a>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, flexWrap: 'wrap' }}>
                  {w.isMarketMaker ? (
                    <>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>${fmtMon(w.lpAddedUsd)} LP</span>
                      <span style={{ fontSize: 8, fontWeight: 800, color: '#2563eb', border: '1px solid #2563eb', borderRadius: 6, padding: '1px 5px', letterSpacing: '0.04em' }}>MARKET MAKER</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>${fmtMon(w.volumeUsd != null ? w.volumeUsd : (w.volumeMon || 0) * 0.02)}</span>
                      <span style={{ fontSize: 9.5, color: 'var(--color-pebble)', fontWeight: 600 }}>{w.trades} tx</span>
                      {(() => {
                        const bias = w.buys > w.sells * 1.5 ? { t: 'Accumulating', c: '#10B981' } : w.sells > w.buys * 1.5 ? { t: 'Distributing', c: '#EF4444' } : null;
                        return bias ? <span style={{ fontSize: 8, fontWeight: 800, color: bias.c, border: `1px solid ${bias.c}`, borderRadius: 6, padding: '1px 5px', letterSpacing: '0.04em' }}>{bias.t}</span> : null;
                      })()}
                    </>
                  )}
                  {(w.tokens || []).slice(0, 2).map((t) => (
                    <span key={t} style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--color-aurora-magenta)', background: 'var(--color-frost-shadow)', borderRadius: 6, padding: '1px 5px' }}>${t}</span>
                  ))}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, minWidth: 62 }}>
                {w.closedTokens > 0 ? (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 800, color: w.realizedMon >= 0 ? '#10B981' : '#EF4444' }}>{w.realizedMon >= 0 ? '+' : ''}{fmtMon(w.realizedMon)}</div>
                    <div style={{ fontSize: 8.5, color: 'var(--color-pebble)', fontWeight: 700 }}>realized{w.winRate != null ? ` · ${Math.round(w.winRate * 100)}%` : ''}</div>
                  </>
                ) : (
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-pebble)' }}>No exits</div>
                )}
              </div>
              <button onClick={() => onToggleFavorite?.({ address: w.address, tokenSymbol: w.lastToken })} title={saved ? 'Remove from watchlist' : 'Save to watchlist'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 5, display: 'flex', flexShrink: 0 }}>
                <Heart size={17} color={saved ? '#EF4444' : 'var(--color-pebble)'} fill={saved ? '#EF4444' : 'none'} />
              </button>
            </div>
          );
        })}
        <p style={{ textAlign: 'center', fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 8, marginBottom: 4 }}>
          Verified EOA traders · bots &amp; MM/arb wallets removed on-chain
        </p>
      </div>
    </div>
  );
}
