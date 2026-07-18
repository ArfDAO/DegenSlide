import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Interactive guided tour — SyncSwap-intro style coachmarks over the REAL UI.
 * Dims the app, cuts a spotlight around the current step's target element and
 * anchors a tooltip next to it. Steps with a missing target (e.g. empty
 * portfolio) are skipped automatically; target:null centers a welcome card.
 *
 * Usage: <Tour steps={[{ target: '[data-tour="deck-card"]', title, text }]}
 *              onDone={() => …} />
 */
export default function Tour({ steps, onDone }) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState(null);
  const [tipPos, setTipPos] = useState(null);
  const tipRef = useRef(null);

  const step = steps[idx];

  // Resolve the first step (from idx forward) whose target exists right now.
  useEffect(() => {
    if (!step) return;
    if (step.target && !document.querySelector(step.target)) {
      if (idx < steps.length - 1) setIdx(idx + 1);
      else onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx]);

  // Measure the target + position the tooltip; track resize/scroll while open.
  useLayoutEffect(() => {
    if (!step) return;
    const measure = () => {
      const el = step.target ? document.querySelector(step.target) : null;
      if (!el) { setRect(null); placeTip(null); return; }
      el.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      setRect({ x: r.x - 6, y: r.y - 6, w: r.width + 12, h: r.height + 12 });
      placeTip({ x: r.x, y: r.y, w: r.width, h: r.height });
    };
    const placeTip = (r) => {
      const tw = Math.min(320, window.innerWidth - 24);
      const th = tipRef.current?.offsetHeight || 170;
      if (!r) { // centered (welcome) card
        setTipPos({ left: (window.innerWidth - tw) / 2, top: (window.innerHeight - th) / 2, w: tw });
        return;
      }
      const below = r.y + r.h + th + 24 < window.innerHeight;
      const top = below ? r.y + r.h + 14 : Math.max(12, r.y - th - 14);
      const left = Math.max(12, Math.min(r.x + r.w / 2 - tw / 2, window.innerWidth - tw - 12));
      setTipPos({ left, top, w: tw });
    };
    measure();
    // re-measure shortly after mount too — layout can settle late (fonts, data)
    const t = setTimeout(measure, 350);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, step?.target]);

  if (!step) return null;

  const next = () => (idx < steps.length - 1 ? setIdx(idx + 1) : onDone());
  const back = () => idx > 0 && setIdx(idx - 1);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 95 }}>
      {/* dim + spotlight: the highlight box's giant shadow darkens everything else */}
      {rect ? (
        <div style={{
          position: 'fixed', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
          borderRadius: 16, boxShadow: '0 0 0 9999px rgba(4,6,12,0.78)',
          border: '2px solid rgba(124,107,255,0.9)',
          animation: 'tourPulse 1.6s ease-in-out infinite',
          pointerEvents: 'none', transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)',
        }} />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(4,6,12,0.78)' }} />
      )}
      {/* click shield — the tour owns input while open */}
      <div style={{ position: 'fixed', inset: 0 }} onClick={next} />

      {tipPos && (
        <div ref={tipRef} onClick={(e) => e.stopPropagation()} style={{
          position: 'fixed', left: tipPos.left, top: tipPos.top, width: tipPos.w, zIndex: 96,
          background: 'var(--surface-1, #131a2b)', border: '1px solid rgba(124,107,255,0.4)',
          borderRadius: 18, padding: '16px 18px', boxShadow: '0 18px 60px rgba(0,0,0,0.6)',
          transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {step.icon && <span style={{ fontSize: 18 }}>{step.icon}</span>}
            <span style={{ fontSize: 14.5, fontWeight: 800, color: 'var(--color-midnight-ink)' }}>{step.title}</span>
          </div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: 'var(--color-pebble)', fontWeight: 600 }}>{step.text}</p>
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 14, gap: 8 }}>
            <div style={{ display: 'flex', gap: 4, marginRight: 'auto' }}>
              {steps.map((_, i) => (
                <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: i === idx ? 'var(--color-deep-iris, #7c6bff)' : 'rgba(128,128,150,0.35)' }} />
              ))}
            </div>
            <button onClick={onDone} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--color-pebble)', padding: '7px 8px' }}>Skip</button>
            {idx > 0 && (
              <button onClick={back} style={{ background: 'var(--color-frost-shadow)', border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: 'var(--color-midnight-ink)', padding: '8px 13px', borderRadius: 10 }}>Back</button>
            )}
            <button onClick={next} style={{ background: 'linear-gradient(135deg, #7c6bff 0%, #5946f0 100%)', border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 800, color: '#fff', padding: '8px 16px', borderRadius: 10, boxShadow: '0 3px 12px rgba(109,93,246,0.4)' }}>
              {idx < steps.length - 1 ? 'Next' : 'Got it'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
