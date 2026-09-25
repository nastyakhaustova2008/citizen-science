import { useEffect, useState } from 'react';
import {
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Plus,
  Trash2,
  Archive,
  ArchiveRestore,
  Star,
  Hash,
  ListChecks,
  CircleDot,
  Type,
  ToggleLeft,
  CalendarClock,
  Camera,
  Hourglass,
} from 'lucide-react';
import { useI18n } from '../../i18n';
import {
  FIELD_TYPES,
  LIMITS,
  emptyField,
  emptyOption,
  fieldKeyFromLabel,
  optionKeyFromLabel,
  fieldPending,
} from '../../lib/labs';
import { langProps } from './LangSwitch';
import { ErrorMsg, LockedHint, CheckRow } from './EditorBits';

export const TYPE_ICON = {
  number: Hash,
  choice: CircleDot,
  multi_choice: ListChecks,
  text: Type,
  boolean: ToggleLeft,
  datetime: CalendarClock,
  photo: Camera,
};

const move = (list, i, dir) => {
  const j = i + dir;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};

/**
 * Field list of a lab (step-3 rules): add, order, edit, delete (draft) / archive (published).
 * `live` = the published form (labFromCampaign) when the lab is published, else null: then
 * fields / options that exist in it (inLive) are archived instead of deleted, and structural
 * changes are marked "pending review" (they go into the revision, step 5c).
 */
export default function FieldsEditor({ lab, update, lang, errors, live = null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(() => new Set());
  const [adding, setAdding] = useState(false);

  // Open the cards that have errors after a save attempt.
  useEffect(() => {
    const withErrors = lab.fields
      .filter((_, i) => Object.keys(errors).some((k) => k.startsWith(`fields.${i}.`)))
      .map((f) => f.uid);
    if (withErrors.length) setOpen((prev) => new Set([...prev, ...withErrors]));
  }, [errors, lab.fields]);

  const setFields = (fn) => update((d) => ({ ...d, fields: fn(d.fields) }));

  const updateField = (i, fn) =>
    setFields((fields) =>
      fields.map((f, j) => {
        if (j !== i) return f;
        const next = fn(f);
        // Unsaved field: the key follows the English label until typed by hand.
        if (!next.saved && !next.keyEdited && next.label.en !== f.label.en) {
          next.key = fieldKeyFromLabel(next.label.en, fields.filter((_, k) => k !== i).map((x) => x.key));
        }
        return next;
      }),
    );

  const setPrimary = (i, on) =>
    setFields((fields) => fields.map((f, j) => ({ ...f, isPrimary: j === i ? on : on ? false : f.isPrimary })));

  function addField(type) {
    const f = { ...emptyField(type), inLive: live ? false : undefined };
    // The first number field of a lab becomes its primary field.
    if (type === 'number' && !lab.fields.some((x) => x.isPrimary && !x.archived)) f.isPrimary = true;
    setFields((fields) => [...fields, f]);
    setOpen((prev) => new Set([...prev, f.uid]));
    setAdding(false);
  }

  const toggle = (uid) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const noPrimary = !lab.fields.some((f) => f.isPrimary && !f.archived && f.type === 'number');

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-faint">{t('labs.fields.builtIn')}</p>
      {noPrimary && lab.fields.length > 0 && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">{t('labs.fields.noPrimary')}</p>
      )}
      {errors.fields && <ErrorMsg code={errors.fields} params={{ count: LIMITS.fields }} />}

      <ol className="space-y-2">
        {lab.fields.map((f, i) => (
          <FieldCard
            key={f.uid}
            field={f}
            index={i}
            count={lab.fields.length}
            lang={lang}
            errors={errors}
            open={open.has(f.uid)}
            onToggle={() => toggle(f.uid)}
            onChange={(fn) => updateField(i, fn)}
            onMove={(dir) => setFields((fields) => move(fields, i, dir))}
            onRemove={() => setFields((fields) => fields.filter((_, j) => j !== i))}
            onPrimary={(on) => setPrimary(i, on)}
            live={live}
          />
        ))}
      </ol>

      {lab.fields.length === 0 && (
        <p className="rounded-lg border border-dashed border-edge p-4 text-center text-sm text-ink-faint dark:border-white/15">
          {t('labs.fields.empty')}
        </p>
      )}

      {live && <p className="text-xs text-ink-faint">{t('labs.revision.fieldsHint')}</p>}
      {adding ? (
        <div className="surface p-3">
          <p className="label">{t('labs.fields.chooseType')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {FIELD_TYPES.map((type) => {
              const Icon = TYPE_ICON[type];
              return (
                <button key={type} type="button" className="btn-secondary !justify-start !px-3 text-xs" onClick={() => addField(type)}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {t(`labs.types.${type}`)}
                </button>
              );
            })}
          </div>
          <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => setAdding(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" className="btn-secondary" onClick={() => setAdding(true)} disabled={lab.fields.length >= LIMITS.fields}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('labs.fields.add')}
        </button>
      )}
    </div>
  );
}

function FieldCard({ field: f, index: i, count, lang, errors, open, onToggle, onChange, onMove, onRemove, onPrimary, live }) {
  const { t } = useI18n();
  // Published lab: fields of the published form are archived, never deleted; structural changes
  // are "pending review" until the revision is approved.
  const archivable = Boolean(live && f.inLive);
  const pending = Boolean(live && fieldPending(live, f));
  const p = `fields.${i}.`;
  const err = (k) => errors[p + k];
  const hasErrors = Object.keys(errors).some((k) => k.startsWith(p));
  const Icon = TYPE_ICON[f.type] || Type;
  const lp = langProps(lang);
  const id = `lab-field-${f.uid}`;
  const set = (patch) => onChange((x) => ({ ...x, ...patch }));
  const title = f.label[lang] || f.label.he || f.label.en || f.label.ru || t('labs.fields.untitled');

  function changeType(type) {
    onChange((x) => ({
      ...x,
      type,
      decimals: type === 'number' ? (x.decimals ?? 1) : null,
      isPrimary: type === 'number' ? x.isPrimary : false,
      textLong: type === 'text' ? x.textLong : false,
      options: type === 'choice' || type === 'multi_choice' ? x.options : [],
      unit: type === 'number' ? x.unit : '',
      min: type === 'number' ? x.min : '',
      max: type === 'number' ? x.max : '',
    }));
  }

  return (
    <li className={`surface ${hasErrors ? '!border-danger' : ''} ${f.archived ? 'opacity-70' : ''}`}>
      <div className="flex items-center gap-2 p-2.5">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-start"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          onClick={onToggle}
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-edge text-ink-soft dark:border-white/15 dark:text-paper/80">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-ink dark:text-paper" {...langProps(f.label[lang] ? lang : 'he')}>
              {title}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
              <span>{t(`labs.types.${f.type}`)}</span>
              {f.key && (
                <code dir="ltr" className="font-mono">
                  {f.key}
                </code>
              )}
              {f.isPrimary && (
                <span className="inline-flex items-center gap-0.5 text-bark">
                  <Star className="h-3 w-3" aria-hidden="true" />
                  {t('labs.fields.primaryBadge')}
                </span>
              )}
              {f.required && <span>· {t('labs.fields.requiredBadge')}</span>}
              {f.archived && <span>· {t('labs.fields.archivedBadge')}</span>}
              {pending && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-warn/15 px-1.5 text-warn">
                  <Hourglass className="h-3 w-3" aria-hidden="true" />
                  {live && !f.inLive ? t('labs.revision.newBadge') : t('labs.revision.pendingBadge')}
                </span>
              )}
            </span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        <div className="flex shrink-0">
          <button type="button" className="btn-ghost !p-2" disabled={i === 0} onClick={() => onMove(-1)}>
            <ArrowUp className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('labs.fields.moveUp')}</span>
          </button>
          <button type="button" className="btn-ghost !p-2" disabled={i === count - 1} onClick={() => onMove(1)}>
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('labs.fields.moveDown')}</span>
          </button>
        </div>
      </div>

      {open && (
        <div id={`${id}-body`} className="space-y-4 border-t border-edge p-3 dark:border-white/10">
          <div>
            <label htmlFor={`${id}-label`} className="label">
              {t('labs.fields.label')}
            </label>
            <input
              id={`${id}-label`}
              className={`input ${err(`label_${lang}`) ? '!border-danger' : ''}`}
              maxLength={LIMITS.fieldLabel}
              value={f.label[lang]}
              onChange={(e) => onChange((x) => ({ ...x, label: { ...x.label, [lang]: e.target.value } }))}
              {...lp}
            />
            <ErrorMsg code={err(`label_${lang}`)} params={{ max: LIMITS.fieldLabel }} />
          </div>
          <div>
            <label htmlFor={`${id}-help`} className="label">
              {t('labs.fields.help')} ({t('common.optional')})
            </label>
            <input
              id={`${id}-help`}
              className="input"
              maxLength={LIMITS.help}
              value={f.help[lang]}
              onChange={(e) => onChange((x) => ({ ...x, help: { ...x.help, [lang]: e.target.value } }))}
              {...lp}
            />
            <ErrorMsg code={err(`help_${lang}`)} params={{ max: LIMITS.help }} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${id}-key`} className="label">
                {t('labs.fields.key')}
              </label>
              <input
                id={`${id}-key`}
                className={`input font-mono ${err('key') ? '!border-danger' : ''}`}
                dir="ltr"
                maxLength={40}
                value={f.key}
                disabled={f.saved}
                onChange={(e) => set({ key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'), keyEdited: true })}
              />
              {f.saved ? (
                <LockedHint reason={t('labs.locked.key')} addNew />
              ) : (
                <p className="mt-1 text-xs text-ink-faint">{t('labs.fields.keyHint')}</p>
              )}
              <ErrorMsg code={err('key')} />
            </div>
            <div>
              <label htmlFor={`${id}-type`} className="label">
                {t('labs.fields.type')}
              </label>
              <select id={`${id}-type`} className="input" value={f.type} disabled={f.saved} onChange={(e) => changeType(e.target.value)}>
                {FIELD_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t(`labs.types.${type}`)}
                  </option>
                ))}
              </select>
              {f.saved && <LockedHint reason={t('labs.locked.type')} addNew />}
              <ErrorMsg code={err('type')} />
            </div>
          </div>

          <CheckRow
            id={`${id}-required`}
            checked={f.required}
            onChange={(v) => set({ required: v })}
            label={t('labs.fields.required')}
          />

          {f.type === 'number' && <NumberSettings f={f} id={id} err={err} set={set} onPrimary={onPrimary} />}

          {f.type === 'text' && (
            <CheckRow
              id={`${id}-long`}
              checked={f.textLong}
              onChange={(v) => set({ textLong: v })}
              label={t('labs.fields.textLong')}
              hint={t('labs.fields.textLongHint', { short: 200, long: 2000 })}
            />
          )}

          {(f.type === 'choice' || f.type === 'multi_choice') && (
            <OptionsEditor f={f} id={id} p={p} lang={lang} errors={errors} onChange={onChange} live={live} />
          )}

          <div className="flex flex-wrap gap-2 border-t border-edge pt-3 dark:border-white/10">
            {archivable ? (
              <button
                type="button"
                className="btn-secondary !py-1.5 text-xs"
                // an archived field cannot stay the primary one
                onClick={() => set({ archived: !f.archived, isPrimary: f.archived ? f.isPrimary : false })}
              >
                {f.archived ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                {f.archived ? t('labs.fields.unarchive') : t('labs.fields.archive')}
              </button>
            ) : (
              <button type="button" className="btn-secondary !py-1.5 text-xs text-danger" onClick={onRemove}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {t('labs.fields.remove')}
              </button>
            )}
            <p className="self-center text-xs text-ink-faint">
              {archivable ? t('labs.revision.archiveHint') : live ? t('labs.revision.removeNewHint') : t('labs.fields.removeHint')}
            </p>
          </div>
        </div>
      )}
    </li>
  );
}

function NumberSettings({ f, id, err, set, onPrimary }) {
  const { t } = useI18n();
  return (
    <div className="space-y-4 rounded-lg bg-paper-sunk/50 p-3 dark:bg-white/5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor={`${id}-unit`} className="label">
            {t('labs.fields.unit')}
          </label>
          <input
            id={`${id}-unit`}
            className="input"
            dir="ltr"
            maxLength={LIMITS.unit}
            value={f.unit}
            disabled={f.saved}
            onChange={(e) => set({ unit: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-min`} className="label">
            {t('labs.fields.min')}
          </label>
          <input
            id={`${id}-min`}
            className={`input tnum ${err('min_value') ? '!border-danger' : ''}`}
            dir="ltr"
            inputMode="decimal"
            value={f.min}
            onChange={(e) => set({ min: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-max`} className="label">
            {t('labs.fields.max')}
          </label>
          <input
            id={`${id}-max`}
            className={`input tnum ${err('max_value') ? '!border-danger' : ''}`}
            dir="ltr"
            inputMode="decimal"
            value={f.max}
            onChange={(e) => set({ max: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`${id}-decimals`} className="label">
            {t('labs.fields.decimals')}
          </label>
          <select
            id={`${id}-decimals`}
            className="input"
            value={f.decimals ?? 0}
            onChange={(e) => set({ decimals: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>
      {f.saved && <LockedHint reason={t('labs.locked.unit')} addNew />}
      <ErrorMsg code={err('min_value') || err('max_value') || err('decimals') || err('unit')} params={{ max: LIMITS.unit }} />
      <CheckRow
        id={`${id}-primary`}
        checked={f.isPrimary}
        disabled={f.archived}
        onChange={onPrimary}
        label={t('labs.fields.primary')}
        hint={t('labs.fields.primaryHint')}
      />
      <ErrorMsg code={err('is_primary') && `primary_${err('is_primary')}`} />
    </div>
  );
}

function OptionsEditor({ f, id, p, lang, errors, onChange, live }) {
  const { t } = useI18n();
  const lp = langProps(lang);
  const setOptions = (fn) => onChange((x) => ({ ...x, options: fn(x.options) }));
  const updateOption = (j, fn) =>
    setOptions((opts) =>
      opts.map((o, k) => {
        if (k !== j) return o;
        const next = fn(o);
        if (!next.saved && !next.keyEdited && next.label.en !== o.label.en) {
          next.key = optionKeyFromLabel(next.label.en, opts.filter((_, m) => m !== j).map((x) => x.key));
        }
        return next;
      }),
    );

  return (
    <fieldset className="space-y-2 rounded-lg bg-paper-sunk/50 p-3 dark:bg-white/5">
      <legend className="label !mb-0">{t('labs.fields.options')}</legend>
      {errors[`${p}options`] && <ErrorMsg code={errors[`${p}options`]} params={{ count: LIMITS.options }} />}
      <ol className="space-y-2">
        {f.options.map((o, j) => {
          const q = `${p}options.${j}.`;
          const oid = `${id}-opt-${o.uid}`;
          const oerr = errors[`${q}label_${lang}`] || errors[`${q}key`];
          return (
            <li key={o.uid} className={`rounded-lg border p-2 ${oerr ? 'border-danger' : 'border-edge dark:border-white/10'} ${o.archived ? 'opacity-60' : ''}`}>
              <div className="flex items-center gap-1.5">
                <input
                  id={oid}
                  className="input !py-1.5"
                  aria-label={`${t('labs.fields.optionLabel')} ${j + 1}`}
                  maxLength={LIMITS.optionLabel}
                  value={o.label[lang]}
                  onChange={(e) => updateOption(j, (x) => ({ ...x, label: { ...x.label, [lang]: e.target.value } }))}
                  {...lp}
                />
                <button type="button" className="btn-ghost !p-1.5" disabled={j === 0} onClick={() => setOptions((opts) => move(opts, j, -1))}>
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t('labs.fields.moveUp')}</span>
                </button>
                <button type="button" className="btn-ghost !p-1.5" disabled={j === f.options.length - 1} onClick={() => setOptions((opts) => move(opts, j, 1))}>
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only">{t('labs.fields.moveDown')}</span>
                </button>
                {live && o.inLive ? (
                  // an option of the published form: archive / unarchive (goes into the revision)
                  <button
                    type="button"
                    className="btn-ghost !p-1.5"
                    aria-pressed={o.archived}
                    onClick={() => updateOption(j, (x) => ({ ...x, archived: !x.archived }))}
                  >
                    {o.archived ? <ArchiveRestore className="h-4 w-4" aria-hidden="true" /> : <Archive className="h-4 w-4" aria-hidden="true" />}
                    <span className="sr-only">{o.archived ? t('labs.fields.unarchive') : t('labs.fields.archive')}</span>
                  </button>
                ) : (
                  <button type="button" className="btn-ghost !p-1.5 text-danger" onClick={() => setOptions((opts) => opts.filter((_, k) => k !== j))}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">{t('labs.fields.removeOption')}</span>
                  </button>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                <label htmlFor={`${oid}-key`}>{t('labs.fields.optionKey')}</label>
                <input
                  id={`${oid}-key`}
                  className="input !w-40 !py-1 font-mono !text-xs"
                  dir="ltr"
                  maxLength={40}
                  value={o.key}
                  disabled={o.saved}
                  onChange={(e) =>
                    updateOption(j, (x) => ({ ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'), keyEdited: true }))
                  }
                />
                {o.saved && <span>{t('labs.locked.optionKeyShort')}</span>}
                {o.archived && <span>· {t('labs.fields.archivedBadge')}</span>}
              </div>
              <ErrorMsg code={oerr} params={{ max: LIMITS.optionLabel }} />
            </li>
          );
        })}
      </ol>
      {f.options.length < LIMITS.options && (
        <button
          type="button"
          className="btn-secondary !py-1.5 text-xs"
          onClick={() => setOptions((opts) => [...opts, { ...emptyOption(), inLive: live ? false : undefined }])}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t('labs.fields.addOption')}
        </button>
      )}
      {f.options.some((o) => o.saved) && <LockedHint reason={t('labs.locked.optionKey')} />}
    </fieldset>
  );
}
