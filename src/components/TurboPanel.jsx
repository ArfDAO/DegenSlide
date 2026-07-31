import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, Download, ArrowUpRight, ShieldAlert, Link2, RefreshCw, Fingerprint, Zap, KeyRound, RotateCcw, FileWarning } from 'lucide-react';
import { ACTIVE } from '../config/chain.js';
import { WALLET_NAME } from '../services/activeWallet.js';
import {
  acceptTurboAgreement, turboWalletExists,
  linkTurboWallet, isTurboLinked, getLinkedAddress,
  depositToTurbo, withdrawTurbo, exportTurboKey,
} from '../services/turboWallet.js';

const TERMS = [
  { icon: Fingerprint, title: 'Derived, not custodial', desc: `A one-time signature from your ${WALLET_NAME} wallet derives this trading wallet. Re-sign the same wallet on any device to restore it — funds are never trapped on one browser.` },
  { icon: Zap, title: 'Instant execution', desc: 'Every COPY / ALL-IN swipe executes immediately on-chain — no further confirmations.' },
  { icon: KeyRound, title: 'Device-local key', desc: 'The derived key is cached in this browser. Anyone with access to this device can control its funds — deposit only what you can afford to lose.' },
  { icon: RotateCcw, title: 'You control recovery', desc: 'Recover the wallet any time by reconnecting and re-signing, or back up the raw key with Export.' },
  { icon: FileWarning, title: 'No warranty', desc: 'Provided as-is. You are solely responsible for your keys and every trade your swipes execute.' },
];

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');

/* ── themed checkbox — square, bone-glow when checked, matches Toggle's palette ── */
function Checkbox({ checked, onChange }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} style={{
      width: 18, height: 18, flexShrink: 0, borderRadius: 4, padding: 0, cursor: 'pointer',
      display: 'grid', placeItems: 'center', transition: 'background 0.15s, border-color 0.15s',
      background: checked ? 'var(--color-bone-glow)' : 'transparent',
      border: `1px solid ${checked ? 'var(--color-bone-glow)' : 'var(--color-charcoal-vein)'}`,
    }}>
      {checked && <Check size={12} strokeWidth={3} color="var(--color-midnight-carbon)" />}
    </button>
  );
}

/**
 * Turbo actions — inline section rendered inside the Profile identity card
 * (under the balance chart).
 *
 *   • Not created yet → agreement + "Create my trading wallet": signs one
 *     gasless message with the ACCOUNT's Privy embedded wallet and DERIVES the
 *     trading wallet from it (recoverable by signing back in, on any device).
 *     This normally happens automatically at login — this is the manual retry.
 *   • Created → deposit / withdraw / export. Deposits can come from any wallet;
 *     linking an external wallet is optional and never changes this wallet.
 */
// `externalWallet` is the LINKED funding address (it survives logout);
// `externalConnected` says whether that wallet can actually sign right now.
// After a re-login it is normal to be linked-but-not-connected — the deposit
// flow reconnects rather than trying to link a second wallet.
export default function TurboActions({ externalWallet, externalConnected, accountAddress, onConnect, showToast, onChanged, turboBalance, turboAddress }) {
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

  // Derive the trading wallet from the ACCOUNT (the Privy embedded wallet), not
  // from an external wallet — that is what makes it recoverable by simply
  // signing back in with the same social account, and why linking or unlinking
  // an external wallet can never change which trading wallet you own. This
  // normally runs automatically at login; the button is the manual retry.
  const doLink = useCallback(async () => {
    // Not signed in yet → open the Privy sign-in / sign-up modal instead of
    // dead-ending on a toast. Once they're in, the account wallet appears and
    // the login effect derives the trading wallet on its own.
    if (!accountAddress) { await onConnect?.(); return; }
    setBusy(true);
    try {
      acceptTurboAgreement();
      await linkTurboWallet(accountAddress);
      refreshLinkState();
      onChanged?.();
      showToast?.('connect', '⚡ Trading wallet ready');
    } catch (e) {
      if (e?.message === 'SIGN_FAILED') showToast?.('tx_error', 'Signature failed — try again');
      else if (e?.code !== 4001) showToast?.('tx_error', 'Could not create your trading wallet');
    } finally { setBusy(false); }
  }, [accountAddress, onConnect, showToast, onChanged, refreshLinkState]);




  const doDeposit = async () => {
    const amt = parseFloat(amount);
    if (!(amt > 0)) { showToast?.('tx_error', 'Enter a deposit amount'); return; }
    // Need a wallet that is linked AND connected. Missing either one routes
    // through onConnect(), which links or reconnects as appropriate; it returns
    // null while its modal is open, so we stop and let the user retry after.
    let from = externalConnected ? externalWallet : null;
    if (!from && onConnect) { from = await onConnect(); if (!from) return; }
    if (!from) return;
    setBusy(true);
    try {
      await depositToTurbo(from, amt);
      showToast?.('tx_sent', `Deposited ${amt} ${sym} to Turbo`);
      setAmount('');
      onChanged?.();
    } catch (e) {
      // A bare "Deposit failed" hid the two real causes (wrong network, or the
      // linked wallet not actually reconnected this session) — name them.
      if (e.code === 4001) { /* user rejected in their wallet — not an error */ }
      else if (e.message === 'WRONG_NETWORK') showToast?.('tx_error', `Switch your wallet to ${ACTIVE.label} and try again`);
      else if (e.message === 'NO_WALLET') showToast?.('tx_error', 'Reconnect your wallet to deposit');
      else if (e.message === 'INSUFFICIENT_FUNDS') showToast?.('no_funds', `Not enough ${sym} in that wallet`);
      else showToast?.('tx_error', 'Deposit failed');
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
            Your trading wallet is created from your account — sign in with the same social login on any device to recover it and its funds. No external wallet needed.
          </span>
        </div>

        {/* Legacy local-only key: warn before we overwrite it with the derived key */}
        {legacyUnlinked && (
          <div style={{ background: 'var(--surface-2)', border: '1px solid rgba(255, 77, 106, 0.35)', borderRadius: 10, padding: '11px 12px', marginBottom: 10 }}>
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
              <div style={{ marginTop: 8, border: '1px solid rgba(255, 77, 106, 0.45)', borderRadius: 8, padding: '9px 11px' }}>
                <div style={{ fontSize: 9.5, fontWeight: 400, color: 'var(--down)', textTransform: 'uppercase', letterSpacing: '-0.3px', fontFamily: MONO, marginBottom: 4 }}>Private key — never share this</div>
                <div style={{ fontSize: 9.5, fontFamily: MONO, color: 'var(--color-bone-glow)', wordBreak: 'break-all', userSelect: 'all' }}>{exported}</div>
              </div>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 9, cursor: 'pointer', userSelect: 'none' }}>
              <Checkbox checked={legacyBackedUp} onChange={setLegacyBackedUp} />
              <span style={{ fontSize: 10.5, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>I've backed up or emptied my current wallet.</span>
            </label>
          </div>
        )}

        {/* Key terms — scannable rows instead of a paragraph wall */}
        <div style={{ background: 'var(--surface-2)', borderRadius: 10, padding: '4px 12px' }}>
          {TERMS.map((t, i) => {
            const Icon = t.icon;
            return (
              <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: i === 0 ? 'none' : '1px solid var(--color-charcoal-vein)' }}>
                <div style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 6, display: 'grid', placeItems: 'center', background: 'var(--surface-3)', marginTop: 1 }}>
                  <Icon size={12} color="var(--color-bone-glow)" />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>{t.title}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--color-bone-dim)', fontWeight: 400, lineHeight: 1.4, marginTop: 2 }}>{t.desc}</div>
                </div>
              </div>
            );
          })}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, cursor: 'pointer', userSelect: 'none' }}>
          <Checkbox checked={agreed} onChange={setAgreed} />
          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-bone-glow)', fontFamily: 'var(--font-arbeit-contrast)' }}>I have read and accept the Turbo Trading Agreement.</span>
        </label>
        <button onClick={doLink} disabled={!canActivate || busy}
          style={{ ...btn(canActivate), width: '100%', marginTop: 10, padding: '12px 0', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, cursor: canActivate && !busy ? 'pointer' : 'default', opacity: busy ? 0.6 : 1, ...(canActivate ? {} : { color: 'var(--color-bone-dim)' }) }}>
          <Link2 size={14} /> {busy ? 'Creating…' : accountAddress ? 'Create my trading wallet' : 'Sign in to create your wallet'}
        </button>
        <p style={{ fontSize: 9.5, color: 'var(--color-bone-dim)', fontWeight: 400, lineHeight: 1.45, margin: '9px 0 0' }}>
          {accountAddress
            ? 'Free and gasless — it never sends a transaction or spends funds. It just derives your wallet from the account you signed in with.'
            : 'Sign in or sign up with Google, X, Discord, GitHub or email — then your trading wallet is created from that account.'}
        </p>
      </div>
    );
  }

  /* ── STATE B: linked — deposit / withdraw / export ── */
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--color-charcoal-vein)' }}>
      {/* Account badge. The trading wallet derives from the ACCOUNT, so it
         differing from a linked funding wallet is normal — the old "connected:"
         mismatch warning here was meaningless under that model (they always
         differ) and it printed a merely-detected extension address. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, padding: '7px 10px', border: '1px solid var(--color-charcoal-vein)' }}>
        <Link2 size={12} style={{ color: 'var(--color-bone-glow)', flexShrink: 0 }} />
        <span style={{ ...LABEL, color: 'var(--color-bone-dim)' }}>Saved to your account</span>
        {externalWallet && (
          <span style={{ fontSize: 9, fontFamily: MONO, color: 'var(--color-bone-dim)', marginLeft: 'auto' }}>
            funding: {short(externalWallet)}{externalConnected ? '' : ' · offline'}
          </span>
        )}
      </div>

      {/* With no external wallet linked (a pure social login), sending to this
         address IS the way to fund the wallet — so it is spelled out, copyable,
         rather than referred to as "the address above". */}
      <p style={{ ...LABEL, margin: '0 0 6px' }}>Deposit · send {sym} to your trading wallet</p>
      {turboAddress && (
        <button onClick={() => { try { navigator.clipboard?.writeText(turboAddress); showToast?.('connect', 'Address copied'); } catch { /* clipboard blocked */ } }}
          title="Copy your trading wallet address"
          style={{ ...btn(false), width: '100%', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 10 }}>
          <Copy size={11} /> {short(turboAddress)}
        </button>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {quicks.map((q) => (
          <button key={q} onClick={() => setAmount(String(q))} style={btn(String(q) === amount)}>{q}</button>
        ))}
        <input type="text" inputMode="decimal" placeholder="Custom" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          style={{ flex: 1.2, padding: '10px 8px', borderRadius: 9999, border: '1px solid var(--color-charcoal-vein)', background: 'transparent', color: 'var(--color-bone-glow)', fontSize: 11, fontWeight: 400, fontFamily: MONO, letterSpacing: '-0.3px', textAlign: 'center', outline: 'none', minWidth: 0 }} />
      </div>
      <button onClick={doDeposit} disabled={busy} style={{ ...btn(true), width: '100%', opacity: busy ? 0.6 : 1 }}>
        {busy ? 'Waiting…'
          : externalConnected ? `Deposit ${amount || '—'} ${sym}`
          : externalWallet ? 'Reconnect wallet to deposit'
          : 'Connect wallet to deposit'}
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
        <span>Recoverable anywhere: sign in with the same account on any device and this exact wallet comes back. Keep only active trading funds here.</span>
      </p>
    </div>
  );
}
