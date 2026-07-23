/**
 * Tiny in-memory per-IP rate limiter for the public HTTP API.
 *
 * Protects `/whales`, `/roster`, `/leaderboard`, `/address/*` from scraping /
 * abuse without any external dependency. Behind Render's proxy the real client
 * IP is in X-Forwarded-For. `/health` and the Helius webhook are exempted by the
 * caller (monitors + provider pushes must never be throttled).
 *
 * A fixed-window counter is enough here (approximate, cheap, no deps); the map
 * is swept each window so memory stays bounded even under a spray of IPs.
 */
export function createRateLimiter({ windowMs = 10000, max = 120 } = {}) {
  const hits = new Map(); // ip -> { count, resetAt }
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, r] of hits) if (r.resetAt < now) hits.delete(ip);
  }, windowMs);
  sweep.unref?.(); // never keep the process alive just for the sweep

  return function allow(req) {
    const xff = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = xff || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let r = hits.get(ip);
    if (!r || r.resetAt < now) { r = { count: 0, resetAt: now + windowMs }; hits.set(ip, r); }
    r.count += 1;
    return { ok: r.count <= max, retryAfterSec: Math.ceil((r.resetAt - now) / 1000) };
  };
}
