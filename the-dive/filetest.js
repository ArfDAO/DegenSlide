const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0,150)); });
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0,150)));
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('file:///Users/biar/Desktop/Degenslide/the-dive/index.html', { waitUntil: 'load', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));
  const state = await page.evaluate(() => ({
    ready: window.__ready === true,
    hasLenis: typeof Lenis !== 'undefined',
    hasGsap: typeof gsap !== 'undefined',
    scrollH: document.documentElement.scrollHeight,
  }));
  console.log(JSON.stringify({ state, errs: errs.slice(0,5) }));
  await b.close();
})();
