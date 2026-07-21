// First-ever visit → show THE DIVE intro once, then straight into the app.
// Same one-time-gate pattern as the disclaimer/onboarding (localStorage flag).
// Kept as an external file (not inline) so it runs under a strict CSP
// (script-src 'self', no 'unsafe-inline').
(function () {
  try {
    if (location.pathname === '/' && !localStorage.getItem('degen_dive_seen_v1')) {
      location.replace('/dive.html');
    }
  } catch (e) { /* storage blocked — just show the app */ }
})();
