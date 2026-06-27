import { useState, useMemo } from 'react';

const TIER_META = {
  whale:       { label: 'WHALE',       color: '#7b61ff', bg: 'rgba(123,97,255,0.1)',  icon: '🐋' },
  pro:         { label: 'PRO',         color: '#7b61ff', bg: 'rgba(123,97,255,0.1)', icon: '⚡' },
  smart_money: { label: 'SMART $',     color: '#4b5563', bg: '#f3f4f6', icon: '🧠' },
  degen:       { label: 'DEGEN',       color: '#4b5563', bg: '#f3f4f6',  icon: '🎰' },
  fresh:       { label: 'FRESH',       color: '#4b5563', bg: '#f3f4f6',  icon: '🌱' },
};

const RANK_META = [
  { bg: 'linear-gradient(135deg, #7b61ff 0%, #5a3ee0 100%)', shadow: 'rgba(123,97,255,0.3)', label: '🥇' },
  { bg: 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)', shadow: 'rgba(156,163,175,0.3)', label: '🥈' },
  { bg: 'linear-gradient(135deg, #4b5563 0%, #374151 100%)', shadow: 'rgba(75,85,99,0.3)',  label: '🥉' },
];

const FILTERS = [
  { id: 'all',    label: 'All' },
  { id: 'whale',  label: '🐋 Whale' },
  { id: 'pro',    label: '⚡ Pro' },
  { id: 'smart_money', label: '🧠 Smart' },
];

const SORTS = [
  { id: 'profit',   label: 'Profit' },
  { id: 'winRate',  label: 'Win Rate' },
  { id: 'volume',   label: 'Volume' },
];

function parseProfitNum(profit) {
  return parseFloat(profit.replace(/[+$,K]/g, s => s === 'K' ? '000' : '')) || 0;
}

function parseVolumeNum(vol) {
  return parseFloat(vol.replace(/[\$,K]/g, s => s === 'K' ? '000' : '')) || 0;
}

function Sparkline({ data, color = '#00C087' }) {
  if (!data?.length) return null;
  const w = 56, h = 24, pad = 2;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const lastPt = pts.split(' ').pop();
  const [lx, ly] = lastPt.split(',').map(Number);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
}

function MiniBar({ value, max, color }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={{ width: 48, height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
    </div>
  );
}

function PodiumCard({ trader, rank, globalRank }) {
  const rm = RANK_META[rank];
  const tier = TIER_META[trader.tier] || TIER_META.fresh;
  return (
    <div className="flex flex-col items-center gap-1.5" style={{ flex: 1 }}>
      {/* Avatar */}
      <div className="relative">
        <div
          className="grid place-items-center rounded-2xl text-xl font-black"
          style={{
            width: rank === 0 ? 64 : 52,
            height: rank === 0 ? 64 : 52,
            background: rm.bg,
            boxShadow: `0 6px 20px ${rm.shadow}`,
            border: `2px solid ${rm.shadow.replace('0.', '0.5')}`,
            color: '#fff',
          }}
        >
          {tier.icon}
        </div>
        <div
          className="absolute -bottom-2 left-1/2 grid place-items-center rounded-full text-[10px] font-black"
          style={{
            transform: 'translateX(-50%)',
            width: 20,
            height: 20,
            background: rm.bg,
            border: `1px solid rgba(255,255,255,0.15)`,
            color: '#fff',
            fontSize: 9,
          }}
        >
          {globalRank}
        </div>
      </div>

      {/* Info */}
      <div className="text-center mt-2">
        <p className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-2)' }}>
          {trader.address.slice(0, 6)}…{trader.address.slice(-4)}
        </p>
        <p className="text-sm font-black mt-0.5" style={{ color: 'var(--text-1)' }}>{trader.profit}</p>
        <p className="text-[9px] font-bold mt-0.5" style={{ color: tier.color }}>
          {tier.label}
        </p>
      </div>

      {/* Podium base */}
      <div
        className="w-full rounded-t-lg mt-1"
        style={{
          height: rank === 0 ? 44 : rank === 1 ? 32 : 22,
          background: rm.bg,
          border: `1px solid ${rm.shadow}`,
          borderBottom: 'none',
        }}
      />
    </div>
  );
}

function TraderRow({ trader, rank }) {
  const tier = TIER_META[trader.tier] || TIER_META.fresh;
  const rm = rank <= 3 ? RANK_META[rank - 1] : null;

  return (
    <div
      className="flex items-center gap-3 rounded-2xl px-3 py-3 transition active:scale-[0.98]"
      style={{
        background: rank <= 3 ? 'rgba(0,0,0,0.025)' : 'transparent',
        border: rank <= 3 ? '1px solid rgba(0,0,0,0.06)' : '1px solid transparent',
        borderBottom: rank > 3 ? '1px solid var(--border)' : undefined,
        borderRadius: rank <= 3 ? 16 : 0,
      }}
    >
      {/* Rank */}
      <div
        className="grid place-items-center rounded-xl text-xs font-black flex-shrink-0"
        style={{
          width: 32,
          height: 32,
          background: rm ? rm.bg : 'var(--s3)',
          boxShadow: rm ? `0 3px 10px ${rm.shadow}` : 'none',
          color: '#fff',
          fontSize: rank <= 3 ? 15 : 11,
        }}
      >
        {rank <= 3 ? RANK_META[rank - 1].label : rank}
      </div>

      {/* Avatar */}
      <div
        className="grid place-items-center rounded-xl text-lg flex-shrink-0"
        style={{
          width: 40,
          height: 40,
          background: tier.bg,
          border: `1px solid ${tier.color}30`,
        }}
      >
        {tier.icon}
      </div>

      {/* Info */}
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono font-bold truncate" style={{ color: 'var(--text-1)' }}>
            {trader.address.slice(0, 8)}…{trader.address.slice(-4)}
          </span>
          <span
            className="flex-shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
            style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.color}30` }}
          >
            {tier.label}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            WR <span style={{ color: trader.winRate >= 50 ? 'var(--monad)' : 'var(--text-2)' }}>{trader.winRate}%</span>
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>·</span>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>
            {trader.tradeCount} trades
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>·</span>
          <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{trader.volume24h}</span>
        </div>
      </div>

      {/* Sparkline + profit */}
      <div className="flex flex-col items-end gap-1 flex-shrink-0">
        <Sparkline data={trader.sparkline} color={tier.color === '#7b61ff' ? '#7b61ff' : '#9ca3af'} />
        <span className="text-xs font-black" style={{ color: 'var(--text-1)' }}>{trader.profit}</span>
      </div>
    </div>
  );
}

export default function Leaderboard({ traders = [] }) {
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('profit');

  const sorted = useMemo(() => {
    let list = [...traders];
    if (filter !== 'all') list = list.filter(t => t.tier === filter);
    list.sort((a, b) => {
      if (sort === 'profit') return parseProfitNum(b.profit) - parseProfitNum(a.profit);
      if (sort === 'winRate') return b.winRate - a.winRate;
      if (sort === 'volume') return parseVolumeNum(b.volume24h) - parseVolumeNum(a.volume24h);
      return 0;
    });
    return list;
  }, [traders, filter, sort]);

  const maxWinRate = Math.max(...traders.map(t => t.winRate), 1);

  const top3 = sorted.slice(0, 3);
  const rest = sorted.slice(3);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">

      {/* ── Filter tabs ── */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {FILTERS.map(f => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className="flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition active:scale-[0.95]"
              style={{
                background: active ? 'var(--volt-dim)' : 'var(--s2)',
                border: active ? '1px solid rgba(123,97,255,0.35)' : '1px solid var(--border)',
                color: active ? 'var(--monad)' : 'var(--text-3)',
              }}
            >
              {f.label}
            </button>
          );
        })}
        <div className="w-px flex-shrink-0" style={{ background: 'var(--border)' }} />
        {SORTS.map(s => {
          const active = sort === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSort(s.id)}
              className="flex-shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold transition active:scale-[0.95]"
              style={{
                background: active ? 'rgba(123,97,255,0.1)' : 'var(--s2)',
                border: active ? '1px solid rgba(123,97,255,0.28)' : '1px solid var(--border)',
                color: active ? 'var(--monad)' : 'var(--text-3)',
              }}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {/* ── Podium (top 3) ── */}
      {top3.length >= 3 && filter === 'all' && sort === 'profit' && (
        <div className="mx-4 mb-3 rounded-[20px] px-3 pt-3"
          style={{ background: 'var(--s1)', border: '1px solid var(--border)' }}>
          <p className="text-[9px] font-black uppercase tracking-[0.45em] text-center mb-3" style={{ color: 'var(--text-3)' }}>
            Top Traders · Monad Testnet
          </p>
          <div className="flex items-end gap-2">
            {/* 2nd */}
            <PodiumCard trader={top3[1]} rank={1} globalRank={2} />
            {/* 1st */}
            <PodiumCard trader={top3[0]} rank={0} globalRank={1} />
            {/* 3rd */}
            <PodiumCard trader={top3[2]} rank={2} globalRank={3} />
          </div>
        </div>
      )}

      {/* ── List ── */}
      <div className="flex-1 overflow-y-auto px-4 pb-2" style={{ scrollbarWidth: 'none' }}>
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 pt-12 text-center">
            <span className="text-4xl">🏆</span>
            <p className="text-sm font-black" style={{ color: 'var(--text-1)' }}>No traders found</p>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Try a different filter</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {(filter === 'all' && sort === 'profit' ? rest : sorted).map((trader, i) => (
              <TraderRow
                key={trader.id}
                trader={trader}
                rank={filter === 'all' && sort === 'profit' ? i + 4 : i + 1}
              />
            ))}
          </div>
        )}

        {/* Footer note */}
        <p className="text-center text-[10px] mt-4 mb-1" style={{ color: 'var(--text-3)' }}>
          Data from Monad Testnet · Updated live
        </p>
      </div>
    </div>
  );
}
