import { useCallback, useEffect, useState } from 'react';
import { Check, Download, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { ACTIVE } from '../config/chain.js';
import {
  hasTurboAgreement, acceptTurboAgreement, ensureTurboWallet, turboWalletExists,
  depositToTurbo, withdrawTurbo, exportTurboKey,
} from '../services/turboWallet.js';

const TERMS = [
  `One-swipe trading: every COPY / ALL-IN swipe executes IMMEDIATELY on-chain with no further confirmations.`,
  `A dedicated Turbo trading wallet is generated and stored only in this browser (localStorage). Anyone with access to this device or its browser data can control its funds.`,
  `Deposit only what you can afford to lose. Meme-token trading is extremely volatile and can go to zero.`,
  `You are self-custodial: back up the private key (Export) — clearing browser data without a backup permanently destroys access to the funds.`,
  `Software is provided as-is, no warranty; you are solely responsible for your keys and every trade executed by your swipes.`,
];

/**
 * Turbo actions — inline section rendered inside the Profile identity card
 * (under the balance chart). Shows the one-time agreement until accepted,
 * then deposit / withdraw / export. Funding is the ONE transfer the user's
 * external wallet still confirms; direct transfers work too.
 */
export default function TurboActions({ externalWallet, onConnect, showToast, onChanged }) {
  const [agreed, setAgreed] = useState(false);
  const [ready, setReady] = useState(() => hasTurboAgreement() && turboWalletExists());
  const [amount, setAmount] = useState('');
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(null);

  useEffect(() => {
    // agreement is device-wide — a chain switch just needs its own keypair
    if (hasTurboAgreement() && !turboWalletExists()) { ensureTurboWallet(); setReady(true); onChanged?.(); }
  }, [onChanged]);
  useEffect(() => { setDest((d) => d || externalWallet || ''); }, [externalWallet]);

  const sym = ACTIVE.nativeSymbol;
  const quicks = ACTIVE.copyTiers.map((t) => t.value * 5);

  const doAccept = useCallback(() => {
    acceptTurboAgreement();
    ensureTurboWallet();
    setReady(true);
    onChanged?.();
    showToast?.('connect', '⚡ Turbo wallet created — deposit to start');
  }, [onChanged, showToast]);

  const doDeposit = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { showToast?.('tx_error', 'Enter a deposit amount'); return; }
    let from = externalWallet;
    if (!from && onConnect) { const ok = await onConnect(); if (!ok) return; return; /* wallet state refreshes — tap again */ }
    if (!from) return;
    setBusy(true);
    try {
      await depositToTurbo(from, amt);
      showToast?.('tx_sent', `Deposited ${amt} ${sym} to Turbo`);
      setAmount('');
      onChanged?.();
    } catch (e) {
      if (e.code !== 4001) showToast?.('tx_error', 'Deposit failed');
    } finally { setBusy(false); }
  };

  const doWithdraw = async () => {
    const to = (dest || externalWallet || '').trim();
    if (!to) { showToast?.('tx_error', 'Enter a withdraw address'); return; }
    setBusy(true);
    try {
      const { amount: out } = await withdrawTurbo(to);
      showToast?.('tx_sent', `Withdrew ${out.toFixed(4)} ${sym}`);
      onChanged?.();
    } catch (e) {
      showToast?.('tx_error', e.message === 'NO_BALANCE' ? 'Nothing to withdraw' : 'Withdraw failed');
    } finally { setBusy(false); }
  };

  const LABEL = { fontSize: 9, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.1em' };
  const btn = (primary) => ({
    flex: 1, padding: '10px 0', borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer',
    background: primary ? 'var(--color-tidewater-navy)' : 'rgba(255,255,255,0.05)',
    border: primary ? 'none' : '1px solid var(--line-1)',
    color: primary ? '#fff' : 'var(--text-1)',
  });

  if (!ready) {
    return (
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ShieldAlert size={15} style={{ color: '#f5b544', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text-1)' }}>
            Accept once — after that, swipes trade instantly with no wallet popups.
          </span>
        </div>
        <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TERMS.map((t, i) => (
            <li key={i} style={{ fontSize: 10.5, color: 'var(--text-2)', fontWeight: 500, lineHeight: 1.5 }}>{t}</li>
          ))}
        </ol>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--color-tidewater-navy)' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-1)' }}>I have read and accept the Turbo Trading Agreement.</span>
        </label>
        <button onClick={doAccept} disabled={!agreed}
          style={{ width: '100%', marginTop: 10, padding: '12px 0', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 800, cursor: agreed ? 'pointer' : 'default', background: agreed ? 'var(--color-tidewater-navy)' : 'rgba(255,255,255,0.05)', color: agreed ? '#fff' : 'var(--text-3)' }}>
          ⚡ Accept & create Turbo wallet
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line-2)' }}>
      <p style={{ ...LABEL, margin: '0 0 6px' }}>Deposit · 1 confirmation, or send {sym} directly to the address above</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {quicks.map((q) => (
          <button key={q} onClick={() => setAmount(String(q))} style={btn(String(q) === amount)}>{q}</button>
        ))}
        <input type="text" inputMode="decimal" placeholder="Custom" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          style={{ flex: 1.2, padding: '10px 8px', borderRadius: 12, border: '1px solid var(--line-1)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-1)', fontSize: 12, fontWeight: 700, textAlign: 'center', outline: 'none', minWidth: 0 }} />
      </div>
      <button onClick={doDeposit} disabled={busy} style={{ ...btn(true), width: '100%', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Waiting…' : externalWallet ? `Deposit ${amount || '—'} ${sym}` : `Connect wallet to deposit`}
      </button>

      <p style={{ ...LABEL, margin: '12px 0 6px' }}>Withdraw to</p>
      <input type="text" placeholder={`Your ${sym} address`} value={dest} onChange={(e) => setDest(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 11px', borderRadius: 10, border: '1px solid var(--line-1)', background: 'rgba(255,255,255,0.05)', color: 'var(--text-1)', fontSize: 10.5, fontFamily: '"JetBrains Mono", monospace', fontWeight: 600, outline: 'none', marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={doWithdraw} disabled={busy} style={{ ...btn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <ArrowUpRight size={12} /> Withdraw all
        </button>
        <button onClick={() => setExported(exported ? null : exportTurboKey())} style={{ ...btn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <Download size={12} /> {exported ? 'Hide key' : 'Export key'}
        </button>
      </div>
      {exported && (
        <div style={{ marginTop: 8, background: 'rgba(255,93,125,0.06)', border: '1px solid rgba(255,93,125,0.3)', borderRadius: 10, padding: '9px 11px' }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--down)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Private key — never share this</div>
          <div style={{ fontSize: 9.5, fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-1)', wordBreak: 'break-all', userSelect: 'all' }}>{exported}</div>
        </div>
      )}
      <p style={{ fontSize: 9.5, color: 'var(--text-3)', fontWeight: 600, lineHeight: 1.5, margin: '10px 0 0' }}>
        <Check size={9} style={{ display: 'inline' }} /> Turbo active — swipes spend from this wallet with no confirmations. Keep only active trading funds here.
      </p>
    </div>
  );
}
