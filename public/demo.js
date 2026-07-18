  // ── responsive letterbox ──
  const stage = document.getElementById('stage');
  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    stage.style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit); fit();

  // ── live-feel ticker (illustrative trades) ──
  const trades = [
    ['🐋','Iron Alpha','BUY','$WIF','$4.8K'], ['🦈','Neon Sniper','BUY','$CHOG','$1.2K'],
    ['🐋','Frost Whale','BUY','$BONK','$9.3K'], ['🐋','Dark Viper','SELL','$WBTC','$2.1K'],
    ['🦈','Turbo Ronin','BUY','$POPCAT','$860'], ['🐋','Apex Ghost','BUY','$MON','$12.4K'],
    ['🦈','Zen Falcon','BUY','$PYTH','$1.9K'], ['🐋','Nova Titan','BUY','$JUP','$6.7K'],
  ];
  const seg = trades.map(t => `${t[0]} <i>${t[1]}</i> <b>${t[2]}</b> <i>${t[3]}</i> ${t[4]}`).join('<span style="opacity:.35">·</span>');
  document.getElementById('ticker').innerHTML = seg + '<span style="opacity:.35">·</span>' + seg;

  // ── scene controller ──
  const scenes = [...document.querySelectorAll('.scene')];
  const DUR = { 1: 4200, 2: 6800, 3: 7200, 4: 5200, 5: 5000, 6: 4600 };
  const dotsEl = document.getElementById('dots');
  scenes.forEach(() => { const i = document.createElement('i'); dotsEl.appendChild(i); });
  const dots = [...dotsEl.children];

  let idx = 0, timer = null;
  function show(i) {
    scenes.forEach((s, k) => s.classList.toggle('on', k === i));
    dots.forEach((d, k) => d.classList.toggle('cur', k === i));
    const sc = scenes[i];
    sc.classList.remove('toast-on');
    const card = sc.querySelector('.demo-card');
    if (card) {
      card.classList.remove('fly');
      // let it settle, then swipe right + toast
      setTimeout(() => { card.classList.add('fly'); }, 3300);
      setTimeout(() => { sc.classList.add('toast-on'); }, 4100);
    }
    timer = setTimeout(next, DUR[i + 1] || 5000);
  }
  function next() { idx = (idx + 1) % scenes.length; show(idx); }

  // ?scene=N pins one scene with no auto-advance — for screenshots/recording setup
  const pinned = parseInt(new URLSearchParams(location.search).get('scene'), 10);
  if (pinned >= 1 && pinned <= scenes.length) {
    idx = pinned - 1;
    show(idx);
    clearTimeout(timer);
  } else {
    show(0);
  }

  // click/space = skip ahead (handy while recording setup)
  addEventListener('keydown', (e) => { if (e.key === ' ') { clearTimeout(timer); next(); } });
  addEventListener('click', () => { clearTimeout(timer); next(); });
