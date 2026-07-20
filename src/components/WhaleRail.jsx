import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { generateAlias } from './SwipeCard';

/* ═══════════════════════════════════════════════════════════════════
   WHALE RAIL — the horizontal strip of circular whale portraits that
   sits directly under the app bar, above the deck.

   It answers "whose signals am I actually following?" at a glance and
   gives every tracked whale a one-tap route into its dossier. When the
   user hasn't saved anyone yet it falls back to the curated Smart Money
   roster, so the rail is never an empty shelf.
   ═══════════════════════════════════════════════════════════════════ */

/* Circular portrait. effigy.im only renders EVM addresses, so Solana
   wallets (and any fetch failure) fall back to a deterministic initials
   disc tinted from the address itself — never a blank hole in the rail. */
function RailAvatar({ addr, size = 54, ring }) {
  const [failed, setFailed] = useState(false);
  const src = addr ? `https://effigy.im/a/${addr}.png` : null;

  // deterministic hue so a given wallet always gets the same colour
  const hue = addr ? addr.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360 : 0;
  const initials = (addr || '?').replace(/^0x/, '').slice(0, 2).toUpperCase();

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      padding: 2,
      background: ring || 'linear-gradient(160deg, rgba(255,190,175,0.28), rgba(255,190,175,0.06))',
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
        background: `linear-gradient(160deg, hsl(${hue} 62% 40%), hsl(${(hue + 40) % 360} 58% 24%))`,
        display: 'grid', placeItems: 'center',
        border: '2px solid var(--bg-app)',
      }}>
        {src && !failed ? (
          <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <span style={{
            fontSize: size * 0.3, fontWeight: 800, color: 'rgba(255,255,255,0.92)',
            fontFamily: '"JetBrains Mono", monospace', letterSpacing: '-0.02em',
          }}>{initials}</span>
        )}
      </div>
    </div>
  );
}

export default function WhaleRail({ watched = [], curated = [], onOpenDossier, onAdd }) {
  // Prefer the user's own roster; fall back to curated Smart Money so a new
  // user still sees who they *could* be following.
  const usingWatched = watched.length > 0;
  const addrs = usingWatched
    ? watched.slice(0, 12)
    : curated.slice(0, 12).map((w) => w.address).filter(Boolean);

  return (
    <div className="whale-rail hide-scrollbar" data-tour="whale-rail">
      <button type="button" className="rail-item rail-add" onClick={onAdd}
        title="Add a wallet to your watchlist">
        <span className="rail-add-disc"><Plus size={20} strokeWidth={2.5} /></span>
        <span className="rail-name">Add</span>
      </button>

      {addrs.map((addr) => (
        <button key={addr} type="button" className="rail-item"
          onClick={() => onOpenDossier?.(addr)}
          title={`${generateAlias(addr)} — open dossier`}>
          <RailAvatar
            addr={addr}
            ring={usingWatched
              ? 'linear-gradient(160deg, #ff7a2f, #f0511e 55%, #c9231f)'
              : undefined}
          />
          <span className="rail-name">{generateAlias(addr).split(' ')[0]}</span>
        </button>
      ))}
    </div>
  );
}
