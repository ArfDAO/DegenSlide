/**
 * Export the durable Solana whale_registry → src/data/curatedSolWhales.json.
 *
 * The curated file ships with the repo, so every deploy carries the FULL grown
 * roster: solListener.loadRoster() upserts it back into the whale_registry at
 * boot, making the roster durable even on ephemeral cloud disks (Render).
 *
 * Run after a local discovery session grows the registry:
 *   node backend/exportSolRegistry.js
 *
 * Every row in the registry originates from GMGN-verified + on-chain-confirmed
 * data — no fabrication. This is a pure dump, no filtering.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = path.dirname(fileURLToPath(import.meta.url));
process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, 'solWhales.db');
const db = await import('./db.js');

const OUT = path.join(__d, '..', 'src', 'data', 'curatedSolWhales.json');

const rows = db.loadWhaleRegistry();
const whales = rows.map((r) => ({
  ...(r.stats && typeof r.stats === 'object' ? r.stats : {}),
  address: r.address,
  volumeUsd: Math.max(Number(r.stats?.volumeUsd) || 0, Number(r.volumeUsd) || 0) || null,
  solBalance: r.solBalance ?? null,
  source: r.source,
  firstSeen: r.firstSeen,
}));

fs.writeFileSync(OUT, JSON.stringify({
  source: 'GMGN OpenAPI whale discovery (smart-money feed + KOL feed + trending-token top traders) — quality-gated (7d winrate/PnL) + on-chain verified',
  exportedAt: new Date().toISOString(),
  count: whales.length,
  whales,
}, null, 1));

console.log(`[export] wrote ${whales.length} whales → ${OUT}`);
