import { visibleFields, exportFieldValue } from './fields';
import { toISODate, formatTime } from './format';

/**
 * Flatten a measurement into a plain export row.
 * `obs` is the campaign the measurement belongs to (campaigns come from AppDataContext),
 * `fields` the fields to export (visibleFields: active + archived ones that have data).
 * Field columns are named by the permanent field key; choice values are option keys;
 * number fields also get a "<key>_unit" column.
 * `getAuthor` (from useAppData) resolves the author; only the (demo) school is exported,
 * never usernames.
 */
function toRow(m, obs, fields, getAuthor) {
  const user = getAuthor(m.userId);
  const row = {
    id: m.id,
    campaign: obs?.titleEn ?? m.observationId,
    date: toISODate(m.timestamp),
    time: formatTime(m.timestamp, 'en'),
    timestamp: m.timestamp,
    place: m.placeLabel ?? '',
    school: user?.school ?? '',
    lat: m.lat,
    lng: m.lng,
  };
  for (const f of fields) {
    row[f.key] = exportFieldValue(f, m.values?.[f.key]);
    if (f.type === 'number' && f.unit) row[`${f.key}_unit`] = f.unit;
  }
  row.verification = m.verification;
  row.form_version = m.formVersion ?? '';
  return row;
}

function toRows(measurements, observation, getAuthor = () => null) {
  const fields = visibleFields(observation, measurements);
  return measurements.map((m) => toRow(m, observation, fields, getAuthor));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(measurements, observation = null, getAuthor) {
  const rows = toRows(measurements, observation, getAuthor);
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(',')),
  ];
  return lines.join('\n');
}

export function toJSON(measurements, observation = null, getAuthor) {
  return JSON.stringify(toRows(measurements, observation, getAuthor), null, 2);
}

export function toGeoJSON(measurements, observation = null, getAuthor) {
  const rows = toRows(measurements, observation, getAuthor);
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: measurements.map((m, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
        properties: rows[i],
      })),
    },
    null,
    2,
  );
}

const MIME = {
  csv: 'text/csv;charset=utf-8',
  json: 'application/json',
  geojson: 'application/geo+json',
};

/**
 * Trigger a client-side file download. Uses an object URL + programmatic
 * click — this is the user's own explicit export action within the app.
 */
export function downloadFile(filename, content, kind = 'csv') {
  const blob = new Blob([content], { type: MIME[kind] || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * `observation` — the campaign all `measurements` belong to (for title and field columns).
 * `getAuthor` — author lookup from useAppData().
 */
export function exportMeasurements(measurements, format, observation = null, getAuthor) {
  const baseName = observation?.slug || 'measurements';
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv')
    downloadFile(`${baseName}-${stamp}.csv`, toCSV(measurements, observation, getAuthor), 'csv');
  if (format === 'json')
    downloadFile(`${baseName}-${stamp}.json`, toJSON(measurements, observation, getAuthor), 'json');
  if (format === 'geojson')
    downloadFile(`${baseName}-${stamp}.geojson`, toGeoJSON(measurements, observation, getAuthor), 'geojson');
}
