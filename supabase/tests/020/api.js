// 020 API tests (audit H2): a real PostgREST (db-max-rows = 1000, jwt-secret) on the test database
// after migration 020 and 020/tests.sql. run.sh builds this file with esbuild, pointing
// src/lib/supabase.js at a small local proxy (/rest/v1 → PostgREST, a stub of /auth/v1), so the
// app's own query code (src/lib/measurementsApi.js) runs unchanged through supabase-js.
//   node api20.mjs <postgrest url> <proxy port> <jwt secret> <identifiers.json>
// identifiers.json (dumped by run.sh) = every user id, username and anonymised id in the database,
// and the columns anon may read per table (`cols`; PostgREST's OpenAPI lists all columns of a
// table, not only the granted ones).
//
// 1. Logged out, generic: every table and every RPC the anon OpenAPI lists is called; no response
//    may contain a user id or username (or a key like user_id / username / actor_id …).
// 2. Logged out, probes: selecting / filtering / sorting / embedding user_id or created_at, and
//    reading profiles, are refused (42501).
// 3. Logged out, the app's queries (map, table with every sort / filter / search, export, point
//    panel, statistics, home numbers): none fails, none returns an identifier.
// 4. Logged in (student, then admin): the same queries with authors work as before; profiles
//    and the profile page's query work; credits stay public.
import './browser-env.js';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { supabase, supabaseKey } from '../../../src/lib/supabase.js';
import {
  fetchLabAll,
  fetchLabPage,
  fetchLabPoints,
  fetchLabStats,
  fetchMeasurement,
  fetchSummary,
  fetchUserPoints,
  SORTABLE_TYPES,
} from '../../../src/lib/measurementsApi.js';
import { fetchAllPaged } from '../../../src/lib/paging.js';
import { fieldFromRow } from '../../../src/lib/fields.js';
import { toCSV, toGeoJSON } from '../../../src/lib/export.js';
import { USERS } from '../../../src/data/mockData.js';

const [PGRST, PROXY_PORT, SECRET, IDS_FILE] = process.argv.slice(2);
const IDS = JSON.parse(fs.readFileSync(IDS_FILE, 'utf8')); // { ids: [...], usernames: [...], cols: {table: [...]} }
const STUDENT = '00000000-0000-4000-8000-000000000003';
const ADMIN = '33333333-3333-4333-8333-333333333333';

let pass = 0;
let fail = 0;
function check(name, ok, got = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${got !== '' ? `  [${String(got).replace(/\s+/g, ' ').slice(0, 200)}]` : ''}`);
}

// ---- JWT (HS256, like Supabase's) --------------------------------------------------------------
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
function jwt(payload) {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...payload });
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
const userToken = (sub) => jwt({ sub, role: 'authenticated', aud: 'authenticated', email: `${sub}@noemail.mitzpe.invalid` });

// ---- proxy: /rest/v1 → PostgREST (bodies recorded), /auth/v1 → stub ---------------------------
let recorded = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  if (req.url.startsWith('/auth/v1/user')) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const sub = JSON.parse(Buffer.from(token.split('.')[1] || 'e30', 'base64url').toString()).sub;
    res.writeHead(sub ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(sub ? { id: sub, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } : { msg: 'no user' }));
    return;
  }
  if (req.url.startsWith('/auth/v1/logout')) {
    res.writeHead(204);
    res.end();
    return;
  }
  if (!req.url.startsWith('/rest/v1/')) {
    res.writeHead(404);
    res.end();
    return;
  }
  const headers = { ...req.headers };
  delete headers.host;
  delete headers['content-length'];
  const r = await fetch(PGRST + req.url.slice('/rest/v1'.length), {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const text = await r.text();
  recorded.push({ url: req.url, auth: headers.authorization || '', status: r.status, text });
  const out = {};
  r.headers.forEach((v, k) => {
    if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) out[k] = v;
  });
  res.writeHead(r.status, out);
  res.end(text);
});
await new Promise((ok) => server.listen(Number(PROXY_PORT), ok));

// ---- identifier scan ---------------------------------------------------------------------------
const FORBIDDEN_KEYS = /"(user_id|userId|username|username_key|actor_id|actor_username|author_id|reviewer_id|owner_id|created_by|role_granted_by|role|email)"\s*:/;
const idNeedles = [...new Set(IDS.ids)].filter(Boolean);
const nameNeedles = [...new Set(IDS.usernames)].filter((u) => u && u.length >= 3);
/** → null (clean) or what was found. */
function leak(text) {
  if (!text) return null;
  const k = text.match(FORBIDDEN_KEYS);
  if (k) return `key ${k[1]}`;
  const lower = text.toLowerCase();
  for (const id of idNeedles) if (lower.includes(id.toLowerCase())) return `id ${id}`;
  for (const n of nameNeedles) if (text.includes(`"${n}"`) || text.includes(`"${n},`) || text.includes(`,${n}"`)) return `username ${n}`;
  return null;
}
check('scan: the identifier list is not empty', idNeedles.length > 30 && nameNeedles.length > 30, `${idNeedles.length} ids, ${nameNeedles.length} names`);
check('scan: it catches a planted id', leak(`{"x":"${idNeedles[0]}"}`) !== null && leak('{"user_id":1}') !== null);

// Anon = the publishable key only, like the app logged out (run.sh signs it with the same secret).
const ANON = supabaseKey;
const raw = (path, opts = {}) =>
  fetch(PGRST + path, { ...opts, headers: { Authorization: `Bearer ${opts.token || ANON}`, ...(opts.headers || {}) } });

// ---- 1. every table / RPC in the anon OpenAPI --------------------------------------------------
const spec = await (await raw('/', { headers: { Accept: 'application/openapi+json' } })).json();
const paths = Object.keys(spec.paths || {});
const tables = paths.filter((p) => p !== '/' && !p.startsWith('/rpc/')).map((p) => p.slice(1)).filter((t) => !/^t(19|20)?_/.test(t));
const rpcs = paths.filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)).filter((f) => !/^t(19|20)?(_|$)/.test(f));
check('openapi: anon sees exactly the public tables', JSON.stringify([...tables].sort()) ===
  JSON.stringify(['campaign_field_options', 'campaign_fields', 'campaigns', 'measurements']), tables.join(','));
check('grants: anon reads no identifying column (from the database)',
  !Object.entries(IDS.cols).some(([t, cols]) => cols.some((c) =>
    /^(user_id|username|username_key|created_by|actor_id|reviewer_id|role|email)$/.test(c) || (t === 'measurements' && c === 'created_at'))),
  JSON.stringify(IDS.cols.measurements));
for (const t of tables) {
  const cols = IDS.cols[t] || [];
  const star = await raw(`/${t}?select=*&limit=1`);
  // Tables with column grants (a non-public column exists) refuse select=* for anon.
  if (t === 'measurements' || t === 'campaigns') check(`${t}?select=* is refused for anon (column grants)`, star.status === 401 || star.status === 403, star.status);
  else check(`${t}?select=* works`, star.ok, star.status);
  const { rows, total } = await fetchAllPaged((o) => {
    let q = supabase.from(t).select(cols.join(','), o);
    for (const c of ['id', 'campaign_id', 'key', 'field_key'].filter((c) => cols.includes(c))) q = q.order(c);
    return q;
  });
  const found = rows.map((r) => leak(JSON.stringify(r))).find(Boolean);
  check(`${t}: all ${total} rows (every granted column) carry no identifier`, !found && rows.length === total, found || rows.length);
}
// Sample arguments by parameter name / type.
function sampleArgs(fn) {
  const params = spec.paths[`/rpc/${fn}`]?.post?.parameters?.find((p) => p.in === 'body')?.schema?.properties || {};
  const args = {};
  for (const [k, s] of Object.entries(params)) {
    const fmt = `${s.format || ''} ${s.type || ''}`;
    if (/uuid/.test(fmt)) args[k] = STUDENT;
    else if (/jsonb|json/.test(fmt)) args[k] = k.includes('fields') ? [] : {};
    else if (/bool/.test(fmt)) args[k] = false;
    else if (/double|numeric|integer|number/.test(fmt)) args[k] = 1;
    else if (k === 'p_role') args[k] = 'student';
    else if (/username/.test(k)) args[k] = 'tester03';
    else args[k] = 'obs-stream-water';
  }
  return args;
}
for (const fn of rpcs) {
  const r = await raw(`/rpc/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sampleArgs(fn)) });
  const text = await r.text();
  const found = leak(text);
  check(`rpc ${fn} (anon): no identifier in the answer`, !found, found || `${r.status} ${text.slice(0, 80)}`);
}
check('rpc list covers the home / lab / credits functions',
  ['measurement_summary', 'measurement_lab_stats', 'measurement_participant_counts', 'lab_credits', 'lab_credits_all'].every((f) => rpcs.includes(f)),
  rpcs.join(','));
check('rpc list: nothing that returns people (comments, photos, avatars, admin, logs)',
  !rpcs.some((f) => /^(comment_|photo_|avatar_|admin_|owner_|account_|lab_log|lab_review|link_domain)/.test(f)), rpcs.join(','));

// ---- 2. probes -----------------------------------------------------------------------------------
const refused = async (path) => {
  const r = await raw(path);
  const j = await r.json().catch(() => ({}));
  return (r.status === 401 || r.status === 403) && j.code === '42501';
};
for (const [name, path] of [
  ['select=user_id', '/measurements?select=user_id&limit=1'],
  ['select=created_at', '/measurements?select=created_at&limit=1'],
  ['filter user_id=eq', `/measurements?select=id&user_id=eq.${STUDENT}`],
  ['filter inside or=()', `/measurements?select=id&or=(user_id.eq.${STUDENT},id.eq.x)`],
  ['order=user_id', '/measurements?select=id&order=user_id&limit=1'],
  ['order=created_at', '/measurements?select=id&order=created_at&limit=1'],
  ['json path on user_id', '/measurements?select=id,u:user_id&limit=1'],
  ['embedding measurements(user_id)', '/campaigns?select=id,measurements(user_id)&limit=1'],
  ['embedding measurements(*)', '/campaigns?select=id,measurements(*)&limit=1'],
  ['profiles?select=id', '/profiles?select=id&limit=1'],
  ['profiles?select=username', '/profiles?select=username&limit=1'],
]) check(`probe (anon) refused: ${name}`, await refused(path));
{
  const r = await raw(`/measurements?select=id&user_id=eq.${STUDENT}`, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  check('probe (anon) refused: HEAD count filtered by user_id', r.status === 401 || r.status === 403, r.status);
}

// ---- 3. the app's queries, logged out -------------------------------------------------------------
async function loadLabs() {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, slug, publication, campaign_fields(*, campaign_field_options(*))')
    .order('id');
  if (error) throw error;
  return data.map((row) => {
    const fields = row.campaign_fields.map(fieldFromRow).sort((a, b) => a.sortOrder - b.sortOrder);
    return { id: row.id, slug: row.slug, titleEn: row.id, fields, primaryField: fields.find((f) => f.isPrimary && !f.archived) || null };
  });
}
async function noThrow(name, fn) {
  try {
    return await fn();
  } catch (e) {
    check(name, false, `${e.code || ''} ${e.message}`);
    return undefined;
  }
}
function stateFor(lab, extra = {}) {
  return { fields: lab.fields, locale: 'en', sort: { key: 'timestamp', dir: 'desc' }, from: '', to: '', query: '', userIds: null, ...extra };
}
/** Every sort the table offers for this lab. */
function sorts(lab) {
  const keys = ['timestamp', 'place', 'status', ...lab.fields.filter((f) => SORTABLE_TYPES.includes(f.type)).map((f) => `f:${f.key}`)];
  return keys.flatMap((key) => [{ key, dir: 'asc' }, { key, dir: 'desc' }]);
}

async function appQueries(who, withAuthor) {
  recorded = [];
  const labs = await noThrow(`${who}: campaigns + fields`, loadLabs);
  if (!labs) return null;
  const sum = await noThrow(`${who}: home numbers (measurement_summary)`, fetchSummary);
  check(`${who}: home numbers load`, sum && sum.total > 0, sum?.total);
  let queries = 0;
  const ok = { points: true, page: true, all: true, stats: true, one: true };
  let someIds = [];
  for (const lab of labs) {
    const pts = await noThrow(`${who}: map ${lab.id}`, () => fetchLabPoints(lab));
    if (!pts) ok.points = false;
    else someIds.push(...pts.points.slice(0, 2).map((p) => p.id));
    const st = await noThrow(`${who}: stats ${lab.id}`, () => fetchLabStats(lab.id, 1));
    if (st === undefined) ok.stats = false;
    for (const sort of sorts(lab)) {
      const pg = await noThrow(`${who}: table ${lab.id} sort ${sort.key} ${sort.dir}`, () => fetchLabPage(lab, stateFor(lab, { sort, withAuthor }), 0));
      queries++;
      if (!pg) ok.page = false;
    }
    // Filters: dates, search, the demo "school" (userIds — ignored without withAuthor), all at once.
    const filtered = stateFor(lab, {
      from: '2026-01-01', to: '2026-12-31', query: 'a', withAuthor,
      userIds: USERS.filter((u) => u.school === USERS[0].school).map((u) => u.id),
    });
    const fp = await noThrow(`${who}: table ${lab.id} with filters`, () => fetchLabPage(lab, filtered, 0));
    if (!fp) ok.page = false;
    const all = await noThrow(`${who}: export ${lab.id}`, () => fetchLabAll(lab, stateFor(lab, { withAuthor })));
    if (!all) ok.all = false;
    else if (all.rows.length) {
      const csv = toCSV(all.rows, lab, () => null) + JSON.stringify(toGeoJSON(all.rows, lab, () => null));
      if (!withAuthor) check(`${who}: export file ${lab.id} (${all.rows.length} rows) has no identifier`, !leak(csv) && !/user_?id/i.test(csv), leak(csv));
      if (!withAuthor) check(`${who}: export ${lab.id} rows have no author`, all.rows.every((r) => r.userId === null));
      else check(`${who}: export ${lab.id} rows have their author`, all.rows.every((r) => typeof r.userId === 'string'));
    }
  }
  for (const id of someIds.slice(0, 12)) {
    const m = await noThrow(`${who}: point panel ${id}`, () => fetchMeasurement(id, { withAuthor }));
    if (!m) ok.one = false;
    else if (withAuthor ? typeof m.userId !== 'string' : m.userId !== null) ok.one = false;
  }
  check(`${who}: map of every lab loads`, ok.points);
  check(`${who}: stats / charts of every lab load`, ok.stats);
  check(`${who}: table pages load for every sort (${queries} queries) and with filters`, ok.page);
  check(`${who}: export of every lab loads`, ok.all);
  check(`${who}: point panel rows load ${withAuthor ? 'with' : 'without'} author`, ok.one);
  check(`${who}: no request was refused (42501 / 401 / 403)`, !recorded.some((r) => r.status === 401 || r.status === 403),
    recorded.filter((r) => r.status >= 400).map((r) => `${r.status} ${r.url}`).slice(0, 2).join(' | '));
  return labs;
}

const labs = await appQueries('anon', false);
{
  const found = recorded.map((r) => leak(r.text) && `${leak(r.text)} in ${r.url}`).find(Boolean);
  check(`anon: none of ${recorded.length} app responses contains an identifier`, !found, found);
  check('anon: the app never asked for user_id / created_at', !recorded.some((r) => /user_id|created_at/.test(decodeURIComponent(r.url))),
    recorded.find((r) => /user_id|created_at/.test(decodeURIComponent(r.url)))?.url);
  check('anon: nothing was sent with a user token', recorded.every((r) => !r.auth || r.auth === `Bearer ${ANON}`));
}
{
  const { data, error } = await supabase.rpc('lab_credits', { p_id: 'obs-stream-water' });
  check('anon: lab credits show admin full names', !error && data?.creator?.full_name === 'Dana Creator' && data?.approvers?.length === 3,
    error?.message || JSON.stringify(data).slice(0, 120));
  const { data: all } = await supabase.rpc('lab_credits_all');
  check('anon: card credits (lab_credits_all)', all?.some((r) => r.creator_full_name === 'Dana Creator'));
}

// ---- 4. logged in -------------------------------------------------------------------------------
for (const [who, sub] of [['student', STUDENT], ['admin', ADMIN]]) {
  const { error } = await supabase.auth.setSession({ access_token: userToken(sub), refresh_token: 'test-refresh' });
  check(`${who}: signed in (session set)`, !error, error?.message);
  await appQueries(who, true);
  const { data: prof, error: pe } = await supabase.from('profiles').select('id, username, role, created_at').in('id', [STUDENT, ADMIN]);
  check(`${who}: reads profiles (usernames)`, !pe && prof?.length === 2, pe?.message);
  const up = await noThrow(`${who}: profile page query`, () => fetchUserPoints(STUDENT));
  check(`${who}: profile page lists the student's measurements`, up && up.total > 0 && up.rows.length === up.total, up?.total);
  const { data: withTable, error: te } = await supabase.from('measurements').select('id, user_id').eq('user_id', STUDENT).limit(1);
  check(`${who}: filter by user_id works`, !te && withTable?.[0]?.user_id === STUDENT, te?.message);
  if (who === 'admin' && labs) {
    const heat = labs.find((l) => l.id === 'obs-schoolyard-heat');
    const page = await fetchLabPage(heat, stateFor(heat, { withAuthor: true, userIds: [STUDENT] }), 0);
    check('admin: table filtered by author ids (demo school filter) works', page.total > 0 && page.rows.every((r) => r.userId === STUDENT), page.total);
  }
  await supabase.auth.signOut();
}
{
  recorded = [];
  const pts = await fetchLabPoints(labs[0]);
  check('after sign-out: requests are anon again', recorded.length > 0 && recorded.every((r) => r.auth === `Bearer ${ANON}`) && pts.total >= 0);
}

server.close();
console.log(`\n020 API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
