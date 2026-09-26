import { useState } from 'react';
import { useI18n } from '../../i18n';

/** Reject an admin photo: an optional reason (≤ 500 characters, shown to the admin). */
export default function RejectForm({ busy, onSend, onCancel }) {
  const { t } = useI18n();
  const [reason, setReason] = useState('');
  return (
    <div className="mt-1.5 space-y-1.5 rounded-lg border border-edge p-2 dark:border-white/10">
      <label className="block text-xs font-semibold">
        {t('avatars.rejectReason')}
        <textarea
          className="input mt-1 min-h-[3.5rem] text-sm"
          dir="auto"
          maxLength={500}
          value={reason}
          placeholder={t('avatars.rejectPlaceholder')}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
          disabled={busy}
          onClick={() => onSend(reason.trim() || null)}
        >
          {t('avatars.rejectSend')}
        </button>
        <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
