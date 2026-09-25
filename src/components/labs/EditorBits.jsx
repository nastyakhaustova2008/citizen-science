import { Lock } from 'lucide-react';
import { useI18n } from '../../i18n';

/** Validation message under an input (labs.validation.<code>). */
export function ErrorMsg({ code, params }) {
  const { t } = useI18n();
  if (!code) return null;
  const key = `labs.validation.${code}`;
  const text = t(key, params);
  return (
    <p className="mt-1 text-sm text-danger" role="alert">
      {text === key ? t('labs.validation.invalid') : text}
    </p>
  );
}

/** Why an input is disabled: a lock + a short reason (+ "add a new field instead"). */
export function LockedHint({ reason, addNew = false }) {
  const { t } = useI18n();
  return (
    <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-faint">
      <Lock className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {reason}
        {addNew && ` ${t('labs.locked.addNew')}`}
      </span>
    </p>
  );
}

/** A labelled section of the editor form. */
export function EditorSection({ title, hint, children }) {
  return (
    <section className="surface space-y-4 p-4">
      <div>
        <h2 className="font-serif text-lg font-bold text-ink dark:text-paper">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

export function CheckRow({ id, checked, onChange, disabled, label, hint }) {
  return (
    <div>
      <label htmlFor={id} className={`flex items-start gap-2 text-sm ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
        <input
          id={id}
          type="checkbox"
          className="mt-0.5 accent-bark"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-ink-soft dark:text-paper/80">{label}</span>
          {hint && <span className="block text-xs text-ink-faint">{hint}</span>}
        </span>
      </label>
    </div>
  );
}
