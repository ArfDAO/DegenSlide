import React, { useState } from 'react';
import StoryCard from './StoryCard';

/* ═══════════════════════════════════════════════════════════════════
   STORY FEED — Horizontal scrolling feed of whale shares + user activity

   Shows: Recent whale copies, user's own trades, whale transactions.
   Yinger aesthetic: full-bleed edge-to-edge scroll, compact 4px gaps,
   telemetry labels, bone-white text on midnight.
   ═══════════════════════════════════════════════════════════════════ */

export default function StoryFeed({ whaleStories = [], userStories = [] }) {
  const stories = [...whaleStories, ...userStories].slice(0, 20);

  if (stories.length === 0) {
    return (
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--color-charcoal-vein)',
        textAlign: 'center',
        flexShrink: 0,
      }}>
        <div style={{
          fontSize: '12px',
          color: 'var(--color-bone-dim)',
          fontFamily: 'var(--font-arbeit-technik)',
          letterSpacing: '-0.6px',
          textTransform: 'uppercase',
        }}>
          No stories yet
        </div>
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      borderBottom: '1px solid var(--color-charcoal-vein)',
      flexShrink: 0,
    }}>
      {/* Label */}
      <div style={{
        padding: '8px 12px 0',
        fontSize: '11px',
        fontFamily: 'var(--font-arbeit-technik)',
        color: 'var(--color-bone-dim)',
        letterSpacing: '-0.6px',
        textTransform: 'uppercase',
        fontWeight: 400,
        lineHeight: '15px',
      }}>
        Recent Activity
      </div>

      {/* Horizontal scroll container */}
      <div className="hide-scrollbar" style={{
        display: 'flex',
        overflowX: 'auto',
        gap: '8px',
        padding: '8px 12px 10px',
        scrollBehavior: 'smooth',
      }}>
        {stories.map((story, idx) => (
          <StoryCard
            key={`${story.type}-${story.id || idx}`}
            type={story.type}
            whaleAlias={story.whaleAlias || story.walletAlias}
            tokenSymbol={story.tokenSymbol}
            tokenAddress={story.tokenAddress}
            tokenImage={story.tokenImage}
            chain={story.chain || 'monad'}
            pnl={story.pnl}
            pnlPercent={story.pnlPercent}
            timestamp={story.timestamp || `${Math.floor(Math.random() * 60)}m`}
            size="sm"
          />
        ))}
      </div>
    </div>
  );
}
