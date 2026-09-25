import { useState } from 'react';
import { Star } from 'lucide-react';
import { useI18n } from '../../i18n';
import { metricLabel } from '../../data/metrics';
import { coordLabel } from '../../lib/format';
import { labEquipment } from '../../lib/labs';
import Markdown from '../Markdown';
import ObsIcon from '../ObsIcon';
import LangSwitch, { langProps } from './LangSwitch';
import { EditorSection } from './EditorBits';

const pick = (obj, base, lang) => obj[`${base}${lang[0].toUpperCase()}${lang[1]}`] || '';

/** Read-only view of a lab for reviewers: texts in any language, settings, fields, protocol. */
export default function LabSummary({ campaign: c }) {
  const { t, locale } = useI18n();
  const [lang, setLang] = useState(locale);
  const lp = langProps(lang);
  const protocol = pick(c, 'protocol', lang);
  const missingText = <span className="text-warn">{t('labs.summary.missing')}</span>;

  return (
    <div className="space-y-4">
      <LangSwitch value={lang} onChange={setLang} label={t('labs.summary.language')} />

      <EditorSection title={t('labs.tabs.info')}>
        <div className="flex items-start gap-3" {...lp}>
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper-sunk dark:bg-white/5">
            <ObsIcon name={c.icon} />
          </span>
          <div className="min-w-0">
            <p className="font-serif text-lg font-bold text-ink dark:text-paper">{pick(c, 'title', lang) || missingText}</p>
            <p className="whitespace-pre-line text-sm text-ink-soft dark:text-paper/80">{pick(c, 'desc', lang) || missingText}</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <Item label={t('labs.info.region')} value={t(`regions.${c.region}`)} />
          <Item label={t('labs.info.difficulty')} value={t(`difficulty.${c.difficulty}`)} />
          <Item label={t('labs.info.metric')} value={c.metric ? metricLabel(c.metric, locale) : t('labs.info.metricNone')} />
          <Item
            label={t('labs.info.map')}
            value={
              c.centerSet ? (
                <span dir="ltr" className="tnum">
                  {coordLabel(c.center[0])}, {coordLabel(c.center[1])} · zoom {c.zoom}
                </span>
              ) : (
                missingText
              )
            }
          />
        </dl>
        <div>
          <p className="label">{t('labs.info.equipment')}</p>
          <p className="text-sm" {...lp}>
            {labEquipment(c, lang).join(' · ') || '—'}
          </p>
        </div>
      </EditorSection>

      <EditorSection title={t('labs.tabs.fields')}>
        <ol className="space-y-2">
          {c.fields.map((f) => (
            <li key={f.key} className={`rounded-lg border border-edge p-2.5 text-sm dark:border-white/10 ${f.archived ? 'opacity-60' : ''}`}>
              <p className="flex flex-wrap items-center gap-x-2">
                <span className="font-semibold" {...lp}>
                  {pick(f, 'label', lang) || missingText}
                </span>
                <code dir="ltr" className="text-xs text-ink-faint">
                  {f.key}
                </code>
                <span className="text-xs text-ink-faint">{t(`labs.types.${f.type}`)}</span>
                {f.isPrimary && (
                  <span className="inline-flex items-center gap-0.5 text-xs text-bark">
                    <Star className="h-3 w-3" aria-hidden="true" />
                    {t('labs.fields.primaryBadge')}
                  </span>
                )}
                {f.required && <span className="text-xs">· {t('labs.fields.requiredBadge')}</span>}
                {f.archived && <span className="text-xs">· {t('labs.fields.archivedBadge')}</span>}
              </p>
              {pick(f, 'help', lang) && (
                <p className="text-xs text-ink-faint" {...lp}>
                  {pick(f, 'help', lang)}
                </p>
              )}
              {f.type === 'number' && (
                <p className="text-xs text-ink-faint" dir="ltr">
                  {[f.unit, f.min != null || f.max != null ? `${f.min ?? '…'} – ${f.max ?? '…'}` : null, `${f.decimals} dp`]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              )}
              {f.options.length > 0 && (
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {f.options.map((o) => (
                    <li key={o.key} className={`chip ${o.archived ? 'opacity-60' : ''}`} {...lp}>
                      {pick(o, 'label', lang) || missingText}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </EditorSection>

      <EditorSection title={t('labs.protocol.title')}>
        <div className="text-sm" {...lp}>
          {protocol ? <Markdown source={protocol} /> : <p className="text-ink-faint">{t('labs.protocol.empty')}</p>}
        </div>
      </EditorSection>
    </div>
  );
}

function Item({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
