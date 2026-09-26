import { useState } from 'react';
import { useI18n } from '../../i18n';

/**
 * Radio list of reason codes + send / cancel (reporting a photo, a moderator removing one).
 * Same look as the comment report form.
 */
export default function ReasonPicker({ name, title, reasons, labelKey, sendLabel, danger = false, busy, onSend, onCancel }) {
  const { t } = useI18n();
  const [reason, setReason] = useState(null);
  return (
    <fieldset className="mt-1.5 space-y-1.5 rounded-lg border border-edge p-2 dark:border-white/10">
      <legend className="px-1 text-xs font-semibold">{title}</legend>
      {reasons.map((r) => (
        <label key={r} className="flex items-center gap-2 text-xs">
          <input type="radio" name={name} checked={reason === r} onChange={() => setReason(r)} />
          {t(`${labelKey}.${r}`)}
        </label>
      ))}
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          className={`btn-primary !px-2.5 !py-1 text-xs ${danger ? '!bg-danger hover:!bg-danger/90' : ''}`}
          disabled={!reason || busy}
          onClick={() => onSend(reason)}
        >
          {sendLabel}
        </button>
        <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </fieldset>
  );
}
