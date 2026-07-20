import React, { useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════
   USER AVATAR — Best NFT or custom avatar display

   Fetches & displays user's most valuable NFT from wallet.
   Falls back to deterministic generated avatar if no NFT.
   Later: API integration with Solana/Monad RPC for NFT queries.
   ═══════════════════════════════════════════════════════════════════ */

export default function UserAvatar({
  walletAddress,
  nftImage,
  onChangeAvatar,
  size = 40,
}) {
  const [failed, setFailed] = useState(false);

  if (nftImage && !failed) {
    return (
      <div
        onClick={onChangeAvatar}
        style={{
          width: size,
          height: size,
          borderRadius: '0px',
          overflow: 'hidden',
          border: '1px solid var(--color-charcoal-vein)',
          cursor: onChangeAvatar ? 'pointer' : 'default',
          display: 'grid',
          placeItems: 'center',
          background: 'var(--color-charcoal-vein)',
        }}
      >
        <img
          src={nftImage}
          alt="NFT Avatar"
          onError={() => setFailed(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      </div>
    );
  }

  // Fallback: Deterministic avatar from wallet
  const hue = walletAddress
    ? walletAddress.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360
    : 0;
  const initials = (walletAddress || 'USER').slice(0, 2).toUpperCase();

  return (
    <div
      onClick={onChangeAvatar}
      style={{
        width: size,
        height: size,
        borderRadius: '0px',
        display: 'grid',
        placeItems: 'center',
        background: `linear-gradient(160deg, hsl(${hue} 60% 40%), hsl(${(hue + 40) % 360} 55% 25%))`,
        border: '1px solid var(--color-charcoal-vein)',
        cursor: onChangeAvatar ? 'pointer' : 'default',
        color: 'var(--color-bone-glow)',
        fontSize: `${size * 0.4}px`,
        fontWeight: 800,
        fontFamily: 'var(--font-arbeit-contrast)',
      }}
      title={onChangeAvatar ? 'Click to change avatar' : 'Avatar'}
    >
      {initials}
    </div>
  );
}
