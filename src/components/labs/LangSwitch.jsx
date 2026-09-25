import { LOCALES } from '../../i18n/strings';
import { useI18n } from '../../i18n';
import { LANGS } from '../../lib/labs';

/**
 * he / en / ru switch for the lab texts. `missing` = {he: count, …}: a dot + count of empty
 * texts in that language (labs need all three before review).
 */
export default function LangSwitch({ value, onChange, missing, label }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label || t('labs.editor.textLanguage')}>
      {label && <span className="text-xs font-semibold text-ink-faint">{label}</span>}
      {LANGS.map((l) => {
        const n = missing?.[l] || 0;
        return (
          <button
            key={l}
            type="button"
            lang={LOCALES[l].htmlLang}
            className={`chip !py-1.5 !text-sm ${value === l ? 'chip-active' : ''}`}
            aria-pressed={value === l}
            onClick={() => onChange(l)}
          >
            {LOCALES[l].label}
            {n > 0 && (
              <span className="tnum inline-flex items-center gap-1 text-xs text-warn" title={t('labs.editor.missingTexts', { count: n })}>
                <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
                <span className="sr-only">{t('labs.editor.missingTexts', { count: n })}</span>
                <span aria-hidden="true">{n}</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Props for an input holding text in language `lang` (direction + lang attribute). */
export const langProps = (lang) => ({ dir: LOCALES[lang].dir, lang: LOCALES[lang].htmlLang });
