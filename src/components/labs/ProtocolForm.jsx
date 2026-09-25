import { Hourglass } from 'lucide-react';
import { useI18n } from '../../i18n';
import { LIMITS, block } from '../../lib/labs';
import Markdown from '../Markdown';
import { langProps } from './LangSwitch';
import { ErrorMsg, EditorSection } from './EditorBits';

/**
 * Per-lab protocol (Markdown) in the chosen language. Empty → the protocol page shows the
 * generic steps. On a published lab (`live` = the published lab) the protocol is structural (it
 * defines the method): changes go into the revision and need 3 approvals (step 5c).
 */
export default function ProtocolForm({ lab, update, lang, errors, live = null }) {
  const { t } = useI18n();
  const value = lab.protocol[lang];
  const pending = live && ['he', 'en', 'ru'].some((l) => block(live.protocol[l]) !== block(lab.protocol[l]));
  return (
    <EditorSection title={t('labs.protocol.title')} hint={t('labs.protocol.hint')}>
      {live && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink dark:text-paper">
          <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          <span>{pending ? t('labs.revision.protocolPending') : t('labs.revision.protocolHint')}</span>
        </p>
      )}
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
          placeholder={t('labs.protocol.placeholder')}
          onChange={(e) => update((d) => ({ ...d, protocol: { ...d.protocol, [lang]: e.target.value } }))}
          {...langProps(lang)}
        />
        <p className="mt-1 text-xs text-ink-faint">{t('labs.protocol.syntax')}</p>
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
