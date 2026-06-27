import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import type { EquityPoint } from '../lib/analytics';
import { money, moneyCompact, pct } from '../lib/format';

type Mode = 'value' | 'return';
type Range = '1M' | '3M' | '6M' | 'YTD' | '1Y' | '3Y' | 'ALL';

interface Props {
  curve: EquityPoint[];
}

// We rebase the benchmark sims to start from the same dollar value as the
// portfolio at the period start. That way the chart shows "what would the
// same money have done in SPY/QQQ?" — not absolute index level.
function rebaseSeries(points: EquityPoint[]): EquityPoint[] {
  if (points.length === 0) return points;
  const start = points[0];
  const baseAccount = start.accountValue || 1;
  const baseSpy = start.spyValue ?? 0;
  const baseQqq = start.qqqValue ?? 0;
  return points.map((p) => ({
    ...p,
    spyValue: baseSpy === 0 ? null : ((p.spyValue ?? baseSpy) / baseSpy) * baseAccount,
    qqqValue: baseQqq === 0 ? null : ((p.qqqValue ?? baseQqq) / baseQqq) * baseAccount,
  }));
}

function returnSeries(points: EquityPoint[]): Array<{ date: string; ts: number; portfolio: number; spy: number | null; qqq: number | null }> {
  if (points.length === 0) return [];
  const base = points[0];
  const baseAcc = base.accountValue || 1;
  const baseSpy = base.spyValue ?? 0;
  const baseQqq = base.qqqValue ?? 0;
  return points.map((p) => {
    // Portfolio "return" series: cumulative gain / cumulative deposits to date.
    // This is a money-weighted approximation that matches how snowball-style
    // sites display "% gain" vs the indexes.
    const portfolioReturn = p.netDeposits > 0
      ? ((p.accountValue - p.netDeposits) / p.netDeposits) * 100
      : 0;
    const spyReturn = baseSpy > 0 && p.spyValue != null ? ((p.spyValue - baseSpy) / baseSpy) * 100 : null;
    const qqqReturn = baseQqq > 0 && p.qqqValue != null ? ((p.qqqValue - baseQqq) / baseQqq) * 100 : null;
    void baseAcc;
    return { date: p.date, ts: p.ts, portfolio: portfolioReturn, spy: spyReturn, qqq: qqqReturn };
  });
}

function filterByRange(points: EquityPoint[], range: Range): EquityPoint[] {
  if (points.length === 0 || range === 'ALL') return points;
  const last = points[points.length - 1];
  let cutoffTs = 0;
  if (range === 'YTD') {
    const yr = last.date.slice(0, 4);
    cutoffTs = new Date(`${yr}-01-01T00:00:00Z`).getTime();
  } else {
    const days = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365, '3Y': 365 * 3 }[range];
    cutoffTs = last.ts - days * 86_400_000;
  }
  const filtered = points.filter((p) => p.ts >= cutoffTs);
  return filtered.length > 0 ? filtered : points.slice(-1);
}

const RANGES: Range[] = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', 'ALL'];

export function EquityChart({ curve }: Props) {
  const [mode, setMode] = useState<Mode>('value');
  const [range, setRange] = useState<Range>('ALL');

  const scoped = useMemo(() => filterByRange(curve, range), [curve, range]);
  const valueData = useMemo(() => rebaseSeries(scoped), [scoped]);
  const retData = useMemo(() => returnSeries(scoped), [scoped]);

  if (curve.length === 0) {
    return (
      <div className="card">
        <h3>Equity vs benchmarks</h3>
        <div className="dim" style={{ padding: 40, textAlign: 'center' }}>No data yet.</div>
      </div>
    );
  }

  return (
    <div className="card">
      <h3>
        <span>Equity vs benchmarks</span>
        <span className="actions">
          <button className={mode === 'value' ? 'active' : ''} onClick={() => setMode('value')}>Value</button>
          <button className={mode === 'return' ? 'active' : ''} onClick={() => setMode('return')}>% Return</button>
        </span>
      </h3>
      <div className="pill-row" style={{ marginBottom: 12 }}>
        {RANGES.map((r) => (
          <button
            key={r}
            className={range === r ? 'active' : ''}
            style={{ padding: '4px 10px', fontSize: 11 }}
            onClick={() => setRange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <div style={{ width: '100%', height: 360 }}>
        <ResponsiveContainer>
          {mode === 'value' ? (
            <LineChart data={valueData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#a8b2bf', fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: '#a8b2bf', fontSize: 11 }} tickFormatter={(v) => moneyCompact(Number(v))} width={70} />
              <Tooltip content={<ValueTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="accountValue" name="Portfolio" stroke="#4f8bff" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="spyValue" name="S&P 500" stroke="#3ddc97" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="qqqValue" name="NASDAQ 100" stroke="#c490ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="netDeposits" name="Net deposits" stroke="#6e7681" strokeWidth={1} dot={false} strokeDasharray="4 4" isAnimationActive={false} />
            </LineChart>
          ) : (
            <LineChart data={retData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fill: '#a8b2bf', fontSize: 11 }} minTickGap={32} />
              <YAxis tick={{ fill: '#a8b2bf', fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(0)}%`} width={50} />
              <Tooltip content={<ReturnTooltip />} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="#6e7681" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="portfolio" name="Portfolio" stroke="#4f8bff" strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="spy" name="S&P 500" stroke="#3ddc97" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="qqq" name="NASDAQ 100" stroke="#c490ff" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function ValueTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const byKey: Record<string, number | null> = {};
  for (const p of payload) byKey[p.dataKey] = p.value;
  return (
    <div className="tooltip">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div className="row"><span className="name">Portfolio</span><span>{money(byKey.accountValue ?? null)}</span></div>
      <div className="row"><span className="name">S&P 500</span><span>{money(byKey.spyValue ?? null)}</span></div>
      <div className="row"><span className="name">NASDAQ 100</span><span>{money(byKey.qqqValue ?? null)}</span></div>
      <div className="row"><span className="name">Net deposits</span><span>{money(byKey.netDeposits ?? null)}</span></div>
    </div>
  );
}

function ReturnTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const byKey: Record<string, number | null> = {};
  for (const p of payload) byKey[p.dataKey] = p.value;
  return (
    <div className="tooltip">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div className="row"><span className="name">Portfolio</span><span>{pct(byKey.portfolio ?? null)}</span></div>
      <div className="row"><span className="name">S&P 500</span><span>{pct(byKey.spy ?? null)}</span></div>
      <div className="row"><span className="name">NASDAQ 100</span><span>{pct(byKey.qqq ?? null)}</span></div>
    </div>
  );
}
