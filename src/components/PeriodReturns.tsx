import type { PeriodReturn } from '../lib/analytics';
import { pct, signClass } from '../lib/format';

export function PeriodReturns({ periods }: { periods: PeriodReturn[] }) {
  return (
    <div className="card">
      <h3>Period returns</h3>
      <table>
        <thead>
          <tr>
            <th>Period</th>
            <th className="num">Portfolio</th>
            <th className="num">S&P 500</th>
            <th className="num">NASDAQ 100</th>
            <th className="num">vs S&P</th>
            <th className="num">vs NDX</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const vsSpy = p.portfolioPct != null && p.spyPct != null ? p.portfolioPct - p.spyPct : null;
            const vsQqq = p.portfolioPct != null && p.qqqPct != null ? p.portfolioPct - p.qqqPct : null;
            return (
              <tr key={p.label}>
                <td><strong>{p.label}</strong></td>
                <td className={`num ${signClass(p.portfolioPct)}`}>{pct(p.portfolioPct)}</td>
                <td className={`num ${signClass(p.spyPct)}`}>{pct(p.spyPct)}</td>
                <td className={`num ${signClass(p.qqqPct)}`}>{pct(p.qqqPct)}</td>
                <td className={`num ${signClass(vsSpy)}`}>{pct(vsSpy)}</td>
                <td className={`num ${signClass(vsQqq)}`}>{pct(vsQqq)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 8 }}>
        Portfolio % is gain net of new contributions over the period. Benchmarks use SPY/QQQ <em>adjusted close</em> (total return, dividends reinvested).
      </p>
    </div>
  );
}
