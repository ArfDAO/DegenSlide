import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
page.on('pageerror', err => console.log('PAGEERROR:', err.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const btn = page.getByText('I understand & accept the risks');
if (await btn.count()) { await btn.click(); }
await page.waitForTimeout(3000);
await page.screenshot({ path: 'scratch/screens/deck2.png' });
await browser.close();
