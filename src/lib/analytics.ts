import type { CashOp, ClosedPosition } from './xtbParser';

export interface PriceSeries {
  // Maps `YYYY-MM-DD` → close price. The map only has entries on trading days,
  // so consumers carry-forward the previous close for non-trading days.
  prices: Map<string, number>;
  // Sorted ascending list of dates that have prices (for fast nearest-day lookup).
  dates: string[];
}

export interface EquityPoint {
  date: string; // YYYY-MM-DD
  ts: number;
  cumDeposits: number;
  cumWithdrawals: number;
  netDeposits: number;
  realizedPL: number;
  dividends: number;
  taxes: number;
  fees: number;
  interest: number;
  income: number; // dividends + interest - taxes - fees
  cashBalance: number;
  positionsCostBasis: number;
  accountValue: number; // cashBalance + positionsCostBasis (cost-basis valuation)
  spyValue: number | null;
  qqqValue: number | null;
}

export interface Holding {
  ticker: string;
  instrument: string;
  qty: number;
  avgCost: number;
  costBasis: number;
  realized: number; // realized P/L attributed to closed lots of this ticker
  dividends: number;
}

export interface KpiSummary {
  netDeposits: number;
  realizedPL: number;
  dividends: number;
  taxes: number;
  fees: number;
  interest: number;
  income: number;
  accountValue: number;
  totalReturnPct: number;
  startDate: string;
  endDate: string;
  numTrades: number;
  numOpen: number;
  winRate: number; // % of closed trades with positive P/L
}

export interface PeriodReturn {
  label: string;
  portfolioPct: number | null;
  spyPct: number | null;
  qqqPct: number | null;
}

export interface MonthlyPL {
  month: string; // YYYY-MM
  realized: number;
  dividends: number;
  net: number;
}

const dayKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (d: Date, n: number): Date => {
  const r = new Date(d.getTime());
  r.setUTCDate(r.getUTCDate() + n);
  return r;
};

// XTB encodes share counts and execution prices in the comment field as
// "OPEN BUY 1.5 @ 200.50" or "CLOSE BUY 0.5/2.5 @ 250.00". We need both qty
// and price to reconstruct lots; the cash amount alone doesn't suffice when
// FX conversion fees skew it.
function parseTradeComment(comment: string): { qty: number; price: number } | null {
  const m = comment.match(/(OPEN|CLOSE)\s+(BUY|SELL)\s+([\d.]+)(?:\/[\d.]+)?\s+@\s+([\d.]+)/i);
  if (!m) return null;
  return { qty: Number(m[3]), price: Number(m[4]) };
}

// Look up a benchmark price for an arbitrary date. If the date is a weekend
// or holiday, walk forward up to 7 days to find the next trading day. Returns
// null only if the requested date precedes the entire history.
function priceOn(series: PriceSeries, date: string): number | null {
  if (series.prices.has(date)) return series.prices.get(date)!;
  if (date < series.dates[0]) return null;
  let probe = date;
  for (let i = 0; i < 7; i++) {
    const d = new Date(probe + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 1);
    probe = dayKey(d);
    if (series.prices.has(probe)) return series.prices.get(probe)!;
  }
  // fall back: linear scan for nearest preceding date
  for (let i = series.dates.length - 1; i >= 0; i--) {
    if (series.dates[i] <= date) return series.prices.get(series.dates[i])!;
  }
  return null;
}

interface BenchmarkSimState {
  shares: number;
  lastValue: number;
}

function simulateBenchmarkFlow(
  state: BenchmarkSimState,
  series: PriceSeries | null,
  date: string,
  netCashFlow: number, // positive on deposits, negative on withdrawals
): void {
  if (!series || series.prices.size === 0) return;
  const price = priceOn(series, date);
  if (price == null || price <= 0) return;
  state.shares += netCashFlow / price;
  state.lastValue = state.shares * price;
}

function markBenchmarkToMarket(state: BenchmarkSimState, series: PriceSeries | null, date: string): number | null {
  if (!series || series.prices.size === 0) return null;
  const price = priceOn(series, date);
  if (price == null) return state.lastValue;
  state.lastValue = state.shares * price;
  return state.lastValue;
}

export interface EquityResult {
  curve: EquityPoint[];
  holdings: Holding[];
  kpis: KpiSummary;
  monthly: MonthlyPL[];
  periods: PeriodReturn[];
}

export function buildEquity(
  cashOps: CashOp[],
  closed: ClosedPosition[],
  spy: PriceSeries | null,
  qqq: PriceSeries | null,
  today: Date,
): EquityResult {
  if (cashOps.length === 0) {
    return {
      curve: [],
      holdings: [],
      kpis: emptyKpis(),
      monthly: [],
      periods: [],
    };
  }

  // 1. Group ops by day so we can mark to market once per day.
  const opsByDay = new Map<string, CashOp[]>();
  for (const op of cashOps) {
    const k = dayKey(op.date);
    if (!opsByDay.has(k)) opsByDay.set(k, []);
    opsByDay.get(k)!.push(op);
  }

  const startDate = new Date(Date.UTC(
    cashOps[0].date.getUTCFullYear(),
    cashOps[0].date.getUTCMonth(),
    cashOps[0].date.getUTCDate(),
  ));
  const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  // 2. Per-ticker lot tracker. We approximate avg cost (not FIFO) — XTB
  // already gives us realized P/L per closed lot, so the avg-cost view is
  // only used for *currently open* positions in the holdings table.
  const lots = new Map<string, { qty: number; cost: number; instrument: string; realized: number; dividends: number }>();
  const ensureLot = (ticker: string, instrument: string) => {
    let l = lots.get(ticker);
    if (!l) {
      l = { qty: 0, cost: 0, instrument, realized: 0, dividends: 0 };
      lots.set(ticker, l);
    } else if (!l.instrument && instrument) {
      l.instrument = instrument;
    }
    return l;
  };
  for (const c of closed) {
    const lot = ensureLot(c.ticker, c.instrument);
    lot.realized += c.profitLoss;
  }

  // 3. Walk every day from startDate to endDate, applying the day's cash ops
  // and emitting a snapshot. Days with no activity carry the previous state.
  const curve: EquityPoint[] = [];
  let cumDeposits = 0;
  let cumWithdrawals = 0;
  let realizedPL = 0;
  let dividends = 0;
  let taxes = 0;
  let fees = 0;
  let interest = 0;
  let cashBalance = 0;
  let positionsCostBasis = 0;

  const spyState: BenchmarkSimState = { shares: 0, lastValue: 0 };
  const qqqState: BenchmarkSimState = { shares: 0, lastValue: 0 };

  for (let d = new Date(startDate); d.getTime() <= endDate.getTime(); d = addDays(d, 1)) {
    const k = dayKey(d);
    const ops = opsByDay.get(k);
    if (ops) {
      for (const op of ops) {
        cashBalance += op.amount;
        switch (op.kind) {
          case 'deposit':
            cumDeposits += op.amount;
            simulateBenchmarkFlow(spyState, spy, k, op.amount);
            simulateBenchmarkFlow(qqqState, qqq, k, op.amount);
            break;
          case 'withdrawal':
          case 'transfer':
            // amount is negative for withdrawals
            if (op.amount < 0) {
              cumWithdrawals += -op.amount;
              simulateBenchmarkFlow(spyState, spy, k, op.amount);
              simulateBenchmarkFlow(qqqState, qqq, k, op.amount);
            } else {
              cumDeposits += op.amount;
              simulateBenchmarkFlow(spyState, spy, k, op.amount);
              simulateBenchmarkFlow(qqqState, qqq, k, op.amount);
            }
            break;
          case 'buy': {
            const parsed = parseTradeComment(op.comment);
            const cost = -op.amount; // amount is negative
            const lot = ensureLot(op.ticker, op.instrument);
            if (parsed && parsed.qty > 0) {
              lot.qty += parsed.qty;
              lot.cost += cost;
            } else {
              lot.cost += cost;
            }
            positionsCostBasis += cost;
            break;
          }
          case 'sell': {
            const parsed = parseTradeComment(op.comment);
            const proceeds = op.amount; // positive
            const lot = ensureLot(op.ticker, op.instrument);
            if (parsed && parsed.qty > 0 && lot.qty > 0) {
              const qtySold = Math.min(parsed.qty, lot.qty);
              const avg = lot.qty > 0 ? lot.cost / lot.qty : 0;
              const removedCost = avg * qtySold;
              lot.qty -= qtySold;
              lot.cost -= removedCost;
              positionsCostBasis -= removedCost;
              const tradeRealized = proceeds - removedCost;
              realizedPL += tradeRealized;
            } else {
              // unknown qty — assume entire remaining lot closed
              positionsCostBasis -= lot.cost;
              realizedPL += proceeds - lot.cost;
              lot.cost = 0;
              lot.qty = 0;
            }
            break;
          }
          case 'dividend':
            dividends += op.amount;
            if (op.ticker) {
              const lot = ensureLot(op.ticker, op.instrument);
              lot.dividends += op.amount;
            }
            break;
          case 'tax':
            taxes += -op.amount; // amount is negative
            break;
          case 'fee':
            fees += -op.amount;
            break;
          case 'interest':
            interest += op.amount;
            break;
          case 'other':
            break;
        }
      }
    }

    const accountValue = cashBalance + positionsCostBasis;
    const income = dividends + interest - taxes - fees;
    const spyValue = markBenchmarkToMarket(spyState, spy, k);
    const qqqValue = markBenchmarkToMarket(qqqState, qqq, k);

    curve.push({
      date: k,
      ts: d.getTime(),
      cumDeposits,
      cumWithdrawals,
      netDeposits: cumDeposits - cumWithdrawals,
      realizedPL,
      dividends,
      taxes,
      fees,
      interest,
      income,
      cashBalance,
      positionsCostBasis,
      accountValue,
      spyValue,
      qqqValue,
    });
  }

  // 4. Build the holdings table from remaining open lots.
  const holdings: Holding[] = [];
  for (const [ticker, lot] of lots) {
    if (lot.qty < 1e-6 && lot.cost < 0.01 && lot.realized === 0 && lot.dividends === 0) continue;
    holdings.push({
      ticker,
      instrument: lot.instrument || ticker,
      qty: Math.max(0, lot.qty),
      avgCost: lot.qty > 0 ? lot.cost / lot.qty : 0,
      costBasis: Math.max(0, lot.cost),
      realized: lot.realized,
      dividends: lot.dividends,
    });
  }
  holdings.sort((a, b) => b.costBasis - a.costBasis);

  // 5. Period returns and KPIs.
  const last = curve[curve.length - 1];
  const monthly = computeMonthly(cashOps, closed);
  const periods = computePeriods(curve, spy, qqq);
  const numClosed = closed.length;
  const wins = closed.filter((c) => c.profitLoss > 0).length;

  const kpis: KpiSummary = {
    netDeposits: last.netDeposits,
    realizedPL: last.realizedPL,
    dividends: last.dividends,
    taxes: last.taxes,
    fees: last.fees,
    interest: last.interest,
    income: last.income,
    accountValue: last.accountValue,
    totalReturnPct: last.netDeposits > 0
      ? ((last.accountValue - last.netDeposits) / last.netDeposits) * 100
      : 0,
    startDate: curve[0]?.date ?? '',
    endDate: last.date,
    numTrades: numClosed,
    numOpen: holdings.filter((h) => h.qty > 1e-6).length,
    winRate: numClosed > 0 ? (wins / numClosed) * 100 : 0,
  };

  return { curve, holdings, kpis, monthly, periods };
}

function emptyKpis(): KpiSummary {
  return {
    netDeposits: 0, realizedPL: 0, dividends: 0, taxes: 0, fees: 0, interest: 0,
    income: 0, accountValue: 0, totalReturnPct: 0, startDate: '', endDate: '',
    numTrades: 0, numOpen: 0, winRate: 0,
  };
}

function computeMonthly(cashOps: CashOp[], closed: ClosedPosition[]): MonthlyPL[] {
  const map = new Map<string, MonthlyPL>();
  const get = (m: string) => {
    let row = map.get(m);
    if (!row) {
      row = { month: m, realized: 0, dividends: 0, net: 0 };
      map.set(m, row);
    }
    return row;
  };
  for (const c of closed) {
    const m = c.closeTime.toISOString().slice(0, 7);
    const r = get(m);
    r.realized += c.profitLoss;
    r.net += c.profitLoss;
  }
  for (const op of cashOps) {
    if (op.kind === 'dividend') {
      const m = op.date.toISOString().slice(0, 7);
      const r = get(m);
      r.dividends += op.amount;
      r.net += op.amount;
    }
  }
  return Array.from(map.values()).sort((a, b) => (a.month < b.month ? -1 : 1));
}

// Period returns are intentionally simple: total return for portfolio (cumulative
// account growth net of deposits, normalised by start-of-period equity), and
// price-only return for the benchmarks. These won't match a true TWR — that's
// noted on the dashboard.
function computePeriods(curve: EquityPoint[], spy: PriceSeries | null, qqq: PriceSeries | null): PeriodReturn[] {
  if (curve.length === 0) return [];
  const last = curve[curve.length - 1];
  const periods: { label: string; days: number | 'ytd' | 'all' }[] = [
    { label: '1M', days: 30 },
    { label: '3M', days: 91 },
    { label: '6M', days: 182 },
    { label: 'YTD', days: 'ytd' },
    { label: '1Y', days: 365 },
    { label: '3Y', days: 365 * 3 },
    { label: 'All', days: 'all' },
  ];
  const out: PeriodReturn[] = [];
  for (const p of periods) {
    let startIdx = 0;
    if (p.days === 'all') {
      startIdx = 0;
    } else if (p.days === 'ytd') {
      const yr = last.date.slice(0, 4);
      startIdx = curve.findIndex((pt) => pt.date >= `${yr}-01-01`);
      if (startIdx < 0) startIdx = 0;
    } else {
      const targetTs = last.ts - p.days * 86_400_000;
      startIdx = curve.findIndex((pt) => pt.ts >= targetTs);
      if (startIdx < 0) startIdx = 0;
    }
    const start = curve[startIdx];
    if (!start) {
      out.push({ label: p.label, portfolioPct: null, spyPct: null, qqqPct: null });
      continue;
    }

    // Portfolio return over period: change in unrealized+realized gain divided
    // by capital that was actually working during the period — start equity
    // plus new deposits made within the window. This way "All" produces the
    // same number as the headline KPI (no division by near-zero start equity).
    const startReturn = start.accountValue - start.netDeposits;
    const endReturn = last.accountValue - last.netDeposits;
    const newDeposits = Math.max(0, last.netDeposits - start.netDeposits);
    const base = Math.max(start.accountValue + newDeposits, 1);
    const portfolioPct = ((endReturn - startReturn) / base) * 100;

    const spyPct = priceReturn(spy, start.date, last.date);
    const qqqPct = priceReturn(qqq, start.date, last.date);
    out.push({ label: p.label, portfolioPct, spyPct, qqqPct });
  }
  return out;
}

function priceReturn(series: PriceSeries | null, fromDate: string, toDate: string): number | null {
  if (!series) return null;
  const from = priceOn(series, fromDate);
  const to = priceOn(series, toDate);
  if (from == null || to == null || from === 0) return null;
  return ((to - from) / from) * 100;
}
