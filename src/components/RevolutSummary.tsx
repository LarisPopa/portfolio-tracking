import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Cell,
  ResponsiveContainer, ReferenceLine, LabelList,
} from 'recharts';
import type { RevolutReport, RevolutTrade, RevolutDividend } from '../lib/revolutParser';
import type { PriceSeries } from '../lib/analytics';
import { money, signClass } from '../lib/format';

// --- Benchmark helpers --------------------------------------------------------

function priceOn(series: PriceSeries, dateStr: string): number | null {
  if (series.prices.has(dateStr)) return series.prices.get(dateStr)!;
  for (let i = 1; i <= 7; i++) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const k = d.toISOString().slice(0, 10);
    if (series.prices.has(k)) return series.prices.get(k)!;
  }
  return null;
}

function benchReturn(series: PriceSeries | null, from: Date | null, to: Date | null): number | null {
  if (!series || !from || !to) return null;
  const p0 = priceOn(series, from.toISOString().slice(0, 10));
  const p1 = priceOn(series, to.toISOString().slice(0, 10));
  if (!p0 || !p1) return null;
  return ((p1 - p0) / p0) * 100;
}

// --- Colour constants ---------------------------------------------------------

const C_BLUE = '#4f8bff';
const C_GREEN = '#3ddc97';
const C_RED = '#ff6b6b';
const C_SPY = '#56d4ff';
const C_QQQ = '#c490ff';
const C_DIM = '#6e7681';

// --- Main component -----------------------------------------------------------

interface Props {
  report: RevolutReport;
  bench?: { spy: PriceSeries | null; qqq: PriceSeries | null };
}

export function RevolutSummary({ report, bench }: Props) {
  const usd = report.trades.filter(t => t.currency === 'USD');
  const eur = report.trades.filter(t => t.currency === 'EUR');

  const totalPnL     = usd.reduce((s, t) => s + t.grossPnL, 0);
  const totalPnL_EUR = eur.reduce((s, t) => s + t.grossPnL, 0);
  const totalFees    = report.trades.reduce((s, t) => s + t.fees, 0);
  const totalCostUSD = usd.reduce((s, t) => s + t.costBasis, 0);
  const totalProcUSD = usd.reduce((s, t) => s + t.grossProceeds, 0);
  const totalDivNet  = report.dividends.reduce((s, d) => s + d.netAmount, 0);
  const totalDivGross= report.dividends.reduce((s, d) => s + d.grossAmount, 0);
  const totalDivTax  = report.dividends.reduce((s, d) => s + d.withholdingTax, 0);

  // Total value received = proceeds from sells + net dividends
  const totalValueUSD = totalProcUSD + totalDivNet;

  const periodStr = report.period
    ? `${report.period.from.toISOString().slice(0, 10)} → ${report.period.to.toISOString().slice(0, 10)}`
    : '';

  // Portfolio return % (USD only: closed trades + dividends)
  const portfolioReturnPct = totalCostUSD > 0
    ? ((totalValueUSD - totalCostUSD) / totalCostUSD) * 100
    : null;

  const spyReturnPct = bench ? benchReturn(bench.spy, report.period?.from ?? null, report.period?.to ?? null) : null;
  const qqqReturnPct = bench ? benchReturn(bench.qqq, report.period?.from ?? null, report.period?.to ?? null) : null;

  return (
    <div style={{ marginTop: 32 }}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Revolut P&amp;L</h2>
        {report.accountName && <Badge>{report.accountName}</Badge>}
        {periodStr && <Badge>{periodStr}</Badge>}
      </div>

      {/* ── KPI cards ── */}
      <div className="kpis">
        <KpiCard label="Realized P&L (USD)" value={money(totalPnL)} valueClass={signClass(totalPnL)} sub={`${usd.length} trades`} />
        {eur.length > 0 && (
          <KpiCard label="Realized P&L (EUR)" value={`${totalPnL_EUR >= 0 ? '+' : ''}€${Math.abs(totalPnL_EUR).toFixed(2)}`} valueClass={signClass(totalPnL_EUR)} sub={`${eur.length} trades`} />
        )}
        <KpiCard label="Dividends (net)" value={money(totalDivNet)} valueClass="green" sub={`Gross ${money(totalDivGross)} · Tax ${money(totalDivTax)}`} />
        <KpiCard
          label="Total net gain"
          value={money(totalPnL + totalDivNet - totalFees)}
          valueClass={signClass(totalPnL + totalDivNet - totalFees)}
          sub={`Fees ${money(totalFees)}${portfolioReturnPct != null ? ` · ${portfolioReturnPct >= 0 ? '+' : ''}${portfolioReturnPct.toFixed(1)}% on invested` : ''}`}
        />
      </div>

      {/* ── Contributions vs Value  +  Benchmark comparison ── */}
      <div className="grid row" style={{ marginBottom: 16, marginTop: 16 }}>
        <ContributionsChart invested={totalCostUSD} received={totalValueUSD} />
        <BenchmarkChart
          portfolioPct={portfolioReturnPct}
          spyPct={spyReturnPct}
          qqqPct={qqqReturnPct}
          hasBench={!!(bench?.spy || bench?.qqq)}
        />
      </div>

      {/* ── Allocation by symbol ── */}
      <div style={{ marginBottom: 16 }}>
        <AllocationChart trades={report.trades} />
      </div>

      {/* ── Trades + dividends tables ── */}
      <div style={{ display: 'grid', gridTemplateColumns: report.dividends.length > 0 ? '2fr 1fr' : '1fr', gap: 16, marginBottom: 16 }}>
        <TradesTable trades={report.trades} />
        {report.dividends.length > 0 && <DividendTable dividends={report.dividends} />}
      </div>
    </div>
  );
}

// --- Contributions vs Portfolio Value chart -----------------------------------

function ContributionsChart({ invested, received }: { invested: number; received: number }) {
  const gain = received - invested;
  const data = [
    { name: 'Invested', value: invested },
    { name: 'Received', value: received },
  ];

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="tooltip">
        <div className="row"><span className="name">{payload[0].payload.name}</span><span>{money(payload[0].value)}</span></div>
      </div>
    );
  };

  return (
    <div className="card">
      <h3>
        Contributions vs value
        <span style={{ fontWeight: 400, fontSize: 11, color: gain >= 0 ? C_GREEN : C_RED }}>
          {gain >= 0 ? '+' : ''}{money(gain)} ({gain >= 0 ? '+' : ''}{invested > 0 ? ((gain / invested) * 100).toFixed(1) : 0}%)
        </span>
      </h3>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Closed positions only — open holdings not in this PDF</div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} barCategoryGap="40%">
          <XAxis dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <ReferenceLine y={invested} stroke={C_DIM} strokeDasharray="4 3" />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            <Cell fill={C_BLUE} />
            <Cell fill={gain >= 0 ? C_GREEN : C_RED} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', justifyContent: 'space-around', fontSize: 12 }}>
        <span style={{ color: 'var(--text-2)' }}>Invested: <strong style={{ color: 'var(--text-1)' }}>{money(invested)}</strong></span>
        <span style={{ color: 'var(--text-2)' }}>Received: <strong style={{ color: gain >= 0 ? C_GREEN : C_RED }}>{money(received)}</strong></span>
      </div>
    </div>
  );
}

// --- Benchmark comparison chart -----------------------------------------------

function BenchmarkChart({ portfolioPct, spyPct, qqqPct, hasBench }: {
  portfolioPct: number | null;
  spyPct: number | null;
  qqqPct: number | null;
  hasBench: boolean;
}) {
  const data = [
    { name: 'Portfolio', value: portfolioPct, color: portfolioPct != null && portfolioPct >= 0 ? C_GREEN : C_RED },
    { name: 'S&P 500', value: spyPct, color: C_SPY },
    { name: 'NASDAQ', value: qqqPct, color: C_QQQ },
  ].filter(d => d.value != null) as { name: string; value: number; color: string }[];

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const v = payload[0].value as number;
    return (
      <div className="tooltip">
        <div className="row"><span className="name">{payload[0].payload.name}</span><span>{v >= 0 ? '+' : ''}{v.toFixed(2)}%</span></div>
      </div>
    );
  };

  return (
    <div className="card">
      <h3>Period performance vs benchmarks</h3>
      {!hasBench && (
        <div style={{ fontSize: 11, color: 'var(--text-3)', marginBottom: 8 }}>Benchmark data not loaded yet</div>
      )}
      {data.length === 0 ? (
        <div className="dim" style={{ padding: '40px 0', textAlign: 'center', fontSize: 13 }}>No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} barCategoryGap="40%">
            <XAxis dataKey="name" tick={{ fill: 'var(--text-2)', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`} tick={{ fill: 'var(--text-3)', fontSize: 11 }} axisLine={false} tickLine={false} width={45} />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <ReferenceLine y={0} stroke={C_DIM} />
            <Bar dataKey="value" radius={[6, 6, 0, 0]}>
              {data.map((d, i) => <Cell key={i} fill={d.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

// --- Allocation by symbol chart -----------------------------------------------

function AllocationChart({ trades }: { trades: RevolutTrade[] }) {
  const data = useMemo(() => {
    const bySymbol: Record<string, { costBasis: number; pnl: number; currency: string }> = {};
    for (const t of trades) {
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = { costBasis: 0, pnl: 0, currency: t.currency };
      bySymbol[t.symbol].costBasis += t.costBasis;
      bySymbol[t.symbol].pnl += t.grossPnL;
    }
    return Object.entries(bySymbol)
      .sort((a, b) => b[1].costBasis - a[1].costBasis)
      .map(([symbol, v]) => ({
        symbol,
        costBasis: v.costBasis,
        pnl: v.pnl,
        currency: v.currency,
        pnlPct: v.costBasis > 0 ? (v.pnl / v.costBasis) * 100 : 0,
      }));
  }, [trades]);

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    const prefix = d.currency === 'EUR' ? '€' : '$';
    return (
      <div className="tooltip">
        <div className="row" style={{ marginBottom: 4 }}><strong>{d.symbol}</strong></div>
        <div className="row"><span className="name">Cost basis</span><span>{prefix}{d.costBasis.toFixed(2)}</span></div>
        <div className="row"><span className="name">P&L</span><span style={{ color: d.pnl >= 0 ? C_GREEN : C_RED }}>{d.pnl >= 0 ? '+' : ''}{prefix}{d.pnl.toFixed(2)} ({d.pnlPct >= 0 ? '+' : ''}{d.pnlPct.toFixed(1)}%)</span></div>
      </div>
    );
  };

  return (
    <div className="card">
      <h3>Allocation by cost basis</h3>
      <ResponsiveContainer width="100%" height={Math.max(180, data.length * 36)}>
        <BarChart data={data} layout="vertical" barCategoryGap="25%">
          <XAxis
            type="number"
            tickFormatter={v => `$${(v as number) >= 1000 ? `${((v as number) / 1000).toFixed(0)}k` : (v as number).toFixed(0)}`}
            tick={{ fill: 'var(--text-3)', fontSize: 11 }}
            axisLine={false} tickLine={false}
          />
          <YAxis type="category" dataKey="symbol" width={52} tick={{ fill: 'var(--text-2)', fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="costBasis" radius={[0, 6, 6, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.pnl >= 0 ? C_GREEN : C_RED} opacity={0.75} />
            ))}
            <LabelList
              dataKey="pnlPct"
              position="right"
              formatter={(v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`}
              style={{ fill: 'var(--text-2)', fontSize: 12 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
        Green = profitable position · Red = loss · Bar length = capital invested
      </div>
    </div>
  );
}

// --- Shared small components --------------------------------------------------

function KpiCard({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, background: 'var(--bg-3)', border: '1px solid var(--border)', padding: '3px 8px', borderRadius: 6, color: 'var(--text-2)' }}>
      {children}
    </span>
  );
}

// --- Trades table -------------------------------------------------------------

type SortKey = 'dateSold' | 'symbol' | 'grossPnL' | 'grossProceeds' | 'costBasis' | 'returnPct';

function TradesTable({ trades }: { trades: RevolutTrade[] }) {
  const [sort, setSort] = useState<SortKey>('dateSold');
  const [asc, setAsc] = useState(false);

  const enriched = useMemo(() =>
    trades.map(t => ({ ...t, returnPct: t.costBasis > 0 ? (t.grossPnL / t.costBasis) * 100 : 0 })),
  [trades]);

  const rows = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...enriched].sort((a, b) => {
      if (sort === 'dateSold') return (a.dateSold.getTime() - b.dateSold.getTime()) * dir;
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      return (a[sort] - b[sort]) * dir;
    });
  }, [enriched, sort, asc]);

  const flip = (k: SortKey) => { if (k === sort) setAsc(p => !p); else { setSort(k); setAsc(false); } };
  const ind  = (k: SortKey) => k === sort ? (asc ? ' ↑' : ' ↓') : '';
  const fmt  = (t: RevolutTrade, v: number) =>
    t.currency === 'USD' ? money(v) : `€${v >= 0 ? '' : '-'}${Math.abs(v).toFixed(2)}`;

  return (
    <div className="card">
      <h3>Closed trades ({trades.length})</h3>
      <div className="scroll-table">
        <table>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer' }} onClick={() => flip('dateSold')}>Sold{ind('dateSold')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => flip('symbol')}>Symbol{ind('symbol')}</th>
              <th>Name</th>
              <th className="num">Qty</th>
              <th className="num" style={{ cursor: 'pointer' }} onClick={() => flip('costBasis')}>Cost{ind('costBasis')}</th>
              <th className="num" style={{ cursor: 'pointer' }} onClick={() => flip('grossProceeds')}>Proceeds{ind('grossProceeds')}</th>
              <th className="num" style={{ cursor: 'pointer' }} onClick={() => flip('grossPnL')}>P&amp;L{ind('grossPnL')}</th>
              <th className="num" style={{ cursor: 'pointer' }} onClick={() => flip('returnPct')}>Return %{ind('returnPct')}</th>
              <th className="num">Fees</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={i}>
                <td className="dim">{t.dateSold.toISOString().slice(0, 10)}</td>
                <td><strong>{t.symbol}</strong></td>
                <td style={{ maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</td>
                <td className="num">{t.quantity.toFixed(4)}</td>
                <td className="num">{fmt(t, t.costBasis)}</td>
                <td className="num">{fmt(t, t.grossProceeds)}</td>
                <td className={`num ${signClass(t.grossPnL)}`}>{fmt(t, t.grossPnL)}</td>
                <td className={`num ${signClass(t.returnPct)}`}>{t.returnPct >= 0 ? '+' : ''}{t.returnPct.toFixed(2)}%</td>
                <td className="num dim">{fmt(t, t.fees)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: 24 }} className="dim">No trades found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Dividends table ----------------------------------------------------------

function DividendTable({ dividends }: { dividends: RevolutDividend[] }) {
  const sorted = useMemo(() =>
    [...dividends].sort((a, b) => b.date.getTime() - a.date.getTime()),
  [dividends]);

  return (
    <div className="card">
      <h3>Dividends ({dividends.length})</h3>
      <div className="scroll-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th className="num">Gross</th>
              <th className="num">Tax</th>
              <th className="num">Net</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((d, i) => (
              <tr key={i}>
                <td className="dim">{d.date.toISOString().slice(0, 10)}</td>
                <td><strong>{d.symbol}</strong></td>
                <td className="num">{money(d.grossAmount)}</td>
                <td className="num dim">{money(d.withholdingTax)}</td>
                <td className="num green">{money(d.netAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
