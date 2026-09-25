import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MapPin,
  Crosshair,
  Check,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ImagePlus,
  X,
  CircleCheck,
} from 'lucide-react';

import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { METRICS, metricLabel } from '../../data/metrics';
import { observationTitle } from '../../data/mockData';
import { formatValueWithUnit, coordLabel } from '../../lib/format';
import { photoDataUri } from '../../lib/media';
import LocationPicker from './LocationPicker';

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

export default function AddMeasurementWizard({ observation }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { addMeasurement } = useAppData();
  const metric = METRICS[observation.metric];

  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);

  const [coords, setCoords] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(false);

  const [value, setValue] = useState('');
  const [datetime, setDatetime] = useState(nowLocalInput);
  const [instrument, setInstrument] = useState('');
  const [conditions, setConditions] = useState('');
  const [notes, setNotes] = useState('');
  const [touchedValue, setTouchedValue] = useState(false);

  const [photo, setPhoto] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const numeric = value === '' ? null : Number(value);
  const outOfRange =
    numeric != null &&
    !Number.isNaN(numeric) &&
    (numeric < metric.plausible[0] || numeric > metric.plausible[1]);
  const valueInvalid = touchedValue && (value === '' || Number.isNaN(numeric));

  const canNext = useMemo(() => {
    if (step === 0) return !!coords;
    if (step === 1) return value !== '' && !Number.isNaN(numeric) && instrument.trim() !== '';
    return confirmed;
  }, [step, coords, value, numeric, instrument, confirmed]);

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

  function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result);
    reader.readAsDataURL(file);
  }

  async function submit() {
    setSaving(true);
    setSaveError(false);
    try {
      await addMeasurement({
        observationId: observation.id,
        lat: coords[0],
        lng: coords[1],
        value: numeric,
        timestamp: new Date(datetime).toISOString(),
        instrument: instrument.trim(),
        conditions: conditions.trim(),
        notes: notes.trim(),
        photoDataUri: photo,
        placeLabel: conditions.trim() || t('wizard.steps.location'),
      });
      setDone(true);
    } catch (err) {
      console.error('[wizard] save failed', err);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
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
            onClick={() => {
              setDone(false);
              setStep(0);
              setCoords(null);
              setValue('');
              setInstrument('');
              setConditions('');
              setNotes('');
              setPhoto(null);
              setConfirmed(false);
              setTouchedValue(false);
            }}
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
              {t(`wizard.steps.${s}`)}
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
        </div>
      )}

      {/* Step 2 — values */}
      {step === 1 && (
        <div className="space-y-3">
          <h2 className="font-serif text-lg font-bold text-ink dark:text-paper">
            {t('wizard.step2.title')}
          </h2>
          <ProtocolReminder text={t('wizard.step2.reminder')} />

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">{t('wizard.step2.valueLabel', { unit: metric.unit })}</span>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                className={`input tnum ${valueInvalid ? '!border-danger' : ''}`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={() => setTouchedValue(true)}
                aria-invalid={valueInvalid}
                aria-describedby="value-help"
              />
            </label>
            <label className="block">
              <span className="label">{t('wizard.step2.datetimeLabel')}</span>
              <input
                type="datetime-local"
                className="input tnum"
                value={datetime}
                onChange={(e) => setDatetime(e.target.value)}
              />
            </label>
          </div>

          <div id="value-help" aria-live="polite">
            {valueInvalid && <p className="text-sm text-danger">{t('wizard.step2.valueRequired')}</p>}
            {outOfRange && !valueInvalid && (
              <p className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 p-2 text-sm text-warn">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {t('wizard.step2.rangeWarning', {
                  min: metric.plausible[0],
                  max: metric.plausible[1],
                  unit: metric.unit,
                })}
              </p>
            )}
          </div>

          <label className="block">
            <span className="label">{t('wizard.step2.instrumentLabel')}</span>
            <input
              type="text"
              className="input"
              placeholder={t('wizard.step2.instrumentPlaceholder')}
              value={instrument}
              onChange={(e) => setInstrument(e.target.value)}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="label">
                {t('wizard.step2.conditionsLabel')}{' '}
                <span className="font-normal text-ink-faint">({t('common.optional')})</span>
              </span>
              <input
                type="text"
                className="input"
                placeholder={t('wizard.step2.conditionsPlaceholder')}
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">
                {t('wizard.step2.notesLabel')}{' '}
                <span className="font-normal text-ink-faint">({t('common.optional')})</span>
              </span>
              <input
                type="text"
                className="input"
                placeholder={t('wizard.step2.notesPlaceholder')}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        </div>
      )}

      {/* Step 3 — photo & confirm */}
      {step === 2 && (
        <div className="space-y-3">
          <h2 className="font-serif text-lg font-bold text-ink dark:text-paper">
            {t('wizard.step3.title')}
          </h2>
          <ProtocolReminder text={t('wizard.step3.reminder')} />

          {photo ? (
            <div className="relative w-fit">
              <img
                src={photo}
                alt={t('wizard.step3.photoAlt')}
                className="max-h-64 rounded-lg border border-edge dark:border-white/10"
              />
              <button
                type="button"
                className="btn-secondary absolute end-2 top-2 !px-2 !py-1"
                onClick={() => setPhoto(null)}
              >
                <X className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">{t('wizard.step3.removePhoto')}</span>
              </button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-edge bg-paper-sunk/40 p-6 text-center text-sm text-ink-faint hover:border-moss dark:border-white/15 dark:bg-white/5">
              <ImagePlus className="h-6 w-6" aria-hidden="true" strokeWidth={1.5} />
              <span className="font-semibold text-ink dark:text-paper">{t('wizard.step3.addPhoto')}</span>
              <span>{t('wizard.step3.photoHint')}</span>
              <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={onPhoto} />
            </label>
          )}

          <div className="surface p-4">
            <h3 className="mb-2 text-sm font-semibold text-ink dark:text-paper">
              {t('wizard.step3.summary')}
            </h3>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              <dt className="text-ink-faint">{metricLabel(observation.metric, locale)}</dt>
              <dd className="tnum font-semibold">
                {formatValueWithUnit(numeric, metric.unit, { locale, decimals: metric.decimals })}
              </dd>
              <dt className="text-ink-faint">{t('map.panel.date')}</dt>
              <dd className="tnum">{new Date(datetime).toLocaleString(locale)}</dd>
              <dt className="text-ink-faint">{t('wizard.step2.instrumentLabel')}</dt>
              <dd>{instrument}</dd>
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
          <button
            type="button"
            className="btn-primary"
            disabled={!canNext}
            onClick={() => {
              if (step === 1) setTouchedValue(true);
              if (canNext) setStep((s) => s + 1);
            }}
          >
            {t('common.next')}
            <Next className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={!canNext || saving} onClick={submit}>
            <Check className="h-4 w-4" aria-hidden="true" />
            {saving ? t('wizard.saving') : t('wizard.step3.submit')}
          </button>
        )}
      </div>
    </div>
  );
}
