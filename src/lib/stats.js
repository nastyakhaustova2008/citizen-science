// Per-lab statistics and chart series are computed by the database (measurement_lab_stats,
// migration 019) from every measurement — see src/lib/measurementsApi.js → fetchLabStats.

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
