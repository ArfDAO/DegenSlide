import React from 'react';
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

/* Monochrome initials disc — one material with the rest of the terminal.
   A watched whale gets an ember ring; curated ones a charcoal ring. No
   external identicons, no per-wallet hues — distinction comes from the
   initials alone. */
function RailAvatar({ addr, size = 54, ring }) {
  const initials = (addr || '?').replace(/^0x/, '').slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: size, height: size, borderRadius: 0, flexShrink: 0,
      padding: 2,
      background: ring || 'var(--line-1)',
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: 0, overflow: 'hidden',
        background: 'var(--surface-2)',
        display: 'grid', placeItems: 'center',
        border: '2px solid var(--bg-app)',
      }}>
        <span style={{
          fontSize: size * 0.3, fontWeight: 700, color: 'var(--text-1)',
          fontFamily: '"JetBrains Mono", monospace', letterSpacing: '-0.02em',
        }}>{initials}</span>
      </div>
    </div>
  );
}

export default function WhaleRail({ watched = [], curated = [], onOpenDossier, onAdd, compact = false }) {
  // Prefer the user's own roster; fall back to curated Smart Money so a new
  // user still sees who they *could* be following.
  const usingWatched = watched.length > 0;
  const addrs = usingWatched
    ? watched.slice(0, 12)
    : curated.slice(0, 12).map((w) => w.address).filter(Boolean);
  const size = compact ? 38 : 54;

  return (
    <div className={`whale-rail ${compact ? 'compact' : ''} hide-scrollbar`} data-tour="whale-rail">
      <button type="button" className="rail-item rail-add" onClick={onAdd}
        title="Add a wallet to your watchlist">
        <span className="rail-add-disc"><Plus size={compact ? 15 : 20} strokeWidth={2.5} /></span>
        {!compact && <span className="rail-name">Add</span>}
      </button>

      {addrs.map((addr) => (
        <button key={addr} type="button" className="rail-item"
          onClick={() => onOpenDossier?.(addr)}
          title={`${generateAlias(addr)} — open dossier`}>
          <RailAvatar
            addr={addr}
            size={size}
            ring={usingWatched ? 'var(--accent)' : undefined}
          />
          {!compact && <span className="rail-name">{generateAlias(addr).split(' ')[0]}</span>}
        </button>
      ))}
    </div>
  );
}
