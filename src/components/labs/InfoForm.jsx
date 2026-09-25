import { Plus, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { METRICS, metricLabel } from '../../data/metrics';
import { LAB_ICONS, REGIONS, DIFFICULTIES, LAB_STATUSES, LIMITS, slugFromTitle } from '../../lib/labs';
import ObsIcon from '../ObsIcon';
import CenterPicker from './CenterPicker';
import { langProps } from './LangSwitch';
import { ErrorMsg, LockedHint, EditorSection } from './EditorBits';

/** Lab info: texts (in the chosen language), icon, region, difficulty, status, colours, map, equipment. */
export default function InfoForm({ lab, update, lang, errors, published }) {
  const { t, locale } = useI18n();
  const lp = langProps(lang);

  const setText = (group, value) =>
    update((d) => {
      const next = { ...d, [group]: { ...d[group], [lang]: value } };
      // New drafts: the URL name follows the English title until edited by hand.
      if (group === 'title' && lang === 'en' && !d.slugEdited && d.publication === 'draft') {
        next.slug = slugFromTitle(value);
      }
      return next;
    });

  const items = lab.equipment[lang];
  const setItems = (list) => update((d) => ({ ...d, equipment: { ...d.equipment, [lang]: list } }));

  return (
    <div className="space-y-5">
      <EditorSection title={t('labs.info.texts')} hint={t('labs.info.textsHint')}>
        <div>
          <label htmlFor="lab-title" className="label">
            {t('labs.info.title')}
          </label>
          <input
            id="lab-title"
            className={`input ${errors[`info.title_${lang}`] ? '!border-danger' : ''}`}
            maxLength={LIMITS.title}
            value={lab.title[lang]}
            onChange={(e) => setText('title', e.target.value)}
            {...lp}
          />
          <ErrorMsg code={errors[`info.title_${lang}`]} params={{ max: LIMITS.title }} />
        </div>
        <div>
          <label htmlFor="lab-desc" className="label">
            {t('labs.info.desc')}
          </label>
          <textarea
            id="lab-desc"
            rows={3}
            className={`input py-2 ${errors[`info.desc_${lang}`] ? '!border-danger' : ''}`}
            maxLength={LIMITS.desc}
            value={lab.desc[lang]}
            onChange={(e) => setText('desc', e.target.value)}
            {...lp}
          />
          <ErrorMsg code={errors[`info.desc_${lang}`]} params={{ max: LIMITS.desc }} />
        </div>
        <div>
          <span className="label">{t('labs.info.equipment')}</span>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  className="input"
                  aria-label={`${t('labs.info.equipment')} ${i + 1}`}
                  maxLength={LIMITS.equipmentItem}
                  value={it}
                  onChange={(e) => setItems(items.map((x, j) => (j === i ? e.target.value : x)))}
                  {...lp}
                />
                <button
                  type="button"
                  className="btn-ghost !p-2"
                  onClick={() => setItems(items.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t('labs.info.removeItem')}</span>
                </button>
              </li>
            ))}
          </ul>
          {items.length < LIMITS.equipmentItems && (
            <button type="button" className="btn-secondary mt-2 !py-1.5 text-xs" onClick={() => setItems([...items, ''])}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('labs.info.addItem')}
            </button>
          )}
          {lang !== 'he' && items.length === 0 && lab.equipment.he.length > 0 && (
            <p className="mt-1 text-xs text-ink-faint">{t('labs.info.equipmentFallback')}</p>
          )}
          <ErrorMsg code={errors[`info.equipment_${lang}`]} params={{ max: LIMITS.equipmentItem, count: LIMITS.equipmentItems }} />
        </div>
      </EditorSection>

      <EditorSection title={t('labs.info.look')}>
        <fieldset>
          <legend className="label">{t('labs.info.icon')}</legend>
          <div className="flex flex-wrap gap-1.5" role="radiogroup">
            {LAB_ICONS.map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={lab.icon === name}
                aria-label={name}
                title={name}
                onClick={() => update((d) => ({ ...d, icon: name }))}
                className={`grid h-10 w-10 place-items-center rounded-xl border transition ${
                  lab.icon === name
                    ? 'border-moss bg-moss/10 text-ink dark:text-paper'
                    : 'border-edge text-ink-faint hover:border-moss dark:border-white/15'
                }`}
              >
                <ObsIcon name={name} className="h-5 w-5" />
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            id="lab-region"
            label={t('labs.info.region')}
            value={lab.region}
            onChange={(v) => update((d) => ({ ...d, region: v }))}
            options={REGIONS.map((r) => ({ value: r, label: t(`regions.${r}`) }))}
          />
          <Select
            id="lab-difficulty"
            label={t('labs.info.difficulty')}
            value={lab.difficulty}
            onChange={(v) => update((d) => ({ ...d, difficulty: v }))}
            options={DIFFICULTIES.map((r) => ({ value: r, label: t(`difficulty.${r}`) }))}
          />
          <Select
            id="lab-status"
            label={t('labs.info.status')}
            hint={t('labs.info.statusHint')}
            value={lab.status}
            onChange={(v) => update((d) => ({ ...d, status: v }))}
            options={LAB_STATUSES.map((r) => ({ value: r, label: t(`status.${r}`) }))}
          />
          <Select
            id="lab-metric"
            label={t('labs.info.metric')}
            hint={t('labs.info.metricHint')}
            value={lab.metric}
            onChange={(v) => update((d) => ({ ...d, metric: v }))}
            options={[
              { value: '', label: t('labs.info.metricNone') },
              ...Object.keys(METRICS).map((k) => ({ value: k, label: metricLabel(k, locale) })),
            ]}
          />
        </div>

        <div>
          <label htmlFor="lab-slug" className="label">
            {t('labs.info.slug')}
          </label>
          <input
            id="lab-slug"
            className={`input ${errors['info.slug'] ? '!border-danger' : ''}`}
            dir="ltr"
            maxLength={LIMITS.slug}
            value={lab.slug}
            disabled={published}
            onChange={(e) =>
              update((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'), slugEdited: true }))
            }
          />
          {published ? (
            <LockedHint reason={t('labs.locked.slug')} />
          ) : (
            <p className="mt-1 text-xs text-ink-faint">{t('labs.info.slugHint')}</p>
          )}
          <ErrorMsg code={errors['info.slug']} />
        </div>
      </EditorSection>

      <EditorSection title={t('labs.info.map')} hint={t('labs.info.mapHint')}>
        <CenterPicker
          value={lab.center}
          zoom={lab.zoom}
          invalid={Boolean(errors['info.center'])}
          onChange={({ center, zoom }) => update((d) => ({ ...d, center, zoom }))}
        />
        <ErrorMsg code={errors['info.center']} />
      </EditorSection>
    </div>
  );
}

function Select({ id, label, hint, value, onChange, options }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </div>
  );
}
