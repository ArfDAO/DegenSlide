import React, { useRef, useEffect, useState } from 'react';
import { LogOut, Settings, Wallet } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════
   PROFILE DROPDOWN — Top-right wallet + settings management

   Avatar/NFT circle that opens dropdown menu:
   - Wallet address (copy to clipboard)
   - Disconnect
   - Settings
   - Profile Edit

   Yinger style: minimal, flat, bone-white on midnight, no elevation.
   ═══════════════════════════════════════════════════════════════════ */

export default function ProfileDropdown({
  walletAddress,
  nftImage,
  onDisconnect,
  onSettings,
  onProfileEdit,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [open]);

  const shortAddr = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : 'No Wallet';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Avatar/Toggle Button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'grid',
          placeItems: 'center',
          width: '40px',
          height: '40px',
          borderRadius: '0px',
          background: 'var(--color-charcoal-vein)',
          border: '1px solid var(--color-charcoal-vein)',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          padding: 0,
        }}
        onMouseEnter={(e) => (e.target.style.background = 'var(--color-bone-glow)')}
        onMouseLeave={(e) => (e.target.style.background = 'var(--color-charcoal-vein)')}
        title={walletAddress || 'Connect Wallet'}
      >
        {nftImage ? (
          <img
            src={nftImage}
            alt="Profile"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '0px',
            }}
          />
        ) : (
          <span style={{
            fontSize: '16px',
            fontWeight: 700,
            color: 'var(--color-bone-glow)',
            fontFamily: 'var(--font-arbeit-contrast)',
          }}>
            ⊙
          </span>
        )}
      </button>

      {/* Dropdown Menu */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          background: 'var(--color-midnight-carbon)',
          border: '1px solid var(--color-charcoal-vein)',
          borderRadius: '0px',
          zIndex: 50,
          minWidth: '220px',
          boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
        }}>
          {/* Wallet Address */}
          {walletAddress && (
            <div style={{
              padding: '12px',
              borderBottom: '1px solid var(--color-charcoal-vein)',
              cursor: 'pointer',
              transition: 'background 0.2s',
            }}
            onClick={() => {
              navigator.clipboard.writeText(walletAddress);
              setOpen(false);
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-charcoal-vein)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{
                fontSize: '11px',
                color: 'var(--color-charcoal-vein)',
                fontFamily: 'var(--font-arbeit-technik)',
                letterSpacing: '-0.6px',
                textTransform: 'uppercase',
                marginBottom: '4px',
              }}>
                Wallet
              </div>
              <div style={{
                fontSize: '12px',
                color: 'var(--color-bone-glow)',
                fontFamily: 'var(--font-arbeit-technik)',
                letterSpacing: '-0.6px',
              }}>
                {shortAddr}
              </div>
            </div>
          )}

          {/* Profile Edit */}
          <MenuItem
            icon={<span style={{ fontSize: '14px' }}>👤</span>}
            label="Edit Profile"
            onClick={() => { onProfileEdit?.(); setOpen(false); }}
          />

          {/* Settings */}
          <MenuItem
            icon={<Settings size={16} />}
            label="Settings"
            onClick={() => { onSettings?.(); setOpen(false); }}
          />

          {/* Disconnect */}
          <MenuItem
            icon={<LogOut size={16} />}
            label="Disconnect"
            onClick={() => { onDisconnect?.(); setOpen(false); }}
            danger
          />
        </div>
      )}
    </div>
  );
}

/* Menu item with icon + label */
function MenuItem({ icon, label, onClick, danger = false }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '12px',
        border: 'none',
        borderBottom: '1px solid var(--color-charcoal-vein)',
        background: 'transparent',
        color: danger ? 'var(--color-rose-quartz-bloom)' : 'var(--color-bone-glow)',
        fontSize: '12px',
        fontFamily: 'var(--font-arbeit-contrast)',
        cursor: 'pointer',
        transition: 'background 0.2s',
        textAlign: 'left',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-charcoal-vein)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon}
      {label}
    </button>
  );
}
