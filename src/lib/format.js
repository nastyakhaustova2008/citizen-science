import { REFERENCE_DATE } from '../data/mockData';

const LOCALE_TAG = { he: 'he-IL', en: 'en-GB', ru: 'ru-RU' };

export function localeTag(locale) {
  return LOCALE_TAG[locale] || 'he-IL';
}

/** Format a number with fixed decimals and locale digit grouping. */
export function formatNumber(value, { locale = 'he', decimals = 0 } = {}) {
  if (value == null || Number.isNaN(Number(value))) return '—';
  return new Intl.NumberFormat(localeTag(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(value));
}

export function formatValueWithUnit(value, unit, { locale = 'he', decimals = 1 } = {}) {
  return `${formatNumber(value, { locale, decimals })} ${unit}`;
}

export function formatDate(iso, locale = 'he') {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(localeTag(locale), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

export function formatTime(iso, locale = 'he') {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat(localeTag(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

export function formatMonthYear(year, month, locale = 'he') {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: 'long',
    year: 'numeric',
  }).format(new Date(year, month, 1));
}

export function formatMonthShort(year, month, locale = 'he') {
  return new Intl.DateTimeFormat(localeTag(locale), { month: 'short' }).format(new Date(year, month, 1));
}

/**
 * Relative time against the dataset's reference "now".
 * Returns a { key, count } pair for the i18n layer to render.
 */
export function relativeTime(iso, now = REFERENCE_DATE) {
  const then = typeof iso === 'string' ? new Date(iso) : iso;
  const diffMs = now.getTime() - then.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 2) return { key: 'time.now' };
  if (min < 60) return { key: 'time.minutesAgo', count: min };
  const hours = Math.round(min / 60);
  if (hours < 24) return { key: 'time.hoursAgo', count: hours };
  const days = Math.round(hours / 24);
  if (days < 14) return { key: 'time.daysAgo', count: days };
  const weeks = Math.round(days / 7);
  return { key: 'time.weeksAgo', count: weeks };
}

/** ISO date (yyyy-mm-dd) for grouping / range inputs. */
export function toISODate(iso) {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toISOString().slice(0, 10);
}

export function coordLabel(n) {
  return Number(n).toFixed(5);
}
