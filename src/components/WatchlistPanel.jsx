import { useState } from 'react';
import { X, Waves, ExternalLink, ChevronRight } from 'lucide-react';
import { EXPLORER_ADDR_URL, ACTIVE } from '../config/chain.js';
import { BlockieAvatar, generateAlias } from './SwipeCard';

/**
 * Watchlist — a clean roster of the wallets you follow. Tapping a row opens
 * the Whale Dossier (live balance, PnL, win rate, recent trades) instead of
 * dumping raw explorer transactions here.
 */

function WalletRow({ wallet, onRemove, onOpenDossier, isAuto, onToggleAuto, autoEnabled }) {
  return (
    <div
      onClick={() => onOpenDossier?.(wallet)}
      style={{
        background: 'var(--color-paper-white)',
        border: `1px solid ${isAuto ? 'rgba(240, 81, 30,0.4)' : 'var(--color-silver-lining)'}`,
        boxShadow: 'none',
        borderRadius: 0,
        marginBottom: 10,
        padding: '12px 14px',
        display: 'flex', alignItems: 'center', gap: 11,
        cursor: onOpenDossier ? 'pointer' : 'default',
      }}
    >
      <BlockieAvatar addr={wallet} size={38} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-midnight-ink)' }}>{generateAlias(wallet)}</div>
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-pebble)', fontFamily: 'monospace', marginTop: 2 }}>
          {wallet.slice(0, 6)}…{wallet.slice(-4)}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexShrink: 0 }}>
        {onToggleAuto && (
          <button
            onClick={e => { e.stopPropagation(); onToggleAuto(wallet); }}
            title={isAuto ? 'Auto-copy ON — every BUY from this whale is copied automatically' : 'Turn on auto-copy for this whale'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
              padding: '4px 9px', borderRadius: 100, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
              border: `1px solid ${isAuto ? 'rgba(240, 81, 30,0.6)' : 'var(--color-silver-lining)'}`,
              background: isAuto ? 'var(--accent)' : 'transparent',
              color: isAuto ? '#fff' : 'var(--color-pebble)',
              boxShadow: 'none',
              opacity: isAuto && !autoEnabled ? 0.55 : 1,
            }}
          >
            🤖 AUTO
          </button>
        )}
        <a
          href={EXPLORER_ADDR_URL(wallet)}
          target="_blank"
          rel="noreferrer"
          onClick={e => e.stopPropagation()}
          title="Open in explorer"
          style={{ color: 'var(--color-pebble)', padding: 6, textDecoration: 'none', display: 'flex' }}
        >
          <ExternalLink size={14} />
        </a>
        <button
          onClick={e => { e.stopPropagation(); onRemove(wallet); }}
          title="Remove"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', color: 'var(--color-aurora-magenta)' }}
        >
          <X size={14} />
        </button>
        <ChevronRight size={15} color="var(--color-pebble)" style={{ marginLeft: -2 }} />
      </div>
    </div>
  );
}

export default function WatchlistPanel({ wallets, onAdd, onRemove, autoWhales = [], onToggleAuto, autoEnabled, onOpenDossier }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const isAuto = (addr) => autoWhales.includes(ACTIVE.kind === 'evm' ? (addr || '').toLowerCase() : addr);

  const handleAdd = () => {
    // EVM chains use 0x…40-hex; Solana uses base58 (32–44 chars)
    const isEvm = ACTIVE.kind === 'evm';
    const addr = isEvm ? input.trim().toLowerCase() : input.trim();
    const valid = isEvm ? /^0x[0-9a-f]{40}$/i.test(addr) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    if (!valid) {
      setError(isEvm ? 'Invalid address — enter a 42-character 0x address.' : 'Invalid address — enter a Solana base58 address.');
      return;
    }
    if (wallets.includes(addr)) {
      setError('This address is already on your list.');
      return;
    }
    setError('');
    onAdd(addr);
    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Input */}
      <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => { setInput(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder={ACTIVE.kind === 'evm' ? '0x… add whale address' : 'Add whale address'}
            style={{
              flex: 1, padding: '10px 13px', borderRadius: 12, minWidth: 0,
              border: `1px solid ${error ? 'var(--color-aurora-magenta)' : 'var(--color-silver-lining)'}`,
              background: 'var(--color-paper-white)',
              color: 'var(--color-midnight-ink)', fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
              outline: 'none',
              boxShadow: 'none',
            }}
          />
          <button
            onClick={handleAdd}
            style={{
              padding: '10px 14px', borderRadius: 12, border: 'none', flexShrink: 0,
              background: 'var(--color-tidewater-navy)',
              color: 'var(--color-paper-white)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              boxShadow: 'none',
            }}
          >
            Add
          </button>
        </div>
        {error && (
          <p style={{ fontSize: 10, color: 'var(--color-aurora-magenta)', margin: '6px 0 0', lineHeight: 1.4, fontWeight: 600 }}>
            {error}
          </p>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', scrollbarWidth: 'none' }}>
        {wallets.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 36, textAlign: 'center' }}>
            <Waves size={40} strokeWidth={1.5} color="var(--color-pebble)" />
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-midnight-ink)', margin: 0, fontFamily: '"averta standard", sans-serif' }}>Track whales</p>
            <p style={{ fontSize: 12, color: 'var(--color-pebble)', margin: 0, maxWidth: 230, lineHeight: 1.6, fontWeight: 600 }}>
              Save whales from the deck or paste an address above. Tap any wallet to see its live dossier — balance, PnL, win rate and recent trades.
            </p>
          </div>
        ) : (
          <>
            {onToggleAuto && autoWhales.length > 0 && !autoEnabled && (
              <div style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 0, border: '1px solid rgba(255, 176, 46,0.4)', background: 'rgba(255, 176, 46,0.08)', fontSize: 10.5, fontWeight: 700, color: '#ffb02e', lineHeight: 1.5 }}>
                🤖 {autoWhales.length} whale{autoWhales.length === 1 ? '' : 's'} marked AUTO, but Auto-Copy is off — enable it in Profile to start hands-free copying.
              </div>
            )}
            {wallets.map(addr => (
              <WalletRow key={addr} wallet={addr} onRemove={onRemove} onOpenDossier={onOpenDossier}
                isAuto={isAuto(addr)} onToggleAuto={onToggleAuto} autoEnabled={autoEnabled} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
