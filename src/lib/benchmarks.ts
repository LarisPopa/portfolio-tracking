import type { PriceSeries } from './analytics';

// Benchmark data is pre-baked into /public/benchmarks/*.json by `npm run
// refresh-benchmarks` (uses Python yfinance to dodge Yahoo's anonymous-IP
// rate limit). Each file is `[[YYYY-MM-DD, close], ...]` with split-and-
// dividend-adjusted closes — this gives proper total-return for SPY/QQQ.
//
// We attempt a live Yahoo fetch via the dev-server `/yahoo` proxy first so
// the data stays fresh when the API is reachable, and silently fall back to
// the bundled JSON otherwise.

const YAHOO_BASE = '/yahoo/v8/finance/chart';
const BUNDLED_BASE = '/benchmarks';

interface YahooChart {
  chart: {
    result?: Array<{
      timestamp?: number[];
      indicators: {
        quote: Array<{ close?: Array<number | null> }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

const dayKeyFromTs = (ts: number): string => {
  const d = new Date(ts * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

function parseYahoo(json: YahooChart): PriceSeries {
  const result = json.chart.result?.[0];
  if (!result || !result.timestamp) return { prices: new Map(), dates: [] };
  const timestamps = result.timestamp;
  const adj = result.indicators.adjclose?.[0]?.adjclose;
  const close = result.indicators.quote[0]?.close ?? [];
  const series = adj && adj.length === timestamps.length ? adj : close;
  const prices = new Map<string, number>();
  const dates: string[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const v = series[i];
    if (v == null || isNaN(v)) continue;
    const k = dayKeyFromTs(timestamps[i]);
    prices.set(k, v);
    dates.push(k);
  }
  dates.sort();
  return { prices, dates };
}

async function fetchYahoo(symbol: string, from: Date, to: Date): Promise<PriceSeries> {
  const period1 = Math.floor(from.getTime() / 1000);
  const period2 = Math.floor(to.getTime() / 1000) + 86_400;
  const params = new URLSearchParams({
    period1: String(period1),
    period2: String(period2),
    interval: '1d',
    includeAdjustedClose: 'true',
  });
  const url = `${YAHOO_BASE}/${encodeURIComponent(symbol)}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo ${symbol}: HTTP ${res.status}`);
  const json = (await res.json()) as YahooChart;
  if (json.chart.error) throw new Error(`Yahoo ${symbol}: ${json.chart.error.description ?? json.chart.error.code}`);
  const series = parseYahoo(json);
  if (series.dates.length === 0) throw new Error(`Yahoo ${symbol}: empty series`);
  return series;
}

async function fetchBundled(name: 'spy' | 'qqq'): Promise<PriceSeries> {
  const res = await fetch(`${BUNDLED_BASE}/${name}.json`);
  if (!res.ok) throw new Error(`Bundled ${name}.json missing (HTTP ${res.status})`);
  const rows = (await res.json()) as Array<[string, number]>;
  const prices = new Map<string, number>();
  const dates: string[] = [];
  for (const [d, p] of rows) {
    prices.set(d, p);
    dates.push(d);
  }
  dates.sort();
  return { prices, dates };
}

async function loadOne(symbol: 'SPY' | 'QQQ', from: Date, to: Date): Promise<PriceSeries> {
  try {
    return await fetchYahoo(symbol, from, to);
  } catch (e) {
    console.warn(`[benchmarks] Yahoo failed for ${symbol}, using bundled data:`, e);
    return await fetchBundled(symbol.toLowerCase() as 'spy' | 'qqq');
  }
}

export async function fetchBenchmarks(from: Date, to: Date): Promise<{ spy: PriceSeries | null; qqq: PriceSeries | null }> {
  const [spy, qqq] = await Promise.allSettled([loadOne('SPY', from, to), loadOne('QQQ', from, to)]);
  return {
    spy: spy.status === 'fulfilled' ? spy.value : null,
    qqq: qqq.status === 'fulfilled' ? qqq.value : null,
  };
}
