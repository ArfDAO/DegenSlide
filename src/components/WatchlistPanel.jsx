import { useState, useEffect, useCallback, useRef } from 'react';
import { Repeat, ArrowUpRight, Check, Landmark, Gift, Zap, Coins, Sprout, X, Waves, RefreshCw, ExternalLink } from 'lucide-react';
import { fetchWalletInfo, fetchWalletTxns } from '../services/monadApi';
import { EXPLORER_TX_URL, EXPLORER_ADDR_URL, ACTIVE } from '../config/chain.js';

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

function weiToMon(wei) {
  const val = parseFloat(wei || '0') / 1e18;
  if (val === 0) return null;
  if (val >= 1000) return val.toFixed(0) + ' MON';
  if (val >= 0.001) return val.toFixed(3) + ' MON';
  return null;
}

function MethodIcon({ method, txTypes }) {
  const m = (method || '').toLowerCase();
  const p = { size: 14, color: 'var(--color-pebble)' };
  if (m.includes('swap')) return <Repeat {...p} />;
  if (m === 'transfer' || (txTypes || []).includes('token_transfer')) return <ArrowUpRight {...p} />;
  if (m.includes('mint')) return <Sprout {...p} />;
  if (m.includes('approve')) return <Check {...p} />;
  if (m.includes('stake') || m.includes('deposit')) return <Landmark {...p} />;
  if (m.includes('claim') || m.includes('harvest')) return <Gift {...p} />;
  if ((txTypes || []).includes('coin_transfer') || m === '') return <Coins {...p} />;
  return <Zap {...p} />;
}

function TxRow({ tx }) {
  const mon = weiToMon(tx.value);
  const method = tx.method || (tx.tx_types?.includes('coin_transfer') ? 'Transfer' : 'Contract Call');
  const ago = timeAgo(tx.timestamp);
  const isSuccess = tx.status === 'ok' || tx.result === 'success' || tx.status === null;

  return (
    <a
      href={EXPLORER_TX_URL(tx.hash)}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 0', textDecoration: 'none',
        borderBottom: '1px solid var(--color-silver-lining)',
      }}
    >
      <div style={{
        width: 30, height: 30, borderRadius: 8, flexShrink: 0,
        background: 'var(--color-frost-shadow)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14,
      }}>
        <MethodIcon method={method} txTypes={tx.tx_types} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-midnight-ink)', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {method}
        </div>
        {mon && <div style={{ fontSize: 10, color: 'var(--color-aurora-magenta)', fontWeight: 600 }}>{mon}</div>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
        <div style={{ fontSize: 9, color: 'var(--color-pebble)' }}>{ago}</div>
        <div style={{ display: 'flex', color: isSuccess ? 'var(--color-aurora-green)' : 'var(--color-aurora-magenta)' }}>{isSuccess ? <Check size={11} /> : <X size={11} />}</div>
      </div>
    </a>
  );
}

function WalletCard({ wallet, onRemove, defaultExpanded = false, isAuto, onToggleAuto, autoEnabled }) {
  const [txns, setTxns] = useState([]);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [infoData, txData] = await Promise.all([
      fetchWalletInfo(wallet),
      fetchWalletTxns(wallet, 8),
    ]);
    if (!mountedRef.current) return;
    if (infoData) setInfo(infoData);
    setTxns(txData);
    setLoading(false);
    setLoadedOnce(true);
  }, [wallet]);

  // Lazy: only fetch/poll while expanded — keeps a 100-whale watchlist cheap.
  useEffect(() => {
    mountedRef.current = true;
    if (!expanded) return () => { mountedRef.current = false; };
    refresh();
    const id = setInterval(refresh, 30000);
    return () => { mountedRef.current = false; clearInterval(id); };
  }, [expanded, refresh]);

  const balanceMon = info?.coin_balance
    ? parseFloat(info.coin_balance) / 1e18
    : null;

  const tier = balanceMon !== null
    ? balanceMon > 100000 ? { label: 'WHALE', color: 'var(--color-tidewater-navy)' }
    : balanceMon > 10000 ? { label: 'SMART', color: 'var(--color-aurora-green)' }
    : balanceMon > 1000  ? { label: 'PRO', color: 'var(--color-deep-iris)' }
    : { label: 'DEGEN', color: 'var(--color-aurora-magenta)' }
    : null;

  const txCount = info?.transactions_count ?? null;
  const recentActivity = txns[0]?.timestamp
    ? timeAgo(txns[0].timestamp) + ' ago'
    : null;

  return (
    <div style={{
      background: 'var(--color-paper-white)',
      border: '1px solid var(--color-silver-lining)',
      boxShadow: 'var(--shadow-md)',
      borderRadius: 16,
      overflow: 'hidden',
      marginBottom: 10,
    }}>
      {/* Header */}
      <div
        style={{ padding: '12px 14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
        onClick={() => setExpanded(e => !e)}
      >
        <div style={{
          width: 38, height: 38, borderRadius: 10, flexShrink: 0,
          background: 'var(--color-frost-shadow)',
          border: '1px solid var(--color-silver-lining)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: 'monospace',
        }}>
          {wallet.slice(2, 4).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)', fontFamily: 'monospace' }}>
              {wallet.slice(0, 6)}…{wallet.slice(-4)}
            </span>
            {tier && (
              <span style={{ fontSize: 8, fontWeight: 600, color: tier.color, background: 'transparent', border: `1px solid ${tier.color}`, borderRadius: 6, padding: '1px 5px', letterSpacing: '0.08em' }}>
                {tier.label}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 3, alignItems: 'center' }}>
            {balanceMon !== null && (
              <span style={{ fontSize: 10, color: 'var(--color-aurora-magenta)', fontWeight: 600 }}>
                {balanceMon >= 1000 ? (balanceMon / 1000).toFixed(1) + 'K' : balanceMon.toFixed(2)} MON
              </span>
            )}
            {txCount !== null && (
              <span style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600 }}>{txCount} txns</span>
            )}
            {recentActivity && (
              <span style={{ fontSize: 10, color: 'var(--color-aurora-green)', fontWeight: 600 }}>● {recentActivity}</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {onToggleAuto && (
            <button
              onClick={e => { e.stopPropagation(); onToggleAuto(wallet); }}
              title={isAuto ? 'Auto-copy ON — every BUY from this whale is copied automatically' : 'Turn on auto-copy for this whale'}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                padding: '4px 9px', borderRadius: 100, fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
                border: `1px solid ${isAuto ? 'rgba(109,93,246,0.6)' : 'var(--color-silver-lining)'}`,
                background: isAuto ? 'linear-gradient(135deg, #7c6bff 0%, #5946f0 100%)' : 'transparent',
                color: isAuto ? '#fff' : 'var(--color-pebble)',
                boxShadow: isAuto ? '0 2px 10px rgba(109,93,246,0.4)' : 'none',
                opacity: isAuto && !autoEnabled ? 0.55 : 1,
              }}
            >
              🤖 AUTO
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); refresh(); }}
            title="Refresh"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex',
              color: loading ? 'var(--color-tidewater-navy)' : 'var(--color-pebble)',
              animation: loading ? 'spin 1s linear infinite' : 'none',
            }}
          >
            <RefreshCw size={14} />
          </button>
          <a
            href={EXPLORER_ADDR_URL(wallet)}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            title="Open in explorer"
            style={{ color: 'var(--color-pebble)', padding: 6, textDecoration: 'none', display: 'flex' }}
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={e => { e.stopPropagation(); onRemove(wallet); }}
            title="Remove"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, display: 'flex', color: 'var(--color-aurora-magenta)' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Transactions */}
      {expanded && (
        <div style={{ padding: '0 14px 10px' }}>
          {loading && txns.length === 0 ? (
            <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--color-pebble)', fontSize: 11, fontWeight: 600 }}>
              Loading…
            </div>
          ) : txns.length === 0 ? (
            <div style={{ padding: '14px 0', textAlign: 'center', color: 'var(--color-pebble)', fontSize: 11, fontWeight: 600 }}>
              No transactions found
            </div>
          ) : (
            txns.slice(0, 6).map(tx => <TxRow key={tx.hash} tx={tx} />)
          )}
        </div>
      )}
    </div>
  );
}

export default function WatchlistPanel({ wallets, onAdd, onRemove, autoWhales = [], onToggleAuto, autoEnabled }) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const isAuto = (addr) => autoWhales.includes(ACTIVE.kind === 'evm' ? (addr || '').toLowerCase() : addr);

  const handleAdd = () => {
    // EVM chains use 0x…40-hex; Solana uses base58 (32–44 chars)
    const isEvm = ACTIVE.kind === 'evm';
    const addr = isEvm ? input.trim().toLowerCase() : input.trim();
    const valid = isEvm ? /^0x[0-9a-f]{40}$/i.test(addr) : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
    if (!valid) {
      setError(isEvm ? 'Invalid address — enter a 42-character 0x address.' : 'Invalid address — enter a Solana base58 address.');
      return;
    }
    if (wallets.includes(addr)) {
      setError('This address is already on your list.');
      return;
    }
    setError('');
    onAdd(addr);
    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Input */}
      <div style={{ padding: '0 16px 12px', flexShrink: 0 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => { setInput(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="0x… add whale address"
            style={{
              flex: 1, padding: '10px 13px', borderRadius: 12, minWidth: 0,
              border: `1px solid ${error ? 'var(--color-aurora-magenta)' : 'var(--color-silver-lining)'}`,
              background: 'var(--color-paper-white)',
              color: 'var(--color-midnight-ink)', fontSize: 11, fontFamily: 'monospace', fontWeight: 600,
              outline: 'none',
              boxShadow: 'var(--shadow-md)',
            }}
          />
          <button
            onClick={handleAdd}
            style={{
              padding: '10px 14px', borderRadius: 12, border: 'none', flexShrink: 0,
              background: 'var(--color-tidewater-navy)',
              color: 'var(--color-paper-white)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            Add
          </button>
        </div>
        {error && (
          <p style={{ fontSize: 10, color: 'var(--color-aurora-magenta)', margin: '6px 0 0', lineHeight: 1.4, fontWeight: 600 }}>
            {error}
          </p>
        )}
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0 16px', scrollbarWidth: 'none' }}>
        {wallets.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 36, textAlign: 'center' }}>
            <Waves size={40} strokeWidth={1.5} color="var(--color-pebble)" />
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-midnight-ink)', margin: 0, fontFamily: '"averta standard", sans-serif' }}>Track whales</p>
            <p style={{ fontSize: 12, color: 'var(--color-pebble)', margin: 0, maxWidth: 230, lineHeight: 1.6, fontWeight: 600 }}>
              Paste a wallet address above to follow it. Its recent trades refresh automatically.
            </p>
          </div>
        ) : (
          <>
            {onToggleAuto && wallets.length > 0 && autoWhales.length > 0 && !autoEnabled && (
              <div style={{ marginBottom: 10, padding: '9px 12px', borderRadius: 12, border: '1px solid rgba(245,181,68,0.4)', background: 'rgba(245,181,68,0.08)', fontSize: 10.5, fontWeight: 700, color: '#f5b544', lineHeight: 1.5 }}>
                🤖 {autoWhales.length} whale{autoWhales.length === 1 ? '' : 's'} marked AUTO, but Auto-Copy is off — enable it in Profile to start hands-free copying.
              </div>
            )}
            {wallets.map(addr => (
              <WalletCard key={addr} wallet={addr} onRemove={onRemove} isAuto={isAuto(addr)} onToggleAuto={onToggleAuto} autoEnabled={autoEnabled} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
