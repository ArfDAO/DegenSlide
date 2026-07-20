import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
page.on('console', msg => console.log('CONSOLE:', msg.type(), msg.text()));
page.on('pageerror', err => console.log('PAGEERROR:', err.message));
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'scratch/screens/deck.png' });
await browser.close();
