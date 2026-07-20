import React from 'react';

/**
 * Catches any render/runtime error in the tree and shows a graceful recovery
 * screen instead of a blank white page. Trading state (positions, Turbo wallet)
 * lives in localStorage, so a reload is always safe.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Surface to the console for debugging / a future Sentry hook. Never the key.
    console.error('[app] render error:', error?.message, info?.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: '#0f0709', color: '#fbf1ef',
        fontFamily: 'Inter, system-ui, sans-serif', textAlign: 'center',
      }}>
        <div style={{ maxWidth: 380 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 16, margin: '0 auto 16px',
            display: 'grid', placeItems: 'center',
            background: 'linear-gradient(135deg, #ff6a3d, #f0511e 60%, #a06bff 130%)',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L20 8.5V15.5L12 22L4 15.5V8.5L12 2Z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" fill="rgba(255,255,255,0.14)" />
              <path d="M12 8v5M12 16.5v.5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ fontSize: 13.5, color: '#9aa3b8', fontWeight: 500, lineHeight: 1.6, margin: '0 0 20px' }}>
            The app hit an unexpected error. Your positions and Turbo wallet are stored locally and are safe — reloading usually fixes it.
          </p>
          <button onClick={() => window.location.reload()} style={{
            padding: '12px 28px', borderRadius: 100, border: 'none', cursor: 'pointer',
            background: '#f0511e', color: '#fff', fontSize: 14, fontWeight: 700,
          }}>
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
