import { toISODate } from './format';

export function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stddev(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function minMax(values) {
  if (!values.length) return { min: null, max: null };
  return { min: Math.min(...values), max: Math.max(...values) };
}

/** Number of distinct calendar days covered by the measurements. */
export function dayCoverage(measurements) {
  return new Set(measurements.map((m) => toISODate(m.timestamp))).size;
}

/**
 * All functions below work on `m.value` — the campaign's primary field value
 * (set by AppDataContext; null when missing). Missing values are skipped.
 */
const hasNum = (m) => typeof m.value === 'number';

export function summarize(measurements) {
  const values = measurements.map((m) => m.value).filter((v) => typeof v === 'number');
  const { min, max } = minMax(values);
  return {
    count: values.length,
    mean: mean(values),
    stddev: stddev(values),
    min,
    max,
    range: min != null ? max - min : null,
    coverageDays: dayCoverage(measurements),
  };
}

/** Daily mean series, sorted by date ascending. */
export function dailyMeanSeries(measurements) {
  const byDay = new Map();
  for (const m of measurements.filter(hasNum)) {
    const day = toISODate(m.timestamp);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(m.value);
  }
  return [...byDay.entries()]
    .map(([day, vals]) => ({ day, value: Number(mean(vals).toFixed(2)), n: vals.length }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** Histogram buckets of a fixed step, spanning the data. */
export function histogram(measurements, step) {
  const values = measurements.filter(hasNum).map((m) => m.value);
  if (!values.length) return [];
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.ceil(Math.max(...values) / step) * step;
  const buckets = [];
  for (let start = lo; start < hi; start += step) {
    buckets.push({
      start: Number(start.toFixed(2)),
      end: Number((start + step).toFixed(2)),
      label: `${Number(start.toFixed(1))}–${Number((start + step).toFixed(1))}`,
      count: 0,
    });
  }
  for (const v of values) {
    const idx = Math.min(buckets.length - 1, Math.floor((v - lo) / step));
    buckets[idx].count += 1;
  }
  return buckets;
}

/** Mean value grouped by a key extractor (e.g. school). */
export function meanByGroup(measurements, keyOf) {
  const groups = new Map();
  for (const m of measurements.filter(hasNum)) {
    const k = keyOf(m);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(m.value);
  }
  return [...groups.entries()]
    .map(([key, vals]) => ({ key, value: Number(mean(vals).toFixed(2)), n: vals.length }))
    .sort((a, b) => b.value - a.value);
}

/** Measurements per month for the last `months` months ending with `now`: [{ year, month, count }]. */
export function monthlyCounts(measurements, months = 12, now = new Date()) {
  const buckets = [];
  const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  for (let i = 0; i < months; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    buckets.push({ year: d.getFullYear(), month: d.getMonth(), count: 0 });
  }
  for (const m of measurements) {
    const d = new Date(m.timestamp);
    const bucket = buckets.find((b) => b.year === d.getFullYear() && b.month === d.getMonth());
    if (bucket) bucket.count += 1;
  }
  return buckets;
}
