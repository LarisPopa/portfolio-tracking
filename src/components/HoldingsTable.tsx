import { useMemo, useState } from 'react';
import type { Holding } from '../lib/analytics';
import { money, num, pct, signClass } from '../lib/format';

type SortKey = 'ticker' | 'qty' | 'avgCost' | 'costBasis' | 'unrealized' | 'realized' | 'dividends' | 'totalReturn';

interface Props {
  holdings: Holding[];
  prices?: Map<string, number>;
  quotesLoading?: boolean;
  onRefreshQuotes?: () => void;
}

export function HoldingsTable({ holdings, prices, quotesLoading, onRefreshQuotes }: Props) {
  const [sort, setSort] = useState<SortKey>('costBasis');
  const [asc, setAsc] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  // Augment each holding with current price + unrealized P/L. Closed positions
  // (qty == 0) get a zero unrealized so sorting still works without surfacing
  // bogus prices into closed rows.
  const enriched = useMemo(() => holdings.map((h) => {
    const last = prices?.get(h.ticker);
    const isOpen = h.qty > 1e-6;
    const unrealized = isOpen && last != null ? (last - h.avgCost) * h.qty : 0;
    const unrealizedPct = isOpen && last != null && h.avgCost > 0 ? ((last - h.avgCost) / h.avgCost) * 100 : null;
    const marketValue = isOpen && last != null ? last * h.qty : null;
    return { ...h, last, unrealized, unrealizedPct, marketValue, totalReturn: h.realized + h.dividends };
  }), [holdings, prices]);

  const rows = useMemo(() => {
    const filtered = filter === 'open' ? enriched.filter((h) => h.qty > 1e-6) : enriched;
    const dir = asc ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [enriched, sort, asc, filter]);

  const flip = (k: SortKey) => {
    if (k === sort) setAsc(!asc);
    else { setSort(k); setAsc(false); }
  };

  const sortIndicator = (k: SortKey) => (k === sort ? (asc ? ' ↑' : ' ↓') : '');
  const openCount = holdings.filter((h) => h.qty > 1e-6).length;
  const havePrices = (prices?.size ?? 0) > 0;

  return (
    <div className="card">
      <h3>
        <span>Holdings & lifetime P/L</span>
        <span className="actions">
          <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>Open ({openCount})</button>
          <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>All</button>
          {onRefreshQuotes && (
            <button onClick={onRefreshQuotes} disabled={quotesLoading} title="Re-fetch live prices">
              {quotesLoading ? '…' : '↻ Prices'}
            </button>
          )}
        </span>
      </h3>
      {!havePrices && !quotesLoading && (
        <p className="muted" style={{ marginTop: -4, marginBottom: 8 }}>
          Live prices unavailable (Yahoo proxy may be rate-limited). Unrealized column shows "–".
        </p>
      )}
      <div className="scroll-table">
        <table>
          <thead>
            <tr>
              <th onClick={() => flip('ticker')} style={{ cursor: 'pointer' }}>Ticker{sortIndicator('ticker')}</th>
              <th>Instrument</th>
              <th className="num" onClick={() => flip('qty')} style={{ cursor: 'pointer' }}>Qty{sortIndicator('qty')}</th>
              <th className="num" onClick={() => flip('avgCost')} style={{ cursor: 'pointer' }}>Avg cost{sortIndicator('avgCost')}</th>
              <th className="num">Last</th>
              <th className="num" onClick={() => flip('costBasis')} style={{ cursor: 'pointer' }}>Cost basis{sortIndicator('costBasis')}</th>
              <th className="num" onClick={() => flip('unrealized')} style={{ cursor: 'pointer' }}>Unrealized{sortIndicator('unrealized')}</th>
              <th className="num" onClick={() => flip('realized')} style={{ cursor: 'pointer' }}>Realized P/L{sortIndicator('realized')}</th>
              <th className="num" onClick={() => flip('dividends')} style={{ cursor: 'pointer' }}>Dividends{sortIndicator('dividends')}</th>
              <th className="num" onClick={() => flip('totalReturn')} style={{ cursor: 'pointer' }}>Realized + Div{sortIndicator('totalReturn')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => {
              const isOpen = h.qty > 1e-6;
              return (
                <tr key={h.ticker}>
                  <td><strong>{h.ticker}</strong></td>
                  <td>{h.instrument}</td>
                  <td className="num">{isOpen ? num(h.qty, 4) : <span className="dim">closed</span>}</td>
                  <td className="num">{isOpen ? money(h.avgCost) : '–'}</td>
                  <td className="num">{isOpen && h.last != null ? money(h.last) : <span className="dim">–</span>}</td>
                  <td className="num">{isOpen ? money(h.costBasis) : '–'}</td>
                  <td className={`num ${signClass(isOpen && h.last != null ? h.unrealized : null)}`}>
                    {isOpen && h.last != null ? (
                      <>
                        {money(h.unrealized)}
                        <div className="dim" style={{ fontSize: 10, fontWeight: 400 }}>{pct(h.unrealizedPct)}</div>
                      </>
                    ) : (
                      <span className="dim">–</span>
                    )}
                  </td>
                  <td className={`num ${signClass(h.realized)}`}>{money(h.realized)}</td>
                  <td className={`num ${signClass(h.dividends)}`}>{money(h.dividends)}</td>
                  <td className={`num ${signClass(h.totalReturn)}`}><strong>{money(h.totalReturn)}</strong></td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={10} style={{ textAlign: 'center', padding: 24 }} className="dim">No rows.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
