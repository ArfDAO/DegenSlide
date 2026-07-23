/**
 * Pluggable external whale-DISCOVERY sources for Solana.
 *
 * Discovery must not depend on a single provider (GMGN) — if GMGN misses a whale
 * or its CLI isn't configured, that whale is never tracked. This registry lets
 * additional smart-money feeds contribute candidates through the SAME pipeline:
 * every candidate returned here is fed into gmgnSync's quality gate + on-chain
 * wallet verification before it can enter the roster, so a new source can only
 * ADD real, vetted whales — never lower the bar.
 *
 * Each source is GATED on its own API key: with no key `enabled()` is false and
 * the source is skipped (clean no-op). To turn one on, set its key env var; the
 * candidates flow automatically. Endpoints are wrapped in try/catch so a wrong
 * path or provider outage degrades to "0 candidates", never a crash.
 *
 * Candidate shape (matches gmgnSync.addCandidate): { address, volUsd, tags, vector }
 *
 * Keys (set in the Solana service env when ready):
 *   BIRDEYE_API_KEY        — birdeye.so
 *   SOLANATRACKER_API_KEY  — solanatracker.io
 *   CIELO_API_KEY          — cielo.finance
 *
 * NOTE: exact response shapes should be re-verified the moment each key is added
 * (providers version their APIs); the parsers below defensively probe the common
 * field names so most shape drift is absorbed.
 */
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const timeout = (ms = 15000) => AbortSignal.timeout(ms);
const num = (...xs) => { for (const x of xs) { const n = Number(x); if (Number.isFinite(n) && n) return n; } return 0; };

export const SOURCES = [
  {
    name: 'birdeye',
    enabled: () => !!process.env.BIRDEYE_API_KEY,
    async fetch() {
      const out = [];
      try {
        const res = await fetch('https://public-api.birdeye.so/trader/gainers-losers?type=1W&sort_by=PnL&sort_type=desc&offset=0&limit=100',
          { headers: { 'X-API-KEY': process.env.BIRDEYE_API_KEY, 'x-chain': 'solana', Accept: 'application/json' }, signal: timeout() });
        const j = await res.json();
        const list = j?.data?.items || j?.data || [];
        for (const t of list) {
          const address = t.address || t.owner || t.wallet;
          if (address && B58.test(address)) out.push({ address, volUsd: num(t.volume, t.tradeVolume, t.volumeUsd), tags: [], vector: 'birdeye:gainers' });
        }
      } catch (e) { console.warn('[src:birdeye]', e.message); }
      return out;
    },
  },
  {
    name: 'solanatracker',
    enabled: () => !!process.env.SOLANATRACKER_API_KEY,
    async fetch() {
      const out = [];
      try {
        const res = await fetch('https://data.solanatracker.io/top-traders/all?sortBy=total&page=1',
          { headers: { 'x-api-key': process.env.SOLANATRACKER_API_KEY, Accept: 'application/json' }, signal: timeout() });
        const j = await res.json();
        const list = j?.wallets || j?.data || j || [];
        for (const t of (Array.isArray(list) ? list : [])) {
          const address = t.wallet || t.address;
          if (address && B58.test(address)) out.push({ address, volUsd: num(t.totalVolume, t.volume, t.total), tags: [], vector: 'solanatracker:top' });
        }
      } catch (e) { console.warn('[src:solanatracker]', e.message); }
      return out;
    },
  },
  {
    name: 'cielo',
    enabled: () => !!process.env.CIELO_API_KEY,
    async fetch() {
      const out = [];
      try {
        const res = await fetch('https://api.cielo.finance/api/v1/smart-money/wallets?chain=solana',
          { headers: { 'x-api-key': process.env.CIELO_API_KEY, Accept: 'application/json' }, signal: timeout() });
        const j = await res.json();
        const list = j?.data?.wallets || j?.data?.items || j?.data || [];
        for (const t of (Array.isArray(list) ? list : [])) {
          const address = t.wallet || t.address;
          if (address && B58.test(address)) out.push({ address, volUsd: num(t.volume, t.pnl, t.realized_pnl_usd), tags: ['smart_degen'], vector: 'cielo:smartmoney' });
        }
      } catch (e) { console.warn('[src:cielo]', e.message); }
      return out;
    },
  },
];

// Run every ENABLED source, returning a flat de-duplicated candidate list.
export async function runExternalSources() {
  const byAddr = new Map();
  for (const s of SOURCES) {
    if (!s.enabled()) continue;
    const cands = await s.fetch();
    console.log(`[discovery:${s.name}] ${cands.length} candidates`);
    for (const c of cands) {
      const prev = byAddr.get(c.address);
      if (prev) { prev.volUsd += c.volUsd; for (const t of c.tags) if (!prev.tags.includes(t)) prev.tags.push(t); }
      else byAddr.set(c.address, { ...c, tags: [...c.tags] });
    }
  }
  return [...byAddr.values()];
}

export function externalSourceStatus() {
  return SOURCES.map((s) => ({ name: s.name, enabled: s.enabled() }));
}
