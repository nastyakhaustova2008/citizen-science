import { getObservation, getUser } from '../data/mockData';
import { METRICS } from '../data/metrics';
import { toISODate, formatTime } from './format';

/** Flatten a measurement into a plain export row. */
function toRow(m) {
  const obs = getObservation(m.observationId);
  const user = getUser(m.userId);
  const metric = METRICS[obs?.metric];
  return {
    id: m.id,
    campaign: obs?.titleEn ?? m.observationId,
    metric: obs?.metric ?? '',
    date: toISODate(m.timestamp),
    time: formatTime(m.timestamp, 'en'),
    timestamp: m.timestamp,
    place: m.placeLabel,
    school: user?.school ?? '',
    lat: m.lat,
    lng: m.lng,
    value: m.value,
    unit: metric?.unit ?? '',
    instrument: m.instrument,
    conditions: m.conditions,
    notes: m.notes ?? '',
    verification: m.verification,
  };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(measurements) {
  const rows = measurements.map(toRow);
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(',')),
  ];
  return lines.join('\n');
}

export function toJSON(measurements) {
  return JSON.stringify(measurements.map(toRow), null, 2);
}

export function toGeoJSON(measurements) {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: measurements.map((m) => {
        const row = toRow(m);
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [m.lng, m.lat] },
          properties: row,
        };
      }),
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

export function exportMeasurements(measurements, format, baseName = 'measurements') {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') downloadFile(`${baseName}-${stamp}.csv`, toCSV(measurements), 'csv');
  if (format === 'json') downloadFile(`${baseName}-${stamp}.json`, toJSON(measurements), 'json');
  if (format === 'geojson')
    downloadFile(`${baseName}-${stamp}.geojson`, toGeoJSON(measurements), 'geojson');
}
