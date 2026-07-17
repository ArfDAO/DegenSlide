import React, { forwardRef, useMemo, useRef, useState, useEffect } from 'react';
import TinderCard from 'react-tinder-card';
import { Activity, Droplet, BarChart3, X, ChevronUp, ExternalLink, Copy, Check } from 'lucide-react';
import { fetchTokenPairData } from '../services/dexscreenerApi';
import { degenScoreBreakdown, scoreTier } from '../services/degenScore';
import { EXPLORER_TX_URL, EXPLORER_ADDR_URL, DEXSCREENER_CHAIN, ACTIVE } from '../config/chain.js';

/* ───────── helpers (all display-only, derived from real address/values) ───────── */
const ADJ = ['Silent','Swift','Bold','Iron','Neon','Lunar','Dark','Frost','Omega','Rapid','Apex','Stealth','Turbo','Nova','Hyper','Zen'];
const NOUN = ['Sniper','Whale','Shark','Degen','Hunter','Alpha','Trader','Wizard','Rider','Falcon','Viper','Ghost','Titan','Phantom','Maverick','Ronin'];
export function generateAlias(addr) {
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
  if (v >= t.whale) return { label: 'WHALE', color: '#22d3ee' };
  if (v >= t.shark) return { label: 'SHARK', color: '#a78bfa' };
  if (v >= t.big)   return { label: 'BIG',   color: '#38bdf8' };
  return { label: 'ACTIVE', color: '#8b93a7' };
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
  const col = up ? 'var(--up)' : 'var(--down)';
  const win = score.winRate != null ? Math.round(score.winRate * 100) : null;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }} title="Realized PnL & win rate from on-chain buy/sell round-trips (observed)">
      <span style={{ ...pill, color: col, borderColor: col, background: up ? 'var(--up-soft)' : 'var(--down-soft)' }}>
        {up ? '▲' : '▼'} {up ? '+' : ''}{fmtMonShort(score.realizedMon)} {ACTIVE.nativeSymbol}
      </span>
      {win != null && (
        <span style={{ ...pill, color: win >= 50 ? 'var(--up)' : 'var(--color-pebble)', borderColor: 'var(--color-silver-lining)', background: 'var(--color-frost-shadow)' }}>
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

/* ───────── real price-change micro bars (from DexScreener priceChange) ───────── */
function ChangeBars({ change }) {
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
              background: up ? 'rgba(47,230,168,0.85)' : 'rgba(255,93,125,0.85)',
            }} />
            <span style={{ fontSize: 8, fontWeight: 700, color: up ? 'var(--up)' : 'var(--down)' }}>{fmtPct(v)}</span>
            <span style={{ fontSize: 8, color: 'var(--color-pebble)', fontWeight: 600 }}>{p.k}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ───────── back-face building blocks ───────── */
function BackLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8 }}>{children}</div>;
}
function BackKV({ k, v, sub }) {
  return (
    <div style={{ borderRadius: 10, border: '1px solid var(--color-silver-lining)', padding: '8px 10px' }}>
      <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace', marginTop: 2 }}>{v}</div>
      {sub && <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--color-pebble)', fontFamily: '"JetBrains Mono", monospace', marginTop: 1 }}>{sub}</div>}
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
  { trader, stackIndex = 0, isTopCard = false, onSwipeLeft, onSwipeRight, onSwipeUp, monPriceUsd, isFavorite, onToggleFavorite, isCurated, onOpenDossier, consensusCount },
  ref,
) {
  const [swipeDir, setSwipeDir] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [showDeepDive, setShowDeepDive] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [pair, setPair] = useState(null);      // real DexScreener token data
  const [pairLoaded, setPairLoaded] = useState(false);
  const startPt = useRef(null);
  const activePointerId = useRef(null);
  const firedSwipe = useRef(null);
  const isDragging = useRef(false);
  const backScrollRef = useRef(null);
  const dossierTap = useRef(null); // tap detection for the whale-identity → dossier
  const flipTap = useRef(null);    // article-level tap detection for flip-back (3D hit-test safe)
  const suppressClick = useRef(false); // swallow the click that trails an unflip tap

  // react-tinder-card attaches NATIVE touch listeners on the card root and
  // preventDefaults touchmove, which killed scrolling inside the flipped
  // details on phones. Stop touch events from ever reaching it while the
  // finger is on the scroller — native pan-y scrolling takes over. Pointer
  // events still bubble, so tap-to-flip-back keeps working.
  useEffect(() => {
    const el = backScrollRef.current;
    if (!el) return;
    const stop = (e) => e.stopPropagation();
    el.addEventListener('touchstart', stop, { passive: true });
    el.addEventListener('touchmove', stop, { passive: true });
    return () => { el.removeEventListener('touchstart', stop); el.removeEventListener('touchmove', stop); };
  }, [isTopCard]);

  // Back face: a tap (no scroll) flips to the front; a drag scrolls the details.
  // Works on touch, where a plain onClick is unreliable under the card's gestures.
  // (tap-to-flip-back now lives in trackStart/trackMove/trackEnd at the article
  // level — Chrome's preserve-3d hit-testing made handlers on the rotated back
  // face itself unreliable)

  // Desktop keyboard: App dispatches 'deck:flip' (Space/Enter) — only the top
  // card responds, toggling the same 3D flip a tap performs.
  useEffect(() => {
    if (!isTopCard) return;
    const onFlip = (e) => setShowDeepDive((v) => (typeof e.detail === 'boolean' ? e.detail : !v));
    window.addEventListener('deck:flip', onFlip);
    return () => window.removeEventListener('deck:flip', onFlip);
  }, [isTopCard]);

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
    if (!isTopCard) return;
    if (showDeepDive) {
      // Flipped: Chrome's preserve-3d hit-testing is unreliable for the
      // rotated back face's own handlers, so the tap-to-unflip is detected
      // HERE at the article level, where events always arrive. No capture —
      // scrolling and links inside the details must keep working.
      flipTap.current = { x: e.clientX, y: e.clientY, moved: false };
      return;
    }
    // Don't hijack pointer capture for taps on interactive controls (e.g. the
    // heart button) — capturing here would retarget their click to the card.
    if (e.target.closest?.('[data-no-drag]')) return;
    activePointerId.current = e.pointerId;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startPt.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
  };
  const trackMove = (e) => {
    if (showDeepDive) {
      const s = flipTap.current;
      if (s && (Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8)) s.moved = true;
      return;
    }
    if (!isTopCard || !startPt.current || activePointerId.current !== e.pointerId) return;
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
    if (showDeepDive) {
      // A clean tap (no drag, not on a link/button, not a cancel) flips back.
      const s = flipTap.current; flipTap.current = null;
      if (!s || s.moved || e.type === 'pointercancel') return;
      if (e.target.closest?.('a, button')) return;
      setShowDeepDive(false);
      // the browser fires a click right after this pointerup — without this
      // guard handleCardClick sees the already-unflipped state and re-flips
      suppressClick.current = true;
      return;
    }
    if (activePointerId.current !== null && e.pointerId !== activePointerId.current) return;
    // A press with no drag and no swipe = a TAP → flip the card. Detecting it
    // here (on pointerup) is reliable on touch, where the synthetic click that
    // powers onClick is often swallowed by the pointer capture.
    const wasTap = !!startPt.current && !isDragging.current && !firedSwipe.current;
    startPt.current = null; activePointerId.current = null;
    if (!firedSwipe.current) setDragOffset({ x: 0, y: 0 });
    setTimeout(() => setSwipeDir(null), 350);
    if (wasTap && isTopCard && !showDeepDive) setShowDeepDive(true);
  };
  const handleCardClick = (e) => {
    // Desktop mouse fallback — trackEnd already handles touch taps.
    // Taps on interactive elements (whale identity → dossier, links) must
    // not ALSO flip the card underneath.
    if (suppressClick.current) { suppressClick.current = false; return; } // click trailing an unflip tap
    if (e?.target?.closest?.('[data-no-drag], a, button')) return;
    if (!isTopCard || isDragging.current || showDeepDive) return;
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
  const sideColor = isBuy ? 'var(--up)' : 'var(--down)';
  // Prefer the indexer's USD value (priced at trade time); fall back to live MON price.
  const tradeUsd = trader.amountUsd != null ? trader.amountUsd : (monPriceUsd ? trader.amountMon * monPriceUsd : null);
  const badge = sizeBadge(tradeUsd);
  const ch24 = pair?.priceChange?.h24 ?? null;
  // Degen Score — live market depth + whale quality in one glanceable number.
  const dBreak = degenScoreBreakdown({
    liquidityUsd: pair?.liquidity ?? trader.liquidityUsd ?? null,
    fdv: pair?.fdv ?? null,
    vol24: pair?.volume?.h24 ?? null,
    buys: pair?.txns?.h24Buys ?? null,
    sells: pair?.txns?.h24Sells ?? null,
    whaleWinRate: trader.traderScore?.winRate ?? null,
  });
  const dScore = dBreak?.total ?? null;
  const dTier = dScore != null ? scoreTier(dScore) : null;

  // Whale's entry price (real: trade USD ÷ tokens received) → how far price has
  // moved since the whale bought. THE "am I still early?" number.
  const whaleEntryPrice = (tradeUsd != null && trader.tokenAmount > 0) ? tradeUsd / trader.tokenAmount : null;
  let sinceEntry = null;
  if (whaleEntryPrice > 0 && pair?.priceUsd > 0) {
    const pct = ((pair.priceUsd - whaleEntryPrice) / whaleEntryPrice) * 100;
    if (Math.abs(pct) < 10000) sinceEntry = pct; // decimals mismatch guard
  }

  // Pair age — young pairs rug; surface it up front.
  const ageMs = pair?.createdAt ? Date.now() - pair.createdAt : null;
  const ageLabel = ageMs != null
    ? (ageMs < 3600e3 ? `${Math.max(1, Math.floor(ageMs / 60e3))}m` : ageMs < 86400e3 ? `${Math.floor(ageMs / 3600e3)}h` : `${Math.floor(ageMs / 86400e3)}d`)
    : null;
  const ageRisky = ageMs != null && ageMs < 86400e3; // younger than a day

  /* ── BACK CARDS ── */
  if (stackIndex > 0) {
    return (
      <TinderCard ref={ref} className="absolute left-0 top-0 h-full w-full"
        style={{ touchAction: 'none' }} preventSwipe={['left','right','up','down']}
        swipeRequirementType="position" swipeThreshold={60} onSwipe={handleSwipe}>
        <div style={{
          zIndex: 30 - stackIndex,
          transform: `translateY(${stackIndex * 12}px) scale(${1 - stackIndex * 0.04})`,
          borderRadius: 24, background: 'var(--color-paper-white)',
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
      right: { text: 'COPY', color: 'var(--up)', rot: -16 },
      left:  { text: 'SKIP', color: 'var(--down)', rot: 16 },
      up:    { text: 'SAVE', color: '#ff5d7d', rot: 0 },
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
      style={{ touchAction: showDeepDive ? 'pan-y' : 'none' }}
      preventSwipe={isTopCard && !showDeepDive ? ['down'] : ['left','right','up','down']}
      swipeRequirementType="position" swipeThreshold={80} onSwipe={handleSwipe}>

      <article
        className="relative flex h-full w-full flex-col"
        onClick={handleCardClick}
        style={{
          zIndex: 30, borderRadius: 24,
          // when flipped, allow vertical touch-scrolling of the detail side
          pointerEvents: isTopCard ? 'auto' : 'none', userSelect: 'none', touchAction: showDeepDive ? 'pan-y' : 'none',
          cursor: isTopCard && !showDeepDive ? 'grab' : 'default',
          transform: showDeepDive ? 'none' : dragTransform,
          transition: firedSwipe.current ? 'transform 0.2s ease-out' : startPt.current || showDeepDive ? 'none' : 'transform 0.25s cubic-bezier(0.34,1.56,0.64,1)',
          willChange: isTopCard ? 'transform' : undefined,
          perspective: 1400,
          background: 'transparent',
        }}
        onPointerDown={trackStart} onPointerMove={trackMove} onPointerUp={trackEnd} onPointerCancel={trackEnd}
      >
        {/* ── 3D FLIPPER: front = trade card, back = deep-dive details.
            Tapping the card rotates it 180° like flipping a real card over. ── */}
        <div style={{
          position: 'absolute', inset: 0,
          transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d',
          transition: 'transform 0.65s cubic-bezier(0.35,0.1,0.25,1)',
          transform: showDeepDive ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}>

        {/* ══ FRONT FACE ══ */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
          borderRadius: 24, overflow: 'hidden',
          border: '1px solid var(--color-silver-lining)', boxShadow: 'var(--shadow-lg)',
          background: 'var(--color-paper-white)',
          // While flipped, the rotated-away front face can still win pointer
          // hit-testing (browser backface quirk) and its handlers swallow the
          // back face's tap-to-unflip — take it out of hit-testing entirely.
          pointerEvents: showDeepDive ? 'none' : 'auto',
        }}>
        {!showDeepDive && <Stamp dir="right" op={stampOpacity.right} />}
        {!showDeepDive && <Stamp dir="left" op={stampOpacity.left} />}
        {!showDeepDive && <Stamp dir="up" op={stampOpacity.up} />}

        {/* ══ SIGNAL BANNER — side-tinted strip announcing the trade ══ */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '13px 18px',
          background: isBuy
            ? 'linear-gradient(100deg, rgba(47,230,168,0.16) 0%, rgba(47,230,168,0.03) 55%, transparent 100%)'
            : 'linear-gradient(100deg, rgba(255,93,125,0.16) 0%, rgba(255,93,125,0.03) 55%, transparent 100%)',
          borderBottom: '1px solid var(--line-2)',
        }}>
          <span style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 100,
            background: sideColor, color: '#04060c', fontSize: 11, fontWeight: 900,
            letterSpacing: '0.08em', fontFamily: '"JetBrains Mono", monospace',
            boxShadow: isBuy ? '0 0 16px rgba(47,230,168,0.4)' : '0 0 16px rgba(255,93,125,0.4)',
          }}>
            {isBuy ? '↗' : '↘'} {trader.side}
          </span>
          <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: '"JetBrains Mono", monospace' }}>
            {trader.dex}{trader.feeTier ? ` · ${(trader.feeTier / 10000).toFixed(2)}%` : ''}
          </span>
          {trader.copyable === false && (
            <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--gold)', background: 'var(--gold-soft)', border: '1px solid rgba(245,181,68,0.4)', padding: '2px 7px', borderRadius: 100, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Watch only</span>
          )}
          {consensusCount >= 2 && (
            <span title={`${consensusCount} different whales bought this token in the last 24h — consensus signal`}
              style={{ fontSize: 8.5, fontWeight: 800, color: '#ff9d4d', background: 'rgba(255,157,77,0.1)', border: '1px solid rgba(255,157,77,0.45)', padding: '2px 8px', borderRadius: 100, letterSpacing: '0.05em', fontFamily: '"JetBrains Mono", monospace', whiteSpace: 'nowrap' }}>
              🔥 {consensusCount} whales
            </span>
          )}
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-3)', fontWeight: 600, fontFamily: '"JetBrains Mono", monospace' }}>{timeAgo(trader.ts)}</span>
        </div>

        {/* ══ WHALE IDENTITY ══ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px 0' }}>
          <div
            data-no-drag="true"
            onPointerDown={(e) => { e.stopPropagation(); dossierTap.current = { x: e.clientX, y: e.clientY }; }}
            onPointerUp={(e) => {
              const s = dossierTap.current; dossierTap.current = null;
              if (!s || Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8) return;
              e.stopPropagation();
              onOpenDossier?.(trader.address);
            }}
            style={{ position: 'relative', flexShrink: 0, cursor: onOpenDossier ? 'pointer' : 'default' }}>
            <BlockieAvatar addr={trader.address} size={46} />
            <span style={{
              position: 'absolute', bottom: -3, right: -3, width: 13, height: 13, borderRadius: '50%',
              background: badge.color, border: '2.5px solid var(--surface-1)',
            }} title={badge.label} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <span
                data-no-drag="true"
                onPointerDown={(e) => { e.stopPropagation(); dossierTap.current = { x: e.clientX, y: e.clientY }; }}
                onPointerUp={(e) => {
                  // click events get swallowed under the card's pointer capture on
                  // touch devices — detect the tap ourselves (down+up, no drag)
                  const s = dossierTap.current; dossierTap.current = null;
                  if (!s || Math.abs(e.clientX - s.x) > 8 || Math.abs(e.clientY - s.y) > 8) return;
                  e.stopPropagation();
                  onOpenDossier?.(trader.address);
                }}
                title="Open whale dossier"
                style={{ fontSize: 16.5, fontWeight: 700, color: 'var(--text-1)', letterSpacing: '-0.02em', fontFamily: 'var(--font-display)', cursor: onOpenDossier ? 'pointer' : 'default', textDecoration: onOpenDossier ? 'underline dotted rgba(255,255,255,0.25) 1px' : 'none', textUnderlineOffset: 3 }}>
                {alias}
              </span>
              <span style={{ fontSize: 8.5, fontWeight: 800, color: badge.color, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: '"JetBrains Mono", monospace' }}>{badge.label}</span>
              {isCurated && (
                <span title="On your tracked whale roster" style={{ display: 'flex', alignItems: 'center', padding: '1px 7px', borderRadius: 100, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.35)' }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: '#22d3ee', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Tracked</span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
              <a href={EXPLORER_ADDR_URL(trader.address)} target="_blank" rel="noreferrer"
                data-no-drag="true" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', fontFamily: '"JetBrains Mono", monospace', textDecoration: 'none', background: 'var(--surface-2)', padding: '2px 8px', borderRadius: 6 }}>
                {trader.address.slice(0, 6)}…{trader.address.slice(-4)} ↗
              </a>
              <WhaleScore score={trader.traderScore} />
            </div>
          </div>
        </div>

        {/* ══ TOKEN HERO — the centerpiece ══ */}
        <div style={{ padding: 'min(18px, 2vh) 18px 0', textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            {pair?.imageUrl ? (
              <img src={pair.imageUrl} alt="" style={{ width: 34, height: 34, borderRadius: '50%', boxShadow: '0 0 0 2px var(--line-1), 0 4px 14px rgba(0,0,0,0.5)' }} />
            ) : (
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--surface-3)', display: 'grid', placeItems: 'center', fontSize: 13, fontWeight: 800, color: 'var(--text-2)' }}>{(trader.tokenSymbol || '?').slice(0, 1)}</div>
            )}
            <span style={{ fontSize: 30, fontWeight: 800, color: 'var(--text-1)', letterSpacing: '-0.035em', fontFamily: 'var(--font-display)' }}>${trader.tokenSymbol}</span>
            {ageLabel && (
              <span title={ageRisky ? 'Fresh pair — extra rug risk' : 'Pair age on this DEX'}
                style={{ fontSize: 9, fontWeight: 800, padding: '3px 8px', borderRadius: 100, letterSpacing: '0.06em', fontFamily: '"JetBrains Mono", monospace',
                  color: ageRisky ? '#f5b544' : 'var(--text-3)', border: `1px solid ${ageRisky ? 'rgba(245,181,68,0.45)' : 'var(--line-2)'}`,
                  background: ageRisky ? 'rgba(245,181,68,0.08)' : 'rgba(255,255,255,0.03)' }}>
                {ageRisky ? '⚠ ' : ''}{ageLabel}
              </span>
            )}
          </div>
          {tradeUsd != null && (
            <div style={{ marginTop: 8, fontSize: 'clamp(28px, 5vh, 38px)', fontWeight: 800, letterSpacing: '-0.03em', color: sideColor, fontFamily: '"JetBrains Mono", monospace', lineHeight: 1, textShadow: isBuy ? '0 0 34px rgba(47,230,168,0.35)' : '0 0 34px rgba(255,93,125,0.35)' }}>
              {fmtUsd(tradeUsd)}
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: '"JetBrains Mono", monospace' }}>
            {/* USDC-quoted Solana trades carry no native amount — fall back to the trade size we do know */}
            whale {isBuy ? 'bought' : 'sold'} · {trader.amountMon >= 0.01
              ? `${trader.amountMon >= 1000 ? (trader.amountMon / 1000).toFixed(2) + 'K' : trader.amountMon.toFixed(2)} ${ACTIVE.nativeSymbol}`
              : (tradeUsd != null ? fmtUsd(tradeUsd) : `— ${ACTIVE.nativeSymbol}`)}
            {sinceEntry != null && (
              <span style={{ marginLeft: 8, color: sinceEntry >= 0 ? 'var(--up)' : 'var(--down)', letterSpacing: '0.04em' }}
                title="Price move since the whale's entry — negative means you'd enter cheaper than the whale">
                since entry {sinceEntry >= 0 ? '+' : ''}{Math.abs(sinceEntry) >= 100 ? sinceEntry.toFixed(0) : sinceEntry.toFixed(1)}%
              </span>
            )}
          </div>
        </div>

        {/* ══ LIVE MARKET WELL ══ */}
        <div style={{ margin: 'min(16px, 2vh) 18px 0', borderRadius: 16, border: '1px solid var(--line-2)', background: 'var(--surface-2)', padding: '11px 14px' }}>
          {pair ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)', fontFamily: '"JetBrains Mono", monospace' }}>{fmtUsd(pair.priceUsd)}</div>
                <div style={{ fontSize: 9, color: 'var(--text-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>{pair.baseToken?.symbol || trader.tokenSymbol}/{pair.quoteToken?.symbol || 'USD'} · live</div>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                {ch24 != null && (
                  <span style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 100,
                    background: ch24 >= 0 ? 'var(--up-soft)' : 'var(--down-soft)',
                    border: `1px solid ${ch24 >= 0 ? 'rgba(47,230,168,0.35)' : 'rgba(255,93,125,0.35)'}`,
                    fontSize: 12, fontWeight: 800, color: ch24 >= 0 ? 'var(--up)' : 'var(--down)', fontFamily: '"JetBrains Mono", monospace',
                  }}>
                    {ch24 >= 0 ? '▲' : '▼'} {fmtPct(ch24)}
                  </span>
                )}
                {dTier && (
                  <span title="Degen Score — live liquidity depth, FDV backing, volume, buy pressure & whale win rate"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 100,
                      background: dTier.bg, border: `1px solid ${dTier.border}`,
                      fontSize: 9.5, fontWeight: 800, color: dTier.color, fontFamily: '"JetBrains Mono", monospace', letterSpacing: '0.06em',
                    }}>
                    {dScore} · {dTier.label}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 600, textAlign: 'center', padding: '2px 0' }}>
              {pairLoaded ? 'No live market data for this token' : 'Loading live market…'}
            </div>
          )}
        </div>

        {/* ══ STAT WELLS ══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: 'min(10px, 1.4vh) 18px 0' }}>
          {[
            { icon: <Droplet size={12} />, label: 'Liquidity', value: fmtUsd(pair?.liquidity) },
            { icon: <Activity size={12} />, label: 'FDV', value: fmtUsd(pair?.fdv) },
            { icon: <BarChart3 size={12} />, label: 'Vol 24h', value: fmtUsd(pair?.volume?.h24) },
            { icon: <Activity size={12} />, label: 'B/S 24h', value: pair ? `${pair.txns?.h24Buys ?? 0}/${pair.txns?.h24Sells ?? 0}` : '—' },
          ].map((it, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, borderRadius: 12, border: '1px solid var(--line-2)', background: 'rgba(255,255,255,0.02)', padding: 'min(8px, 1.1vh) 11px' }}>
              <div style={{ color: 'var(--text-3)', display: 'flex' }}>{it.icon}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{it.label}</div>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-1)', fontFamily: '"JetBrains Mono", monospace', whiteSpace: 'nowrap' }}>{it.value}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ══ AFFORDANCE — even more detail (price changes, links) on the flip side ══ */}
        <div style={{ marginTop: 'auto', padding: 'min(12px, 1.5vh) 0 min(14px, 2vh)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          <ChevronUp size={13} color="var(--text-3)" className="animate-bounce" />
          <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.22em', fontFamily: '"JetBrains Mono", monospace' }}>tap for details</span>
        </div>
        </div>

        {/* ══ BACK FACE — deep dive, real data only. Tap anywhere (except a
            link) to flip back to the front. ══ */}
        <div
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
            borderRadius: 24, overflow: 'hidden', touchAction: 'pan-y',
            border: '1px solid var(--color-silver-lining)', boxShadow: 'var(--shadow-lg)',
            background: 'var(--color-paper-white)',
            // mirror of the front-face guard: only the visible face is hit-testable
            pointerEvents: showDeepDive ? 'auto' : 'none',
          }}
        >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid var(--color-frost-shadow)' }}>
                {pair?.imageUrl
                  ? <img src={pair.imageUrl} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
                  : <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--color-frost-shadow)', display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, color: 'var(--color-pebble)' }}>{(trader.tokenSymbol || '?').slice(0, 1)}</div>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--color-midnight-ink)', lineHeight: 1.1 }}>${trader.tokenSymbol}</div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', fontFamily: '"JetBrains Mono", monospace' }}>{fmtUsd(pair?.priceUsd)}{ageLabel ? ` · ${ageLabel} old` : ''}{pair?.dexId ? ` · ${pair.dexId}` : ''}</div>
                </div>
                <button onClick={() => setShowDeepDive(false)} style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--color-frost-shadow)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--color-pebble)', flexShrink: 0 }}>
                  <X size={18} />
                </button>
              </div>

              <div ref={backScrollRef} className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', touchAction: 'pan-y', padding: '16px 18px' }}>

                {/* ── THE WHALE'S PLAY — what you'd actually be copying ── */}
                <BackLabel>The whale&apos;s play</BackLabel>
                <div style={{ background: 'var(--color-frost-shadow)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <BlockieAvatar addr={trader.address} size={30} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--color-midnight-ink)' }}>{alias}</div>
                      <div style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--color-pebble)', fontFamily: '"JetBrains Mono", monospace' }}>{trader.address?.slice(0, 6)}…{trader.address?.slice(-4)} · {timeAgo(trader.ts)}</div>
                    </div>
                    {sinceEntry != null && (
                      <span style={{ fontSize: 11, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: sinceEntry >= 0 ? 'var(--up)' : 'var(--down)' }}
                        title="Price move since this whale's entry">
                        {sinceEntry >= 0 ? '▲' : '▼'} {Math.abs(sinceEntry) >= 100 ? Math.abs(sinceEntry).toFixed(0) : Math.abs(sinceEntry).toFixed(1)}% since entry
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 11 }}>
                    <BackKV k="Entry size" v={tradeUsd != null ? fmtUsd(tradeUsd) : '—'} sub={trader.amountMon >= 0.01 ? `${trader.amountMon >= 1000 ? (trader.amountMon / 1000).toFixed(2) + 'K' : trader.amountMon.toFixed(2)} ${ACTIVE.nativeSymbol}` : null} />
                    <BackKV k="Entry price" v={whaleEntryPrice != null ? fmtUsd(whaleEntryPrice) : '—'} sub={pair?.priceUsd ? `now ${fmtUsd(pair.priceUsd)}` : null} />
                  </div>
                  <WhaleScore score={trader.traderScore} />
                </div>

                {/* ── DEGEN SCORE — the full "why" behind the front pill ── */}
                {dBreak && dTier && (
                  <>
                    <BackLabel>Degen score</BackLabel>
                    <div style={{ background: 'var(--color-frost-shadow)', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 26, fontWeight: 800, fontFamily: '"JetBrains Mono", monospace', color: dTier.color }}>{dScore}</span>
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: dTier.color }}>{dTier.label}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 600, color: 'var(--color-pebble)' }}>/ 100</span>
                      </div>
                      {dBreak.parts.map((p) => (
                        <div key={p.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3.5px 0' }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-pebble)', width: 108, flexShrink: 0 }}>{p.label}</span>
                          <div style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(128,128,128,0.15)', overflow: 'hidden' }}>
                            <div style={{ width: `${(p.pts / p.max) * 100}%`, height: '100%', borderRadius: 3, background: p.pts / p.max >= 0.66 ? 'var(--up)' : p.pts / p.max >= 0.33 ? '#f5b544' : 'var(--down)' }} />
                          </div>
                          <span style={{ fontSize: 9.5, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace', width: 34, textAlign: 'right', flexShrink: 0 }}>{p.pts}/{p.max}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* ── MOMENTUM — price change + volume, all timeframes ── */}
                <BackLabel>Momentum</BackLabel>
                <div style={{ background: 'var(--color-frost-shadow)', borderRadius: 12, padding: '14px', marginBottom: 16 }}>
                  {pair ? (
                    <>
                      <ChangeBars change={pair.priceChange} />
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-silver-lining)' }}>
                        {[['Vol 1h', pair.volume?.h1], ['Vol 6h', pair.volume?.h6], ['Vol 24h', pair.volume?.h24]].map(([k, v]) => (
                          <div key={k} style={{ flex: 1, textAlign: 'center' }}>
                            <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k}</div>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace', marginTop: 2 }}>{fmtUsd(v)}</div>
                          </div>
                        ))}
                      </div>
                      {(pair.txns?.h24Buys || 0) + (pair.txns?.h24Sells || 0) > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 700, marginBottom: 4 }}>
                            <span style={{ color: 'var(--up)' }}>{pair.txns.h24Buys} buys</span>
                            <span style={{ color: 'var(--color-pebble)' }}>24h pressure</span>
                            <span style={{ color: 'var(--down)' }}>{pair.txns.h24Sells} sells</span>
                          </div>
                          <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${(pair.txns.h24Buys / (pair.txns.h24Buys + pair.txns.h24Sells)) * 100}%`, background: 'var(--up)' }} />
                            <div style={{ flex: 1, background: 'var(--down)' }} />
                          </div>
                        </div>
                      )}
                    </>
                  ) : <span style={{ fontSize: 12, color: 'var(--color-pebble)' }}>No live market data for this token.</span>}
                </div>

                {/* ── MARKET + honest risk flags from the same live numbers ── */}
                <BackLabel>Market</BackLabel>
                <div style={{ background: 'var(--color-frost-shadow)', borderRadius: 12, padding: '4px 14px', marginBottom: 12 }}>
                  {[
                    ['Liquidity', fmtUsd(pair?.liquidity)],
                    ['Market Cap', fmtUsd(pair?.marketCap)],
                    ['FDV', fmtUsd(pair?.fdv)],
                    ['FDV / Liquidity', (pair?.fdv && pair?.liquidity) ? `${(pair.fdv / pair.liquidity).toFixed(0)}×` : '—'],
                    ['Pair created', ageLabel ? `${ageLabel} ago` : '—'],
                  ].map(([k, v], i, arr) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: i < arr.length - 1 ? '1px solid var(--color-silver-lining)' : 'none' }}>
                      <span style={{ fontSize: 12, color: 'var(--color-pebble)', fontWeight: 600 }}>{k}</span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace' }}>{v}</span>
                    </div>
                  ))}
                </div>
                {pair && (() => {
                  const flags = [];
                  if ((pair.liquidity || 0) < 10_000) flags.push('Thin liquidity (<$10K) — exits move the price');
                  if (ageRisky) flags.push('Pair younger than 24h — unproven');
                  if (pair.fdv && pair.liquidity && pair.fdv / pair.liquidity > 100) flags.push(`FDV is ${(pair.fdv / pair.liquidity).toFixed(0)}× liquidity — little real backing`);
                  return flags.length ? (
                    <div style={{ borderRadius: 12, border: '1px solid rgba(245,181,68,0.4)', background: 'rgba(245,181,68,0.07)', padding: '10px 13px', marginBottom: 16 }}>
                      {flags.map((f, i) => (
                        <div key={i} style={{ fontSize: 10.5, fontWeight: 700, color: '#b98a2e', lineHeight: 1.6 }}>⚠ {f}</div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ borderRadius: 12, border: '1px solid rgba(47,230,168,0.35)', background: 'rgba(47,230,168,0.06)', padding: '10px 13px', marginBottom: 16, fontSize: 10.5, fontWeight: 700, color: 'var(--color-aurora-green)' }}>
                      ✓ No red flags in live market data
                    </div>
                  );
                })()}

                {/* ── links + contract ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(trader.tokenAddress).then(() => { setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 1400); }).catch(() => {}); }}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: 10, background: 'var(--color-frost-shadow)', border: 'none', cursor: 'pointer', color: copiedAddr ? 'var(--color-aurora-green)' : 'var(--color-midnight-ink)', fontSize: 12, fontWeight: 600 }}>
                    <span style={{ fontFamily: '"JetBrains Mono", monospace' }}>{copiedAddr ? 'Copied ✓' : `${trader.tokenAddress?.slice(0, 8)}…${trader.tokenAddress?.slice(-6)}`}</span>
                    {copiedAddr ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                  <a href={EXPLORER_TX_URL(trader.txHash)} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: 10, background: 'var(--color-frost-shadow)', textDecoration: 'none', color: 'var(--color-midnight-ink)', fontSize: 12, fontWeight: 600 }}>
                    View whale&apos;s tx on {ACTIVE.kind === 'evm' ? 'MonadScan' : 'Solscan'} <ExternalLink size={14} />
                  </a>
                  {/* dexUrl comes from an external API — only trust an https link (no javascript:/data: XSS) */}
                  <a href={(typeof pair?.dexUrl === 'string' && /^https:\/\//i.test(pair.dexUrl)) ? pair.dexUrl : `https://dexscreener.com/${DEXSCREENER_CHAIN}/${trader.tokenAddress}`} target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: 10, background: 'var(--color-frost-shadow)', textDecoration: 'none', color: 'var(--color-midnight-ink)', fontSize: 12, fontWeight: 600 }}>
                    ${trader.tokenSymbol} chart on DexScreener <ExternalLink size={14} />
                  </a>
                </div>
              </div>
        </div>

        </div>{/* /flipper */}
      </article>
    </TinderCard>
  );
});

export default SwipeCard;
