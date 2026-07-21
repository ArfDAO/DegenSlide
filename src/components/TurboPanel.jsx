import { useCallback, useEffect, useState } from 'react';
import { Check, Download, ArrowUpRight, ShieldAlert, Link2, RefreshCw } from 'lucide-react';
import { ACTIVE } from '../config/chain.js';
import { WALLET_NAME } from '../services/activeWallet.js';
import {
  acceptTurboAgreement, turboWalletExists,
  linkTurboWallet, isTurboLinked, getLinkedAddress,
  depositToTurbo, withdrawTurbo, exportTurboKey,
} from '../services/turboWallet.js';

const TERMS = [
  `Your in-app trading wallet is DERIVED from a one-time signature by your ${WALLET_NAME} wallet. Signing the same message with the same wallet on any device restores the exact same trading wallet — your funds are never trapped on one browser.`,
  `One-swipe trading: every COPY / ALL-IN swipe executes IMMEDIATELY on-chain with no further confirmations.`,
  `The derived key is cached in this browser (localStorage) for popup-free trading. Anyone with access to this device or its browser data can control its funds — so deposit only what you can afford to lose.`,
  `You are self-custodial. You can recover the wallet any time by reconnecting and re-signing, or back up the raw key with Export.`,
  `Software is provided as-is, no warranty; you are solely responsible for your keys and every trade executed by your swipes.`,
];

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/**
 * Turbo actions — inline section rendered inside the Profile identity card
 * (under the balance chart).
 *
 *   • Not linked yet → agreement + "Connect wallet & save account": connects the
 *     external wallet, signs one gasless message, and DERIVES the trading wallet
 *     from it (recoverable anywhere).
 *   • Linked → deposit / withdraw / export, with the linked wallet shown.
 */
export default function TurboActions({ externalWallet, onConnect, showToast, onChanged, turboBalance, turboAddress }) {
  const [agreed, setAgreed] = useState(false);
  const [linked, setLinked] = useState(() => isTurboLinked());
  const [linkedAddr, setLinkedAddr] = useState(() => getLinkedAddress());
  // A trading key that predates account-linking (local-only, no external owner).
  const [legacyUnlinked, setLegacyUnlinked] = useState(() => turboWalletExists() && !isTurboLinked());
  const [legacyBackedUp, setLegacyBackedUp] = useState(false);
  const [amount, setAmount] = useState('');
  const [wdAmount, setWdAmount] = useState(''); // withdraw amount ('' = all)
  const [dest, setDest] = useState('');
  const [busy, setBusy] = useState(false);
  const [exported, setExported] = useState(null);

  useEffect(() => { setDest((d) => d || externalWallet || getLinkedAddress() || ''); }, [externalWallet]);

  const sym = ACTIVE.nativeSymbol;
  const quicks = ACTIVE.copyTiers.map((t) => t.value * 5);

  const refreshLinkState = useCallback(() => {
    setLinked(isTurboLinked());
    setLinkedAddr(getLinkedAddress());
    setLegacyUnlinked(turboWalletExists() && !isTurboLinked());
  }, []);

  // Re-sync when the account is linked or cleared elsewhere (e.g. Disconnect
  // sets the turbo address to null → this panel must flip back to "connect").
  useEffect(() => { refreshLinkState(); }, [turboAddress, refreshLinkState]);

  // Connect the external wallet (if needed), sign once, derive/link the wallet.
  const doLink = useCallback(async () => {
    let addr = externalWallet;
    if (!addr && onConnect) { addr = await onConnect(); if (!addr) return; }
    if (!addr) { showToast?.('tx_error', `Connect your ${WALLET_NAME} wallet first`); return; }
    setBusy(true);
    try {
      acceptTurboAgreement();
      await linkTurboWallet(addr);
      refreshLinkState();
      setDest((d) => d || addr);
      onChanged?.();
      showToast?.('connect', '⚡ Account saved — trading wallet linked to your wallet');
    } catch (e) {
      if (e?.code !== 4001 && e?.message !== 'SIGN_FAILED') showToast?.('tx_error', 'Could not link wallet');
      else if (e?.message === 'SIGN_FAILED') showToast?.('tx_error', 'Signature failed — try again');
    } finally { setBusy(false); }
  }, [externalWallet, onConnect, showToast, onChanged, refreshLinkState]);

  const doDeposit = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { showToast?.('tx_error', 'Enter a deposit amount'); return; }
    let from = externalWallet;
    if (!from && onConnect) { from = await onConnect(); if (!from) return; }
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
    const to = (dest || externalWallet || getLinkedAddress() || '').trim();
    if (!to) { showToast?.('tx_error', 'Enter a withdraw address'); return; }
    const amt = parseFloat(wdAmount);
    const partial = wdAmount !== '' && amt > 0;
    if (wdAmount !== '' && !(amt > 0)) { showToast?.('tx_error', 'Enter a valid amount'); return; }
    setBusy(true);
    try {
      const { amount: out } = await withdrawTurbo(to, partial ? amt : undefined);
      showToast?.('tx_sent', `Withdrew ${out.toFixed(4)} ${sym}`);
      setWdAmount('');
      onChanged?.();
    } catch (e) {
      console.error('[Withdraw] failed:', e?.message, e?.reason || '', e);
      const msg = e.message === 'NO_BALANCE' ? 'Nothing to withdraw'
        : e.message === 'INSUFFICIENT_FUNDS' ? `Not enough — you have ${Number(e.haveMon ?? 0).toFixed(4)} ${sym}`
        : e.message === 'BAD_ADDRESS' ? 'Invalid withdraw address'
        : e.message === 'BAD_AMOUNT' ? 'Enter a valid amount'
        : e.message === 'DEST_REJECTS' ? 'That address rejects transfers — use a standard wallet address'
        : e.message === 'TX_FAILED' ? 'Withdraw reverted on-chain — try a standard wallet address'
        : (e.message === 'WITHDRAW_REVERT' && e.reason) ? `Withdraw failed: ${String(e.reason).slice(0, 80)}`
        : 'Withdraw failed';
      showToast?.('tx_error', msg);
    } finally { setBusy(false); }
  };

  const MONO = 'var(--font-arbeit-technik)';
  const LABEL = { fontSize: 10, fontWeight: 400, color: 'var(--color-bone-dim)', textTransform: 'uppercase', letterSpacing: '-0.3px', fontFamily: MONO };
  const btn = (primary) => ({
    flex: 1, padding: '10px 0', borderRadius: 9999, fontSize: 11, fontWeight: 400, cursor: 'pointer',
    fontFamily: MONO, letterSpacing: '-0.3px', textTransform: 'uppercase',
    background: primary ? 'var(--color-bone-glow)' : 'transparent',
    border: primary ? '1px solid var(--color-bone-glow)' : '1px solid var(--color-charcoal-vein)',
    color: primary ? 'var(--color-midnight-carbon)' : 'var(--color-bone-glow)',
  });

  /* ── STATE A: no wallet linked yet — the "save your account" onboarding ── */
  if (!linked) {
    const canActivate = agreed && (!legacyUnlinked || legacyBackedUp);
    return (
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-charcoal-vein)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <ShieldAlert size={15} style={{ color: 'var(--color-bone-glow)', flexShrink: 0 }} />
          <span style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>
            Connect your wallet to save your account. Your trading wallet links to it — reconnect anywhere to recover it and its funds.
          </span>
        </div>

        {/* Legacy local-only key: warn before we overwrite it with the derived key */}
        {legacyUnlinked && (
          <div style={{ border: '1px solid rgba(255, 77, 106, 0.45)', padding: '9px 11px', marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 400, color: 'var(--down)', textTransform: 'uppercase', letterSpacing: '-0.3px', fontFamily: MONO, marginBottom: 5 }}>
              Existing local wallet found
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--color-bone-dim)', margin: '0 0 8px', lineHeight: 1.4 }}>
              This device already holds an unlinked trading wallet ({short(getLinkedAddress()) || 'local'}). Linking derives a NEW address from your wallet — <b style={{ color: 'var(--color-bone-glow)' }}>withdraw or export its key first</b>, or its funds become unreachable from the app.
            </p>
            <button onClick={() => setExported(exported ? null : exportTurboKey())} style={{ ...btn(false), width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Download size={12} /> {exported ? 'Hide key' : 'Export current key'}
            </button>
            {exported && (
              <div style={{ marginTop: 8, border: '1px solid rgba(255, 77, 106, 0.45)', padding: '9px 11px' }}>
                <div style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--down)', textTransform: 'uppercase', letterSpacing: '-0.3px', fontFamily: MONO, marginBottom: 4 }}>Private key — never share this</div>
                <div style={{ fontSize: 9.5, fontFamily: MONO, color: 'var(--color-bone-glow)', wordBreak: 'break-all', userSelect: 'all' }}>{exported}</div>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, cursor: 'pointer', userSelect: 'none' }}>
              <input type="checkbox" checked={legacyBackedUp} onChange={(e) => setLegacyBackedUp(e.target.checked)} style={{ width: 14, height: 14, accentColor: 'var(--color-bone-glow)' }} />
              <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>I've backed up or emptied my current wallet.</span>
            </label>
          </div>
        )}

        <ol style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {TERMS.map((t, i) => (
            <li key={i} style={{ fontSize: 10.5, color: 'var(--color-bone-dim)', fontWeight: 400, lineHeight: 1.45 }}>{t}</li>
          ))}
        </ol>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, cursor: 'pointer', userSelect: 'none' }}>
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: 15, height: 15, accentColor: 'var(--color-bone-glow)' }} />
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>I have read and accept the Turbo Trading Agreement.</span>
        </label>
        <button onClick={doLink} disabled={!canActivate || busy}
          style={{ ...btn(canActivate), width: '100%', marginTop: 10, padding: '12px 0', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: canActivate && !busy ? 'pointer' : 'default', opacity: busy ? 0.6 : 1, ...(canActivate ? {} : { color: 'var(--color-bone-dim)' }) }}>
          <Link2 size={14} /> {busy ? 'Signing…' : externalWallet ? 'Sign to save account' : `Connect ${WALLET_NAME} & save account`}
        </button>
        <p style={{ fontSize: 9.5, color: 'var(--color-bone-dim)', fontWeight: 400, lineHeight: 1.45, margin: '9px 0 0' }}>
          Signing is free and gasless — it never sends a transaction or spends funds. It only proves you own the wallet.
        </p>
      </div>
    );
  }

  /* ── STATE B: linked — deposit / withdraw / export ── */
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-charcoal-vein)' }}>
      {/* linked-wallet badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '7px 10px', border: '1px solid var(--color-charcoal-vein)' }}>
        <Link2 size={12} style={{ color: 'var(--color-bone-glow)', flexShrink: 0 }} />
        <span style={{ ...LABEL, color: 'var(--color-bone-dim)' }}>Saved · linked to</span>
        <span style={{ fontSize: 11, fontFamily: MONO, color: 'var(--color-bone-glow)', letterSpacing: '-0.3px' }}>{short(linkedAddr)}</span>
        {externalWallet && linkedAddr && externalWallet.toLowerCase() !== linkedAddr.toLowerCase() && (
          <span style={{ fontSize: 9, fontFamily: MONO, color: 'var(--down)', marginLeft: 'auto' }}>connected: {short(externalWallet)}</span>
        )}
      </div>

      <p style={{ ...LABEL, margin: '0 0 6px' }}>Deposit · 1 confirmation, or send {sym} directly to the address above</p>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {quicks.map((q) => (
          <button key={q} onClick={() => setAmount(String(q))} style={btn(String(q) === amount)}>{q}</button>
        ))}
        <input type="text" inputMode="decimal" placeholder="Custom" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          style={{ flex: 1.2, padding: '10px 8px', borderRadius: 9999, border: '1px solid var(--color-charcoal-vein)', background: 'transparent', color: 'var(--color-bone-glow)', fontSize: 11, fontWeight: 400, fontFamily: MONO, letterSpacing: '-0.3px', textAlign: 'center', outline: 'none', minWidth: 0 }} />
      </div>
      <button onClick={doDeposit} disabled={busy} style={{ ...btn(true), width: '100%', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Waiting…' : externalWallet ? `Deposit ${amount || '—'} ${sym}` : `Connect wallet to deposit`}
      </button>

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '12px 0 6px' }}>
        <p style={{ ...LABEL, margin: 0 }}>Withdraw to</p>
        <span style={{ fontSize: 10, fontFamily: MONO, color: 'var(--color-bone-dim)', letterSpacing: '-0.3px' }}>
          Available: <span style={{ color: 'var(--color-bone-glow)' }}>{turboBalance != null ? turboBalance.toFixed(4) : '—'} {sym}</span>
        </span>
      </div>
      <input type="text" placeholder={`Your ${sym} address`} value={dest} onChange={(e) => setDest(e.target.value)}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 14px', borderRadius: 9999, border: '1px solid var(--color-charcoal-vein)', background: 'transparent', color: 'var(--color-bone-glow)', fontSize: 10.5, fontFamily: MONO, letterSpacing: '-0.3px', fontWeight: 400, outline: 'none', marginBottom: 8 }} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        <input type="text" inputMode="decimal" placeholder={`Amount (blank = all)`} value={wdAmount}
          onChange={(e) => setWdAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          style={{ flex: 1, boxSizing: 'border-box', padding: '10px 12px', borderRadius: 9999, border: '1px solid var(--color-charcoal-vein)', background: 'transparent', color: 'var(--color-bone-glow)', fontSize: 11, fontFamily: MONO, letterSpacing: '-0.3px', fontWeight: 400, textAlign: 'center', outline: 'none', minWidth: 0 }} />
        <button onClick={() => setWdAmount('')} style={{ ...btn(wdAmount === ''), flex: '0 0 auto', padding: '0 18px' }}>Max</button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={doWithdraw} disabled={busy} style={{ ...btn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, opacity: busy ? 0.6 : 1 }}>
          <ArrowUpRight size={12} /> {busy ? 'Sending…' : wdAmount ? `Withdraw ${wdAmount} ${sym}` : 'Withdraw all'}
        </button>
        <button onClick={() => setExported(exported ? null : exportTurboKey())} style={{ ...btn(false), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <Download size={12} /> {exported ? 'Hide key' : 'Export key'}
        </button>
      </div>
      {exported && (
        <div style={{ marginTop: 8, background: 'transparent', border: '1px solid rgba(255, 77, 106, 0.45)', borderRadius: 0, padding: '9px 11px' }}>
          <div style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--down)', textTransform: 'uppercase', letterSpacing: '-0.3px', fontFamily: MONO, marginBottom: 4 }}>Private key — never share this</div>
          <div style={{ fontSize: 9.5, fontFamily: MONO, color: 'var(--color-bone-glow)', wordBreak: 'break-all', userSelect: 'all' }}>{exported}</div>
        </div>
      )}
      <p style={{ fontSize: 9.5, color: 'var(--color-bone-dim)', fontWeight: 400, lineHeight: 1.45, margin: '10px 0 0', display: 'flex', gap: 5 }}>
        <RefreshCw size={10} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Recoverable anywhere: reconnect {short(linkedAddr)} on any device and re-sign to restore this exact wallet. Keep only active trading funds here.</span>
      </p>
    </div>
  );
}
