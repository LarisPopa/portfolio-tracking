import * as XLSX from 'xlsx';

// XTB exports cash operations as one of these `Type` strings. We bucket them
// into semantic categories the rest of the app reasons about.
export type CashOpKind =
  | 'deposit'
  | 'withdrawal'
  | 'transfer'
  | 'buy'
  | 'sell'
  | 'dividend'
  | 'tax'
  | 'fee'
  | 'interest'
  | 'other';

export interface CashOp {
  date: Date;
  rawType: string;
  kind: CashOpKind;
  ticker: string;
  instrument: string;
  amount: number;
  comment: string;
}

export interface ClosedPosition {
  instrument: string;
  category: string;
  ticker: string;
  side: string;
  volume: number;
  openPrice: number;
  openTime: Date;
  closePrice: number;
  closeTime: Date;
  profitLoss: number;
  purchaseValue: number;
  saleValue: number;
}

export interface ParsedReport {
  cashOps: CashOp[];
  closed: ClosedPosition[];
  account: string;
  dateFrom?: Date;
  dateTo?: Date;
}

const KIND_MAP: Record<string, CashOpKind> = {
  Deposit: 'deposit',
  Withdrawal: 'withdrawal',
  Transfer: 'transfer',
  'Stock purchase': 'buy',
  'Stock sell': 'sell',
  Dividend: 'dividend',
  'Withholding tax': 'tax',
  'RO tax': 'tax',
  'SEC fee': 'fee',
  Commission: 'fee',
  'Free funds interest': 'interest',
};

function classify(type: string): CashOpKind {
  if (KIND_MAP[type]) return KIND_MAP[type];
  const lower = type.toLowerCase();
  if (lower.includes('tax')) return 'tax';
  if (lower.includes('fee') || lower.includes('commission')) return 'fee';
  if (lower.includes('dividend')) return 'dividend';
  if (lower.includes('interest')) return 'interest';
  return 'other';
}

function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return XLSX.SSF.parse_date_code(v) ? new Date(Date.UTC(0, 0, v - 1)) : undefined;
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? undefined : d;
  }
  return undefined;
}

function toNum(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[, ]/g, '');
    const n = Number(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
}

// Sheet headers don't sit on row 1 — the first 4 rows hold meta (account,
// title, date range). We find the actual header row by looking for the column
// names we expect.
function findHeaderRow(rows: unknown[][], needles: string[]): number {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const row = rows[i] ?? [];
    if (needles.every((n) => row.some((c) => String(c ?? '').trim() === n))) {
      return i;
    }
  }
  return -1;
}

function parseClosed(sheet: XLSX.WorkSheet): ClosedPosition[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headerIdx = findHeaderRow(rows, ['Instrument', 'Ticker', 'Open Price', 'Close Price']);
  if (headerIdx < 0) return [];
  const header = (rows[headerIdx] as string[]).map((s) => String(s ?? '').trim());
  const idx = (name: string) => header.indexOf(name);
  const out: ClosedPosition[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const instrument = String(r[idx('Instrument')] ?? '').trim();
    if (!instrument || instrument.toLowerCase() === 'total') continue;
    const ticker = String(r[idx('Ticker')] ?? '').trim();
    if (!ticker) continue;
    const openTime = toDate(r[idx('Open Time (UTC)')]);
    const closeTime = toDate(r[idx('Close Time (UTC)')]);
    if (!openTime || !closeTime) continue;
    out.push({
      instrument,
      category: String(r[idx('Category')] ?? '').trim(),
      ticker,
      side: String(r[idx('Type')] ?? '').trim(),
      volume: toNum(r[idx('Volume')]),
      openPrice: toNum(r[idx('Open Price')]),
      openTime,
      closePrice: toNum(r[idx('Close Price')]),
      closeTime,
      profitLoss: toNum(r[idx('Profit/Loss')]),
      purchaseValue: toNum(r[idx('Purchase Value')]),
      saleValue: toNum(r[idx('Sale Value')]),
    });
  }
  return out;
}

function parseCash(sheet: XLSX.WorkSheet): CashOp[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  const headerIdx = findHeaderRow(rows, ['Type', 'Time', 'Amount']);
  if (headerIdx < 0) return [];
  const header = (rows[headerIdx] as string[]).map((s) => String(s ?? '').trim());
  const idx = (name: string) => header.indexOf(name);
  const out: CashOp[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const type = String(r[idx('Type')] ?? '').trim();
    if (!type || type.toLowerCase() === 'total') continue;
    const date = toDate(r[idx('Time')]);
    if (!date) continue;
    out.push({
      date,
      rawType: type,
      kind: classify(type),
      ticker: String(r[idx('Ticker')] ?? '').trim(),
      instrument: String(r[idx('Instrument')] ?? '').trim(),
      amount: toNum(r[idx('Amount')]),
      comment: String(r[idx('Comment')] ?? '').trim(),
    });
  }
  return out;
}

function readMeta(sheet: XLSX.WorkSheet): { account: string; from?: Date; to?: Date } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  let account = '';
  let from: Date | undefined;
  let to: Date | undefined;
  for (const row of rows.slice(0, 6)) {
    const key = String(row?.[0] ?? '').trim();
    const val = row?.[1];
    if (key === 'Account' || key === 'Account number') account = String(val ?? '');
    if (key === 'Date from (UTC)') from = toDate(val);
    if (key === 'Date to (UTC)') to = toDate(val);
  }
  return { account, from, to };
}

export async function parseXtbReport(file: File | ArrayBuffer): Promise<ParsedReport> {
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const closedSheet = wb.Sheets['Closed Positions'];
  const cashSheet = wb.Sheets['Cash Operations'];
  if (!closedSheet && !cashSheet) {
    throw new Error('Workbook does not contain "Closed Positions" or "Cash Operations" sheets — is this an XTB export?');
  }
  const closed = closedSheet ? parseClosed(closedSheet) : [];
  const cashOps = cashSheet ? parseCash(cashSheet) : [];
  const meta = closedSheet ? readMeta(closedSheet) : cashSheet ? readMeta(cashSheet) : { account: '' };
  cashOps.sort((a, b) => a.date.getTime() - b.date.getTime());
  closed.sort((a, b) => a.closeTime.getTime() - b.closeTime.getTime());
  return {
    cashOps,
    closed,
    account: meta.account,
    dateFrom: meta.from,
    dateTo: meta.to,
  };
}
