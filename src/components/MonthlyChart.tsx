import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from 'recharts';
import type { MonthlyPL } from '../lib/analytics';
import { money } from '../lib/format';

export function MonthlyChart({ data }: { data: MonthlyPL[] }) {
  return (
    <div className="card">
      <h3>Monthly P/L (realized + dividends)</h3>
      {data.length === 0 ? (
        <div className="dim" style={{ padding: 40, textAlign: 'center' }}>No closed P/L yet.</div>
      ) : (
        <div style={{ width: '100%', height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: '#a8b2bf', fontSize: 11 }} minTickGap={20} />
              <YAxis tick={{ fill: '#a8b2bf', fontSize: 11 }} tickFormatter={(v) => money(Number(v))} width={80} />
              <Tooltip content={<MonthTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
              <Bar dataKey="net" radius={[4, 4, 0, 0]}>
                {data.map((d) => (
                  <Cell key={d.month} fill={d.net >= 0 ? '#3ddc97' : '#ff6b6b'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function MonthTooltip({ active, payload, label }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0].payload as MonthlyPL;
  return (
    <div className="tooltip">
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div className="row"><span className="name">Realized</span><span>{money(d.realized)}</span></div>
      <div className="row"><span className="name">Dividends</span><span>{money(d.dividends)}</span></div>
      <div className="row"><span className="name">Net</span><span>{money(d.net)}</span></div>
    </div>
  );
}
