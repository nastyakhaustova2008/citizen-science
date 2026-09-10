/**
 * Per-metric configuration: display, plausible range (used for the wizard
 * "are you sure?" warning), and a muted colour scale for the map + legend.
 *
 * `domain` is [min, max] for the colour ramp. `colors` are sampled left→right.
 */

export const METRICS = {
  temperature: {
    key: 'temperature',
    labelHe: 'טמפרטורה',
    labelEn: 'Temperature',
    labelRu: 'Температура',
    unit: '°C',
    decimals: 1,
    domain: [16, 46],
    plausible: [18, 45],
    colors: ['#3E6B8A', '#5A7A5F', '#C9B037', '#B8862F', '#A6462F'],
    histogramStep: 4,
  },
  humidity: {
    key: 'humidity',
    labelHe: 'לחות אבסולוטית',
    labelEn: 'Absolute humidity',
    labelRu: 'Абсолютная влажность',
    unit: 'g/m³',
    decimals: 1,
    domain: [4, 22],
    plausible: [3, 24],
    colors: ['#C9B994', '#9FB58A', '#5A7A5F', '#3E6B8A', '#2F5568'],
    histogramStep: 3,
  },
  skyBrightness: {
    key: 'skyBrightness',
    labelHe: 'בהירות שמיים',
    labelEn: 'Sky brightness',
    labelRu: 'Яркость неба',
    unit: 'mag/arcsec²',
    decimals: 2,
    domain: [16.5, 22],
    plausible: [15, 22.5],
    // bright sky (light pollution) -> dark sky
    colors: ['#D9A441', '#9A8F6B', '#5A6B7A', '#37475C', '#1F2A3A'],
    histogramStep: 1,
  },
  airQuality: {
    key: 'airQuality',
    labelHe: 'חלקיקים נשימים PM2.5',
    labelEn: 'Fine particles PM2.5',
    labelRu: 'Взвешенные частицы PM2.5',
    unit: 'µg/m³',
    decimals: 0,
    domain: [3, 65],
    plausible: [1, 90],
    colors: ['#5A7A5F', '#9FB58A', '#C9B037', '#B8862F', '#A6462F'],
    histogramStep: 10,
  },
};

export function metricLabel(metricKey, locale) {
  const m = METRICS[metricKey];
  if (!m) return metricKey;
  if (locale === 'en') return m.labelEn;
  if (locale === 'ru') return m.labelRu;
  return m.labelHe;
}

/** Linear interpolation between two hex colours. */
function lerpColor(a, b, t) {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 255;
  const ag = (ah >> 8) & 255;
  const ab = ah & 255;
  const br = (bh >> 16) & 255;
  const bg = (bh >> 8) & 255;
  const bb = bh & 255;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) + (rr << 16) + (rg << 8) + rb).toString(16).slice(1)}`;
}

/** Map a value to a colour on the metric's scale. */
export function colorForValue(metricKey, value) {
  const m = METRICS[metricKey];
  if (!m) return '#5A7A5F';
  const [min, max] = m.domain;
  const clamped = Math.max(min, Math.min(max, value));
  const frac = (clamped - min) / (max - min || 1);
  const segments = m.colors.length - 1;
  const scaled = frac * segments;
  const idx = Math.min(segments - 1, Math.floor(scaled));
  return lerpColor(m.colors[idx], m.colors[idx + 1], scaled - idx);
}

/** Evenly spaced legend stops for the gradient bar. */
export function legendStops(metricKey, steps = 5) {
  const m = METRICS[metricKey];
  if (!m) return [];
  const [min, max] = m.domain;
  return Array.from({ length: steps }, (_, i) => {
    const value = min + ((max - min) * i) / (steps - 1);
    return { value, color: colorForValue(metricKey, value) };
  });
}
