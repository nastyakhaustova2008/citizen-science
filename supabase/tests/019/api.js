// 019 API tests: run against a real PostgREST with db-max-rows = 1000 (like Supabase's "Max rows")
// on the test database (run.sh starts it when a postgrest binary is available).
//   node api.mjs <postgrest url>
// 1. Reproduces the bug: one select of a lab with > 1000 rows silently returns 1000.
// 2. fetchAllPaged / fetchPage (src/lib/paging.js) read every row / the right page.
// 3. Table search (searchFilter in src/lib/measurementsApi.js): every needle matches literally —
//    exactly the rows a plain JS "contains" finds — and never widens or changes the filter.
import { PostgrestClient } from '@supabase/postgrest-js';
import { fetchAllPaged, fetchPage, MAX_ROWS } from '../../../src/lib/paging.js';
import { searchFilter } from '../../../src/lib/measurementsApi.js';
import { fieldFromRow, optionLabel } from '../../../src/lib/fields.js';

const db = new PostgrestClient(process.argv[2]);
let pass = 0;
let fail = 0;
function check(name, ok, got = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${got !== '' ? `  [${got}]` : ''}`);
}

const LAB = 'obs-schoolyard-heat';
const labQuery = (o) =>
  db.from('measurements').select('id, measured_at', o).eq('observation_id', LAB)
    .order('measured_at', { ascending: false }).order('id', { ascending: false });

// 1. the bug
{
  const { data, count } = await db.from('measurements').select('id', { count: 'exact' }).eq('observation_id', LAB);
  check('bug reproduced: one select is cut at Max rows', data.length === MAX_ROWS && count > MAX_ROWS, `${data.length} of ${count}`);
}

// 2. paging
{
  const all = await fetchAllPaged(labQuery);
  check('fetchAllPaged: every row, no duplicates', all.rows.length === all.total && new Set(all.rows.map((r) => r.id)).size === all.total && !all.capped, `${all.rows.length}/${all.total}`);
  const small = await fetchAllPaged(labQuery, { pageSize: 100 });
  check('fetchAllPaged: same rows with 100 per page', JSON.stringify(small.rows) === JSON.stringify(all.rows));
  const capped = await fetchAllPaged(labQuery, { cap: 500 });
  check('fetchAllPaged: cap → capped, total still exact', capped.rows.length === 500 && capped.capped && capped.total === all.total);
  let progress = 0;
  await fetchAllPaged(labQuery, { pageSize: 300, onProgress: (n) => (progress = n) });
  check('fetchAllPaged: progress reaches the total', progress === all.total, progress);
  const last = Math.floor((all.total - 1) / 50);
  const p = await fetchPage(labQuery, last, 50);
  check('fetchPage: last page + exact count', p.total === all.total && p.rows.length === all.total - last * 50 && p.rows.at(-1).id === all.rows.at(-1).id);
  const mid = await fetchPage(labQuery, 7, 50);
  check('fetchPage: page 8 = rows 351–400', JSON.stringify(mid.rows) === JSON.stringify(all.rows.slice(350, 400)));
  const rpc = await fetchAllPaged((o) => db.rpc('measurement_participant_counts', {}, o).order('campaign_id'), { pageSize: 5 });
  check('fetchAllPaged over a set-returning RPC', rpc.rows.length === rpc.total && rpc.total > 5, rpc.total);
  let threw = false;
  try {
    await fetchAllPaged(labQuery, { pageSize: 5000 });
  } catch {
    threw = true;
  }
  check('page size above Max rows is refused', threw);
}

// 3. search
{
  const SW = 'obs-stream-water';
  const { data: camp } = await db.from('campaigns').select('campaign_fields(*, campaign_field_options(*))').eq('id', SW).single();
  const fields = camp.campaign_fields.map(fieldFromRow);
  const { rows } = await fetchAllPaged((o) =>
    db.from('measurements').select('id, place_label, field_values', o).eq('observation_id', SW).order('id'));
  // Oracle: plain JS contains (a * in the query stands for any one character, see likeEscape).
  const oracle = (needle, locale) => {
    const q = needle.trim().toLowerCase();
    const re = new RegExp(q.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.'), 'i');
    const has = (s) => s != null && re.test(String(s).toLowerCase());
    return rows.filter((r) => {
      if (has(r.place_label)) return true;
      return fields.some((f) => {
        const v = r.field_values?.[f.key];
        if (v == null) return false;
        if (f.type === 'text') return has(v);
        if (f.type === 'choice') return `${v} ${optionLabel(f, v, locale)}`.toLowerCase().includes(q);
        if (f.type === 'multi_choice') return v.some((k) => `${k} ${optionLabel(f, k, locale)}`.toLowerCase().includes(q));
        return false;
      });
    }).map((r) => r.id).sort();
  };
  const needles = [
    ['a,b', 'en'], ['a)b', 'en'], ['a(b', 'en'], ['"x"', 'en'], ['50%', 'en'], ['a_b', 'en'], ['\\', 'en'],
    ['back\\slash', 'en'], ['.or(id.neq.0)', 'en'], ['x"),id.neq.0,place_label.eq.("', 'en'],
    ['id.neq.0', 'en'], ['%', 'en'], ['_', 'en'], ['a*b', 'en'],
    ['ליד הנחל', 'he'], ['У РУЧЬЯ', 'ru'], ['Murky', 'en'], ['צלול', 'he'], ['пена', 'ru'], ['oil', 'en'],
  ];
  for (const [needle, locale] of needles) {
    const filter = searchFilter(needle, fields, locale);
    const { data, error } = await db.from('measurements').select('id').eq('observation_id', SW).or(filter);
    const got = error ? `ERROR ${error.message}` : data.map((r) => r.id).sort();
    const want = oracle(needle, locale);
    check(`search ${JSON.stringify(needle)} (${locale}) ${needle.includes('*') ? 'matches (* = any one character)' : 'matches literally'}`, JSON.stringify(got) === JSON.stringify(want),
      `${Array.isArray(got) ? got.length : got} rows, want ${want.length}${want.length && want.length < 4 ? ': ' + want.join(' ') : ''}`);
  }
  check('search: tricky needles really exist in the data', oracle('.or(id.neq.0)', 'en').length === 1 && oracle('a_b', 'en').length === 1 && oracle('50%', 'en').length === 1);
}

console.log(`\n019 API: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
