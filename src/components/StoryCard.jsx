import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import TokenImage from './TokenImage';

/* ═══════════════════════════════════════════════════════════════════
   STORY CARD — Compact story showing whale copy result or user activity

   Displays token visual, P&L result (profit/loss), whale name, timestamp.
   Styled as Yinger: bone-white text on midnight canvas, minimal borders,
   4px spacing, telemetry-style labels. 'sm' is a dense horizontal chip
   (32px token image) so the feed never eats into the deck below it.
   ═══════════════════════════════════════════════════════════════════ */

export default function StoryCard({
  type = 'copy', // 'copy' | 'share' | 'whale'
  whaleAlias,
  tokenSymbol,
  tokenAddress,
  tokenImage,
  chain = 'monad',
  pnl,
  pnlPercent,
  timestamp,
  size = 'sm', // 'sm' for horizontal scroll, 'md' for grid
}) {
  const isProfitable = pnl >= 0;
  const isShare = type === 'share';

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 10px',
      background: 'var(--color-midnight-carbon)',
      border: '1px solid var(--color-charcoal-vein)',
      borderRadius: '0px',
      minWidth: size === 'sm' ? '156px' : 'auto',
      flex: size === 'sm' ? '0 0 auto' : '1',
    }}>
      {/* Token Image */}
      <div style={{
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        <TokenImage
          tokenAddress={tokenAddress}
          tokenSymbol={tokenSymbol}
          chain={chain}
          size={size === 'sm' ? 32 : 48}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {/* Token Symbol + Timestamp */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px' }}>
          <span style={{
            fontSize: '12px',
            fontWeight: 400,
            color: 'var(--color-bone-glow)',
            fontFamily: 'var(--font-arbeit-technik)',
            textTransform: 'uppercase',
            letterSpacing: '-0.6px',
            lineHeight: '15px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            ${tokenSymbol}
          </span>
          {timestamp && (
            <span style={{
              fontSize: '10px',
              color: 'var(--color-bone-dim)',
              fontFamily: 'var(--font-arbeit-technik)',
              letterSpacing: '-0.6px',
              marginLeft: 'auto',
              flexShrink: 0,
            }}>
              {typeof timestamp === 'string' ? timestamp : `${timestamp}m`}
            </span>
          )}
        </div>

        {/* Whale or User Name */}
        {whaleAlias && (
          <div style={{
            fontSize: '10px',
            color: 'var(--color-bone-dim)',
            fontFamily: 'var(--font-arbeit-contrast)',
            lineHeight: '13px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {isShare ? 'Your share' : whaleAlias}
          </div>
        )}

        {/* P&L Badge */}
        {typeof pnl === 'number' && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}>
            {isProfitable ? (
              <TrendingUp size={10} color="var(--color-bone-glow)" strokeWidth={2} />
            ) : (
              <TrendingDown size={10} color="var(--color-bone-dim)" strokeWidth={2} />
            )}
            <span style={{
              fontSize: '10px',
              fontWeight: 400,
              color: isProfitable ? 'var(--color-bone-glow)' : 'var(--color-bone-dim)',
              fontFamily: 'var(--font-arbeit-technik)',
              letterSpacing: '-0.6px',
              whiteSpace: 'nowrap',
            }}>
              {isProfitable ? '+' : ''}{pnl.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent?.toFixed(1)}%)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
