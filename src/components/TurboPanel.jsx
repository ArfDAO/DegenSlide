import { useCallback, useEffect, useState } from 'react';
import { X, Zap, Copy, Check, Download, ArrowUpRight, ShieldAlert } from 'lucide-react';
import { ACTIVE } from '../config/chain.js';
import {
  hasTurboAgreement, acceptTurboAgreement, ensureTurboWallet, turboWalletExists,
  getTurboAddress, getTurboBalance, depositToTurbo, withdrawTurbo, exportTurboKey,
} from '../services/turboWallet.js';

const TERMS = [
  `One-swipe trading: after this setup, every COPY / ALL-IN swipe executes IMMEDIATELY on-chain with no further confirmations.`,
  `A dedicated Turbo trading wallet is generated and stored only in this browser (localStorage). Anyone with access to this device or its browser data can control its funds.`,
  `Deposit only what you can afford to lose. Meme-token trading is extremely volatile and can go to zero.`,
  `You are self-custodial: back up the private key (Export) — clearing browser data without a backup permanently destroys access to the funds.`,
  `Software is provided as-is, no warranty; you are solely responsible for your keys and every trade executed by your swipes.`,
];

/**
 * Turbo wallet setup + management. mode 'setup' walks agreement → fund;
 * mode 'manage' shows balance / deposit / withdraw / export.
 * Funding is the ONE transfer the user's main wallet still confirms.
 */
export default function TurboPanel({ open, onClose, walletAddress, onConnect, onReady, showToast }) {
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState('terms'); // terms | fund
  const [balance, setBalance] = useState(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState(null);

  const refresh = useCallback(() => { getTurboBalance().then(setBalance); }, []);

  useEffect(() => {
    if (!open) return;
    setExported(null); setCopied(false); setBusy(false);
    if (hasTurboAgreement()) {
      // agreement is device-wide — a chain switch just needs its own keypair
      if (!turboWalletExists()) ensureTurboWallet();
      setStep('fund'); refresh();
    } else { setStep('terms'); setAgreed(false); }
  }, [open, refresh]);

  useEffect(() => {
    if (!open || step !== 'fund') return;
    const id = setInterval(refresh, 8000);
    return () => clearInterval(id);
  }, [open, step, refresh]);

  if (!open) return null;

  const addr = turboWalletExists() ? getTurboAddress() : null;
  const sym = ACTIVE.nativeSymbol;
  const quicks = ACTIVE.copyTiers.map((t) => t.value * 5);

  const doAccept = () => {
    acceptTurboAgreement();
    ensureTurboWallet();
    setStep('fund');
    refresh();
  };
  const doDeposit = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { showToast?.('tx_error', 'Enter a deposit amount'); return; }
    let from = walletAddress;
    if (!from && onConnect) { const ok = await onConnect(); if (!ok) return; }
    if (!from) return;
    setBusy(true);
    try {
      await depositToTurbo(from, amt);
      showToast?.('tx_sent', `Deposited ${amt} ${sym} to Turbo`);
      setAmount('');
      refresh();
      onReady?.();
    } catch (e) {
      if (e.code !== 4001) showToast?.('tx_error', 'Deposit failed');
    } finally { setBusy(false); }
  };
  const doWithdraw = async () => {
    if (!walletAddress) { showToast?.('tx_error', 'Connect your main wallet first'); return; }
    setBusy(true);
    try {
      const { amount: out } = await withdrawTurbo(walletAddress);
      showToast?.('tx_sent', `Withdrew ${out.toFixed(4)} ${sym}`);
      refresh();
    } catch (e) {
      showToast?.('tx_error', e.message === 'NO_BALANCE' ? 'Nothing to withdraw' : 'Withdraw failed');
    } finally { setBusy(false); }
  };

  const row = { display: 'flex', alignItems: 'center', gap: 8 };
  const btn = (primary) => ({
    flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer',
    background: primary ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)',
    color: primary ? '#fff' : 'var(--color-midnight-ink)',
  });

  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 90, background: 'rgba(2,4,10,0.6)', backdropFilter: 'blur(6px)' }} />
      <div className="animate-slide-up-modal" style={{ position: 'absolute', left: 14, right: 14, top: '8%', bottom: '10%', zIndex: 91, background: 'var(--surface-1)', borderRadius: 24, border: '1px solid var(--line-1)', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ ...row, justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid var(--line-2)' }}>
          <span style={{ ...row, fontSize: 15, fontWeight: 800, color: 'var(--color-midnight-ink)' }}>
            <Zap size={16} style={{ color: '#f5b544' }} /> Turbo · 1-Swipe Trading
          </span>
          <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: 15, background: 'var(--color-frost-shadow)', border: 'none', display: 'grid', placeItems: 'center', cursor: 'pointer', color: 'var(--color-pebble)' }}><X size={16} /></button>
        </div>

        <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {step === 'terms' ? (
            <>
              <div style={{ ...row, gap: 10, background: 'var(--gold-soft, rgba(245,181,68,0.12))', border: '1px solid rgba(245,181,68,0.35)', borderRadius: 12, padding: '10px 12px', marginBottom: 14 }}>
                <ShieldAlert size={18} style={{ color: '#f5b544', flexShrink: 0 }} />
                <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--color-midnight-ink)', lineHeight: 1.5 }}>
                  Accept once — after that, swipes trade instantly with no wallet popups.
                </span>
              </div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Turbo Trading Agreement</div>
              <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 9 }}>
                {TERMS.map((t, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--color-midnight-ink)', fontWeight: 500, lineHeight: 1.55 }}>{t}</li>
                ))}
              </ol>
              <label style={{ ...row, gap: 10, marginTop: 16, cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--color-tidewater-navy)' }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-midnight-ink)' }}>I have read and accept the Turbo Trading Agreement.</span>
              </label>
            </>
          ) : (
            <>
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Turbo balance</div>
                <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--color-midnight-ink)', fontFamily: '"JetBrains Mono", monospace', marginTop: 2 }}>
                  {balance == null ? '…' : `${balance.toFixed(4)} ${sym}`}
                </div>
                {balance != null && balance > 0 && (
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--up)', marginTop: 2 }}>⚡ Turbo active — swipes execute instantly</div>
                )}
              </div>

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Turbo wallet address</div>
              <button onClick={() => { navigator.clipboard?.writeText(addr); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                style={{ ...row, width: '100%', justifyContent: 'space-between', background: 'var(--color-frost-shadow)', border: '1px solid var(--color-silver-lining)', borderRadius: 10, padding: '9px 12px', cursor: 'pointer', marginBottom: 14 }}>
                <span style={{ fontSize: 11, fontFamily: '"JetBrains Mono", monospace', fontWeight: 700, color: 'var(--color-midnight-ink)', overflow: 'hidden', textOverflow: 'ellipsis' }}>{addr}</span>
                {copied ? <Check size={13} color="var(--up)" /> : <Copy size={13} color="var(--color-pebble)" />}
              </button>

              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-pebble)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Deposit from your wallet (1 confirmation)</div>
              <div style={{ ...row, marginBottom: 8 }}>
                {quicks.map((q) => (
                  <button key={q} onClick={() => setAmount(String(q))} style={{ ...btn(String(q) === amount), padding: '9px 0' }}>{q} {sym}</button>
                ))}
                <input type="text" inputMode="decimal" placeholder="Custom" value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  style={{ flex: 1, padding: '9px 8px', borderRadius: 12, border: '1px solid var(--color-silver-lining)', background: 'var(--color-frost-shadow)', color: 'var(--color-midnight-ink)', fontSize: 12.5, fontWeight: 700, textAlign: 'center', outline: 'none', minWidth: 0 }} />
              </div>
              <button onClick={doDeposit} disabled={busy} style={{ ...btn(true), width: '100%', opacity: busy ? 0.6 : 1 }}>
                {busy ? 'Waiting…' : `Deposit ${amount || '—'} ${sym}`}
              </button>

              <div style={{ ...row, marginTop: 14 }}>
                <button onClick={doWithdraw} disabled={busy} style={{ ...btn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <ArrowUpRight size={13} /> Withdraw all
                </button>
                <button onClick={() => setExported(exportTurboKey())} style={{ ...btn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Download size={13} /> Export key
                </button>
              </div>
              {exported && (
                <div style={{ marginTop: 10, background: 'var(--color-frost-shadow)', border: '1px solid var(--color-silver-lining)', borderRadius: 10, padding: '10px 12px' }}>
                  <div style={{ fontSize: 9.5, fontWeight: 800, color: 'var(--down)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Private key — never share this</div>
                  <div style={{ fontSize: 10, fontFamily: '"JetBrains Mono", monospace', color: 'var(--color-midnight-ink)', wordBreak: 'break-all', userSelect: 'all' }}>{exported}</div>
                </div>
              )}
              <p style={{ fontSize: 10, color: 'var(--color-pebble)', fontWeight: 600, lineHeight: 1.5, marginTop: 12, marginBottom: 0 }}>
                Swipes spend from this wallet with no confirmations. Keep only active trading funds here.
              </p>
            </>
          )}
        </div>

        {step === 'terms' && (
          <div style={{ padding: '0 18px 16px' }}>
            <button onClick={doAccept} disabled={!agreed} style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: 'none', fontSize: 14, fontWeight: 800, cursor: agreed ? 'pointer' : 'default', background: agreed ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: agreed ? '#fff' : 'var(--color-pebble)' }}>
              Accept & create Turbo wallet
            </button>
          </div>
        )}
        {step === 'fund' && (
          <div style={{ padding: '0 18px 16px' }}>
            <button onClick={onClose} style={{ width: '100%', padding: '12px 0', borderRadius: 14, border: 'none', fontSize: 13.5, fontWeight: 800, cursor: 'pointer', background: (balance || 0) > 0 ? 'var(--color-tidewater-navy)' : 'var(--color-frost-shadow)', color: (balance || 0) > 0 ? '#fff' : 'var(--color-midnight-ink)' }}>
              {(balance || 0) > 0 ? '⚡ Start swiping' : 'Close'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
