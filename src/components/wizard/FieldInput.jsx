import { AlertTriangle, ImagePlus, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { fieldLabel, fieldHelp, optionLabel, errorParams } from '../../lib/fields';

/**
 * One form field rendered from its definition (see src/lib/fields.js).
 * `value` is the raw form state (emptyInput / what the inputs produce),
 * `error` an error code (fields.errors.<code>) or null, `warning` an optional soft note.
 * `contentLocale` (optional): language of the field's own texts (the lab editor's preview);
 * defaults to the UI language.
 */
export default function FieldInput({ field, value, onChange, onBlur, error, warning, contentLocale, idPrefix = 'field' }) {
  const { t, locale: uiLocale } = useI18n();
  const locale = contentLocale || uiLocale;
  const id = `${idPrefix}-${field.key}`;
  const helpId = `${id}-help`;
  const msgId = `${id}-msg`;
  const label = fieldLabel(field, locale);
  const help = fieldHelp(field, locale);
  const invalid = !!error;
  const describedBy = [help && helpId, (error || warning) && msgId].filter(Boolean).join(' ') || undefined;

  const labelText = (
    <>
      {label}
      {field.type === 'number' && field.unit && (
        <>
          {' '}
          (<span dir="ltr">{field.unit}</span>)
        </>
      )}
      {!field.required && (
        <span className="font-normal text-ink-faint"> ({t('common.optional')})</span>
      )}
    </>
  );

  const helpText = help && (
    <p id={helpId} className="mt-1 text-xs text-ink-faint">
      {help}
    </p>
  );

  const message = (error || warning) && (
    <div id={msgId} aria-live="polite" className="mt-1">
      {error ? (
        <p className="text-sm text-danger">{t(`fields.errors.${error}`, errorParams(field))}</p>
      ) : (
        <p className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {warning}
        </p>
      )}
    </div>
  );

  const invalidCls = invalid ? '!border-danger' : '';

  // Choice / multi choice / boolean: a group of chips with real radio / checkbox inputs.
  if (field.type === 'choice' || field.type === 'multi_choice' || field.type === 'boolean') {
    const multi = field.type === 'multi_choice';
    const items =
      field.type === 'boolean'
        ? [
            { key: true, label: t('common.yes') },
            { key: false, label: t('common.no') },
          ]
        : field.options
            // Archived options stay visible only if already selected (so the student can unselect).
            .filter((o) => !o.archived || (multi ? value.includes(o.key) : value === o.key))
            .map((o) => ({ key: o.key, label: optionLabel(field, o.key, locale) }));
    const isOn = (k) => (multi ? value.includes(k) : value === k);
    return (
      <fieldset aria-describedby={describedBy} aria-invalid={invalid} onBlur={onBlur}>
        <legend className="label">{labelText}</legend>
        {helpText}
        <div className="mt-1.5 flex flex-wrap gap-2">
          {items.map((it) => (
            <label
              key={String(it.key)}
              className={`chip cursor-pointer gap-1.5 !py-1.5 !text-sm ${isOn(it.key) ? 'chip-active' : ''} ${
                invalid ? '!border-danger' : ''
              }`}
            >
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={id}
                className="accent-bark"
                checked={isOn(it.key)}
                onChange={() => {
                  if (!multi) onChange(it.key);
                  else onChange(isOn(it.key) ? value.filter((k) => k !== it.key) : [...value, it.key]);
                }}
              />
              {it.label}
            </label>
          ))}
        </div>
        {message}
      </fieldset>
    );
  }

  if (field.type === 'photo') {
    return (
      <div aria-describedby={describedBy}>
        <span className="label">{labelText}</span>
        {helpText}
        <div className="mt-1.5">
          {value ? (
            <div className="relative w-fit">
              <img
                src={value}
                alt={t('wizard.step3.photoAlt')}
                className="max-h-64 rounded-lg border border-edge dark:border-white/10"
              />
              <button
                type="button"
                className="btn-secondary absolute end-2 top-2 !px-2 !py-1"
                onClick={() => onChange(null)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('wizard.step3.removePhoto')}</span>
              </button>
            </div>
          ) : (
            <label
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-edge bg-paper-sunk/40 p-6 text-center text-sm text-ink-faint hover:border-moss dark:border-white/15 dark:bg-white/5 ${invalidCls}`}
            >
              <ImagePlus className="h-6 w-6" aria-hidden="true" strokeWidth={1.5} />
              <span className="font-semibold text-ink dark:text-paper">{t('wizard.step3.addPhoto')}</span>
              <span>{t('wizard.step3.photoHintShort')}</span>
              <input
                id={id}
                type="file"
                accept="image/png,image/jpeg"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => onChange(reader.result);
                  reader.readAsDataURL(file);
                }}
              />
            </label>
          )}
        </div>
        {message}
      </div>
    );
  }

  let control;
  if (field.type === 'number') {
    control = (
      <input
        id={id}
        type="number"
        inputMode="decimal"
        step={field.decimals ? 1 / 10 ** field.decimals : 1}
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        dir="ltr"
        className={`input tnum ${invalidCls}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  } else if (field.type === 'datetime') {
    control = (
      <input
        id={id}
        type="datetime-local"
        className={`input tnum ${invalidCls}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  } else if (field.textLong) {
    control = (
      <textarea
        id={id}
        rows={3}
        maxLength={2000}
        className={`input py-2 ${invalidCls}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  } else {
    control = (
      <input
        id={id}
        type="text"
        maxLength={200}
        className={`input ${invalidCls}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
    );
  }

  return (
    <div>
      <label htmlFor={id} className="label">
        {labelText}
      </label>
      {helpText}
      <div className="mt-1">{control}</div>
      {message}
    </div>
  );
}
