import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
page.on('pageerror', err => console.log('PAGEERROR:', err.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
let btn = page.getByText('I understand & accept the risks');
if (await btn.count()) { await btn.click(); await page.waitForTimeout(600); }
btn = page.getByText('Start swiping');
if (await btn.count()) { await btn.click(); await page.waitForTimeout(600); }
for (const label of ['Skip tour', 'Skip', 'Got it', 'Close', '×']) {
  const b = page.getByText(label, { exact: false });
  if (await b.count()) { try { await b.first().click({ timeout: 800 }); await page.waitForTimeout(400); } catch {} }
}
// click profile (last nav item)
await page.locator('.nav-item').nth(3).click();
await page.waitForTimeout(2000);
await page.screenshot({ path: 'scratch/screens/profile.png' });
await browser.close();
