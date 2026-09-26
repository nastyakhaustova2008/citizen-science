/**
 * Reading measurements (audit H5): never the whole table in one request — see src/lib/paging.js.
 *   - map of a lab:     fetchLabPoints()   — lean rows, all of them up to MAP_CAP
 *   - one point:        fetchMeasurement() — the full row (point panel)
 *   - data table:       fetchLabPage()     — one page, filters / sort / search on the server
 *   - export:           fetchLabAll()      — same filters, all rows up to EXPORT_CAP
 *   - profile:          fetchUserPoints()  — one user's rows up to PROFILE_CAP (logged-in only)
 *   - numbers / charts: fetchLabStats(), fetchSummary() — aggregate RPCs (migration 019)
 * Inserting stays in AppDataContext (addMeasurement).
 *
 * Logged-out visitors (audit H2, migration 020): the anon role may read only the columns in
 * PUBLIC_MEASUREMENT_COLUMNS — no user_id, no created_at. Selecting, filtering or sorting by
 * those as anon fails with 42501, so every read here takes `withAuthor` (true only with a
 * session) and never mentions them otherwise. Ordering uses measured_at + id (granted to anon).
 */
import { supabase } from './supabase';
import { fetchAllPaged, fetchPage } from './paging';
import { optionLabel } from './fields';

export const MAP_CAP = 5000;
export const EXPORT_CAP = 20000;
export const PROFILE_CAP = 2000;
export const TABLE_PAGE = 50;

export const MEASUREMENT_COLUMNS =
  'id, observation_id, user_id, place_label, lat, lng, measured_at, verification, photo_seed, field_values, form_version';
/** The same without the author: what logged-out visitors may read (grant in migration 020). */
export const PUBLIC_MEASUREMENT_COLUMNS =
  'id, observation_id, place_label, lat, lng, measured_at, verification, photo_seed, field_values, form_version';

const columns = (withAuthor) => (withAuthor ? MEASUREMENT_COLUMNS : PUBLIC_MEASUREMENT_COLUMNS);

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/; // campaign_fields.key (SQL check) — safe inside a query string

function db() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

/** DB row (snake_case) → the Measurement shape the UI uses (see mockData.js). */
export function fromRow(row) {
  return {
    id: row.id,
    observationId: row.observation_id,
    userId: row.user_id ?? null, // not read for logged-out visitors
    placeLabel: row.place_label || '',
    lat: row.lat,
    lng: row.lng,
    timestamp: row.measured_at,
    values: row.field_values || {},
    formVersion: row.form_version,
    verification: row.verification,
    photoSeed: row.photo_seed,
  };
}

// ---- map ------------------------------------------------------------------------------------

/**
 * Map points of one lab: id, place, date, status and the primary value only (no author, no
 * other values — the point panel loads the full row). → { points, total, capped }
 */
export async function fetchLabPoints(campaign, { signal } = {}) {
  const key = campaign.primaryField?.key;
  const cols = `id, lat, lng, measured_at, verification${key && KEY_RE.test(key) ? `, pv:field_values->${key}` : ''}`;
  const { rows, total, capped } = await fetchAllPaged(
    (o) =>
      db()
        .from('measurements')
        .select(cols, o)
        .eq('observation_id', campaign.id)
        .order('measured_at', { ascending: false })
        .order('id', { ascending: false }),
    { cap: MAP_CAP, signal },
  );
  const points = rows.map((r) => ({
    id: r.id,
    observationId: campaign.id,
    lat: r.lat,
    lng: r.lng,
    timestamp: r.measured_at,
    verification: r.verification,
    value: typeof r.pv === 'number' ? r.pv : null,
  }));
  return { points, total, capped };
}

/** The full row of one measurement, or null. `withAuthor`: also user_id (logged-in only). */
export async function fetchMeasurement(id, { withAuthor = false } = {}) {
  const { data, error } = await db().from('measurements').select(columns(withAuthor)).eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data) : null;
}

// ---- table: filters, search, sort ----------------------------------------------------------

/** LIKE pattern text: \ % _ match literally. (`*` can't: PostgREST turns every * into %.) */
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/\*/g, '_');
}

/** A value inside PostgREST's or=(…): double-quoted, so , . : ( ) are plain text; \ and " escaped. */
function quoted(s) {
  return `"${s.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/** `*text*` as a quoted ilike operand that matches `text` literally (see likeEscape for `*`). */
export function containsPattern(text) {
  return quoted(`*${likeEscape(text)}*`);
}

/** Fields the search looks into: text values, and the option labels (current language) of choices. */
const SEARCH_TYPES = ['text', 'choice', 'multi_choice'];

/**
 * The PostgREST or=(…) filter for the table search, or null (empty query).
 * Place name and text fields: case-insensitive "contains". Choice fields: the options whose key or
 * label (in `locale`) contains the query. User input only ever appears quoted and escaped, so it
 * can't add conditions or change the filter's structure.
 */
export function searchFilter(query, fields, locale) {
  const q = (query || '').trim();
  if (!q) return null;
  const lower = q.toLowerCase();
  const parts = [`place_label.ilike.${containsPattern(q)}`];
  for (const f of fields) {
    if (!SEARCH_TYPES.includes(f.type) || !KEY_RE.test(f.key)) continue;
    if (f.type === 'text') {
      parts.push(`field_values->>${f.key}.ilike.${containsPattern(q)}`);
      continue;
    }
    const keys = (f.options || [])
      .filter((o) => KEY_RE.test(o.key))
      .filter((o) => `${o.key} ${optionLabel(f, o.key, locale)}`.toLowerCase().includes(lower))
      .map((o) => o.key);
    if (!keys.length) continue;
    if (f.type === 'choice') parts.push(`field_values->>${f.key}.in.(${keys.join(',')})`);
    // multi_choice: the stored array's text contains "<key>" (with the quotes)
    else for (const k of keys) parts.push(`field_values->>${f.key}.ilike.${containsPattern(`"${k}"`)}`);
  }
  return parts.join(',');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function nextDay(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Sort keys the server can apply: built-ins and these field types (not choices / photos). */
export const SORTABLE_TYPES = ['number', 'datetime', 'boolean', 'text'];

/**
 * The table's query for one lab.
 * state: { fields, locale, sort: {key, dir}, from, to ('YYYY-MM-DD', UTC days like the table
 * shows), query, userIds (null = everyone; the demo "school" filter), withAuthor (logged in:
 * also user_id; without it user_id is neither read nor filtered — userIds is ignored) }.
 */
function labQuery(campaign, state, options) {
  const { fields = [], locale, sort = { key: 'timestamp', dir: 'desc' }, from, to, query, userIds, withAuthor } = state;
  let q = db().from('measurements').select(columns(withAuthor), options).eq('observation_id', campaign.id);
  if (from && DATE_RE.test(from)) q = q.gte('measured_at', `${from}T00:00:00Z`);
  if (to && DATE_RE.test(to)) q = q.lt('measured_at', `${nextDay(to)}T00:00:00Z`);
  if (userIds && withAuthor) q = q.in('user_id', userIds);
  const search = searchFilter(query, fields, locale);
  if (search) q = q.or(search);

  const asc = sort.dir === 'asc';
  const field = sort.key.startsWith('f:') ? fields.find((f) => `f:${f.key}` === sort.key) : null;
  if (field && SORTABLE_TYPES.includes(field.type) && KEY_RE.test(field.key)) {
    // jsonb order: numbers numerically, strings (ISO dates, text) as text; empty cells last.
    q = q.order(`field_values->${field.key}`, { ascending: asc, nullsFirst: false });
  } else if (sort.key === 'place') q = q.order('place_label', { ascending: asc, nullsFirst: false });
  else if (sort.key === 'status') q = q.order('verification', { ascending: asc });
  if (sort.key !== 'timestamp') q = q.order('measured_at', { ascending: false });
  else q = q.order('measured_at', { ascending: asc });
  return q.order('id', { ascending: sort.key === 'timestamp' ? asc : false });
}

/** One table page → { rows (Measurement), total }. */
export async function fetchLabPage(campaign, state, page, { signal } = {}) {
  const { rows, total } = await fetchPage((o) => labQuery(campaign, state, o), page, TABLE_PAGE, { signal });
  return { rows: rows.map(fromRow), total };
}

/** Every row for the export (same filters and order), up to EXPORT_CAP → { rows, total, capped }. */
export async function fetchLabAll(campaign, state, { onProgress, signal } = {}) {
  const res = await fetchAllPaged((o) => labQuery(campaign, state, o), { cap: EXPORT_CAP, onProgress, signal });
  return { ...res, rows: res.rows.map(fromRow) };
}

// ---- profile --------------------------------------------------------------------------------

/**
 * One user's measurements, newest first, up to PROFILE_CAP → { rows, total, capped }.
 * Logged-in users only (filters by user_id; the profile page doesn't call it logged out).
 */
export async function fetchUserPoints(userId, { signal } = {}) {
  const res = await fetchAllPaged(
    (o) =>
      db()
        .from('measurements')
        .select('id, observation_id, lat, lng, measured_at, field_values', o)
        .eq('user_id', userId)
        .order('measured_at', { ascending: false })
        .order('id', { ascending: false }),
    { cap: PROFILE_CAP, signal },
  );
  return { ...res, rows: res.rows.map(fromRow) };
}

// ---- aggregates (019) -----------------------------------------------------------------------

/**
 * Home page numbers: { total, labs: {campaignId: {n, participants, min, max, cells: [{lat, lng,
 * value, n}], cellsTotal}} }. Errors (also: 019 not run yet) are thrown → error state.
 */
export async function fetchSummary() {
  const { data, error } = await db().rpc('measurement_summary');
  if (error) throw error;
  const labs = {};
  for (const [id, l] of Object.entries(data?.labs || {})) {
    labs[id] = {
      n: Number(l.n) || 0,
      participants: Number(l.participants) || 0,
      min: l.min ?? null,
      max: l.max ?? null,
      cells: (l.cells || []).map(([lat, lng, value, n]) => ({ lat: Number(lat), lng: Number(lng), value, n })),
      cellsTotal: Number(l.cells_total) || 0,
    };
  }
  return { total: Number(data?.total) || 0, labs };
}

const round2 = (v) => (v == null ? null : Number(Number(v).toFixed(2)));

/**
 * All measurements of one lab, aggregated on the server (complete, never cut).
 * `step` = wished histogram width (the server may widen it; ≤ 200 bins).
 * → { n, valueN, mean, stddev, min, max, days, step, daily: [{day, value, n}],
 *     histogram: [{start, end, label, count}], keys: Set } or null (lab not visible).
 */
export async function fetchLabStats(campaignId, step) {
  const { data, error } = await db().rpc('measurement_lab_stats', { p_campaign: campaignId, p_step: step });
  if (error) throw error;
  return labStatsFromRpc(data);
}

/** measurement_lab_stats jsonb → the shape above (exported for supabase/tests/019/mirror.js). */
export function labStatsFromRpc(data) {
  if (!data) return null;
  const s = Number(data.step);
  const counts = new Map((data.hist || []).map(([bin, n]) => [Number(bin), Number(n)]));
  const bins = [...counts.keys()];
  const histogram = [];
  if (bins.length) {
    // The server keeps the span ≤ 200 bins, so filling the gaps stays small.
    for (let b = Math.min(...bins); b <= Math.max(...bins); b++) {
      const start = Number((b * s).toFixed(6));
      const end = Number(((b + 1) * s).toFixed(6));
      histogram.push({
        start,
        end,
        label: `${Number(start.toFixed(1))}–${Number(end.toFixed(1))}`,
        count: counts.get(b) || 0,
      });
    }
  }
  return {
    n: Number(data.n) || 0,
    valueN: Number(data.value_n) || 0,
    mean: data.mean ?? null,
    stddev: data.stddev ?? null,
    min: data.min ?? null,
    max: data.max ?? null,
    days: Number(data.days) || 0,
    step: s,
    daily: (data.daily || []).map(([day, mean, n]) => ({ day, value: round2(mean), n: Number(n) })),
    histogram,
    keys: new Set(data.keys || []),
  };
}
