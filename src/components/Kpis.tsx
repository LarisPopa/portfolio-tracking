import type { KpiSummary } from '../lib/analytics';
import { money, pct, signClass } from '../lib/format';

export interface MarketKpi {
  // Mark-to-market view computed from live quotes. `pricedCount` reports how
  // many of the open positions have a current price — when partial we still
  // show the figure but flag the gap so the user knows it's an estimate.
  unrealized: number;
  marketValue: number;
  totalReturnPct: number;
  totalReturnAbs: number;
  pricedCount: number;
  openCount: number;
  openCostBasis: number; // sum of cost basis for all open positions
}

export function Kpis({ k, market }: { k: KpiSummary; market?: MarketKpi | null }) {
  const partial = market && market.pricedCount > 0 && market.pricedCount < market.openCount;
  const unrealizedPct = market && market.openCostBasis > 0
    ? (market.unrealized / market.openCostBasis) * 100
    : 0;
  return (
    <div className="kpis">
      {market && market.pricedCount > 0 ? (
        <Card
          label="Portfolio value (market)"
          value={money(market.marketValue)}
          sub={`${money(k.netDeposits)} contributed · ${money(market.totalReturnAbs)} total gain${partial ? ` · ${market.pricedCount}/${market.openCount} priced` : ''}`}
        />
      ) : (
        <Card
          label="Account value (cost basis)"
          value={money(k.accountValue)}
          sub={`${money(k.netDeposits)} contributed · ${money(k.accountValue - k.netDeposits)} cost-basis gain`}
        />
      )}
      {market && market.pricedCount > 0 ? (
        <Card
          label="Total return (mark-to-market)"
          value={pct(market.totalReturnPct)}
          valueClass={signClass(market.totalReturnPct)}
          sub={`${money(market.totalReturnAbs)} incl. ${money(market.unrealized)} unrealized${partial ? ` · ${market.pricedCount}/${market.openCount} priced` : ''}`}
        />
      ) : (
        <Card
          label="Total return (mark-to-market)"
          value="–"
          sub="Live prices not loaded yet"
        />
      )}
      {market && market.pricedCount > 0 ? (
        <Card
          label="Unrealized P/L"
          value={money(market.unrealized)}
          valueClass={signClass(market.unrealized)}
          sub={`${pct(unrealizedPct)} on open positions${partial ? ` · ${market.pricedCount}/${market.openCount} priced` : ''}`}
        />
      ) : (
        <Card label="Unrealized P/L" value="–" sub="Load live prices to see unrealized gain" />
      )}
      <Card label="Realized return" value={pct(k.totalReturnPct)} valueClass={signClass(k.totalReturnPct)} sub={`${money(k.accountValue - k.netDeposits)} cost basis vs deposits`} />
      <Card label="Realized P/L" value={money(k.realizedPL)} valueClass={signClass(k.realizedPL)} sub={`${k.numTrades} closed trades · ${k.winRate.toFixed(1)}% wins`} />
      <Card label="Dividends" value={money(k.dividends)} valueClass="green" sub={`Tax ${money(-k.taxes)}`} />
      <Card label="Net income" value={money(k.income)} valueClass={signClass(k.income)} sub={`Interest ${money(k.interest)} · Fees ${money(-k.fees)}`} />
      <Card label="Open positions" value={String(k.numOpen)} sub={`${k.startDate} → ${k.endDate}`} />
    </div>
  );
}

function Card({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className={`value ${valueClass ?? ''}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
