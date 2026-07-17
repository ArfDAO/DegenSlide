/**
 * Shareable PnL card — renders a position's REAL numbers onto a 1200×675
 * canvas (X/Twitter-friendly 16:9) and hands it to the native share sheet on
 * mobile, or downloads a PNG elsewhere. Pure client-side; nothing leaves the
 * device unless the user shares it.
 */
import { ACTIVE } from '../config/chain.js';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const fmtUsd = (v) => {
  if (v == null) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return `$${v.toFixed(2)}`;
  return `$${v.toFixed(4)}`;
};

export async function sharePnlCard({ symbol, pnlPct, pnlUsd, investedUsd, currentValue, heldDays }) {
  const W = 1200, H = 675;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const up = (pnlPct ?? 0) >= 0;
  const accent = up ? '#2fe6a8' : '#ff5d7d';

  // ── background: app-dark with a soft accent glow ──
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0b0e16');
  bg.addColorStop(1, '#131a2b');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.82, H * 0.2, 60, W * 0.82, H * 0.2, 520);
  glow.addColorStop(0, up ? 'rgba(47,230,168,0.16)' : 'rgba(255,93,125,0.16)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(W * 0.1, H * 0.9, 40, W * 0.1, H * 0.9, 480);
  glow2.addColorStop(0, 'rgba(109,93,246,0.18)');
  glow2.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // subtle card frame
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, 24, 24, W - 48, H - 48, 28);
  ctx.stroke();

  // ── brand ──
  ctx.fillStyle = '#8b7dff';
  ctx.font = '800 34px "Space Grotesk", Inter, sans-serif';
  ctx.fillText('🐋 DegenSlide', 72, 106);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '600 22px "JetBrains Mono", monospace';
  ctx.fillText(`${ACTIVE.label.toUpperCase()} · COPY-TRADE`, 72, 142);

  // ── token + PnL ──
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 64px "Space Grotesk", Inter, sans-serif';
  ctx.fillText(`$${symbol}`, 72, 268);

  ctx.fillStyle = accent;
  ctx.font = '800 148px "JetBrains Mono", monospace';
  const pctText = pnlPct == null ? '—' : `${up ? '+' : ''}${pnlPct.toFixed(1)}%`;
  ctx.shadowColor = up ? 'rgba(47,230,168,0.45)' : 'rgba(255,93,125,0.45)';
  ctx.shadowBlur = 42;
  ctx.fillText(pctText, 66, 420);
  ctx.shadowBlur = 0;

  ctx.fillStyle = accent;
  ctx.font = '700 40px "JetBrains Mono", monospace';
  ctx.fillText(pnlUsd == null ? '' : `${up ? '+' : ''}${fmtUsd(pnlUsd)}`, 72, 482);

  // ── stat wells ──
  const wells = [
    { label: 'INVESTED', value: fmtUsd(investedUsd) },
    { label: 'VALUE NOW', value: fmtUsd(currentValue) },
    { label: 'HELD', value: heldDays != null ? (heldDays < 1 ? `${Math.max(1, Math.round(heldDays * 24))}h` : `${Math.round(heldDays)}d`) : '—' },
  ];
  const wellW = 300, wellH = 96, gap = 24, startX = 72, y0 = 520;
  wells.forEach((w, i) => {
    const x = startX + i * (wellW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    roundRect(ctx, x, y0, wellW, wellH, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y0, wellW, wellH, 18);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '700 18px "JetBrains Mono", monospace';
    ctx.fillText(w.label, x + 22, y0 + 36);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 32px "JetBrains Mono", monospace';
    ctx.fillText(w.value, x + 22, y0 + 76);
  });

  // ── footer ──
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.fillText('swipe · copy · profit', 72, H - 44);
  const d = new Date();
  const dateStr = d.toISOString().slice(0, 10);
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, W - 72, H - 44);
  ctx.textAlign = 'left';

  // ── export: native share sheet on mobile, PNG download elsewhere ──
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('CARD_RENDER_FAILED');
  const file = new File([blob], `degenslide-${symbol}-pnl.png`, { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `$${symbol} on DegenSlide`, text: `$${symbol} ${pctText} on DegenSlide 🐋` });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled'; // user closed the sheet — not an error
      // fall through to download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'downloaded';
}
