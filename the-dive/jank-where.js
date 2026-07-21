const puppeteer = require('puppeteer-core');
(async () => {
  const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--hide-scrollbars','--no-sandbox'] });
  const page = await b.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5190/', { waitUntil: 'networkidle0' });
  await page.waitForFunction('window.__ready === true', { timeout: 45000 });
  const out = await page.evaluate(() => new Promise(res => {
    const end = Math.max(0, document.documentElement.scrollHeight - innerHeight);
    const worst = []; let last = performance.now(), y = 0;
    const tick = () => {
      const now = performance.now(); const d = now - last; last = now;
      if (d > 50) worst.push({ y, d: +d.toFixed(1) });
      y += 13; scrollTo(0, Math.min(y, end));
      if (y < end) requestAnimationFrame(tick); else res(worst);
    };
    requestAnimationFrame(tick);
  }));
  console.log(JSON.stringify(out));
  await b.close();
})();
