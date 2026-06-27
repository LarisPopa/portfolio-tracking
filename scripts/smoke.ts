/* Headless smoke test: parses the sample XLSX, loads bundled benchmark
 * JSONs, runs analytics, and prints a summary. Validates the data pipeline
 * without needing a browser. Run with `npx tsx scripts/smoke.ts`. */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseXtbReport } from '../src/lib/xtbParser';
import { buildEquity } from '../src/lib/analytics';
import type { PriceSeries } from '../src/lib/analytics';

async function loadBundled(name: 'spy' | 'qqq'): Promise<PriceSeries> {
  const buf = await readFile(resolve(import.meta.dirname, '..', 'public', 'benchmarks', `${name}.json`), 'utf-8');
  const rows = JSON.parse(buf) as Array<[string, number]>;
  const prices = new Map<string, number>();
  const dates: string[] = [];
  for (const [d, p] of rows) {
    prices.set(d, p);
    dates.push(d);
  }
  dates.sort();
  return { prices, dates };
}

async function main() {
  const samplePath = resolve(import.meta.dirname, '..', '..', 'sample.xlsx');
  const buf = await readFile(samplePath);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const report = await parseXtbReport(ab);
  const spy = await loadBundled('spy');
  const qqq = await loadBundled('qqq');
  const result = buildEquity(report.cashOps, report.closed, spy, qqq, report.dateTo ?? new Date());
  console.log('--- REPORT ---');
  console.log('Account:', report.account);
  console.log('Range:', report.dateFrom?.toISOString().slice(0, 10), '→', report.dateTo?.toISOString().slice(0, 10));
  console.log('Cash ops:', report.cashOps.length);
  console.log('Closed trades:', report.closed.length);
  console.log('--- KPIs ---');
  console.log(result.kpis);
  console.log('--- Curve points:', result.curve.length);
  console.log('First:', result.curve[0]);
  console.log('Last:', result.curve.at(-1));
  console.log('--- Holdings (open) ---');
  for (const h of result.holdings.filter((h) => h.qty > 1e-6).slice(0, 10)) {
    console.log(h.ticker.padEnd(10), 'qty', h.qty.toFixed(2).padStart(10), 'cost', h.costBasis.toFixed(2).padStart(10), 'realized', h.realized.toFixed(2));
  }
  console.log('--- Periods ---');
  for (const p of result.periods) {
    console.log(p.label.padEnd(4), 'port', (p.portfolioPct ?? NaN).toFixed(2) + '%', 'spy', (p.spyPct ?? NaN).toFixed(2) + '%', 'qqq', (p.qqqPct ?? NaN).toFixed(2) + '%');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
