/**
 * Reading lists from Supabase without silently losing rows (audit H5).
 *
 * The Data API returns at most MAX_ROWS rows per request (Supabase → Settings → Data API →
 * "Max rows") and cuts the rest WITHOUT an error. So no list read may rely on one unbounded
 * select. Use one of:
 *   - fetchPage()     — one page of a table view (`.range()` + exact count);
 *   - fetchAllPaged() — every row, page by page, up to a cap; the caller must say so on screen
 *                       when `capped` is true;
 *   - an aggregate RPC that returns one jsonb value (never cut), e.g. measurement_lab_stats;
 *   - an RPC with its own limit + cursor ("More" buttons: admin logs, user list).
 *
 * `makeQuery(options)` builds the query: pass `options` to `.select(columns, options)` (or
 * `.rpc(name, args, options)`) and give it a stable order that ends with a unique column
 * (e.g. measured_at desc, id desc). Rows inserted while paging only shift later rows (they come
 * twice and are dropped by id); a row deleted meanwhile may be missed — acceptable.
 */

export const MAX_ROWS = 1000;

function checkSize(size) {
  if (!Number.isInteger(size) || size < 1 || size > MAX_ROWS) {
    throw new Error(`page size must be 1…${MAX_ROWS} (the Data API's Max rows)`);
  }
}

/** One page (0-based) of `size` rows → { rows, total }. */
export async function fetchPage(makeQuery, page, size, { signal } = {}) {
  checkSize(size);
  let q = makeQuery({ count: 'exact' }).range(page * size, page * size + size - 1);
  if (signal) q = q.abortSignal(signal);
  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: data || [], total: count ?? (data || []).length };
}

/**
 * Every row (up to `cap`), `pageSize` rows per request → { rows, total, capped }.
 * `total` = all matching rows (exact count); `capped` = total is larger than what was read.
 * `onProgress(loaded, expected)` after each page; `signal` (AbortSignal) cancels.
 */
export async function fetchAllPaged(makeQuery, { pageSize = MAX_ROWS, cap = Infinity, onProgress, signal } = {}) {
  checkSize(pageSize);
  const rows = [];
  const seen = new Set();
  let total = null;
  let from = 0;
  // Guard against endless loops if rows keep being inserted while we read.
  for (let guard = 0; guard < 10000; guard++) {
    const want = Math.min(pageSize, cap - rows.length);
    if (want <= 0) break;
    let q = makeQuery(total == null ? { count: 'exact' } : {}).range(from, from + want - 1);
    if (signal) q = q.abortSignal(signal);
    const { data, error, count } = await q;
    if (error) throw error;
    if (total == null) {
      if (count == null) throw new Error('fetchAllPaged: the query gave no count (pass the options to select/rpc)');
      total = count;
    }
    const page = data || [];
    for (const row of page) {
      const key = row.id ?? JSON.stringify(row);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(row);
      }
    }
    from += page.length;
    onProgress?.(rows.length, Math.min(total, cap));
    // Empty page = past the end (a short page is NOT the end: Max rows may have cut it).
    if (page.length === 0 || rows.length >= Math.min(total, cap)) break;
  }
  const limited = rows.slice(0, cap);
  return { rows: limited, total: Math.max(total ?? 0, limited.length), capped: (total ?? 0) > limited.length };
}
