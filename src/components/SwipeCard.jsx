import React, { forwardRef, useMemo, useRef, useState, useEffect } from 'react';
import TinderCard from 'react-tinder-card';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Droplet, BarChart3, X, ChevronUp, ExternalLink, Heart } from 'lucide-react';
import { fetchTokenPairData } from '../services/dexscreenerApi';
import { EXPLORER_TX_URL, EXPLORER_ADDR_URL, DEXSCREENER_CHAIN, ACTIVE } from '../config/chain.js';

/* ───────── helpers (all display-only, derived from real address/values) ───────── */
const ADJ = ['Silent','Swift','Bold','Iron','Neon','Lunar','Dark','Frost','Omega','Rapid','Apex','Stealth','Turbo','Nova','Hyper','Zen'];
const NOUN = ['Sniper','Whale','Shark','Degen','Hunter','Alpha','Trader','Wizard','Rider','Falcon','Viper','Ghost','Titan','Phantom','Maverick','Ronin'];
function generateAlias(addr) {
  if (!addr) return 'Unknown';
  const sum = addr.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return `${ADJ[sum % ADJ.length]} ${NOUN[(sum * 7) % NOUN.length]}`;
}
// Size badge derived purely from the REAL trade size in MON.
// Size badge derived from the REAL trade value in USD — thresholds are per-chain
// (ACTIVE.tiers), since whale scale differs wildly between Monad and Solana.
function sizeBadge(usd) {
  const v = Number(usd) || 0;
  const t = ACTIVE.tiers;
  if (v >= t.whale) return { label: 'WHALE', color: '#2563eb' };
  if (v >= t.shark) return { label: 'SHARK', color: '#7c3aed' };
  if (v >= t.big)   return { label: 'BIG',   color: '#0ea5e9' };
  return { label: 'ACTIVE', color: '#6b7280' };
}
function fmtMonShort(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  if (a >= 1) return v.toFixed(0);
  return v.toFixed(1);
}
// Real profitability score from the indexer (realized MON via average cost).
function WhaleScore({ score }) {
  if (!score) return null;
  const pill = { display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 100, fontSize: 9.5, fontWeight: 800, letterSpacing: '0.02em', border: '1px solid' };
  if (!score.closedTokens) {
    return (
      <div style={{ display: 'flex', gap: 6, marginTop: 6 }} title="No completed round-trips observed on-chain yet">
        <span style={{ ...pill, color: 'var(--color-pebble)', borderColor: 'var(--color-silver-lining)', background: 'var(--color-frost-shadow)' }}>
          New wallet{score.activeTokens ? ` · ${score.activeTokens} open` : ''}
        </span>
      </div>
    );
  }
  const up = score.realizedMon >= 0;
  const col = up ? '#10B981' : '#EF4444';
  const win = score.winRate != null ? Math.round(score.winRate * 100) : null;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }} title="Realized PnL & win rate from on-chain buy/sell round-trips (observed)">
      <span style={{ ...pill, color: col, borderColor: col, background: up ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)' }}>
        {up ? '▲' : '▼'} {up ? '+' : ''}{fmtMonShort(score.realizedMon)} {ACTIVE.nativeSymbol}
      </span>
      {win != null && (
        <span style={{ ...pill, color: win >= 50 ? '#10B981' : 'var(--color-pebble)', borderColor: 'var(--color-silver-lining)', background: 'var(--color-frost-shadow)' }}>
          {win}% win · {score.closedTokens} closed
        </span>
      )}
    </div>
  );
}
function fmtUsd(v) {
  v = Number(v);
  if (v == null || isNaN(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  if (a >= 1)   return `$${v.toFixed(2)}`;
  if (a > 0)    return `$${v.toPrecision(3)}`;
  return '—';
}
function fmtPct(v) {
  if (v == null || isNaN(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/* ───────── real price-change micro bars (from DexScreener priceChangfunction ChangeBars({ change }) {
  const pts = [
    { k: '5m', v: change?.m5 },
    { k: '1h', v: change?.h1 },
    { k: '6h', v: change?.h6 },
    { k: '24h', v: change?.h24 },
  ];
  const max = Math.max(1, ...pts.map((p) => Math.abs(p.v ?? 0)));
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 56 }}>
      {pts.map((p) => {
        const v = p.v ?? 0;
        const h = Math.max(4, (Math.abs(v) / max) * 40);
        const up = v >= 0;
        return (
          <div key={p.k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
            <div style={{
              width: '100%', maxWidth: 34, height: h, borderRadius: 4,
              background: up ? 'rgba(16,185,129,0.85)' : 'rgba(239,68,68,0.85)',
            }} />
            <span style={{ fontSize: 8, fontWeight: 700, color: up ? '#10B981' : '#EF4444' }}>{fmtPct(v)}</span>
            <span style={{ fontSize: 8, color: 'var(--color-pebble)', fontWeight: 600 }}>{p.k}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── avatar (effigy.im — deterministic from the real address) ───────── */
export function BlockieAvatar({ addr, size = 42 }) {
  const [loaded, setLoaded] = useState(false);
  const src = addr ? `https://effigy.im/a/${addr}.png` : null;
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, overflow: 'hidden', flexShrink: 0,
      border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)',
    }}>
      {src && (
        <img src={src} alt="" width={size} height={size}
          onLoad={() => setLoaded(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: loaded ? 'block' : 'none' }} />
      )}
    </div>
  );
}

/* ═════════════════════════ SWIPE CARD ═════════════════════════ */
const SwipeCard = forwardRef(function SwipeCard(
  { trader, stackIndex = 0, isTopCard = false, onSwipeLeft, onSwipeRight, onSwipeUp, monPriceUsd, isFavorite, onToggleFavorite, isCurated },
  ref,
) {
  const [swipeDir, setSwipeDir] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showDeepDive, setShowDeepDive] = useState(false);
  const [pair, setPair] = useState(null);      // real DexScreener token data
  const [pairLoaded, setPairLoaded] = useState(false);
  const startPt = useRef(null);
  const activePointerId = useRef(null);
  const firedSwipe = useRef(null);
  const isDragging = useRef(false);

  // Fetch REAL token market data for the visible cards only.
  useEffect(() => {
    let alive = true;
    if (!trader?.tokenAddress || stackIndex > 1) return;
    fetchTokenPairData(trader.tokenAddress)
      .then((p) => { if (alive) { setPair(p); setPairLoaded(true); } })
      .catch(() => { if (alive) setPairLoaded(true); });
    return () => { alive = false; };
  }, [trader?.tokenAddress, stackIndex]);

  if (!trader) return null;

  /* ── gesture handlers (data-agnostic) ── */
  const handleSwipe = (direction) => {
    setSwipeDir(null); setDragOffset({ x: 0, y: 0 });
    startPt.current = null; firedSwipe.current = null; isDragging.current = false;
    if (direction === 'left')  onSwipeLeft?.(trader);
    if (direction === 'right') onSwipeRight?.(trader);
    if (direction === 'up')    onSwipeUp?.(trader);
  };
  const triggerSwipe = (dir) => {
    if (firedSwipe.current || !isTopCard) return;
    firedSwipe.current = dir;
    setTimeout(() => ref?.current?.swipe?.(dir), 0);
  };
  const trackStart = (e) => {
    if (!isTopCard || showDeepDive) return;
    // Don't hijack pointer capture for taps on interactive controls (e.g. the
    // heart button) — capturing here would retarget their click to the card.
    if (e.target.closest?.('[data-no-drag]')) return;
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startPt.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
  };
  const trackMove = (e) => {
    if (!isTopCard || !startPt.current || activePointerId.current !== e.pointerId || showDeepDive) return;
    const dx = e.clientX - startPt.current.x;
    const dy = e.clientY - startPt.current.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) isDragging.current = true;
    setDragOffset({ x: Math.max(-280, Math.min(280, dx)), y: Math.max(-200, Math.min(200, dy)) });
    const thr = 20;
    if (Math.abs(dy) > Math.abs(dx) * 1.1 && dy < -thr) {
      setSwipeDir('up'); if (Math.abs(dy) > 100) triggerSwipe('up');
    } else if (dx > thr) {
      setSwipeDir('right'); if (dx > 100) triggerSwipe('right');
    } else if (dx < -thr) {
      setSwipeDir('left'); if (dx < -100) triggerSwipe('left');
    } else setSwipeDir(null);
  };
  const trackEnd = (e) => {
    if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;
    startPt.current = null; activePointerId.current = null;
    if (!firedSwipe.current) setDragOffset({ x: 0, y: 0 });
    setTimeout(() => setSwipeDir(null), 350);
  };
  const handleCardClick = () => {
    if (!isTopCard || isDragging.current) return;
    setShowDeepDive(true);
  };

  const dragTransform = useMemo(() => {
    if (!isTopCard) return undefined;
    return `translate3d(${dragOffset.x}px,${dragOffset.y}px,0) rotate(${(dragOffset.x * 90) / 280}deg)`;
  }, [dragOffset.x, dragOffset.y, isTopCard]);

  const stampOpacity = useMemo(() => ({
    right: dragOffset.x > 20 ? Math.min((dragOffset.x - 20) / 70, 1) : 0,
    left:  dragOffset.x < -20 ? Math.min((Math.abs(dragOffset.x) - 20) / 70, 1) : 0,
    up:    dragOffset.y < -20 && Math.abs(dragOffset.y) > Math.abs(dragOffset.x) ? Math.min((Math.abs(dragOffset.y) - 20) / 70, 1) : 0,
  }), [dragOffset.x, dragOffset.y]);

  /* ── real derived data ── */
  const alias = generateAlias(trader.address);
  const isBuy = trader.side === 'BUY';
  const sideColor = isBuy ? '#10B981' : '#EF4444';
  // Prefer the indexer's USD value (priced at trade time); fall back to live MON price.
  const tradeUsd = trader.amountUsd != null ? trader.amountUsd : (monPriceUsd ? trader.amountMon * monPriceUsd : null);
  const badge = sizeBadge(tradeUsd);
  const ch24 = pair?.priceChange?.h24 ?? null;

  /* ── BACK CARDS ── */
  if (stackIndex > 0) {
    return (
      <TinderCard ref={ref} className="absolute left-0 top-0 h-full w-full"
        style={{ touchAction: 'none' }} preventSwipe={['left','right','up','down']}
        swipeRequirementType="position" swipeThreshold={60} onSwipe={handleSwipe}>
        <div style={{
          zIndex: 30 - stackIndex,
          transform: `translateY(${stackIndex * 12}px) scale(${1 - stackIndex * 0.04})`,
          borderRadius: 16, background: 'var(--color-paper-white)',
          border: '1px solid var(--color-silver-lining)', boxShadow: 'var(--shadow-md)',
          pointerEvents: 'none', width: '100%', height: '100%',
          opacity: 1 - stackIndex * 0.2, overflow: 'hidden',
        }} />
      </TinderCard>
    );
  }

  const Stamp = ({ dir, op }) => {
    if (op <= 0) return null;
    const cfg = {
      right: { text: 'COPY', color: '#10B981', rot: -16 },
      left:  { text: 'SKIP', color: '#EF4444', rot: 16 },
      up:    { text: 'ALL IN', color: '#3b82f6', rot: 0 },
    }[dir];
    const pos = dir === 'right' ? { top: 56, left: 24 } : dir === 'left' ? { top: 56, right: 24 } : { top: 56, left: '50%', transform: 'translateX(-50%)' };
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 50, borderRadius: 'inherit', opacity: Math.min(op, 1), pointerEvents: 'none' }}>
        <div style={{ position: 'absolute', ...pos, border: `3px solid ${cfg.color}`, borderRadius: 6, padding: '6px 16px', transform: pos.transform || `rotate(${cfg.rot}deg)` }}>
          <span style={{ fontSize: 26, fontWeight: 900, letterSpacing: '0.12em', color: cfg.color, fontFamily: '"JetBrains Mono", monospace' }}>{cfg.text}</span>
        </div>
      </div>
    );
  };

  return (
    <TinderCard ref={ref} className="absolute left-0 top-0 h-full w-full"
      style={{ touchAction: 'none' }}
      preventSwipe={isTopCard && !showDeepDive ? ['down'] : ['left','right','up','down']}
      swipeRequirementType="position" swipeThreshold={80} onSwipe={handleSwipe}>

      <article
        className="relative flex h-full w-full flex-col overflow-hidden"
        onClick={handleCardClick}
        style={{
          zIndex: 30, borderRadius: 16,
          border: '1px solid var(--color-silver-lining)', boxShadow: 'var(--shadow-lg)',
          pointerEvents: isTopCard ? 'auto' : 'none', userSelect: 'none', touchAction: 'none',
          cursor: isTopCard && !showDeepDive ? 'grab' : 'default',
          transform: showDeepDive ? 'none' : dragTransform,
          transition: firedSwipe.current ? 'transform 0.2s ease-out' : startPt.current || showDeepDive ? 'none' : 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)',
          willChange: isTopCard ? 'transform' : undefined,
          background: 'var(--color-paper-white)',
        }}
        onPointerDown={trackStart} onPointerMove={trackMove} onPointerUp={trackEnd} onPointerCancel={trackEnd}
      >
        {!showDeepDive && <Stamp dir="right" op={stampOpacity.right} />}
        {!showDeepDive && <Stamp dir="left" op={stampOpacity.left} />}
        {!showDeepDive && <Stamp dir="up" op={stampOpacity.up} />}

        {/* HEADER — real whale identity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 20px 14px' }}>
          <BlockieAvatar addr={trader.address} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-midnight-ink)', letterSpacing: '-0.02em' }}>{alias}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 100, background: 'var(--color-frost-shadow)', border: '1px solid var(--color-silver-lining)' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: badge.color }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: badge.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{badge.label}</span>
              </span>
              {isCurated && (
                <span title="On your curated whale roster" style={{ display: 'flex', alignItems: 'center', padding: '2px 8px', borderRadius: 100, background: 'rgba(37,99,235,0.1)', border: '1px solid rgba(37,99,235,0.35)' }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Tracked</span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <a href={EXPLORER_ADDR_URL(trader.address)} target="_blank" rel="noreferrer"
                data-no-drag="true" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-pebble)', fontFamily: '"JetBrains Mono", monospace', textDecoration: 'none' }}>
                {trader.address.slice(0, 6)}…{trader.address.slice(-4)}
              </a>
              <span style={{ fontSize: 10, color: 'var(--color-silver-lining)' }}>·</span>
              <span style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600 }}>{timeAgo(trader.ts)}</span>
            </div>
            <WhaleScore score={trader.traderScore} />
          </div>
          <button
            type="button"
            data-no-drag="true"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(trader); }}
            title={isFavorite ? 'Remove from favorites' : 'Save whale'}
            style={{
              width: 34, height: 34, borderRadius: 17, flexShrink: 0, border: 'none',
              background: isFavorite ? 'rgba(239,68,68,0.1)' : 'var(--color-frost-shadow)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
            }}
          >
            <Heart size={16} color={isFavorite ? '#EF4444' : 'var(--color-pebble)'} fill={isFavorite ? '#EF4444' : 'none'} />
          </button>
        </div>

        {/* ACTION — real trade */}
        <div style={{ padding: '0 20px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', background: sideColor, padding: '2px 8px', borderRadius: 6, letterSpacing: '0.04em' }}>{trader.side}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{trader.dex}{trader.quoteSymbol ? ` · via ${trader.quoteSymbol}` : ''}{trader.feeTier ? ` · ${(trader.feeTier / 10000).toFixed(2)}%` : ''}</span>
            {trader.copyable === false && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#b45309', background: 'rgba(180,83,9,0.1)', border: '1px solid rgba(180,83,9,0.35)', padding: '1px 6px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Watch only</span>
            )}
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--color-midnight-ink)', letterSpacing: '-0.03em' }}>
            ${trader.tokenSymbol}
            {tradeUsd != null && (
              <span style={{ color: 'var(--color-pebble)', fontWeight: 700, fontSize: 16 }}>{' '}· {fmtUsd(tradeUsd)}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 2 }}>
            {trader.amountMon >= 1000 ? (trader.amountMon / 1000).toFixed(2) + 'K' : trader.amountMon.toFixed(2)} {ACTIVE.nativeSymbol} worth
          </div>
        </div>

        {/* TOKEN PRICE STRIP — real DexScreener */}
        <div style={{ padding: '4px 20px 12px', borderBottom: '1px solid var(--color-frost-shadow)' }}>
          {pair ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {pair.imageUrl ? (
                <img src={pair.imageUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-frost-shadow)' }} />
              )}
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace' }}>{fmtUsd(pair.priceUsd)}</div>
                <div style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600 }}>{pair.baseToken?.symbol || trader.tokenSymbol} / {pair.quoteToken?.symbol || 'MON'}</div>
              </div>
              {ch24 != null && (
                <div style={{ marginLeft: 'auto', fontSize: 14, fontWeight: 800, color: ch24 >= 0 ? '#10B981' : '#EF4444' }}>
                  {ch24 >= 0 ? '▲' : '▼'} {fmtPct(ch24)}
                </div>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--color-pebble)', fontWeight: 600, padding: '6px 0' }}>
              {pairLoaded ? 'No live market data for this token' : 'Loading token market…'}
            </div>
          )}
        </div>

        {/* REAL STATS GRID */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: '16px 20px' }}>
          {[
            { icon: <Droplet size={14} />, label: 'Liquidity', value: fmtUsd(pair?.liquidity) },
            { icon: <Activity size={14} />, label: 'FDV', value: fmtUsd(pair?.fdv) },
            { icon: <BarChart3 size={14} />, label: 'Vol 24h', value: fmtUsd(pair?.volume?.h24) },
            { icon: <Activity size={14} />, label: 'Buys/Sells 24h', value: pair ? `${pair.txns?.h24Buys ?? 0}/${pair.txns?.h24Sells ?? 0}` : '—' },
          ].map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ color: 'var(--color-pebble)' }}>{it.icon}</div>
              <div>
                <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{it.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace' }}>{it.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* AFFORDANCE */}
        <div style={{ marginTop: 'auto', padding: '14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, borderTop: '1px solid var(--color-frost-shadow)', background: 'var(--color-frost-shadow)' }}>
          <ChevronUp size={16} color="var(--color-pebble)" className="animate-bounce" />
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Tap for details</span>
        </div>

        {/* DEEP DIVE — real data only */}
        <AnimatePresence>
          {showDeepDive && (
            <motion.div
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              onClick={(e) => e.stopPropagation()}
              style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'var(--color-paper-white)', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--color-frost-shadow)' }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>${trader.tokenSymbol} · live data</span>
                <button onClick={() => setShowDeepDive(false)} style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--color-frost-shadow)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-pebble)' }}>
                  <X size={18} />
                </button>
              </div>

              <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                {/* real price changes */}
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Price change (DexScreener)</div>
                <div style={{ background: 'var(--color-frost-shadow)', borderRadius: 10, padding: '16px', marginBottom: 20 }}>
                  {pair ? <ChangeBars change={pair.priceChange} /> : <span style={{ fontSize: 12, color: 'var(--color-pebble)' }}>No market data.</span>}
                </div>

                {/* real market stats */}
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Market</div>
                <div style={{ background: 'var(--color-frost-shadow)', borderRadius: 10, padding: '4px 16px', marginBottom: 20 }}>
                  {[
                    ['Price', fmtUsd(pair?.priceUsd)],
                    ['Liquidity', fmtUsd(pair?.liquidity)],
                    ['FDV', fmtUsd(pair?.fdv)],
                    ['Market Cap', fmtUsd(pair?.marketCap)],
                    ['Volume 24h', fmtUsd(pair?.volume?.h24)],
                    ['Buys / Sells 24h', pair ? `${pair.txns?.h24Buys ?? 0} / ${pair.txns?.h24Sells ?? 0}` : '—'],
                  ].map(([k, v], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: i < 5 ? '1px solid var(--color-silver-lining)' : 'none' }}>
                      <span style={{ fontSize: 13, color: 'var(--color-pebble)', fontWeight: 600 }}>{k}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace' }}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* real links */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <a href={EXPLORER_TX_URL(trader.txHash)} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 10, background: 'var(--color-frost-shadow)', textDecoration: 'none', color: 'var(--color-midnight-ink)', fontSize: 13, fontWeight: 600 }}>
                    View whale's tx on MonadScan <ExternalLink size={14} />
                  </a>
                  <a href={pair?.dexUrl || `https://dexscreener.com/${DEXSCREENER_CHAIN}/${trader.tokenAddress}`} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 10, background: 'var(--color-frost-shadow)', textDecoration: 'none', color: 'var(--color-midnight-ink)', fontSize: 13, fontWeight: 600 }}>
                    ${trader.tokenSymbol} on DexScreener <ExternalLink size={14} />
                  </a>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </article>
    </TinderCard>
  );
});

export default SwipeCard;
