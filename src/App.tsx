import { useEffect, useMemo, useRef, useState } from 'react';
import { parseXtbReport } from './lib/xtbParser';
import type { ParsedReport } from './lib/xtbParser';
import { buildEquity } from './lib/analytics';
import type { EquityResult, PriceSeries } from './lib/analytics';
import { fetchBenchmarks } from './lib/benchmarks';
import { fetchQuotes } from './lib/quotes';
import { Kpis } from './components/Kpis';
import type { MarketKpi } from './components/Kpis';
import { EquityChart } from './components/EquityChart';
import { MonthlyChart } from './components/MonthlyChart';
import { AllocationPie } from './components/AllocationPie';
import { HoldingsTable } from './components/HoldingsTable';
import { ClosedTradesTable } from './components/ClosedTradesTable';
import { DividendLog } from './components/DividendLog';
import { PeriodReturns } from './components/PeriodReturns';

interface BenchmarkState {
  spy: PriceSeries | null;
  qqq: PriceSeries | null;
  loading: boolean;
  error: string | null;
}

export default function App() {
  const [report, setReport] = useState<ParsedReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [bench, setBench] = useState<BenchmarkState>({ spy: null, qqq: null, loading: false, error: null });
  const [quotes, setQuotes] = useState<Map<string, number>>(new Map());
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleFile = async (file: File) => {
    setError(null);
    setParsing(true);
    try {
      const r = await parseXtbReport(file);
      setReport(r);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to parse file.');
      setReport(null);
    } finally {
      setParsing(false);
    }
  };

  useEffect(() => {
    if (!report || report.cashOps.length === 0) return;
    const from = report.cashOps[0].date;
    const to = report.dateTo ?? new Date();
    setBench((s) => ({ ...s, loading: true, error: null }));
    fetchBenchmarks(from, to)
      .then(({ spy, qqq }) => {
        setBench({
          spy,
          qqq,
          loading: false,
          error: !spy && !qqq
            ? 'Benchmark data unavailable. Check that the Vite dev server can reach query1.finance.yahoo.com.'
            : null,
        });
      })
      .catch((e) => setBench({ spy: null, qqq: null, loading: false, error: String(e?.message ?? e) }));
  }, [report]);

  const result: EquityResult | null = useMemo(() => {
    if (!report) return null;
    const today = report.dateTo ?? new Date();
    return buildEquity(report.cashOps, report.closed, bench.spy, bench.qqq, today);
  }, [report, bench.spy, bench.qqq]);

  const refreshQuotes = (tickers: string[]) => {
    if (tickers.length === 0) return;
    setQuotesLoading(true);
    fetchQuotes(tickers)
      .then(setQuotes)
      .finally(() => setQuotesLoading(false));
  };

  // Pull live prices once we know the open holdings. The chart endpoint
  // tolerates per-symbol calls so we don't need a separate batch API.
  useEffect(() => {
    if (!result) return;
    const open = result.holdings.filter((h) => h.qty > 1e-6).map((h) => h.ticker);
    refreshQuotes(open);
  }, [result?.holdings.length]);

  // Mark-to-market view: take the cost-basis equity walk and overlay live
  // prices on the open positions so the headline return reflects unrealized
  // gains too. We start from cost-basis accountValue and add per-holding
  // unrealized P/L so cash, dividends, fees etc all carry through cleanly.
  const market: MarketKpi | null = useMemo(() => {
    if (!result) return null;
    const open = result.holdings.filter((h) => h.qty > 1e-6);
    if (open.length === 0) return null;
    let unrealized = 0;
    let pricedCount = 0;
    for (const h of open) {
      const last = quotes.get(h.ticker);
      if (last == null) continue;
      unrealized += (last - h.avgCost) * h.qty;
      pricedCount++;
    }
    const openCostBasis = open.reduce((sum, h) => sum + h.costBasis, 0);
    const marketValue = result.kpis.accountValue + unrealized;
    const totalReturnAbs = marketValue - result.kpis.netDeposits;
    const totalReturnPct = result.kpis.netDeposits > 0
      ? (totalReturnAbs / result.kpis.netDeposits) * 100
      : 0;
    return { unrealized, marketValue, totalReturnPct, totalReturnAbs, pricedCount, openCount: open.length, openCostBasis };
  }, [result, quotes]);

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  return (
    <div className="app">
      <header className="top">
        <h1>
          <span>📈 Portfolio Tracker</span>
          {report?.account && <span className="badge">XTB · {report.account}</span>}
          {report && (
            <span className="badge">
              {report.dateFrom?.toISOString().slice(0, 10)} → {report.dateTo?.toISOString().slice(0, 10)}
            </span>
          )}
        </h1>
        <div className="upload-bar">
          {report && <span className="muted">{report.cashOps.length} cash ops · {report.closed.length} closed trades</span>}
          <button onClick={() => inputRef.current?.click()}>
            {report ? 'Load different file' : 'Upload XLSX'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {bench.error && <div className="error">{bench.error}</div>}

      {!report && (
        <div
          className={`dropzone ${dragging ? 'dragging' : ''}`}
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
        >
          {parsing ? (
            <div><strong>Parsing…</strong></div>
          ) : (
            <>
              <h2 style={{ margin: '0 0 8px' }}>Drop your XTB XLSX export here</h2>
              <div>or click to browse · <strong>account history → Excel export</strong></div>
              <div className="muted" style={{ marginTop: 16 }}>
                Sheets expected: <code>Closed Positions</code>, <code>Cash Operations</code>.
                <br />Benchmarks: SPY (S&P 500) and QQQ (NASDAQ 100) — adjusted close from Yahoo Finance via the dev-server proxy.
              </div>
            </>
          )}
        </div>
      )}

      {report && result && (
        <>
          <Kpis k={result.kpis} market={market} />

          <div className="grid two" style={{ marginBottom: 16 }}>
            <EquityChart curve={result.curve} />
            <PeriodReturns periods={result.periods} />
          </div>

          <div className="grid row" style={{ marginBottom: 16 }}>
            <MonthlyChart data={result.monthly} />
            <AllocationPie holdings={result.holdings} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <HoldingsTable
              holdings={result.holdings}
              prices={quotes}
              quotesLoading={quotesLoading}
              onRefreshQuotes={() => refreshQuotes(result.holdings.filter((h) => h.qty > 1e-6).map((h) => h.ticker))}
            />
          </div>

          <div className="grid row" style={{ marginBottom: 16 }}>
            <ClosedTradesTable trades={report.closed} />
            <DividendLog cashOps={report.cashOps} />
          </div>

          {bench.loading && <div className="muted" style={{ textAlign: 'center' }}>Loading benchmark prices…</div>}

          <footer>
            Open positions are valued at cost basis (no live price feed). Realized P/L, dividends, taxes, fees and interest come from the XTB cash log.
            Benchmarks are price-only; for total return add roughly 1–2% per year. Stooq data via dev-server proxy.
          </footer>
        </>
      )}
    </div>
  );
}
