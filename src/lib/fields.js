import { METRICS, DEFAULT_COLORS } from '../data/metrics';
import { formatNumber, formatDate, formatTime } from './format';
import { cleanComment, textSafetyError } from './comments';

/**
 * Form engine: campaign field definitions (tables campaign_fields / campaign_field_options,
 * see supabase/migrations/004_form_engine.sql) and the values measurements store under
 * each field key (measurements.field_values).
 *
 * Validation rules and error codes mirror the database trigger
 * `measurements_validate_values()` — keep both in sync.
 */

export const TEXT_MAX = { short: 200, long: 2000 };

/* ------------------------------------------------------------------ */
/* Measurement text, place name, date (018)                            */
/* ------------------------------------------------------------------ */

/** Place name: one line, ≤ 120 characters (= measurements_validate_values, key _place). */
export const PLACE_MAX = 120;

/** Earliest / latest measurement date (= private.measurement_date_ok). */
export const MEASURED_AT_MIN = Date.parse('2000-01-01T00:00:00Z');
export const MEASURED_AT_AHEAD_MS = 24 * 60 * 60 * 1000;

/** Content codes: the value was read fine, but its text breaks a rule (not a changed form). */
export const TEXT_CODES = [
  'too_long',
  'phone_not_allowed',
  'email_not_allowed',
  'link_not_allowed',
  'link_shortener',
  'link_domain_not_allowed',
];

const SPACE_RUN = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g;

/** Stored form of a text value (= private.measurement_clean): comment rules; '' → ''. */
export function cleanText(text, singleLine = false) {
  const c = cleanComment(text);
  return singleLine ? c.replace(SPACE_RUN, ' ') : c;
}

/** Characters (code points), as Postgres char_length counts them. */
const charLength = (text) => [...text].length;

/**
 * Code for a cleaned text (= private.measurement_text_error): too_long, a safety code
 * (comments' rules: no phones, emails, links outside the allowed domains) or null.
 * domains null = not loaded: the domain check is left to the server.
 */
export function textError(cleaned, max, domains) {
  if (!cleaned) return null;
  if (charLength(cleaned) > max) return 'too_long';
  return textSafetyError(cleaned, domains)?.code || null;
}

/** Place name error code, or null. */
export const placeLabelError = (text, domains) => textError(cleanText(text, true), PLACE_MAX, domains);

/** 'date_range' when the measurement date is before 2000 or more than a day ahead, else null. */
export function measuredAtError(date, now = Date.now()) {
  const ms = date instanceof Date ? date.getTime() : Date.parse(date);
  if (Number.isNaN(ms)) return null;
  return ms < MEASURED_AT_MIN || ms > now + MEASURED_AT_AHEAD_MS ? 'date_range' : null;
}

/** DB rows → the field shape the UI uses (camelCase, options sorted). */
export function fieldFromRow(row) {
  const options = (row.campaign_field_options || [])
    .map((o) => ({
      key: o.key,
      labelHe: o.label_he,
      labelEn: o.label_en,
      labelRu: o.label_ru,
      sortOrder: o.sort_order,
      archived: o.archived,
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  return {
    key: row.key,
    type: row.type,
    labelHe: row.label_he,
    labelEn: row.label_en,
    labelRu: row.label_ru,
    helpHe: row.help_he,
    helpEn: row.help_en,
    helpRu: row.help_ru,
    required: row.required,
    sortOrder: row.sort_order,
    archived: row.archived,
    isPrimary: row.is_primary,
    unit: row.unit,
    min: row.min_value == null ? null : Number(row.min_value),
    max: row.max_value == null ? null : Number(row.max_value),
    decimals: row.decimals,
    textLong: row.text_long,
    options,
  };
}

function localized(obj, base, locale) {
  if (!obj) return '';
  if (locale === 'en') return obj[`${base}En`] || obj[`${base}He`];
  if (locale === 'ru') return obj[`${base}Ru`] || obj[`${base}He`];
  return obj[`${base}He`];
}

export const fieldLabel = (field, locale) => localized(field, 'label', locale) || field?.key || '';
export const fieldHelp = (field, locale) => localized(field, 'help', locale) || '';

export function optionLabel(field, key, locale) {
  const o = field?.options?.find((x) => x.key === key);
  return o ? localized(o, 'label', locale) : key;
}

/** Fields shown in the form: not archived, in order. */
export function activeFields(campaign) {
  return (campaign?.fields || []).filter((f) => !f.archived);
}

export function hasValue(v) {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Fields to display / export for a set of measurements:
 * every active field, plus archived fields that still have data.
 */
export function visibleFields(campaign, measurements) {
  return (campaign?.fields || []).filter(
    (f) => !f.archived || measurements.some((m) => hasValue(m.values?.[f.key])),
  );
}

/* ------------------------------------------------------------------ */
/* Photo values (016)                                                  */
/* ------------------------------------------------------------------ */

/** A photo value that was deleted (moderator, its author, expiry, account deletion). */
export const PHOTO_REMOVED = 'removed';

const PHOTO_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$/;

/** A file name in the measurement-photos bucket. */
export function isPhotoPath(v) {
  return typeof v === 'string' && PHOTO_PATH_RE.test(v);
}

/**
 * 'stored' (a file in Storage), 'removed', or 'legacy' (true: attached before photos were
 * stored — there is no file).
 */
export function photoState(v) {
  if (isPhotoPath(v)) return 'stored';
  if (v === PHOTO_REMOVED) return 'removed';
  return 'legacy';
}

/* ------------------------------------------------------------------ */
/* Form input ↔ stored value                                           */
/* ------------------------------------------------------------------ */

/** Empty form state for one field. */
export function emptyInput(field) {
  if (field.type === 'multi_choice') return [];
  if (field.type === 'boolean' || field.type === 'photo') return null;
  return '';
}

/**
 * Convert what the form holds into the value stored in field_values.
 * Returns undefined for "not filled".
 * number: string from <input type=number> → Number (NaN is kept, so it fails validation).
 * datetime: local "yyyy-mm-ddThh:mm" → ISO string. photo: a picked image → true ("attached");
 * the wizard replaces it with the Storage path after the upload (016).
 */
export function inputToValue(field, raw) {
  switch (field.type) {
    case 'number': {
      const s = String(raw ?? '').trim().replace(',', '.');
      return s === '' ? undefined : Number(s);
    }
    case 'text':
    case 'choice': {
      const s = String(raw ?? '').trim();
      return s === '' ? undefined : s;
    }
    case 'multi_choice':
      return Array.isArray(raw) && raw.length ? raw : undefined;
    case 'boolean':
      return typeof raw === 'boolean' ? raw : undefined;
    case 'datetime': {
      if (!raw) return undefined;
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? 'invalid' : d.toISOString();
    }
    case 'photo':
      return raw ? true : undefined;
    default:
      return undefined;
  }
}

/**
 * Error code for one value, or null. Same codes as the database trigger.
 * domains: the allowed link domains for text values (null / undefined = left to the server).
 */
export function validateValue(field, value, domains = null) {
  // Text counts as it will be stored (cleaned); only invisible characters = not filled.
  if (field.type === 'text' && typeof value === 'string') value = cleanText(value);
  if (!hasValue(value)) return field.required ? 'required' : null;
  const activeOption = (k) => field.options.some((o) => o.key === k && !o.archived);
  switch (field.type) {
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'type';
      if (field.min != null && value < field.min) return 'min';
      if (field.max != null && value > field.max) return 'max';
      if (Number(value.toFixed(field.decimals ?? 0)) !== value) return 'decimals';
      return null;
    case 'text':
      if (typeof value !== 'string') return 'type';
      return textError(value, field.textLong ? TEXT_MAX.long : TEXT_MAX.short, domains);
    case 'boolean':
      return typeof value === 'boolean' ? null : 'type';
    case 'choice':
      if (typeof value !== 'string') return 'type';
      return activeOption(value) ? null : 'option';
    case 'multi_choice':
      if (!Array.isArray(value)) return 'type';
      if (new Set(value).size !== value.length) return 'duplicate';
      return value.every(activeOption) ? null : 'option';
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : 'type';
    case 'photo':
      return value === true || isPhotoPath(value) ? null : 'type';
    default:
      return 'type';
  }
}

/**
 * i18n params for an error message (fields.errors.<code>); `unit` includes its leading space,
 * `limit` = the text length limit (a text field, or the place name when field is null),
 * `domains` = the allowed link domains, comma-separated (link_domain_not_allowed).
 */
export function errorParams(field, domains = null) {
  return {
    min: field?.min,
    max: field?.max,
    limit: !field ? PLACE_MAX : field.textLong ? TEXT_MAX.long : TEXT_MAX.short,
    decimals: field?.decimals ?? 0,
    unit: field?.unit ? ` ${field.unit}` : '',
    domains: (domains || []).join(', '),
  };
}

/* ------------------------------------------------------------------ */
/* Display / export                                                    */
/* ------------------------------------------------------------------ */

/** Human-readable value in the current locale ('' when empty). */
export function formatFieldValue(field, value, { locale, t }) {
  if (!hasValue(value)) return '';
  switch (field.type) {
    case 'number':
      return `${formatNumber(value, { locale, decimals: field.decimals ?? 0 })}${field.unit ? ` ${field.unit}` : ''}`;
    case 'choice':
      return optionLabel(field, value, locale);
    case 'multi_choice':
      return value.map((k) => optionLabel(field, k, locale)).join(', ');
    case 'boolean':
      return value ? t('common.yes') : t('common.no');
    case 'datetime':
      return `${formatDate(value, locale)} ${formatTime(value, locale)}`;
    case 'photo':
      return t(`fields.photo.${photoState(value)}`);
    default:
      return String(value);
  }
}

/** Stable, locale-independent export value (option keys, not labels); null when empty. */
export function exportFieldValue(field, value) {
  if (!hasValue(value)) return null;
  if (field.type === 'multi_choice') return value.join(';');
  if (field.type === 'photo') return photoState(value) === 'removed' ? 'removed' : 'yes';
  return value;
}

/** Sort key for table columns (numbers, labels, booleans…). */
export function sortValue(field, value, locale) {
  if (!hasValue(value)) return null;
  if (field.type === 'number') return value;
  if (field.type === 'boolean') return value ? 1 : 0;
  if (field.type === 'choice') return optionLabel(field, value, locale);
  if (field.type === 'multi_choice') return value.map((k) => optionLabel(field, k, locale)).join(', ');
  return String(value);
}

/* ------------------------------------------------------------------ */
/* Primary field → colour scale                                        */
/* ------------------------------------------------------------------ */

function niceStep(span) {
  if (!(span > 0)) return 1;
  const raw = span / 8;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * pow;
}

/**
 * Scale for the campaign's primary field (map colours, legend, charts, stats), or null
 * when the campaign has no primary field.
 * `campaign.metric` (optional) names a preset in metrics.js with colours, colour range,
 * the soft "plausible" range and histogram step. Without a preset: default colours over
 * the field's min–max, or over the data (`values`) when min/max are not set.
 */
export function buildScale(campaign, values = []) {
  const field = campaign?.primaryField;
  if (!field) return null;
  const preset = METRICS[campaign.metric] || null;
  let domain = preset?.domain;
  if (!domain) {
    const nums = values.filter((v) => typeof v === 'number');
    const lo = field.min ?? (nums.length ? Math.min(...nums) : 0);
    const hi = field.max ?? (nums.length ? Math.max(...nums) : lo + 1);
    domain = [lo, hi > lo ? hi : lo + 1];
  }
  return {
    field,
    unit: field.unit || '',
    decimals: field.decimals ?? 0,
    domain,
    colors: preset?.colors || DEFAULT_COLORS,
    plausible: preset?.plausible || null,
    histogramStep: preset?.histogramStep || niceStep(domain[1] - domain[0]),
  };
}
