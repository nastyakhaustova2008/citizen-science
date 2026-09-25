import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Crosshair,
  Check,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  CircleCheck,
} from 'lucide-react';

import { useI18n } from '../../i18n';
import { useAppData, InvalidValuesError } from '../../context/AppDataContext';
import {
  activeFields,
  emptyInput,
  inputToValue,
  validateValue,
  fieldLabel,
  formatFieldValue,
} from '../../lib/fields';
import { coordLabel } from '../../lib/format';
import LocationPicker from './LocationPicker';
import FieldInput from './FieldInput';

const STEPS = ['location', 'values', 'photo'];

function ProtocolReminder({ text }) {
  const { t } = useI18n();
  return (
    <aside className="rounded-lg border-s-2 border-moss bg-moss/5 p-3 text-sm dark:bg-moss/10">
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-moss">
        {t('wizard.protocolReminder')}
      </p>
      <p className="text-ink-soft dark:text-paper/80">{text}</p>
    </aside>
  );
}

function nowLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/**
 * Add-measurement wizard. Steps 2–3 are built from the campaign's field definitions
 * (observation.fields): step 2 — every active non-photo field, step 3 — photo fields,
 * summary and confirmation. The database re-validates on insert; if it rejects the values
 * (e.g. the form changed meanwhile), the campaign is re-read, the input is kept and the
 * fields that need fixing are highlighted.
 */
export default function AddMeasurementWizard({ observation }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { addMeasurement } = useAppData();

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);
  const [placeLabel, setPlaceLabel] = useState('');

  const [datetime, setDatetime] = useState(nowLocalInput);
  const [inputs, setInputs] = useState({});
  const [touched, setTouched] = useState(() => new Set());
  const [triedValues, setTriedValues] = useState(false);
  const [triedPhotos, setTriedPhotos] = useState(false);
  const [serverErrors, setServerErrors] = useState({});
  const [formUpdated, setFormUpdated] = useState(false);

  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Re-derived on every render, so a refreshed definition applies immediately.
  const fields = activeFields(observation);
  const valueFields = fields.filter((f) => f.type !== 'photo');
  const photoFields = fields.filter((f) => f.type === 'photo');
  const scale = observation.scale;

  const rawOf = (f) => (f.key in inputs ? inputs[f.key] : emptyInput(f));

  const values = useMemo(() => {
    const out = {};
    for (const f of fields) {
      const v = inputToValue(f, f.key in inputs ? inputs[f.key] : emptyInput(f));
      if (v !== undefined) out[f.key] = v;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs, observation]);

  const clientErrors = useMemo(() => {
    const out = {};
    for (const f of fields) {
      const e = validateValue(f, values[f.key]);
      if (e) out[f.key] = e;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, observation]);

  const datetimeInvalid = !datetime || Number.isNaN(new Date(datetime).getTime());

  function errorFor(f) {
    if (serverErrors[f.key]) return serverErrors[f.key];
    const tried = f.type === 'photo' ? triedPhotos : triedValues;
    return tried || touched.has(f.key) ? clientErrors[f.key] || null : null;
  }

  function warningFor(f) {
    if (!f.isPrimary || !scale?.plausible || clientErrors[f.key]) return null;
    const v = values[f.key];
    if (typeof v !== 'number') return null;
    const [min, max] = scale.plausible;
    if (v >= min && v <= max) return null;
    return t('wizard.step2.rangeWarning', { min, max, unit: f.unit || '' });
  }

  function setInput(key, raw) {
    setInputs((prev) => ({ ...prev, [key]: raw }));
    setServerErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function touch(key) {
    setTouched((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }

  const valueStepErrors = valueFields.filter((f) => clientErrors[f.key] || serverErrors[f.key]);
  const photoStepErrors = photoFields.filter((f) => clientErrors[f.key] || serverErrors[f.key]);

  function focusField(key) {
    setTimeout(() => {
      const el =
        document.getElementById(`field-${key}`) ||
        document.querySelector(`input[name="field-${key}"]`);
      el?.focus();
    }, 0);
  }

  function useMyLocation() {
    setLocError(false);
    if (!navigator.geolocation) {
      setLocError(true);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords([
          Number(pos.coords.latitude.toFixed(5)),
          Number(pos.coords.longitude.toFixed(5)),
        ]);
        setLocating(false);
      },
      () => {
        setLocError(true);
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function goNext() {
    if (step === 0) {
      if (coords) setStep(1);
      return;
    }
    setTriedValues(true);
    if (datetimeInvalid) return;
    if (valueStepErrors.length) {
      focusField(valueStepErrors[0].key);
      return;
    }
    setStep(2);
  }

  async function submit() {
    setTriedValues(true);
    setTriedPhotos(true);
    if (valueStepErrors.length || datetimeInvalid) {
      setStep(1);
      if (valueStepErrors.length) focusField(valueStepErrors[0].key);
      return;
    }
    if (photoStepErrors.length) return;

    setSaving(true);
    setSaveError(false);
    setFormUpdated(false);
    try {
      const photos = {};
      for (const f of photoFields) if (inputs[f.key]) photos[f.key] = inputs[f.key];
      await addMeasurement({
        observationId: observation.id,
        lat: coords[0],
        lng: coords[1],
        placeLabel: placeLabel.trim(),
        timestamp: new Date(datetime).toISOString(),
        values,
        photos,
      });
      setDone(true);
    } catch (err) {
      if (err instanceof InvalidValuesError) {
        // The campaign was re-read; keep every input and highlight what the database refused.
        setServerErrors(err.fieldErrors);
        setFormUpdated(true);
        const keys = Object.keys(err.fieldErrors);
        const onlyPhotos = keys.length > 0 && keys.every((k) => photoFields.some((f) => f.key === k));
        if (!onlyPhotos) {
          setStep(1);
          const first = valueFields.find((f) => keys.includes(f.key));
          if (first) focusField(first.key);
        }
      } else {
        console.error('[wizard] save failed', err);
        setSaveError(true);
      }
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setDone(false);
    setStep(0);
    setCoords(null);
    setPlaceLabel('');
    setDatetime(nowLocalInput());
    setInputs({});
    setTouched(new Set());
    setTriedValues(false);
    setTriedPhotos(false);
    setServerErrors({});
    setFormUpdated(false);
    setConfirmed(false);
  }

  if (done) {
    return (
      <div className="surface mx-auto max-w-md p-6 text-center">
        <CircleCheck className="mx-auto h-10 w-10 text-ok" strokeWidth={1.5} aria-hidden="true" />
        <h2 className="mt-3 font-serif text-xl font-bold text-ink dark:text-paper">
          {t('wizard.success.title')}
        </h2>
        <p className="mt-1.5 text-sm text-ink-faint">{t('wizard.success.body')}</p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            className="btn-secondary"
            onClick={reset}
          >
            {t('wizard.success.addAnother')}
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => navigate(`/observations/${observation.slug}?tab=map`)}
          >
            {t('wizard.success.backToObservation')}
          </button>
        </div>
      </div>
    );
  }

  const Prev = locale === 'he' ? ChevronRight : ChevronLeft;
  const Next = locale === 'he' ? ChevronLeft : ChevronRight;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {/* Stepper */}
      <ol className="flex items-center gap-2 text-xs" aria-label={t('wizard.stepOf', { current: step + 1, total: 3 })}>
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-semibold ${
                i < step
                  ? 'border-moss bg-moss text-paper'
                  : i === step
                    ? 'border-bark bg-bark text-paper-raised'
                    : 'border-edge text-ink-faint'
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
            </span>
            <span
              className={`hidden truncate sm:block ${
                i === step ? 'font-semibold text-ink dark:text-paper' : 'text-ink-faint'
              }`}
            >
              {t(`wizard.steps.${s === 'photo' && !photoFields.length ? 'review' : s}`)}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-edge dark:bg-white/10" />}
          </li>
        ))}
      </ol>

      {/* Step 1 — location */}
      {step === 0 && (
        <div className="space-y-3">
          <h2 className="font-serif text-lg font-bold text-ink dark:text-paper">
            {t('wizard.step1.title')}
          </h2>
          <ProtocolReminder text={t('wizard.step1.reminder')} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={useMyLocation} disabled={locating}>
              <Crosshair className="h-4 w-4" aria-hidden="true" />
              {locating ? t('wizard.step1.locating') : t('wizard.step1.useLocation')}
            </button>
          </div>
          {locError && (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {t('wizard.step1.locationError')}
            </p>
          )}
          <p className="text-sm text-ink-faint">{t('wizard.step1.pickOnMap')}</p>
          <LocationPicker
            center={observation.center}
            zoom={observation.zoom + 4}
            value={coords}
            onPick={setCoords}
            height={320}
          />
          <p className="tnum text-sm text-ink-soft dark:text-paper/80" dir="ltr" aria-live="polite">
            {coords
              ? t('wizard.step1.selected', {
                  lat: coordLabel(coords[0]),
                  lng: coordLabel(coords[1]),
                })
              : ''}
            {!coords && <span dir="auto">{t('wizard.step1.noneSelected')}</span>}
          </p>
          <label className="block">
            <span className="label">
              {t('wizard.step1.placeLabel')}{' '}
              <span className="font-normal text-ink-faint">({t('common.optional')})</span>
            </span>
            <input
              type="text"
              maxLength={120}
              className="input"
              placeholder={t('wizard.step1.placePlaceholder')}
              value={placeLabel}
              onChange={(e) => setPlaceLabel(e.target.value)}
            />
          </label>
        </div>
      )}

      {/* Step 2 — values (built from the campaign's fields) */}
      {step === 1 && (
        <div className="space-y-4">
          <h2 className="font-serif text-lg font-bold text-ink dark:text-paper">
            {t('wizard.step2.title')}
          </h2>
          <ProtocolReminder text={t('wizard.step2.reminder')} />
          {formUpdated && <FormUpdatedNotice />}

          <label className="block">
            <span className="label">{t('wizard.step2.datetimeLabel')}</span>
            <input
              type="datetime-local"
              className={`input tnum ${triedValues && datetimeInvalid ? '!border-danger' : ''}`}
              value={datetime}
              onChange={(e) => setDatetime(e.target.value)}
              aria-invalid={triedValues && datetimeInvalid}
            />
            {triedValues && datetimeInvalid && (
              <p className="mt-1 text-sm text-danger">{t('fields.errors.required')}</p>
            )}
          </label>

          {valueFields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={rawOf(f)}
              onChange={(raw) => setInput(f.key, raw)}
              onBlur={() => touch(f.key)}
              error={errorFor(f)}
              warning={warningFor(f)}
            />
          ))}
        </div>
      )}

      {/* Step 3 — photo fields, summary & confirm */}
      {step === 2 && (
        <div className="space-y-4">
          <h2 className="font-serif text-lg font-bold text-ink dark:text-paper">
            {photoFields.length ? t('wizard.step3.title') : t('wizard.step3.titleReview')}
          </h2>
          {photoFields.length > 0 && <ProtocolReminder text={t('wizard.step3.reminder')} />}
          {formUpdated && <FormUpdatedNotice />}

          {photoFields.map((f) => (
            <FieldInput
              key={f.key}
              field={f}
              value={rawOf(f)}
              onChange={(raw) => setInput(f.key, raw)}
              error={errorFor(f)}
            />
          ))}

          <div className="surface p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink dark:text-paper">
              {t('wizard.step3.summary')}
            </h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {valueFields
                .filter((f) => values[f.key] !== undefined)
                .map((f) => (
                  <SummaryRow key={f.key} label={fieldLabel(f, locale)} numeric={f.type === 'number'}>
                    {formatFieldValue(f, values[f.key], { locale, t })}
                  </SummaryRow>
                ))}
              <dt className="text-ink-faint">{t('map.panel.date')}</dt>
              <dd className="tnum">{new Date(datetime).toLocaleString(locale)}</dd>
              {placeLabel.trim() && (
                <>
                  <dt className="text-ink-faint">{t('wizard.step1.placeLabel')}</dt>
                  <dd>{placeLabel.trim()}</dd>
                </>
              )}
              <dt className="text-ink-faint">GPS</dt>
              <dd className="tnum text-xs" dir="ltr">
                {coords && `${coordLabel(coords[0])}, ${coordLabel(coords[1])}`}
              </dd>
            </dl>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 accent-bark"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>{t('wizard.step3.confirmText')}</span>
          </label>

          {saveError && (
            <p className="flex items-center gap-1.5 text-sm text-danger" role="alert">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {t('wizard.saveError')}
            </p>
          )}
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between border-t border-edge pt-4 dark:border-white/10">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => (step === 0 ? navigate(-1) : setStep((s) => s - 1))}
        >
          <Prev className="h-4 w-4" aria-hidden="true" />
          {step === 0 ? t('common.cancel') : t('common.previous')}
        </button>

        {step < 2 ? (
          <button type="button" className="btn-primary" disabled={step === 0 && !coords} onClick={goNext}>
            {t('common.next')}
            <Next className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={!confirmed || saving} onClick={submit}>
            <Check className="h-4 w-4" aria-hidden="true" />
            {saving ? t('wizard.saving') : t('wizard.step3.submit')}
          </button>
        )}
      </div>
    </div>
  );
}

function FormUpdatedNotice() {
  const { t } = useI18n();
  return (
    <p
      className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm text-warn"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {t('wizard.formUpdated')}
    </p>
  );
}

function SummaryRow({ label, numeric, children }) {
  return (
    <>
      <dt className="text-ink-faint">{label}</dt>
      <dd className={numeric ? 'tnum font-semibold' : 'break-words'}>
        {numeric ? <span dir="ltr">{children}</span> : children}
      </dd>
    </>
  );
}
