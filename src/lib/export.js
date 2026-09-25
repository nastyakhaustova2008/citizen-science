import { getUser } from '../data/mockData';
import { visibleFields, exportFieldValue } from './fields';
import { toISODate, formatTime } from './format';

/**
 * Flatten a measurement into a plain export row.
 * `obs` is the campaign the measurement belongs to (campaigns come from AppDataContext),
 * `fields` the fields to export (visibleFields: active + archived ones that have data).
 * Field columns are named by the permanent field key; choice values are option keys;
 * number fields also get a "<key>_unit" column.
 */
function toRow(m, obs, fields) {
  const user = getUser(m.userId);
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

function toRows(measurements, observation) {
  const fields = visibleFields(observation, measurements);
  return measurements.map((m) => toRow(m, observation, fields));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(measurements, observation = null) {
  const rows = toRows(measurements, observation);
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(',')),
  ];
  return lines.join('\n');
}

export function toJSON(measurements, observation = null) {
  return JSON.stringify(toRows(measurements, observation), null, 2);
}

export function toGeoJSON(measurements, observation = null) {
  const rows = toRows(measurements, observation);
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

/** `observation` — the campaign all `measurements` belong to (for title and field columns). */
export function exportMeasurements(measurements, format, observation = null) {
  const baseName = observation?.slug || 'measurements';
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') downloadFile(`${baseName}-${stamp}.csv`, toCSV(measurements, observation), 'csv');
  if (format === 'json')
    downloadFile(`${baseName}-${stamp}.json`, toJSON(measurements, observation), 'json');
  if (format === 'geojson')
    downloadFile(`${baseName}-${stamp}.geojson`, toGeoJSON(measurements, observation), 'geojson');
}
