import { useI18n } from '../../i18n';
import { LIMITS } from '../../lib/labs';
import Markdown from '../Markdown';
import { langProps } from './LangSwitch';
import { ErrorMsg, LockedHint, EditorSection } from './EditorBits';

/**
 * Per-lab protocol (Markdown) in the chosen language. Empty → the protocol page shows the
 * generic steps. On a published lab the protocol is structural (it defines the method) and
 * changes only through a reviewed revision (step 5c).
 */
export default function ProtocolForm({ lab, update, lang, errors, structureLocked }) {
  const { t } = useI18n();
  const value = lab.protocol[lang];
  return (
    <EditorSection title={t('labs.protocol.title')} hint={t('labs.protocol.hint')}>
      <div>
        <label htmlFor="lab-protocol" className="label">
          {t('labs.protocol.text')}
        </label>
        <textarea
          id="lab-protocol"
          rows={12}
          className={`input py-2 font-mono !text-[13px] ${errors[`info.protocol_${lang}`] ? '!border-danger' : ''}`}
          maxLength={LIMITS.protocol}
          value={value}
          disabled={structureLocked}
          placeholder={t('labs.protocol.placeholder')}
          onChange={(e) => update((d) => ({ ...d, protocol: { ...d.protocol, [lang]: e.target.value } }))}
          {...langProps(lang)}
        />
        {structureLocked ? (
          <LockedHint reason={t('labs.locked.protocolSoon')} />
        ) : (
          <p className="mt-1 text-xs text-ink-faint">{t('labs.protocol.syntax')}</p>
        )}
        <ErrorMsg code={errors[`info.protocol_${lang}`]} params={{ max: LIMITS.protocol }} />
      </div>
      <div>
        <p className="label">{t('labs.protocol.preview')}</p>
        <div className="rounded-lg border border-dashed border-edge p-3 text-sm dark:border-white/15" {...langProps(lang)}>
          {value.trim() ? <Markdown source={value} /> : <p className="text-ink-faint">{t('labs.protocol.empty')}</p>}
        </div>
      </div>
    </EditorSection>
  );
}
