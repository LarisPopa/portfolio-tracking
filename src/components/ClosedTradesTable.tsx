import { useMemo, useState } from 'react';
import type { ClosedPosition } from '../lib/xtbParser';
import { money, num, pct, signClass } from '../lib/format';

type SortKey = 'closeTime' | 'ticker' | 'profitLoss' | 'returnPct' | 'volume';

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

export function ClosedTradesTable({ trades }: { trades: ClosedPosition[] }) {
  const [sort, setSort] = useState<SortKey>('closeTime');
  const [asc, setAsc] = useState(false);

  const enriched = useMemo(() => trades.map((t) => ({
    ...t,
    returnPct: t.openPrice > 0 ? ((t.closePrice - t.openPrice) / t.openPrice) * 100 : 0,
  })), [trades]);

  const rows = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...enriched].sort((a, b) => {
      let av: any = a[sort as keyof typeof a];
      let bv: any = b[sort as keyof typeof b];
      if (av instanceof Date) av = av.getTime();
      if (bv instanceof Date) bv = bv.getTime();
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [enriched, sort, asc]);

  const flip = (k: SortKey) => {
    if (k === sort) setAsc(!asc);
    else { setSort(k); setAsc(false); }
  };
  const ind = (k: SortKey) => (k === sort ? (asc ? ' ↑' : ' ↓') : '');

  return (
    <div className="card">
      <h3>Closed trades ({trades.length})</h3>
      <div className="scroll-table">
        <table>
          <thead>
            <tr>
              <th style={{ cursor: 'pointer' }} onClick={() => flip('closeTime')}>Close{ind('closeTime')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => flip('ticker')}>Ticker{ind('ticker')}</th>
              <th>Instrument</th>
              <th className="num" style={{ cursor: 'pointer' }} onClick={() => flip('volume')}>Qty{ind('volume')}</th>
              <th className="num">Open</th>
              <th className="num">Close</th>
              <th className="num" style={{ cursor: 'pointer' }} onClick={() => flip('returnPct')}>Return{ind('returnPct')}</th>
              <th className="num" style={{ cursor: 'pointer' }} onClick={() => flip('profitLoss')}>P/L{ind('profitLoss')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t, i) => (
              <tr key={`${t.ticker}-${t.closeTime.getTime()}-${i}`}>
                <td className="dim">{fmtDate(t.closeTime)}</td>
                <td><strong>{t.ticker}</strong></td>
                <td>{t.instrument}</td>
                <td className="num">{num(t.volume, 4)}</td>
                <td className="num">{money(t.openPrice)}</td>
                <td className="num">{money(t.closePrice)}</td>
                <td className={`num ${signClass(t.returnPct)}`}>{pct(t.returnPct)}</td>
                <td className={`num ${signClass(t.profitLoss)}`}>{money(t.profitLoss)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24 }} className="dim">No closed trades.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
