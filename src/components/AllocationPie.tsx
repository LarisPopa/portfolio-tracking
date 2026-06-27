import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Holding } from '../lib/analytics';
import { money, pct as fmtPct } from '../lib/format';

const COLORS = [
  '#4f8bff', '#3ddc97', '#c490ff', '#ff9e6b', '#56d4ff', '#f0c674',
  '#ff6b6b', '#7adcb6', '#a99bff', '#ffb78a', '#82e9de', '#ffd989',
];

export function AllocationPie({ holdings }: { holdings: Holding[] }) {
  const open = holdings.filter((h) => h.qty > 1e-6 && h.costBasis > 0);
  const total = open.reduce((s, h) => s + h.costBasis, 0);
  const data = open
    .map((h) => ({ name: h.ticker, value: h.costBasis, instrument: h.instrument }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 15);

  return (
    <div className="card">
      <h3>Allocation by cost basis ({open.length} positions)</h3>
      {data.length === 0 ? (
        <div className="dim" style={{ padding: 40, textAlign: 'center' }}>No open positions.</div>
      ) : (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" innerRadius={50} outerRadius={100} paddingAngle={1}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} stroke="var(--bg-1)" />
                ))}
              </Pie>
              <Tooltip
                content={({ active, payload }: any) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload;
                  return (
                    <div className="tooltip">
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.instrument} ({d.name})</div>
                      <div className="row"><span className="name">Cost basis</span><span>{money(d.value)}</span></div>
                      <div className="row"><span className="name">Share</span><span>{fmtPct((d.value / total) * 100)}</span></div>
                    </div>
                  );
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
