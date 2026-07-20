import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

/* ═══════════════════════════════════════════════════════════════════
   STORY CARD — Compact story showing whale copy result or user activity

   Displays token visual, P&L result (profit/loss), whale name, timestamp.
   Styled as Yinger: bone-white text on midnight canvas, minimal borders,
   4px spacing, telemetry-style labels.
   ═══════════════════════════════════════════════════════════════════ */

export default function StoryCard({
  type = 'copy', // 'copy' | 'share' | 'whale'
  whaleAlias,
  tokenSymbol,
  tokenImage,
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
      flexDirection: size === 'sm' ? 'column' : 'row',
      gap: '4px',
      padding: '12px',
      background: 'var(--color-midnight-carbon)',
      border: '1px solid var(--color-charcoal-vein)',
      borderRadius: '0px',
      minWidth: size === 'sm' ? '140px' : 'auto',
      flex: size === 'sm' ? '0 0 140px' : '1',
    }}>
      {/* Token Image */}
      <div style={{
        width: size === 'sm' ? '100%' : '48px',
        height: size === 'sm' ? '100px' : '48px',
        borderRadius: '0px',
        background: 'var(--color-charcoal-vein)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        border: '1px solid var(--color-charcoal-vein)',
        overflow: 'hidden',
      }}>
        {tokenImage ? (
          <img
            src={tokenImage}
            alt={tokenSymbol}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <span style={{
            fontSize: '32px',
            fontWeight: 700,
            color: 'var(--color-bone-glow)',
            fontFamily: 'var(--font-arbeit-contrast)',
          }}>
            {(tokenSymbol || '?').slice(0, 1)}
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {/* Token Symbol */}
        <div style={{
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-bone-glow)',
          fontFamily: 'var(--font-arbeit-technik)',
          textTransform: 'uppercase',
          letterSpacing: '-0.6px',
          lineHeight: '15px',
        }}>
          ${tokenSymbol}
        </div>

        {/* Whale or User Name */}
        {whaleAlias && (
          <div style={{
            fontSize: '11px',
            color: 'var(--color-charcoal-vein)',
            fontFamily: 'var(--font-arbeit-contrast)',
            lineHeight: '15px',
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
            marginTop: '2px',
          }}>
            {isProfitable ? (
              <TrendingUp size={12} color="var(--color-bone-glow)" strokeWidth={2} />
            ) : (
              <TrendingDown size={12} color="var(--color-bone-glow)" strokeWidth={2} />
            )}
            <span style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--color-bone-glow)',
              fontFamily: 'var(--font-arbeit-technik)',
              letterSpacing: '-0.6px',
            }}>
              {isProfitable ? '+' : ''}{pnl.toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent?.toFixed(1)}%)
            </span>
          </div>
        )}

        {/* Timestamp */}
        {timestamp && (
          <div style={{
            fontSize: '10px',
            color: 'var(--color-charcoal-vein)',
            fontFamily: 'var(--font-arbeit-technik)',
            letterSpacing: '-0.6px',
            marginTop: '4px',
          }}>
            {typeof timestamp === 'string' ? timestamp : `${timestamp}m ago`}
          </div>
        )}
      </div>
    </div>
  );
}
