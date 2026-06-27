const fmtMoney = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const fmtMoneyCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const fmtNum = new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 });

export const money = (n: number | null | undefined): string =>
  n == null || isNaN(n) ? '–' : fmtMoney.format(n);

export const moneyCompact = (n: number | null | undefined): string =>
  n == null || isNaN(n) ? '–' : fmtMoneyCompact.format(n);

export const num = (n: number | null | undefined, dp = 4): string => {
  if (n == null || isNaN(n)) return '–';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: dp }).format(n);
};

export const pct = (n: number | null | undefined, dp = 2): string => {
  if (n == null || isNaN(n)) return '–';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(dp)}%`;
};

export const signClass = (n: number | null | undefined): '' | 'green' | 'red' => {
  if (n == null || isNaN(n) || n === 0) return '';
  return n > 0 ? 'green' : 'red';
};
