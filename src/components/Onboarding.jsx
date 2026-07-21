import { Check, Zap, PieChart } from 'lucide-react';

/**
 * First-run "how it works" — shown once after the risk disclaimer so new users
 * understand the swipe → copy → manage loop before landing on the deck.
 */
export default function Onboarding({ onDone }) {
  const steps = [
    {
      Icon: Check, tint: 'var(--up)', bg: 'var(--up-soft)', bd: 'rgba(109, 180, 138, 0.35)',
      title: 'Swipe right to copy',
      body: 'The deck streams live whale buys. Swipe right (or tap ✓) to copy the trade, left to skip, up to save the whale to your watchlist.',
    },
    {
      Icon: Zap, tint: 'var(--gold)', bg: 'var(--gold-soft)', bd: 'rgba(201, 162, 78, 0.4)',
      title: 'Turbo = one-swipe trading',
      body: 'Connect your wallet in Profile to save your account — your Turbo wallet links to it and is recoverable anywhere. Fund it once, then every swipe executes instantly on-chain with no pop-ups.',
    },
    {
      Icon: PieChart, tint: 'var(--accent)', bg: 'var(--accent-soft)', bd: 'rgba(214, 99, 58, 0.4)',
      title: 'Manage in Portfolio',
      body: 'Track live PnL, buy more, sell any percentage, and set stop-loss / take-profit that auto-close for you — on Monad and Solana.',
    },
  ];
  return (
    <div className="app-container">
      <div style={{ position: 'absolute', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22 }}>
        <div style={{ maxWidth: 440, width: '100%', background: 'var(--surface-1)', border: '1px solid var(--line-1)', borderRadius: 24, padding: 24, boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--accent-2)', textTransform: 'uppercase', letterSpacing: '0.14em', fontFamily: 'var(--font-mono)', marginBottom: 4 }}>Welcome to DegenSlide</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-1)', fontFamily: 'var(--font-display)', margin: '0 0 18px' }}>Swipe to copy whales</h1>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {steps.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, flexShrink: 0, display: 'grid', placeItems: 'center', background: s.bg, border: `1px solid ${s.bd}`, color: s.tint }}>
                  <s.Icon size={18} strokeWidth={2.4} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{s.title}</div>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 2 }}>{s.body}</div>
                </div>
              </div>
            ))}
          </div>
          <button onClick={onDone}
            style={{ width: '100%', marginTop: 20, padding: '13px 0', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 800, cursor: 'pointer', background: 'var(--color-tidewater-navy)', color: '#fff' }}>
            Start swiping
          </button>
        </div>
      </div>
    </div>
  );
}
