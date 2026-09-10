import { Search, X, SlidersHorizontal } from 'lucide-react';
import { useI18n } from '../i18n';

function Select({ label, value, onChange, options }) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
      <span className="text-xs font-semibold text-ink-faint">{label}</span>
      <select
        className="input py-2"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * `selects`: [{ key, label, value, options: [{value,label}] }]
 * `query` / `onQuery`: search string
 */
export default function FilterBar({ selects, query, onQuery, onReset, hasActiveFilters }) {
  const { t } = useI18n();
  return (
    <div className="surface mb-6 flex flex-col gap-3 p-3 sm:p-4">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-ink-faint"
            aria-hidden="true"
          />
          <input
            type="search"
            className="input ps-9"
            placeholder={t('common.searchPlaceholder')}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            aria-label={t('common.search')}
          />
        </div>
        {hasActiveFilters && (
          <button type="button" className="btn-ghost shrink-0" onClick={onReset}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">{t('common.clearFilters')}</span>
          </button>
        )}
      </div>

      <div className="flex items-end gap-3 overflow-x-auto pb-1">
        <SlidersHorizontal
          className="mb-2.5 hidden h-4 w-4 shrink-0 text-ink-faint sm:block"
          aria-hidden="true"
        />
        {selects.map((s) => (
          <Select
            key={s.key}
            label={s.label}
            value={s.value}
            onChange={s.onChange}
            options={s.options}
          />
        ))}
      </div>
    </div>
  );
}
