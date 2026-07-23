/**
 * Helius webhook manager — REAL-TIME Solana whale tracking.
 *
 * Replaces the ~5-minute round-robin polling latency with instant push: Helius
 * POSTs every transaction that touches a tracked whale wallet to our
 * `/helius-webhook` endpoint the moment it confirms. One "raw" webhook holds the
 * whole roster (Helius allows up to 100k addresses per webhook), so a single
 * webhook covers every whale on the free tier.
 *
 * This module only MANAGES the webhook registration (create / find / update the
 * address list). The receiving + parsing lives in solListener.js, which feeds
 * the pushed transactions straight into the existing computeSwap() path — so the
 * webhook and the (now safety-net) poller produce identical cards.
 *
 * Enabled only when BOTH are set:
 *   HELIUS_API_KEY        - your Helius key (free tier is enough)
 *   PUBLIC_URL            - the public base URL Helius should POST to
 *                           (on Render this is auto-derived from RENDER_EXTERNAL_URL)
 * Optional:
 *   HELIUS_WEBHOOK_SECRET - shared secret; sent as the webhook's Authorization
 *                           header and verified on every inbound POST
 *   HELIUS_API_BASE       - override the webhook API host (default api.helius.xyz)
 */
const KEY = process.env.HELIUS_API_KEY || '';
const BASE = (process.env.HELIUS_API_BASE || 'https://api.helius.xyz').replace(/\/+$/, '');
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
const SECRET = process.env.HELIUS_WEBHOOK_SECRET || '';
const WEBHOOK_PATH = '/helius-webhook';
const MAX_ADDRESSES = 100000; // Helius hard cap per webhook

export const heliusEnabled = () => !!(KEY && PUBLIC_URL);
export const webhookPath = () => WEBHOOK_PATH;
export const webhookUrl = () => PUBLIC_URL + WEBHOOK_PATH;
// Inbound POSTs are authenticated with the same secret we registered (if any).
export const validateAuth = (header) => !SECRET || header === SECRET;
export function heliusStatus() {
  return { enabled: heliusEnabled(), hasKey: !!KEY, publicUrl: PUBLIC_URL || null, authProtected: !!SECRET, lastSync };
}

let lastSync = null; // { at, ok, count, id, action, reason }

async function api(method, path, body) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}api-key=${KEY}`;
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`helius ${method} ${path} → HTTP ${res.status} ${text.slice(0, 180)}`);
  return text ? JSON.parse(text) : null;
}

function sameSet(a, b) {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/**
 * Ensure a Helius "raw" webhook exists for our endpoint and points at exactly
 * `addresses`. Idempotent: unchanged address sets are a no-op (no credit spend).
 * Returns a status object; never throws (real-time is best-effort, the poller
 * remains the safety net).
 */
export async function syncWebhook(addresses) {
  if (!heliusEnabled()) { lastSync = { at: Date.now(), ok: false, reason: 'HELIUS_API_KEY / PUBLIC_URL not set' }; return lastSync; }
  const addrs = [...new Set(addresses)].slice(0, MAX_ADDRESSES);
  const url = webhookUrl();
  const body = {
    webhookURL: url,
    transactionTypes: ['ANY'],       // raw feed — we classify swaps ourselves
    accountAddresses: addrs,
    webhookType: 'raw',
    txnStatus: 'success',            // failed txs never become cards
    ...(SECRET ? { authHeader: SECRET } : {}),
  };
  try {
    const list = await api('GET', '/v0/webhooks');
    const mine = Array.isArray(list) ? list.find((w) => w.webhookURL === url) : null;
    if (mine) {
      if (sameSet(mine.accountAddresses, addrs)) { lastSync = { at: Date.now(), ok: true, count: addrs.length, id: mine.webhookID, action: 'unchanged' }; return lastSync; }
      await api('PUT', `/v0/webhooks/${mine.webhookID}`, body);
      lastSync = { at: Date.now(), ok: true, count: addrs.length, id: mine.webhookID, action: 'updated' };
      return lastSync;
    }
    const created = await api('POST', '/v0/webhooks', body);
    lastSync = { at: Date.now(), ok: true, count: addrs.length, id: created?.webhookID, action: 'created' };
    return lastSync;
  } catch (e) {
    lastSync = { at: Date.now(), ok: false, reason: e.message };
    return lastSync;
  }
}
