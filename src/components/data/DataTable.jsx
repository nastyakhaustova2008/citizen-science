import { useMemo, useState } from 'react';
import { ArrowUp, ArrowDown, ChevronsUpDown, Download, Search, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { getUser } from '../../data/mockData';
import { formatDate, formatTime, toISODate } from '../../lib/format';
import { visibleFields, fieldLabel, formatFieldValue, sortValue, optionLabel } from '../../lib/fields';
import { exportMeasurements } from '../../lib/export';
import { VerificationBadge, EmptyState } from '../primitives';

const PAGE = 12;

export default function DataTable({ observation, measurements }) {
  const { t, locale } = useI18n();
  // Every active field, plus archived fields that still have data.
  const fields = useMemo(() => visibleFields(observation, measurements), [observation, measurements]);

  const [sort, setSort] = useState({ key: 'timestamp', dir: 'desc' });
  const [school, setSchool] = useState('__all__');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [page, setPage] = useState(0);

  const schools = useMemo(
    () => [...new Set(measurements.map((m) => getUser(m.userId)?.school).filter(Boolean))].sort(),
    [measurements],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = measurements.map((m) => {
      const u = getUser(m.userId);
      return {
        ...m,
        _school: u?.school ?? '',
        _date: toISODate(m.timestamp),
      };
    });
    if (school !== '__all__') list = list.filter((r) => r._school === school);
    if (from) list = list.filter((r) => r._date >= from);
    if (to) list = list.filter((r) => r._date <= to);
    if (q) {
      const searchable = fields.filter((f) => ['text', 'choice', 'multi_choice'].includes(f.type));
      const textOf = (r, f) => {
        const v = r.values[f.key];
        if (v == null) return '';
        if (f.type === 'choice') return `${v} ${optionLabel(f, v, locale)}`;
        if (f.type === 'multi_choice') return v.map((k) => `${k} ${optionLabel(f, k, locale)}`).join(' ');
        return String(v);
      };
      list = list.filter(
        (r) =>
          (r.placeLabel || '').toLowerCase().includes(q) ||
          r._school.toLowerCase().includes(q) ||
          searchable.some((f) => textOf(r, f).toLowerCase().includes(q)),
      );
    }

    const { key, dir } = sort;
    const mul = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let av;
      let bv;
      const field = key.startsWith('f:') ? fields.find((f) => `f:${f.key}` === key) : null;
      if (field) {
        av = sortValue(field, a.values[field.key], locale);
        bv = sortValue(field, b.values[field.key], locale);
        // Empty cells always last.
        if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
      } else if (key === 'timestamp') [av, bv] = [a.timestamp, b.timestamp];
      else if (key === 'school') [av, bv] = [a._school, b._school];
      else if (key === 'place') [av, bv] = [a.placeLabel, b.placeLabel];
      else if (key === 'status') [av, bv] = [a.verification, b.verification];
      else [av, bv] = [a[key], b[key]];
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return 0;
    });
    return list;
  }, [measurements, fields, locale, school, from, to, query, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE));
  const pageRows = rows.slice(page * PAGE, page * PAGE + PAGE);

  const hasFilters = school !== '__all__' || from || to || query.trim();

  function toggleSort(key) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  }

  function SortHeader({ colKey, label, align = 'start' }) {
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

  const selectedRows = rows.filter((r) => selected.has(r.id));
  const exportSet = selectedRows.length ? selectedRows : rows;

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id));

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="surface flex flex-wrap items-end gap-3 p-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-ink-faint">{t('data.filterBySchool')}</span>
          <select
            className="input py-2"
            value={school}
            onChange={(e) => {
              setSchool(e.target.value);
              setPage(0);
            }}
          >
            <option value="__all__">{t('common.all')}</option>
            {schools.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
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
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
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
              setPage(0);
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
          {selected.size > 0
            ? `${selected.size} ${t('common.selected')}`
            : `${rows.length} ${t('common.rows')}`}
        </span>
        <div className="ms-auto flex flex-wrap gap-2">
          {['csv', 'json', 'geojson'].map((fmt) => (
            <button
              key={fmt}
              type="button"
              className="btn-secondary"
              onClick={() => exportMeasurements(exportSet, fmt, observation)}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              {t(`data.export${fmt[0].toUpperCase()}${fmt.slice(1)}`)}
              {selected.size > 0 && <span className="tnum">({selectedRows.length})</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <EmptyState title={t('data.emptyTitle')} body={t('data.emptyBody')} />
      ) : (
        <div className="surface overflow-x-auto">
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
                        const next = new Set(prev);
                        pageRows.forEach((r) => (e.target.checked ? next.add(r.id) : next.delete(r.id)));
                        return next;
                      });
                    }}
                  />
                </th>
                <SortHeader colKey="timestamp" label={t('data.columns.date')} />
                <SortHeader colKey="place" label={t('data.columns.place')} />
                <SortHeader colKey="school" label={t('data.columns.school')} />
                {fields.map((f) => (
                  <SortHeader
                    key={f.key}
                    colKey={`f:${f.key}`}
                    label={
                      f.archived ? `${fieldLabel(f, locale)} (${t('fields.archived')})` : fieldLabel(f, locale)
                    }
                    align={f.type === 'number' ? 'end' : 'start'}
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
                          const next = new Set(prev);
                          if (e.target.checked) next.add(r.id);
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
                  <td className="px-3 py-2 text-ink-faint">{r._school}</td>
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
