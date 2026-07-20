import React, { useState, useEffect } from 'react';

/* ═══════════════════════════════════════════════════════════════════
   TOKEN IMAGE — Fetches & displays token image from DexScreener API

   For Monad: uses DexScreener data
   For Solana: uses DexScreener + Jupiter data
   Falls back to initials if image unavailable.
   ═══════════════════════════════════════════════════════════════════ */

export default function TokenImage({
  tokenAddress,
  tokenSymbol,
  chain = 'monad', // 'monad' | 'solana'
  size = 48,
  onImageLoaded,
}) {
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!tokenAddress) {
      setFailed(true);
      setLoading(false);
      return;
    }

    // For now: use a placeholder approach
    // Later: integrate DexScreener API
    // GET https://api.dexscreener.com/latest/dex/tokens/{tokenAddress}
    // GET https://api.dexscreener.com/latest/dex/search?q={tokenAddress}

    const fetchImage = async () => {
      try {
        // DexScreener API endpoint
        const url = `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: { 'User-Agent': 'DegenSlide/1.0' }
        });

        if (!response.ok) throw new Error('Token not found');

        const data = await response.json();

        // DexScreener returns pairs array
        if (data.pairs && data.pairs.length > 0) {
          const pair = data.pairs[0];
          const imgUrl = pair.baseToken?.image || pair.quoteToken?.image;

          if (imgUrl) {
            setImageUrl(imgUrl);
            onImageLoaded?.(imgUrl);
          } else {
            setFailed(true);
          }
        } else {
          setFailed(true);
        }
      } catch (err) {
        console.log(`Token image fetch failed for ${tokenAddress}:`, err.message);
        setFailed(true);
      } finally {
        setLoading(false);
      }
    };

    fetchImage();
  }, [tokenAddress, chain, onImageLoaded]);

  // Show image if loaded
  if (imageUrl && !failed) {
    return (
      <img
        src={imageUrl}
        alt={tokenSymbol}
        style={{
          width: size,
          height: size,
          borderRadius: '0px',
          objectFit: 'cover',
          border: '1px solid var(--color-charcoal-vein)',
        }}
        onError={() => setFailed(true)}
      />
    );
  }

  // Fallback: initials stamped bone-on-midnight (two-color system, no gradients)
  const initials = (tokenSymbol || '?').slice(0, 1).toUpperCase();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '0px',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--color-midnight-carbon)',
        border: '1px solid var(--color-charcoal-vein)',
        color: 'var(--color-bone-glow)',
        fontSize: `${size * 0.4}px`,
        fontWeight: 400,
        fontFamily: 'var(--font-arbeit-technik)',
        flexShrink: 0,
      }}
      title={tokenSymbol}
    >
      {initials}
    </div>
  );
}
