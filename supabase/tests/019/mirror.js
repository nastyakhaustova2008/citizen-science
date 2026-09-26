// 019 mirror test, JS side: the numbers of measurement_lab_stats (as the client reads them,
// labStatsFromRpc) must equal the same numbers computed in JS from the raw rows (mirror.sql),
// with the algorithms the client used before 019 (mean, sample stddev, UTC days, daily mean
// rounded to 2 places, histogram with half-open bins [i·step, (i+1)·step)).
// Bundled with esbuild and run by run.sh:  node mirror.mjs <sql-output.json>
import fs from 'node:fs';
import { labStatsFromRpc } from '../../../src/lib/measurementsApi.js';

const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const near = (a, b) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)));
let bad = 0;

for (const c of cases) {
  const got = labStatsFromRpc(c.rpc);
  const rows = c.rows || [];
  const vals = rows.map((r) => r[1]).filter((v) => typeof v === 'number');
  const mean = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  const stddev = vals.length > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / (vals.length - 1)) : null;
  const day = (t) => t.slice(0, 10);
  const byDay = new Map();
  for (const [t, v] of rows) if (typeof v === 'number') byDay.set(day(t), [...(byDay.get(day(t)) || []), v]);
  const daily = [...byDay.entries()]
    .map(([d, vs]) => ({ day: d, value: Number((vs.reduce((a, b) => a + b, 0) / vs.length).toFixed(2)), n: vs.length }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const step = got.step; // the server may widen the wished step; checked separately below
  const bins = new Map();
  for (const v of vals) bins.set(Math.floor(v / step), (bins.get(Math.floor(v / step)) || 0) + 1);

  const checks = {
    n: got.n === rows.length,
    valueN: got.valueN === vals.length,
    mean: near(got.mean, mean),
    stddev: near(got.stddev, stddev),
    min: got.min === (vals.length ? Math.min(...vals) : null),
    max: got.max === (vals.length ? Math.max(...vals) : null),
    days: got.days === new Set(rows.map((r) => day(r[0]))).size,
    daily: JSON.stringify(got.daily) === JSON.stringify(daily),
    histSum: got.histogram.reduce((a, b) => a + b.count, 0) === vals.length,
    histBins: got.histogram.every((b) => (bins.get(Math.round(b.start / step)) || 0) === b.count),
    histSpan: got.histogram.length <= 200,
    stepKeptOrWidened: step >= c.step,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length) bad++;
  console.log(`${failed.length ? 'DIFF' : '    '} ${c.lab.padEnd(22)} step ${String(c.step).padEnd(6)} → ${String(step).padEnd(6)} rows ${rows.length}${failed.length ? `  failed: ${failed.join(', ')}` : ''}`);
}
console.log(`\nmirror 019: ${cases.length} cases, ${bad} mismatches`);
process.exit(bad ? 1 : 0);
