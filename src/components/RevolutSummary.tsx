import { useState, useMemo } from 'react';
import type { RevolutReport, RevolutTrade, RevolutDividend } from '../lib/revolutParser';
import { money, signClass } from '../lib/format';

export function RevolutSummary({ report }: { report: RevolutReport }) {
  const usd = report.trades.filter(t => t.currency === 'USD');
  const eur = report.trades.filter(t => t.currency === 'EUR');

  const totalPnL = usd.reduce((s, t) => s + t.grossPnL, 0);
  const totalPnL_EUR = eur.reduce((s, t) => s + t.grossPnL, 0);
  const totalFees = usd.reduce((s, t) => s + t.fees, 0) + eur.reduce((s, t) => s + t.fees, 0);
  const totalCostUSD = usd.reduce((s, t) => s + t.costBasis, 0);
  const totalDivNet = report.dividends.reduce((s, d) => s + d.netAmount, 0);
  const totalDivGross = report.dividends.reduce((s, d) => s + d.grossAmount, 0);
  const totalDivTax = report.dividends.reduce((s, d) => s + d.withholdingTax, 0);

  const periodStr = report.period
    ? `${report.period.from.toISOString().slice(0, 10)} → ${report.period.to.toISOString().slice(0, 10)}`
    : '';

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Revolut P&amp;L</h2>
        {report.accountName && <span className="badge" style={{ fontSize: 11, background: 'var(--bg-3)', border: '1px solid var(--border)', padding: '3px 8px', borderRadius: 6, color: 'var(--text-2)' }}>{report.accountName}</span>}
        {periodStr && <span className="badge" style={{ fontSize: 11, background: 'var(--bg-3)', border: '1px solid var(--border)', padding: '3px 8px', borderRadius: 6, color: 'var(--text-2)' }}>{periodStr}</span>}
      </div>

      <div className="kpis">
        <KpiCard label="Realized P&L (USD)" value={money(totalPnL)} valueClass={signClass(totalPnL)} sub={`${usd.length} trades`} />
        {eur.length > 0 && (
          <KpiCard label="Realized P&L (EUR)" value={`${totalPnL_EUR >= 0 ? '+' : ''}€${Math.abs(totalPnL_EUR).toFixed(2)}`} valueClass={signClass(totalPnL_EUR)} sub={`${eur.length} trades`} />
        )}
        <KpiCard label="Dividends (net)" value={money(totalDivNet)} valueClass="green" sub={`Gross ${money(totalDivGross)} · Tax ${money(totalDivTax)}`} />
        <KpiCard label="Total net gain" value={money(totalPnL + totalDivNet - totalFees)} valueClass={signClass(totalPnL + totalDivNet - totalFees)} sub={`Fees ${money(totalFees)} · ${totalCostUSD > 0 ? ((totalPnL / totalCostUSD) * 100).toFixed(1) + '% on cost' : ''}`} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: report.dividends.length > 0 ? '2fr 1fr' : '1fr', gap: 16, marginTop: 16 }}>
        <TradesTable trades={report.trades} />
        {report.dividends.length > 0 && <DividendTable dividends={report.dividends} />}
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

type SortKey = 'dateSold' | 'symbol' | 'grossPnL' | 'grossProceeds' | 'costBasis';

function TradesTable({ trades }: { trades: RevolutTrade[] }) {
  const [sort, setSort] = useState<SortKey>('dateSold');
  const [asc, setAsc] = useState(false);

  const rows = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...trades].sort((a, b) => {
      if (sort === 'dateSold') return (a.dateSold.getTime() - b.dateSold.getTime()) * dir;
      if (sort === 'symbol') return a.symbol.localeCompare(b.symbol) * dir;
      return (a[sort] - b[sort]) * dir;
    });
  }, [trades, sort, asc]);

  const flip = (k: SortKey) => { if (k === sort) setAsc(p => !p); else { setSort(k); setAsc(false); } };
  const ind = (k: SortKey) => k === sort ? (asc ? ' ↑' : ' ↓') : '';

  const fmt = (t: RevolutTrade, v: number) =>
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
                <td className="num dim">{fmt(t, t.fees)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24 }} className="dim">No trades found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

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
