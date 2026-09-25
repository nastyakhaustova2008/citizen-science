import { useI18n } from '../../i18n';
import { summarize } from '../../lib/stats';
import { formatNumber } from '../../lib/format';

/** Summary of the primary field (`scale` from buildScale; null → count and coverage only). */
export default function StatsSummary({ measurements, scale }) {
  const { t, locale } = useI18n();
  const s = summarize(measurements);
  const d = scale?.decimals ?? 1;
  const unit = scale?.unit ? ` ${scale.unit}` : '';

  const cells = [
    { label: t('data.stats.count'), value: formatNumber(measurements.length, { locale }) },
    {
      label: t('data.stats.mean'),
      value: s.mean != null ? `${formatNumber(s.mean, { locale, decimals: d })}${unit}` : '—',
    },
    {
      label: t('data.stats.stddev'),
      value: s.stddev != null ? formatNumber(s.stddev, { locale, decimals: d }) : '—',
    },
    {
      label: t('data.stats.range'),
      value:
        s.min != null
          ? `${formatNumber(s.min, { locale, decimals: d })}–${formatNumber(s.max, {
              locale,
              decimals: d,
            })}`
          : '—',
    },
    {
      label: t('data.stats.coverage'),
      value: t('data.stats.coverageValue', { days: s.coverageDays }),
    },
  ];

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {cells.map((c) => (
        <div key={c.label} className="surface px-3 py-2.5">
          <dt className="text-xs font-medium text-ink-faint">{c.label}</dt>
          <dd className="tnum mt-0.5 text-base font-semibold text-ink dark:text-paper">
            <span dir="ltr">{c.value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
