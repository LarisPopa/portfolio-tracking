// Live quote lookup for individual holdings. Hits the Yahoo `/v8/finance/chart`
// endpoint via the dev-server proxy (same path used for benchmark history).
// Returns regularMarketPrice when available, falling back to the most recent
// non-null close. Failures degrade silently — callers show "–".
//
// XTB tickers are suffixed `.US` / `.UK` etc; Yahoo uses bare symbols for US
// listings and `.L`-style suffixes for foreign exchanges.

const YAHOO_BASE = '/yahoo/v8/finance/chart';

const SUFFIX_MAP: Array<[RegExp, string]> = [
  [/\.US$/i, ''],
  [/\.UK$/i, '.L'],
  [/\.DE$/i, '.DE'],
  [/\.FR$/i, '.PA'],
  [/\.NL$/i, '.AS'],
];

export function toYahooSymbol(xtbTicker: string): string {
  for (const [re, repl] of SUFFIX_MAP) {
    if (re.test(xtbTicker)) return xtbTicker.replace(re, repl);
  }
  return xtbTicker;
}

export async function fetchQuote(xtbTicker: string): Promise<number | null> {
  const sym = toYahooSymbol(xtbTicker);
  if (!sym) return null;
  const url = `${YAHOO_BASE}/${encodeURIComponent(sym)}?range=5d&interval=1d`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = (await res.json()) as any;
    const result = json?.chart?.result?.[0];
    const live = result?.meta?.regularMarketPrice;
    if (typeof live === 'number' && live > 0) return live;
    const closes: Array<number | null> = result?.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null && !isNaN(closes[i] as number)) return closes[i] as number;
    }
    return null;
  } catch {
    return null;
  }
}

// Concurrency-limited batch — Yahoo throttles aggressive parallel requests
// from the same IP, so we cap parallelism and let stragglers settle.
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchQuotes(tickers: string[]): Promise<Map<string, number>> {
  const unique = Array.from(new Set(tickers.filter(Boolean)));
  const results = await mapWithLimit(unique, 4, async (t) => [t, await fetchQuote(t)] as const);
  const map = new Map<string, number>();
  for (const [t, p] of results) {
    if (p != null) map.set(t, p);
  }
  return map;
}
