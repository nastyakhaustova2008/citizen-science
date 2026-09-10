import { useI18n } from '../../i18n';
import { METRICS } from '../../data/metrics';
import { summarize } from '../../lib/stats';
import { formatNumber } from '../../lib/format';

export default function StatsSummary({ measurements, metric }) {
  const { t, locale } = useI18n();
  const m = METRICS[metric];
  const s = summarize(measurements);
  const d = m?.decimals ?? 1;

  const cells = [
    { label: t('data.stats.count'), value: formatNumber(s.count, { locale }) },
    {
      label: t('data.stats.mean'),
      value: s.mean != null ? `${formatNumber(s.mean, { locale, decimals: d })} ${m.unit}` : '—',
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
          <dd className="tnum mt-0.5 text-base font-semibold text-ink dark:text-paper">{c.value}</dd>
        </div>
      ))}
    </dl>
  );
}
