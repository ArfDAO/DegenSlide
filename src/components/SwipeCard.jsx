import { forwardRef, useMemo, useRef, useState } from 'react';
import TinderCard from 'react-tinder-card';
import { EXPLORER_TX_URL, EXPLORER_ADDR_URL } from '../services/monadApi';

function shortenAddress(addr) {
  if (!addr) return '0x000...000';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const TIER = {
  whale:       { label: 'Whale',       emoji: '🐋', color: '#7b61ff', bg: 'rgba(123,97,255,0.1)',  border: 'rgba(123,97,255,0.2)' },
  smart_money: { label: 'Smart Money', emoji: '⚡', color: '#4b5563', bg: '#f3f4f6',  border: '#e5e7eb' },
  pro:         { label: 'Pro',         emoji: '💎', color: '#7b61ff', bg: 'rgba(123,97,255,0.1)',  border: 'rgba(123,97,255,0.2)' },
  degen:       { label: 'Degen',       emoji: '🔥', color: '#4b5563', bg: '#f3f4f6',   border: '#e5e7eb' },
  fresh:       { label: 'Fresh',       emoji: '🌱', color: '#4b5563', bg: '#f3f4f6',   border: '#e5e7eb' },
};

const TAG_COLOR = {
  Degen:    '#4b5563', Safe: '#7b61ff', Whale: '#7b61ff', Pro: '#4b5563',
  Sniper:   '#4b5563', Breakout: '#7b61ff', Momentum: '#4b5563', Alpha: '#7b61ff',
  Trend:    '#4b5563', Fast: '#7b61ff', LowCap: '#4b5563', Fresh: '#4b5563', Early: '#7b61ff',
};

const SENTIMENT_MAP = {
  bullish: { label: 'Bullish', icon: '▲', color: '#7b61ff' },
  bearish: { label: 'Bearish', icon: '▼', color: '#4b5563' },
  neutral: { label: 'Neutral', icon: '●', color: '#9ca3af' },
};

const TOKEN_META = {
  MON:  { icon: '◈', color: '#7b61ff' },
  WETH: { icon: 'Ξ', color: '#4b5563' },
  USDC: { icon: '$', color: '#4b5563' },
};

function Sparkline({ values = [], positive = true }) {
  if (!values || values.length < 2) return null;
  const W = 80, H = 32;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => ({
    x: (i / (values.length - 1)) * W,
    y: H - ((v - min) / range) * (H - 4) - 2,
  }));
  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const fillD = `${pathD} L${W},${H} L0,${H} Z`;
  const stroke = positive ? '#7b61ff' : '#9ca3af';
  const id = `sp-${Math.random().toString(36).slice(2, 6)}`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible', display: 'block' }}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${id})`} />
      <path d={pathD} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r="3.5"
        fill={stroke} stroke="#0C1525" strokeWidth="2" />
    </svg>
  );
}

const SwipeCard = forwardRef(function SwipeCard(
  { trader, stackIndex = 0, isTopCard = false, onSwipeLeft, onSwipeRight, onSwipeUp },
  ref
) {
  const [swipeDir, setSwipeDir] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const startPt = useRef(null);
  const activePointerId = useRef(null);
  const firedSwipe = useRef(null);

  if (!trader) return null;

  const handleSwipe = (direction) => {
    setSwipeDir(null);
    setDragOffset({ x: 0, y: 0 });
    startPt.current = null;
    firedSwipe.current = null;
    if (direction === 'left')  onSwipeLeft?.(trader);
    if (direction === 'right') onSwipeRight?.(trader);
    if (direction === 'up')    onSwipeUp?.(trader);
  };

  const triggerSwipe = (direction) => {
    if (firedSwipe.current || !isTopCard) return;
    firedSwipe.current = direction;
    setTimeout(() => {
      ref?.current?.swipe?.(direction);
    }, 0);
  };

  const trackStart = (e) => {
    if (!isTopCard) return;
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startPt.current = { x: e.clientX, y: e.clientY };
  };
  const trackMove = (e) => {
    if (!isTopCard || !startPt.current || activePointerId.current !== e.pointerId) return;
    const dx = e.clientX - startPt.current.x;
    const dy = e.clientY - startPt.current.y;
    const thr = 18;
    const limitedX = Math.max(-180, Math.min(180, dx));
    const limitedY = Math.max(-120, Math.min(120, dy));

    setDragOffset({ x: limitedX, y: limitedY });

    if (Math.abs(dy) > Math.abs(dx) * 1.1 && dy < -thr) {
      setSwipeDir('up');
      if (Math.abs(dy) > 70) triggerSwipe('up');
    } else if (dx > thr) {
      setSwipeDir('right');
      if (dx > 70) triggerSwipe('right');
    } else if (dx < -thr) {
      setSwipeDir('left');
      if (dx < -70) triggerSwipe('left');
    } else {
      setSwipeDir(null);
    }
  };
  const trackEnd = (e) => {
    if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;
    startPt.current = null;
    activePointerId.current = null;
    if (!firedSwipe.current) {
      setDragOffset({ x: 0, y: 0 });
    }
    setTimeout(() => setSwipeDir(null), 350);
  };

  const dragTransform = useMemo(() => {
    if (!isTopCard) return undefined;
    const rotate = dragOffset.x / 18;
    return `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0) rotate(${rotate}deg)`;
  }, [dragOffset.x, dragOffset.y, isTopCard]);

  const isPositive  = trader.sentiment !== 'bearish';
  const token       = TOKEN_META[trader.tokenSymbol] ?? TOKEN_META.MON;
  const sentiment   = SENTIMENT_MAP[trader.sentiment] ?? SENTIMENT_MAP.neutral;
  const tier        = TIER[trader.tier] ?? TIER.fresh;
  const winColor    = trader.winRate >= 50 ? '#7b61ff' : '#6b7280';
  const confColor   = trader.confidence >= 50 ? '#7b61ff' : '#6b7280';

  // Arka kartlar: sadece düz dikdörtgen, içerik yok
  if (stackIndex > 0) {
    return (
      <TinderCard
        ref={ref}
        className="absolute left-0 top-0 h-full w-full"
        style={{ touchAction: 'none' }}
        preventSwipe={['left', 'right', 'up', 'down']}
        swipeRequirementType="position"
        swipeThreshold={50}
        onSwipe={handleSwipe}
      >
        <div
          style={{
            zIndex: 30 - stackIndex,
            transform: `translateY(${stackIndex * 12}px) scale(${1 - stackIndex * 0.04})`,
            borderRadius: 24,
            background: stackIndex === 1 ? '#f9fafb' : '#f3f4f6',
            border: '1px solid #e5e7eb',
            boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            pointerEvents: 'none',
            width: '100%',
            height: '100%',
          }}
        />
      </TinderCard>
    );
  }

  return (
    <TinderCard
      ref={ref}
      className="absolute left-0 top-0 h-full w-full"
      style={{ touchAction: 'none' }}
      preventSwipe={isTopCard ? ['down'] : ['left', 'right', 'up', 'down']}
      swipeRequirementType="position"
      swipeThreshold={50}
      onSwipe={handleSwipe}
    >
      <article
        className="relative flex h-full w-full flex-col overflow-hidden"
        style={{
          zIndex: 30,
          borderRadius: 24,
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          boxShadow: '0 12px 40px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.02)',
          pointerEvents: isTopCard ? 'auto' : 'none',
          userSelect: 'none',
          touchAction: 'none',
          cursor: isTopCard ? 'grab' : 'default',
          transform: dragTransform,
          transition: firedSwipe.current ? 'transform 0.18s ease-out' : startPt.current ? 'none' : 'transform 0.18s ease-out',
          willChange: isTopCard ? 'transform' : undefined,
        }}
        onMouseDown={trackStart}
        onMouseMove={trackMove}
        onMouseUp={trackEnd}
        onTouchStart={trackStart}
        onTouchMove={trackMove}
        onTouchEnd={trackEnd}
        onPointerDown={trackStart}
        onPointerMove={trackMove}
        onPointerUp={trackEnd}
        onPointerCancel={trackEnd}
      >
        {/* Swipe overlays */}
        {swipeDir === 'right' && (
          <div className="pointer-events-none absolute inset-0 z-20 rounded-[24px] flex items-start justify-start p-5"
            style={{ background: 'linear-gradient(135deg, rgba(123,97,255,0.15) 0%, transparent 60%)' }}>
            <span className="rounded-xl px-4 py-1.5 text-base font-black -rotate-12"
              style={{ border: '2px solid #7b61ff', color: '#7b61ff', background: 'rgba(123,97,255,0.1)', letterSpacing: '0.05em' }}>
              COPY ✓
            </span>
          </div>
        )}
        {swipeDir === 'left' && (
          <div className="pointer-events-none absolute inset-0 z-20 rounded-[24px] flex items-start justify-end p-5"
            style={{ background: 'linear-gradient(225deg, rgba(75,85,99,0.15) 0%, transparent 60%)' }}>
            <span className="rounded-xl px-4 py-1.5 text-base font-black rotate-12"
              style={{ border: '2px solid #4b5563', color: '#4b5563', background: 'rgba(75,85,99,0.1)', letterSpacing: '0.05em' }}>
              PASS ✕
            </span>
          </div>
        )}
        {swipeDir === 'up' && (
          <div className="pointer-events-none absolute inset-0 z-20 rounded-[24px] flex items-end justify-center pb-10"
            style={{ background: 'linear-gradient(0deg, rgba(17,24,39,0.15) 0%, transparent 60%)' }}>
            <span className="rounded-xl px-5 py-1.5 text-base font-black"
              style={{ border: '2px solid #111827', color: '#111827', background: 'rgba(17,24,39,0.1)', letterSpacing: '0.05em' }}>
              ALL IN 💸
            </span>
          </div>
        )}

        {/* ── HEADER ── */}
        <div className="relative flex items-center justify-between px-5 pt-5 pb-3">
          {/* Network + address */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5">
              {trader.isLive && (
                <div className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                  style={{ background: '#7b61ff', animation: 'live-pulse 1.5s ease-in-out infinite' }} />
              )}
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#7b61ff', letterSpacing: '0.12em' }}>
                Monad Testnet
              </span>
            </div>
            <a
              href={EXPLORER_ADDR_URL(trader.address)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[14px] font-bold hover:underline leading-none"
              style={{ color: '#111827', letterSpacing: '0.02em' }}
              onClick={e => e.stopPropagation()}
            >
              {shortenAddress(trader.address)}
            </a>
          </div>
          {/* Tier badge */}
          <div className="flex items-center gap-1.5 rounded-xl px-3 py-1.5"
            style={{ background: tier.bg, border: `1px solid ${tier.border}` }}>
            <span style={{ fontSize: 13 }}>{tier.emoji}</span>
            <span className="text-[11px] font-black" style={{ color: tier.color }}>{tier.label}</span>
          </div>
        </div>

        {/* ── DIVIDER ── */}
        <div className="mx-5" style={{ height: 1, background: '#f3f4f6' }} />

        {/* ── P&L SECTION ── */}
        <div className="relative px-5 pt-4 pb-3">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: '#6b7280', letterSpacing: '0.12em' }}>
                Est. P&amp;L
              </span>
              <span className="text-[30px] font-black leading-none" style={{ color: isPositive ? '#111827' : '#4b5563', letterSpacing: '-0.02em' }}>
                {trader.profit}
              </span>
              <div className="mt-1 flex items-center gap-1">
                <span style={{ color: sentiment.color, fontSize: 10, fontWeight: 700 }}>
                  {sentiment.icon}
                </span>
                <span className="text-[11px] font-semibold" style={{ color: sentiment.color }}>
                  {sentiment.label}
                </span>
                <span className="text-[10px]" style={{ color: '#9ca3af' }}>·</span>
                <span className="text-[10px] font-mono" style={{ color: '#6b7280' }}>{trader.balanceMon} MON</span>
              </div>
            </div>
            <div className="mt-1">
              <Sparkline values={trader.sparkline} positive={isPositive} />
            </div>
          </div>

          {/* Stats row */}
          <div className="mt-3 flex items-center gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#6b7280' }}>Win Rate</span>
              <span className="text-[14px] font-black" style={{ color: winColor }}>{trader.winRate}%</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#6b7280' }}>Volume 24h</span>
              <span className="text-[14px] font-black" style={{ color: trader.volume24h ? '#7b61ff' : '#9ca3af' }}>
                {trader.volume24h ?? '—'}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#6b7280' }}>Txns</span>
              <span className="text-[14px] font-black" style={{ color: '#111827' }}>
                {(trader.txCount ?? 0).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Win rate bar */}
          <div className="mt-2.5 w-full rounded-full overflow-hidden" style={{ height: 4, background: '#f3f4f6' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.min(trader.winRate, 100)}%`, background: winColor, transition: 'width 1s ease' }} />
          </div>
        </div>

        {/* ── DIVIDER ── */}
        <div className="mx-5" style={{ height: 1, background: '#f3f4f6' }} />

        {/* ── TRADE ACTION ── */}
        <div className="relative flex flex-1 flex-col justify-center px-5 py-4 gap-2">
          {/* Token pill */}
          <div className="self-start flex items-center gap-1.5 rounded-lg px-2.5 py-1"
            style={{ background: '#f9fafb', border: '1px solid #e5e7eb' }}>
            <span className="font-black" style={{ color: token.color, fontSize: 13 }}>{token.icon}</span>
            <span className="text-[11px] font-black tracking-wider" style={{ color: token.color }}>
              {trader.tokenSymbol}
            </span>
            {trader.lastTxMethod && (
              <span className="text-[10px]" style={{ color: '#6b7280' }}>· {trader.lastTxMethod}</span>
            )}
          </div>

          {/* Action text */}
          <h2 className="text-[18px] font-black uppercase leading-tight" style={{ color: '#111827', letterSpacing: '-0.01em' }}>
            {trader.actionText}
          </h2>

          {/* Confidence */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#6b7280' }}>Confidence</span>
              <span className="text-[13px] font-black" style={{ color: confColor }}>{trader.confidence}%</span>
            </div>
            <div className="w-full rounded-full overflow-hidden" style={{ height: 4, background: '#f3f4f6' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(trader.confidence, 100)}%`, background: confColor, transition: 'width 1s ease' }} />
            </div>
          </div>
        </div>

        {/* ── DIVIDER ── */}
        <div className="mx-5" style={{ height: 1, background: '#f3f4f6' }} />

        {/* ── TAGS ── */}
        <div className="relative px-5 py-3.5 flex flex-wrap gap-1.5">
          {trader.tags.map((tag) => {
            const color = TAG_COLOR[tag] ?? '#6b7280';
            return (
              <span key={tag}
                className="rounded-lg px-2.5 py-1 text-[10px] font-bold"
                style={{
                  background: `${color}1A`,
                  border: `1px solid ${color}40`,
                  color,
                }}>
                #{tag}
              </span>
            );
          })}
        </div>

      </article>
    </TinderCard>
  );
});

export default SwipeCard;
