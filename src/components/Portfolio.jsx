import { useEffect, useState, useCallback } from 'react';
import { X, PieChart } from 'lucide-react';
import { fetchMONPrice, fetchTokensByAddresses } from '../services/dexscreenerApi';
import { ACTIVE } from '../config/chain.js';
import { WALLET_NAME } from '../services/activeWallet';

/* ── format helpers ── */
function fmtUsd(val) {
  if (val == null || isNaN(val)) return '—';
  const abs = Math.abs(val);
  if (abs >= 1000) return `$${(val / 1000).toFixed(2)}k`;
  if (abs >= 1)    return `$${val.toFixed(2)}`;
  if (abs >= 0.01) return `$${val.toFixed(3)}`;
  return `$${val.toPrecision(2)}`;
}
function fmtPct(val) {
  if (val == null || isNaN(val)) return '—';
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
}
function fmtTokens(val) {
  if (val == null || isNaN(val)) return '—';
  if (val >= 1e9) return `${(val / 1e9).toFixed(2)}B`;
  if (val >= 1e6) return `${(val / 1e6).toFixed(2)}M`;
  if (val >= 1e3) return `${(val / 1e3).toFixed(2)}K`;
  if (val >= 1)   return val.toFixed(2);
  return val.toPrecision(3);
}
function fmtPrice(val) {
  if (val == null || isNaN(val)) return '—';
  if (val >= 1) return `$${val.toFixed(3)}`;
  if (val >= 0.0001) return `$${val.toFixed(6)}`;
  return `$${val.toExponential(2)}`;
}
function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ── position math (tolerant of legacy entries) ── */
function positionMath(p, pair, monPrice) {
  const amountMon = p.amountMon ?? p.amount ?? 0;
  const decimals = p.token?.decimals ?? 18;
  let tokensHeld = null;
  try { tokensHeld = p.tokensRaw ? Number(BigInt(p.tokensRaw)) / 10 ** decimals : null; } catch { tokensHeld = null; }
  const investedUsd = p.investedUsd != null
    ? p.investedUsd
    : ((p.monPriceUsd || monPrice) ? amountMon * (p.monPriceUsd || monPrice) : null);
  const price = pair ? pair.priceUsd : null;
  const currentValue = (tokensHeld != null && price != null) ? tokensHeld * price : null;
  const avgEntry = (tokensHeld && investedUsd != null && tokensHeld > 0) ? investedUsd / tokensHeld : null;
  const pnlUsd = (currentValue != null && investedUsd != null) ? currentValue - investedUsd : null;
  const pnlPct = (pnlUsd != null && investedUsd) ? (pnlUsd / investedUsd) * 100 : null;
  return { amountMon, decimals, tokensHeld, investedUsd, price, currentValue, avgEntry, pnlUsd, pnlPct };
}

/* ── MON price banner ── */
function MonPriceTicker({ data }) {
  if (!data) return null;
  const ch24 = data.priceChange?.h24 ?? 0;
  const positive = ch24 >= 0;
  return (
    <div style={{ background: 'var(--color-paper-white)', border: '1px solid var(--color-silver-lining)', borderRadius: 16, padding: '11px 14px', marginBottom: 10, boxShadow: 'var(--shadow-md)', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 10, background: 'var(--color-frost-shadow)', border: '1px solid var(--color-silver-lining)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, color: 'var(--color-midnight-ink)', flexShrink: 0 }}>◈</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>{ACTIVE.nativeSymbol}</div>
        <div style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600 }}>{ACTIVE.label} · DexScreener</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>${data.priceUsd?.toFixed(3)}</div>
        <div style={{ fontSize: 11, fontWeight: 600, color: positive ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)' }}>{positive ? '▲' : '▼'} {fmtPct(ch24)}</div>
      </div>
    </div>
  );
}

/* ── portfolio summary ── */
function Summary({ rows }) {
  const invested = rows.reduce((s, r) => s + (r.m.investedUsd || 0), 0);
  const current = rows.reduce((s, r) => s + (r.m.currentValue ?? r.m.investedUsd ?? 0), 0);
  const priced = rows.filter((r) => r.m.pnlUsd != null);
  const pnl = current - invested;
  const pnlPct = invested ? (pnl / invested) * 100 : null;
  const wins = priced.filter((r) => r.m.pnlUsd >= 0).length;
  const col = pnl >= 0 ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)';
  return (
    <div style={{ background: 'var(--color-paper-white)', border: '1px solid var(--color-silver-lining)', borderRadius: 16, padding: '12px 14px', marginBottom: 10, boxShadow: 'var(--shadow-md)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr' }}>
      <div style={{ paddingRight: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Invested</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>{fmtUsd(invested)}</div>
      </div>
      <div style={{ borderLeft: '1px solid var(--color-silver-lining)', paddingLeft: 10, paddingRight: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Value / PnL</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>{fmtUsd(current)}</div>
        {priced.length > 0 && <div style={{ fontSize: 10, fontWeight: 700, color: col, marginTop: 1 }}>{pnl >= 0 ? '+' : ''}{fmtUsd(pnl)} · {fmtPct(pnlPct)}</div>}
      </div>
      <div style={{ borderLeft: '1px solid var(--color-silver-lining)', paddingLeft: 10 }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Win Rate</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: priced.length && wins ? 'var(--color-aurora-green)' : 'var(--color-pebble)' }}>{priced.length ? `${Math.round((wins / priced.length) * 100)}%` : '—'}</div>
        <div style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 1 }}>{wins}/{priced.length}</div>
      </div>
    </div>
  );
}

/* ── stat cell ── */
function Stat({ label, value, color, sub }) {
  return (
    <div>
      <div style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: color || 'var(--color-midnight-ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 9.5, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

/* ── position card ── */
function PositionCard({ p, pair, monPrice, tradeAmount, autoSell, onRemove, onBuyMore, onSetTargets, onSell }) {
  const m = positionMath(p, pair, monPrice);
  const [buyAmt, setBuyAmt] = useState(String(tradeAmount ?? 1));
  const [editTargets, setEditTargets] = useState(false);
  const [sl, setSl] = useState(p.stopLossPct != null ? String(p.stopLossPct) : '');
  const [tp, setTp] = useState(p.takeProfitPct != null ? String(p.takeProfitPct) : '');
  const [confirmDel, setConfirmDel] = useState(false);
  const [selling, setSelling] = useState(false);
  const [confirmSell, setConfirmSell] = useState(false);

  const doSell = async () => {
    setConfirmSell(false); setSelling(true);
    try { await onSell(p); } catch { /* toast handled upstream */ } finally { setSelling(false); }
  };

  const isApe = p.action === 'APE';
  const col = m.pnlUsd == null ? 'var(--color-pebble)' : m.pnlUsd >= 0 ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)';
  const sym = p.token?.symbol || 'TOKEN';

  const slHit = p.stopLossPct != null && m.pnlPct != null && m.pnlPct <= p.stopLossPct;
  const tpHit = p.takeProfitPct != null && m.pnlPct != null && m.pnlPct >= p.takeProfitPct;

  const saveTargets = () => {
    const slNum = sl.trim() === '' ? null : parseFloat(sl);
    const tpNum = tp.trim() === '' ? null : parseFloat(tp);
    onSetTargets(p.id, { stopLossPct: isNaN(slNum) ? null : slNum, takeProfitPct: isNaN(tpNum) ? null : tpNum });
    setEditTargets(false);
  };

  const inputStyle = { width: '100%', padding: '9px 10px', borderRadius: 10, border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)', color: 'var(--color-midnight-ink)', fontSize: 13, fontWeight: 700, outline: 'none', boxSizing: 'border-box' };

  return (
    <div style={{ background: 'var(--color-paper-white)', border: `1px solid ${slHit ? 'var(--color-aurora-magenta)' : tpHit ? 'var(--color-aurora-green)' : 'var(--color-silver-lining)'}`, borderRadius: 18, padding: 14, marginBottom: 10, boxShadow: 'var(--shadow-md)' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: 'var(--color-frost-shadow)', border: '1px solid var(--color-silver-lining)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' }}>
          {pair?.imageUrl ? <img src={pair.imageUrl} alt="" width={40} height={40} style={{ objectFit: 'cover' }} /> : <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>{sym.slice(0, 2).toUpperCase()}</span>}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>${sym}</span>
            <span style={{ fontSize: 8.5, fontWeight: 700, padding: '2px 6px', borderRadius: 20, color: isApe ? 'var(--color-aurora-magenta)' : 'var(--color-deep-iris)', border: `1px solid ${isApe ? 'var(--color-aurora-magenta)' : 'var(--color-deep-iris)'}` }}>{isApe ? 'ALL IN' : 'COPY'}</span>
            {slHit && <span style={{ fontSize: 8.5, fontWeight: 700, padding: '2px 6px', borderRadius: 20, color: '#fff', background: 'var(--color-aurora-magenta)' }}>STOP HIT</span>}
            {tpHit && <span style={{ fontSize: 8.5, fontWeight: 700, padding: '2px 6px', borderRadius: 20, color: '#fff', background: 'var(--color-aurora-green)' }}>TARGET HIT</span>}
          </div>
          <div style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 2, fontFamily: 'monospace' }}>
            {p.trader?.address ? `${p.trader.address.slice(0, 6)}…${p.trader.address.slice(-4)}` : ''} · {timeAgo(p.lastTime || p.time)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: col }}>{m.pnlUsd == null ? '—' : `${m.pnlUsd >= 0 ? '+' : ''}${fmtUsd(m.pnlUsd)}`}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: col }}>{fmtPct(m.pnlPct)}</div>
        </div>
      </div>

      {/* pnl bar */}
      {m.pnlPct != null && (
        <div style={{ height: 4, borderRadius: 2, background: 'var(--color-frost-shadow)', overflow: 'hidden', marginTop: 10 }}>
          <div style={{ width: `${Math.min(100, Math.abs(m.pnlPct) * 2)}%`, height: '100%', background: col, borderRadius: 2, transition: 'width 0.5s' }} />
        </div>
      )}

      {/* stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 12 }}>
        <Stat label="Invested" value={m.investedUsd != null ? fmtUsd(m.investedUsd) : '—'} sub={`${m.amountMon} ${ACTIVE.nativeSymbol}`} />
        <Stat label="Holding" value={fmtTokens(m.tokensHeld)} sub={sym} />
        <Stat label="Value now" value={m.currentValue != null ? fmtUsd(m.currentValue) : '—'} color={col} />
        <Stat label="Avg entry" value={fmtPrice(m.avgEntry)} />
        <Stat label="Price now" value={fmtPrice(m.price)} sub={pair ? `24h ${fmtPct(pair.priceChange?.h24)}` : ''} />
        <Stat label="Liquidity" value={pair ? fmtUsd(pair.liquidity) : '—'} />
      </div>

      {/* stop-loss / take-profit */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-silver-lining)' }}>
        {!editTargets ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: p.stopLossPct != null ? 'var(--color-aurora-magenta)' : 'var(--color-pebble)' }}>
                SL {p.stopLossPct != null ? `${p.stopLossPct}%` : 'off'}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: p.takeProfitPct != null ? 'var(--color-aurora-green)' : 'var(--color-pebble)' }}>
                TP {p.takeProfitPct != null ? `+${p.takeProfitPct}%` : 'off'}
              </span>
            </div>
            <button onClick={() => setEditTargets(true)} style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-tidewater-navy)', background: 'var(--color-frost-shadow)', border: 'none', borderRadius: 9, padding: '5px 10px', cursor: 'pointer' }}>Set targets</button>
          </div>
        ) : (
          <div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-aurora-magenta)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Stop loss %</label>
                <input type="text" inputMode="decimal" placeholder="-20" value={sl} onChange={(e) => setSl(e.target.value.replace(/[^0-9.-]/g, ''))} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-aurora-green)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Take profit %</label>
                <input type="text" inputMode="decimal" placeholder="50" value={tp} onChange={(e) => setTp(e.target.value.replace(/[^0-9.-]/g, ''))} style={{ ...inputStyle, marginTop: 4 }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <button onClick={saveTargets} style={{ flex: 1, padding: '9px 0', borderRadius: 10, border: 'none', background: 'var(--color-tidewater-navy)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Save targets</button>
              <button onClick={() => { setSl(''); setTp(''); onSetTargets(p.id, { stopLossPct: null, takeProfitPct: null }); setEditTargets(false); }} style={{ padding: '9px 12px', borderRadius: 10, border: '1px solid var(--color-silver-lining)', background: 'transparent', color: 'var(--color-pebble)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Clear</button>
            </div>
            <div style={{ fontSize: 9.5, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 6, lineHeight: 1.4 }}>
              {autoSell ? `When PnL crosses a level the position auto-sells to ${ACTIVE.nativeSymbol} (${WALLET_NAME} confirms each sell). Toggle in Profile → Settings.` : 'Auto-sell is OFF — these only show a visual alert. Enable it in Profile → Settings.'}
            </div>
          </div>
        )}
      </div>

      {/* actions row 1: buy more (custom amount) */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--color-silver-lining)', display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <input type="text" inputMode="decimal" value={buyAmt} onChange={(e) => setBuyAmt(e.target.value.replace(/[^0-9.]/g, ''))} style={{ ...inputStyle, paddingRight: 42 }} />
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 11, fontWeight: 700, color: 'var(--color-pebble)' }}>{ACTIVE.nativeSymbol}</span>
        </div>
        <button
          onClick={() => { const a = parseFloat(buyAmt); if (a > 0) onBuyMore(p, a); }}
          disabled={!(parseFloat(buyAmt) > 0)}
          style={{ padding: '0 16px', borderRadius: 10, border: 'none', background: parseFloat(buyAmt) > 0 ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: parseFloat(buyAmt) > 0 ? '#fff' : 'var(--color-pebble)', fontSize: 12, fontWeight: 700, cursor: parseFloat(buyAmt) > 0 ? 'pointer' : 'default', whiteSpace: 'nowrap' }}
        >+ Buy</button>
      </div>

      {/* actions row 2: close (sell to MON) + stop tracking */}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        {!confirmSell ? (
          <button onClick={() => setConfirmSell(true)} disabled={selling} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: '1px solid var(--color-aurora-green)', background: 'transparent', color: 'var(--color-aurora-green)', fontSize: 12, fontWeight: 700, cursor: selling ? 'default' : 'pointer', opacity: selling ? 0.6 : 1 }}>
            {selling ? 'Selling…' : `↓ Close (sell → ${ACTIVE.nativeSymbol})`}
          </button>
        ) : (
          <>
            <button onClick={doSell} style={{ flex: 1, padding: '10px 0', borderRadius: 10, border: 'none', background: 'var(--color-aurora-green)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Confirm sell all</button>
            <button onClick={() => setConfirmSell(false)} style={{ padding: '10px 14px', borderRadius: 10, border: '1px solid var(--color-silver-lining)', background: 'transparent', color: 'var(--color-pebble)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Cancel</button>
          </>
        )}
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} title="Stop tracking (no sell)" style={{ padding: '0 12px', borderRadius: 10, border: '1px solid var(--color-silver-lining)', background: 'transparent', color: 'var(--color-aurora-magenta)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}><X size={15} /></button>
        ) : (
          <button onClick={() => onRemove(p.id)} style={{ padding: '0 12px', borderRadius: 10, border: 'none', background: 'var(--color-aurora-magenta)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Sure?</button>
        )}
      </div>
      {m.pnlUsd == null && (
        <div style={{ fontSize: 9.5, color: 'var(--color-pebble)', fontWeight: 600, marginTop: 8 }}>Live PnL appears once DexScreener has a price for this token.</div>
      )}
    </div>
  );
}

/* ── main ── */
export default function Portfolio({ portfolio, monPriceUsd, tradeAmount = 1, autoSell = true, onRemove, onBuyMore, onSetTargets, onSell }) {
  const [monData, setMonData] = useState(null);
  const [pairMap, setPairMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const refresh = useCallback(async () => {
    if (!portfolio.length) return;
    setLoading(true);
    try {
      const data = await fetchMONPrice();
      if (data) setMonData(data);
      const addrs = [...new Set(portfolio.map((p) => p.token?.address).filter(Boolean))];
      if (addrs.length) {
        const pairs = await fetchTokensByAddresses(addrs);
        const map = {};
        pairs.forEach((pr) => { if (pr.baseToken?.address) map[pr.baseToken.address.toLowerCase()] = pr; });
        setPairMap(map);
      }
      setLastUpdated(Date.now());
    } catch { /* keep previous */ }
    finally { setLoading(false); }
  }, [portfolio]);

  useEffect(() => { refresh(); const id = setInterval(refresh, 30000); return () => clearInterval(id); }, [refresh]);

  if (portfolio.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', paddingBottom: 80, gap: 12 }}>
        <PieChart size={40} strokeWidth={1.5} color="var(--color-pebble)" style={{ opacity: 0.4 }} />
        <div style={{ fontFamily: '"averta standard", sans-serif', fontWeight: 700, fontSize: 16, color: 'var(--color-midnight-ink)' }}>No positions yet</div>
        <div style={{ fontSize: 13, color: 'var(--color-pebble)', maxWidth: 230, fontWeight: 600 }}>Swipe right (or ALL IN) on a whale to open a position. Manage it here — buy more, set stop-loss / take-profit, track live PnL.</div>
      </div>
    );
  }

  const monPrice = monData?.priceUsd ?? monPriceUsd ?? null;
  const rows = portfolio.map((p) => ({ p, pair: pairMap[(p.token?.address || '').toLowerCase()] || null, m: positionMath(p, pairMap[(p.token?.address || '').toLowerCase()] || null, monPrice) }));

  return (
    <div style={{ height: '100%', overflowY: 'auto', paddingBottom: 16, scrollbarWidth: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-pebble)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{portfolio.length} Position{portfolio.length !== 1 ? 's' : ''}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdated && <span style={{ fontSize: 9, color: 'var(--color-pebble)', fontWeight: 600 }}>{timeAgo(lastUpdated)}</span>}
          <button onClick={refresh} disabled={loading} style={{ background: 'transparent', border: '1px solid var(--color-silver-lining)', borderRadius: 9, padding: '3px 10px', fontSize: 10, fontWeight: 700, color: loading ? 'var(--color-pebble)' : 'var(--color-aurora-magenta)', cursor: loading ? 'default' : 'pointer' }}>{loading ? '⟳ syncing' : '⟳ Refresh'}</button>
        </div>
      </div>

      <MonPriceTicker data={monData} />
      <Summary rows={rows} />

      {lastUpdated && <div style={{ fontSize: 9, color: 'var(--color-pebble)', textAlign: 'right', marginBottom: 6, fontWeight: 600 }}>via DexScreener · auto-refresh 30s</div>}

      {rows.map(({ p, pair }) => (
        <PositionCard key={p.id} p={p} pair={pair} monPrice={monPrice} tradeAmount={tradeAmount} autoSell={autoSell} onRemove={onRemove} onBuyMore={onBuyMore} onSetTargets={onSetTargets} onSell={onSell} />
      ))}
    </div>
  );
}
