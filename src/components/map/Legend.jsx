import { useI18n } from '../../i18n';
import { legendStops } from '../../data/metrics';
import { fieldLabel } from '../../lib/fields';
import { formatNumber } from '../../lib/format';

/** Colour legend for the campaign's primary field (`scale` from buildScale). */
export default function Legend({ scale }) {
  const { t, locale } = useI18n();
  if (!scale) return null;
  const m = scale;
  const stops = legendStops(scale, 5);
  const gradient = `linear-gradient(to ${
    document.documentElement.dir === 'rtl' ? 'left' : 'right'
  }, ${m.colors.join(', ')})`;

  return (
    <div className="surface pointer-events-auto w-56 p-3 text-xs">
      <div className="mb-2 font-semibold text-ink dark:text-paper">
        {t('map.legendTitle', { metric: fieldLabel(scale.field, locale) })}
      </div>
      <div className="h-2.5 w-full rounded" style={{ background: gradient }} aria-hidden="true" />
      <div className="mt-1 flex justify-between text-ink-faint">
        {stops.map((s, i) => (
          <span key={i} className="tnum">
            {formatNumber(s.value, { locale, decimals: m.decimals === 0 ? 0 : 1 })}
          </span>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-ink-faint">
        <span>{t('map.low')}</span>
        <span>
          {m.unit && <span dir="ltr">{m.unit}</span>}
          {m.unit && ' · '}
          {t('map.high')}
        </span>
      </div>
    </div>
  );
}
