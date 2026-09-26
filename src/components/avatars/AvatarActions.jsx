import { useCallback, useEffect, useState } from 'react';
import { Clock, EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { REPORT_REASONS } from '../../lib/comments';
import { confirmAvatar, getAvatar, moderateAvatar, reportAvatar } from '../../lib/avatarsApi';
import { AVATAR_BUCKET, forgetSignedUrl, removeFile } from '../../lib/storage';
import ReasonPicker from '../photos/ReasonPicker';
import AvatarErrorText from './AvatarErrorText';
import RejectForm from './RejectForm';

const action = 'rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-faint hover:bg-paper-sunk hover:text-ink dark:hover:bg-white/5 dark:hover:text-paper';

/**
 * Someone else's profile page (logged-in viewers): what I may do with their picture (017) —
 * report it; main admins / owner: hide, show again, delete; their confirmer: confirm / reject.
 * The server re-checks every action.
 */
export default function AvatarActions({ userId }) {
  const { t } = useI18n();
  const { refreshAvatars, reloadAvatarQueue } = useAppData();
  const [info, setInfo] = useState(undefined);
  const [mode, setMode] = useState(null); // report | reject | delete
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setInfo(await getAvatar(userId));
    } catch {
      setInfo(null);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!info?.avatar) return null;
  const a = info.avatar;

  async function run(fn, after) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setMode(null);
      after?.(res);
      forgetSignedUrl(a.path, AVATAR_BUCKET);
      await load();
      refreshAvatars([userId]);
      reloadAvatarQueue();
    } catch (err) {
      setError({ code: err.code || 'generic' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1 text-xs">
      {a.status === 'pending' && (
        <p className="flex items-center gap-1 font-semibold text-bark dark:text-bark-light">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {t('avatars.pendingOther')}
        </p>
      )}
      {a.status === 'hidden' && (
        <p className="flex items-center gap-1 font-semibold text-bark dark:text-bark-light">
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
          {t(a.hiddenReason === 'reports' ? 'avatars.hiddenByReports' : 'avatars.hiddenByModerator')}
        </p>
      )}
      {info.canModerate && a.reports > 0 && (
        <p className="font-semibold text-danger">{t('comments.reportsCount', { count: a.reports })}</p>
      )}

      {mode === 'report' ? (
        <ReasonPicker
          name={`avatar-report-${userId}`}
          title={t('avatars.reportTitle')}
          reasons={REPORT_REASONS}
          labelKey="comments.reasons"
          sendLabel={t('comments.reportSend')}
          busy={busy}
          onSend={(r) => run(() => reportAvatar(userId, r), (res) => setNotice(res.hidden ? 'avatars.reportHidden' : 'comments.reportDone'))}
          onCancel={() => setMode(null)}
        />
      ) : mode === 'reject' ? (
        <RejectForm
          busy={busy}
          onSend={(reason) => run(() => confirmAvatar(userId, false, reason), () => removeFile(a.path, AVATAR_BUCKET))}
          onCancel={() => setMode(null)}
        />
      ) : mode === 'delete' ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>{t('avatars.confirmModDelete')}</span>
          <button
            type="button"
            className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
            disabled={busy}
            onClick={() => run(() => moderateAvatar(userId, 'delete'), () => removeFile(a.path, AVATAR_BUCKET))}
          >
            {t('avatars.delete')}
          </button>
          <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setMode(null)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-1">
          {info.canConfirm && (
            <>
              <button type="button" className={action} disabled={busy} onClick={() => run(() => confirmAvatar(userId, true))}>
                {t('avatars.confirm')}
              </button>
              <button type="button" className={`${action} !text-danger`} onClick={() => setMode('reject')}>
                {t('avatars.reject')}
              </button>
            </>
          )}
          {info.canModerate && a.status === 'hidden' && (
            <button type="button" className={action} disabled={busy} onClick={() => run(() => moderateAvatar(userId, 'unhide'))}>
              {t('comments.unhide')}
            </button>
          )}
          {info.canModerate && a.status !== 'hidden' && a.status !== 'pending' && a.reports > 0 && (
            <button type="button" className={action} disabled={busy} onClick={() => run(() => moderateAvatar(userId, 'unhide'))}>
              {t('comments.keep')}
            </button>
          )}
          {info.canModerate && a.status !== 'hidden' && a.status !== 'pending' && (
            <button type="button" className={action} disabled={busy} onClick={() => run(() => moderateAvatar(userId, 'hide'))}>
              {t('comments.hide')}
            </button>
          )}
          {info.canModerate && (
            <button type="button" className={`${action} !text-danger`} onClick={() => setMode('delete')}>
              {t('avatars.delete')}
            </button>
          )}
          {!a.mine && (a.status === 'active' || a.status === 'confirmed') && !a.reported && (
            <button type="button" className={action} onClick={() => setMode('report')}>
              {t('avatars.report')}
            </button>
          )}
          {!a.mine && a.reported && <span className="px-1.5 py-0.5 text-[11px] text-ink-faint">{t('comments.reported')}</span>}
        </div>
      )}
      {notice && (
        <p className="text-[11px] text-ink-faint" role="status">
          {t(notice)}
        </p>
      )}
      <AvatarErrorText error={error} />
    </div>
  );
}
