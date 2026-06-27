// Parses Revolut "Profit and Loss Statement" PDFs exported from the Revolut app.
// The PDF contains one or two sections (USD and/or EUR), each with a Sells table
// and an Other income & fees (dividends) table. We skip RON equivalents and rates
// and extract only the primary-currency amounts.

export interface RevolutTrade {
  dateAcquired: Date;
  dateSold: Date;
  symbol: string;
  name: string;
  quantity: number;
  costBasis: number;
  grossProceeds: number;
  grossPnL: number;
  fees: number;
  currency: 'USD' | 'EUR';
}

export interface RevolutDividend {
  date: Date;
  symbol: string;
  name: string;
  grossAmount: number;
  withholdingTax: number;
  netAmount: number;
  currency: 'USD' | 'EUR';
}

export interface RevolutReport {
  accountName: string;
  period: { from: Date; to: Date } | null;
  trades: RevolutTrade[];
  dividends: RevolutDividend[];
}

// --- PDF text extraction -------------------------------------------------------

interface RawItem {
  text: string;
  x: number;
  y: number; // top-down (converted from PDF bottom-up)
  page: number;
}

interface TextLine {
  y: number;
  page: number;
  text: string;
}

async function extractLines(file: File): Promise<TextLine[]> {
  // Dynamic import keeps pdfjs out of the main bundle
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const all: RawItem[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const tx = item.transform as number[];
      const x = tx[4];
      const y = vp.height - tx[5]; // flip to top-down
      all.push({ text: item.str.trim(), x, y, page: p });
    }
  }

  // Sort: page → y (top to bottom) → x (left to right)
  all.sort((a, b) =>
    a.page !== b.page ? a.page - b.page :
    Math.abs(a.y - b.y) > 4 ? a.y - b.y :
    a.x - b.x,
  );

  // Group items whose y-coordinates are within 4 units into a single line
  const lines: TextLine[] = [];
  for (const item of all) {
    const last = lines[lines.length - 1];
    if (last && last.page === item.page && Math.abs(last.y - item.y) <= 4) {
      last.text += ' ' + item.text;
    } else {
      lines.push({ y: item.y, page: item.page, text: item.text });
    }
  }

  return lines;
}

// --- Amount parsing ------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

// Extract all primary-currency amounts from a line, handling -US$13 and US$1,234.56
function extractAmounts(text: string): number[] {
  const re = /(-?)(?:US\$|€)(-?)([\d,]+(?:\.[0-9]+)?)/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const val = parseFloat(m[3].replace(/,/g, ''));
    out.push(m[1] === '-' || m[2] === '-' ? -val : val);
  }
  return out;
}

// Lines containing only RON equivalents or exchange rates — skip these
function isSecondaryLine(text: string): boolean {
  return /\d[\d.]+\s+RON/.test(text) || /^Rate:\s/.test(text);
}

// --- Row parsers ---------------------------------------------------------------

function parseSellRow(text: string, currency: 'USD' | 'EUR'): RevolutTrade | null {
  const toks = text.split(/\s+/);
  // Must start with two dates
  if (!DATE_RE.test(toks[0]) || !DATE_RE.test(toks[1])) return null;

  const dateAcquired = parseDate(toks[0]);
  const dateSold = parseDate(toks[1]);
  const symbol = toks[2] ?? '';

  // Locate ISIN (2 letters + 9 alphanumeric + 1 digit = 12 chars)
  const isinIdx = toks.findIndex(t => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(t));
  const name = isinIdx > 3 ? toks.slice(3, isinIdx).join(' ') : '';
  // Quantity sits two positions after the ISIN (ISIN → country → qty)
  const qty = isinIdx >= 0 ? parseFloat(toks[isinIdx + 2] ?? '') : NaN;

  const amounts = extractAmounts(text);
  if (amounts.length < 3) return null;

  return {
    dateAcquired,
    dateSold,
    symbol,
    name,
    quantity: isNaN(qty) ? 0 : qty,
    costBasis: amounts[0],
    grossProceeds: amounts[1],
    grossPnL: amounts[2],
    fees: amounts[3] ?? 0,
    currency,
  };
}

function parseDividendRow(text: string, currency: 'USD' | 'EUR'): RevolutDividend | null {
  const toks = text.split(/\s+/);
  if (!DATE_RE.test(toks[0])) return null;

  const date = parseDate(toks[0]);
  const symbol = toks[1] ?? '';

  const isinIdx = toks.findIndex(t => /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(t));
  // Strip the " dividend" suffix Revolut appends to the security name
  const rawName = isinIdx > 2 ? toks.slice(2, isinIdx).join(' ') : '';
  const name = rawName.replace(/\s*dividend\s*/i, '').trim();

  const amounts = extractAmounts(text);
  if (amounts.length < 2) return null;

  return {
    date,
    symbol,
    name,
    grossAmount: amounts[0],
    withholdingTax: amounts[1],
    netAmount: amounts[2] ?? amounts[0] - amounts[1],
    currency,
  };
}

// --- Main entry point ---------------------------------------------------------

export async function parseRevolutReport(file: File): Promise<RevolutReport> {
  const lines = await extractLines(file);

  const trades: RevolutTrade[] = [];
  const dividends: RevolutDividend[] = [];
  let accountName = '';
  let period: { from: Date; to: Date } | null = null;
  let currency: 'USD' | 'EUR' = 'USD';

  type Section = 'none' | 'sells' | 'dividends';
  let section: Section = 'none';
  let sellsSeen = false; // guard: only enter dividends after sells

  for (const line of lines) {
    const t = line.text;

    // Detect which currency section we're in
    if (t.includes('USD Profit and Loss')) { currency = 'USD'; section = 'none'; sellsSeen = false; continue; }
    if (t.includes('EUR Profit and Loss')) { currency = 'EUR'; section = 'none'; sellsSeen = false; continue; }

    // Extract account name (first "Firstname Lastname" line)
    if (!accountName) {
      const nameMatch = t.match(/^([A-Z][a-z]+(?: [A-Z][a-z]+)+)$/);
      if (nameMatch && !t.includes('Statement')) accountName = nameMatch[1];
    }

    // Detect period "07 Nov 2023 - 26 Jun 2026"
    if (!period) {
      const pm = t.match(/(\d{2} \w+ \d{4})\s*[-–]\s*(\d{2} \w+ \d{4})/);
      if (pm) {
        const from = new Date(pm[1]);
        const to = new Date(pm[2]);
        if (!isNaN(from.getTime()) && !isNaN(to.getTime())) period = { from, to };
      }
    }

    // Section transitions
    if ((t === 'Sells' || (t.startsWith('Sells') && !t.includes('Summary') && !t.includes('Total'))) && t.length < 20) {
      section = 'sells'; continue;
    }
    if (t.includes('Other income & fees') && !t.includes('Summary')) {
      if (sellsSeen) { section = 'dividends'; continue; }
    }

    // End of table section
    if (t.startsWith('Total') || t.startsWith('Get help') || t.startsWith('© ') || t.startsWith('This statement')) {
      if (section === 'sells') sellsSeen = true;
      section = 'none'; continue;
    }

    // Skip column header rows and secondary (RON/Rate) lines
    if (t.startsWith('Date acquired') || t.startsWith('Date Description') || t.startsWith('Date\tDescription')) continue;
    if (isSecondaryLine(t)) continue;

    // Parse data rows
    if (section === 'sells') {
      const trade = parseSellRow(t, currency);
      if (trade) trades.push(trade);
    } else if (section === 'dividends') {
      const div = parseDividendRow(t, currency);
      if (div) dividends.push(div);
    }
  }

  return { accountName, period, trades, dividends };
}
