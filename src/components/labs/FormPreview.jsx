import { useMemo, useState } from 'react';
import { useI18n } from '../../i18n';
import { emptyInput } from '../../lib/fields';
import { previewField } from '../../lib/labs';

/** The stored preview value, or an empty one when the field's type changed meanwhile. */
function safeValue(field, v) {
  if (v === undefined) return emptyInput(field);
  if (field.type === 'multi_choice') return Array.isArray(v) ? v : [];
  return Array.isArray(v) ? emptyInput(field) : v;
}
import FieldInput from '../wizard/FieldInput';
import ObsIcon from '../ObsIcon';
import LangSwitch, { langProps } from './LangSwitch';

/** The student's form as it will look, in the chosen language (nothing is saved). */
export default function FormPreview({ lab }) {
  const { t, locale } = useI18n();
  const [lang, setLang] = useState(locale);
  const [values, setValues] = useState({});
  const fields = useMemo(() => lab.fields.filter((f) => !f.archived).map(previewField), [lab.fields]);
  const missing =
    !lab.title[lang].trim() ||
    lab.fields.some(
      (f) => !f.archived && (!f.label[lang].trim() || f.options.some((o) => !o.archived && !o.label[lang].trim())),
    );

  return (
    <div className="space-y-4">
      <LangSwitch value={lang} onChange={setLang} label={t('labs.preview.language')} />
      {missing && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{t('labs.preview.missing')}</p>
      )}
      <div className="surface space-y-5 p-4" {...langProps(lang)}>
        <header className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper-sunk dark:bg-white/5">
            <ObsIcon name={lab.icon} />
          </span>
          <div className="min-w-0">
            <p className="font-serif text-lg font-bold text-ink dark:text-paper">{lab.title[lang] || lab.title.he || '—'}</p>
            <p className="text-sm text-ink-faint">{lab.desc[lang] || lab.desc.he}</p>
          </div>
        </header>
        <p className="rounded-lg bg-paper-sunk/60 p-2 text-xs text-ink-faint dark:bg-white/5">{t('labs.preview.builtIn')}</p>
        {fields.length === 0 ? (
          <p className="text-sm text-ink-faint">{t('labs.fields.empty')}</p>
        ) : (
          fields.map((f) => (
            <FieldInput
              key={f.key}
              idPrefix="preview"
              field={f}
              contentLocale={lang}
              value={safeValue(f, values[f.key])}
              onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
            />
          ))
        )}
      </div>
      <p className="text-xs text-ink-faint">{t('labs.preview.note')}</p>
    </div>
  );
}
