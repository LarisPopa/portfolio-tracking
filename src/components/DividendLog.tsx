import { useMemo } from 'react';
import type { CashOp } from '../lib/xtbParser';
import { money } from '../lib/format';

export function DividendLog({ cashOps }: { cashOps: CashOp[] }) {
  const dividends = useMemo(
    () => cashOps.filter((o) => o.kind === 'dividend').sort((a, b) => b.date.getTime() - a.date.getTime()),
    [cashOps],
  );
  const total = dividends.reduce((s, d) => s + d.amount, 0);
  const taxes = cashOps.filter((o) => o.kind === 'tax').reduce((s, o) => s + o.amount, 0);

  return (
    <div className="card">
      <h3>
        <span>Dividends</span>
        <span className="dim" style={{ fontSize: 11, fontWeight: 400 }}>
          gross {money(total)} · tax {money(taxes)}
        </span>
      </h3>
      <div className="scroll-table">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Ticker</th>
              <th>Instrument</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {dividends.map((d, i) => (
              <tr key={`${d.date.getTime()}-${d.ticker}-${i}`}>
                <td className="dim">{d.date.toISOString().slice(0, 10)}</td>
                <td><strong>{d.ticker || '–'}</strong></td>
                <td>{d.instrument}</td>
                <td className="num green">{money(d.amount)}</td>
              </tr>
            ))}
            {dividends.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24 }} className="dim">No dividends recorded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
