import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown, Download, Search, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { useAuth } from '../../context/AuthContext';
import { USERS } from '../../data/mockData';
import { formatDate, formatTime, formatNumber } from '../../lib/format';
import { fieldsWithData, fieldLabel, formatFieldValue } from '../../lib/fields';
import { exportMeasurements } from '../../lib/export';
import { EXPORT_CAP, SORTABLE_TYPES, TABLE_PAGE, fetchLabAll } from '../../lib/measurementsApi';
import { useLabPage } from '../../hooks/useMeasurements';
import { VerificationBadge, EmptyState, ErrorBlock, LoadingBlock } from '../primitives';

// Schools of the demo authors (mock data; real accounts have no school).
const SCHOOLS = [...new Set(USERS.map((u) => u.school).filter(Boolean))].sort();

/**
 * Measurements of one lab, TABLE_PAGE rows per page. Filters, search and sort run on the server
 * (src/lib/measurementsApi.js), so every page and count covers all rows. `stats` (the lab's
 * aggregate) gives the columns: active fields + archived ones that have data.
 * Export: the selected rows, or every row matching the filters (page by page, up to EXPORT_CAP).
 * Logged out (audit H2): no user_id is read, so the demo "school" filter and column are hidden.
 */
export default function DataTable({ observation, stats }) {
  const { t, locale } = useI18n();
  const { getAuthor } = useAppData();
  const withAuthor = Boolean(useAuth().session);
  // Every active field, plus archived fields that still have data.
  const fields = useMemo(() => fieldsWithData(observation, stats.keys), [observation, stats.keys]);

  const [sort, setSort] = useState({ key: 'timestamp', dir: 'desc' });
  const [schoolChoice, setSchool] = useState('__all__');
  const school = withAuthor ? schoolChoice : '__all__';
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  // Selected rows (kept across pages): id → row.
  const [selected, setSelected] = useState(() => new Map());
  const [page, setPage] = useState(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 350);
    return () => clearTimeout(id);
  }, [query]);

  const filters = useMemo(
    () => ({
      fields,
      locale,
      sort,
      from,
      to,
      query: debouncedQuery,
      userIds: school === '__all__' ? null : USERS.filter((u) => u.school === school).map((u) => u.id),
      withAuthor,
    }),
    [fields, locale, sort, from, to, debouncedQuery, school, withAuthor],
  );
  // Logging in or out: rows chosen under the other view are dropped.
  useEffect(() => setSelected(new Map()), [withAuthor]);
  // New filters → back to the first page.
  useEffect(() => setPage(0), [filters]);

  const res = useLabPage(observation, filters, page);
  const rows = res.data?.rows || [];
  const total = res.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / TABLE_PAGE));
  const pageRows = rows;

  const hasFilters = school !== '__all__' || from || to || query.trim();

  // Export of everything matching the filters: progress, cancel, cap.
  const [exporting, setExporting] = useState(null); // {format, loaded, expected}
  const [exportNote, setExportNote] = useState(null); // {kind: 'capped' | 'error', shown, total}
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function exportAll(format) {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setExportNote(null);
    setExporting({ format, loaded: 0, expected: total });
    try {
      const out = await fetchLabAll(observation, filters, {
        signal: ctrl.signal,
        onProgress: (loaded, expected) => setExporting({ format, loaded, expected }),
      });
      if (ctrl.signal.aborted) return;
      exportMeasurements(out.rows, format, observation, getAuthor, { total: out.total });
      if (out.capped) setExportNote({ kind: 'capped', shown: out.rows.length, total: out.total });
    } catch (err) {
      if (!ctrl.signal.aborted) {
        console.error('[export] failed', err);
        setExportNote({ kind: 'error' });
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setExporting(null);
    }
  }

  function exportClick(format) {
    if (selected.size > 0) exportMeasurements([...selected.values()], format, observation, getAuthor);
    else exportAll(format);
  }

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  function SortHeader({ colKey, label, align = 'start', sortable = true }) {
    if (!sortable) {
      return (
        <th scope="col" className={`whitespace-nowrap px-3 py-2 text-${align} font-semibold text-ink-soft dark:text-paper/80`}>
          {label}
        </th>
      );
    }
    const active = sort.key === colKey;
    const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th scope="col" className={`whitespace-nowrap px-3 py-2 text-${align}`}>
        <button
          type="button"
          onClick={() => toggleSort(colKey)}
          className="inline-flex items-center gap-1 font-semibold text-ink-soft hover:text-ink dark:text-paper/80 dark:hover:text-paper"
          aria-label={t('a11y.sortBy', { column: label })}
          aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        >
          {label}
          <Icon className="h-3.5 w-3.5 opacity-60" aria-hidden="true" />
        </button>
      </th>
    );
  }

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="surface flex flex-wrap items-end gap-3 p-3">
        {withAuthor && (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-ink-faint">{t('data.filterBySchool')}</span>
            <select
              className="input py-2"
              value={school}
              onChange={(e) => setSchool(e.target.value)}
            >
              <option value="__all__">{t('common.all')}</option>
              {SCHOOLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-faint">{t('data.filterFrom')}</span>
          <input type="date" className="input py-2 tnum" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-faint">{t('data.filterTo')}</span>
          <input type="date" className="input py-2 tnum" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-semibold text-ink-faint">{t('common.search')}</span>
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-ink-faint" aria-hidden="true" />
            <input
              type="search"
              className="input ps-9"
              placeholder={t('common.searchPlaceholder')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </label>
        {hasFilters && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setSchool('__all__');
              setFrom('');
              setTo('');
              setQuery('');
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
            {t('common.clearFilters')}
          </button>
        )}
      </div>

      {/* Export bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink-faint">
          {selected.size > 0 ? (
            <>
              <span className="tnum">{formatNumber(selected.size, { locale })}</span> {t('common.selected')}
              <button type="button" className="btn-ghost ms-1 px-2 py-0.5 text-xs" onClick={() => setSelected(new Map())}>
                {t('data.clearSelection')}
              </button>
            </>
          ) : (
            <>
              <span className="tnum">{formatNumber(total, { locale })}</span> {t('common.rows')}
            </>
          )}
        </span>
        <div className="ms-auto flex flex-wrap gap-2">
          {['csv', 'json', 'geojson'].map((fmt) => (
            <button
              key={fmt}
              type="button"
              className="btn-secondary"
              disabled={Boolean(exporting) || (selected.size === 0 && total === 0)}
              onClick={() => exportClick(fmt)}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t(`data.export${fmt[0].toUpperCase()}${fmt.slice(1)}`)}
              {selected.size > 0 && <span className="tnum">({selected.size})</span>}
            </button>
          ))}
        </div>
      </div>

      {exporting && (
        <div className="surface flex flex-wrap items-center gap-3 p-3 text-sm" role="status">
          <span className="text-ink dark:text-paper">
            {t('data.exportProgress', {
              loaded: formatNumber(exporting.loaded, { locale }),
              total: formatNumber(Math.min(exporting.expected, EXPORT_CAP), { locale }),
            })}
          </span>
          <progress
            className="h-2 min-w-[8rem] flex-1 accent-bark"
            max={Math.max(1, Math.min(exporting.expected, EXPORT_CAP))}
            value={exporting.loaded}
          />
          <button type="button" className="btn-ghost" onClick={() => abortRef.current?.abort()}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {exportNote?.kind === 'capped' && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink dark:text-paper" role="status">
          {t('data.exportCapped', {
            shown: formatNumber(exportNote.shown, { locale }),
            total: formatNumber(exportNote.total, { locale }),
          })}
        </p>
      )}
      {exportNote?.kind === 'error' && (
        <p className="text-sm text-danger" role="alert">
          {t('data.exportFailed')}
        </p>
      )}

      {/* Table */}
      {res.error ? (
        <ErrorBlock onRetry={res.reload} />
      ) : !res.data ? (
        <LoadingBlock />
      ) : rows.length === 0 ? (
        <EmptyState title={t('data.emptyTitle')} body={t('data.emptyBody')} />
      ) : (
        // relative: keeps the badges' sr-only labels inside the scroll box (no page-wide scroll at 360 px)
        <div className={`surface relative overflow-x-auto transition-opacity ${res.loading ? 'opacity-60' : ''}`} aria-busy={res.loading}>
          <table className="w-full text-sm">
            <thead className="border-b border-edge text-xs dark:border-white/10">
              <tr>
                <th scope="col" className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-bark"
                    aria-label={t('data.selectAll')}
                    checked={allOnPageSelected}
                    onChange={(e) => {
                      setSelected((prev) => {
                        const next = new Map(prev);
                        pageRows.forEach((r) => (e.target.checked ? next.set(r.id, r) : next.delete(r.id)));
                        return next;
                      });
                    }}
                  />
                </th>
                <SortHeader colKey="timestamp" label={t('data.columns.date')} />
                <SortHeader colKey="place" label={t('data.columns.place')} />
                {withAuthor && <SortHeader colKey="school" label={t('data.columns.school')} sortable={false} />}
                {fields.map((f) => (
                  <SortHeader
                    key={f.key}
                    colKey={`f:${f.key}`}
                    label={
                      f.archived ? `${fieldLabel(f, locale)} (${t('fields.archived')})` : fieldLabel(f, locale)
                    }
                    align={f.type === 'number' ? 'end' : 'start'}
                    sortable={SORTABLE_TYPES.includes(f.type)}
                  />
                ))}
                <SortHeader colKey="status" label={t('data.columns.status')} />
              </tr>
            </thead>
            <tbody className="divide-y divide-edge dark:divide-white/10">
              {pageRows.map((r) => (
                <tr key={r.id} className="hover:bg-paper-sunk/60 dark:hover:bg-white/5">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="accent-bark"
                      aria-label={t('data.selectRow')}
                      checked={selected.has(r.id)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Map(prev);
                          if (e.target.checked) next.set(r.id, r);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="tnum">{formatDate(r.timestamp, locale)}</span>
                    <span className="tnum block text-xs text-ink-faint">
                      {formatTime(r.timestamp, locale)}
                    </span>
                  </td>
                  <td className="px-3 py-2">{r.placeLabel}</td>
                  {withAuthor && <td className="px-3 py-2 text-ink-faint">{getAuthor(r.userId)?.school ?? ''}</td>}
                  {fields.map((f) => {
                    const text = formatFieldValue(f, r.values[f.key], { locale, t });
                    if (f.type === 'number') {
                      return (
                        <td
                          key={f.key}
                          className={`tnum whitespace-nowrap px-3 py-2 text-end ${f.isPrimary ? 'font-semibold' : ''}`}
                        >
                          <span dir="ltr">{text}</span>
                        </td>
                      );
                    }
                    return (
                      <td key={f.key} className="max-w-[16rem] px-3 py-2 text-xs text-ink-faint">
                        <span className="line-clamp-2" title={text}>
                          {text}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-2">
                    <VerificationBadge status={r.verification} withLabel={false} />
                    <span className="ms-1 align-middle text-xs">{t(`map.panel.${r.verification}`)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            type="button"
            className="btn-ghost"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label={t('a11y.pagePrev')}
          >
            ‹
          </button>
          <span className="tnum text-ink-faint">
            {page + 1} {t('common.of')} {pageCount}
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            aria-label={t('a11y.pageNext')}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
