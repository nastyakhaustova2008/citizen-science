import { useI18n } from '../i18n';
import { formatMonthShort, formatMonthYear } from '../lib/format';

/**
 * Month-resolution contribution grid (GitHub-style, restrained).
 * `data`: [{ year, month, count }]
 */
export default function ContributionGraph({ data }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...data.map((d) => d.count));

  function shade(count) {
    if (count === 0) return 'bg-paper-sunk dark:bg-white/5';
    const level = count / max;
    if (level < 0.34) return 'bg-moss/30';
    if (level < 0.67) return 'bg-moss/60';
    return 'bg-moss';
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {data.map((d) => (
          <div
            key={`${d.year}-${d.month}`}
            className="flex flex-col items-center gap-1"
            title={
              d.count === 0
                ? `${formatMonthYear(d.year, d.month, locale)} — ${t('profile.noMonth')}`
                : t('profile.monthCount', {
                    count: d.count,
                    month: formatMonthYear(d.year, d.month, locale),
                  })
            }
          >
            <span
              className={`h-8 w-8 rounded ${shade(d.count)}`}
              role="img"
              aria-label={
                d.count === 0
                  ? `${formatMonthYear(d.year, d.month, locale)}: ${t('profile.noMonth')}`
                  : t('profile.monthCount', {
                      count: d.count,
                      month: formatMonthYear(d.year, d.month, locale),
                    })
              }
            />
            <span className="text-[10px] text-ink-faint">{formatMonthShort(d.year, d.month, locale)}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-faint">{t('profile.contributionsHint')}</p>
    </div>
  );
}
