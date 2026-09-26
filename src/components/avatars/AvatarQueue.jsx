import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { formatDate, formatTime } from '../../lib/format';
import { confirmAvatar, moderateAvatar } from '../../lib/avatarsApi';
import { AVATAR_BUCKET, forgetSignedUrl, removeFile } from '../../lib/storage';
import { Avatar, EmptyState, SectionHeading } from '../primitives';
import AvatarErrorText from './AvatarErrorText';
import RejectForm from './RejectForm';

/**
 * Admin panel → Comments & photos: profile pictures waiting for me (017) — admin face photos I
 * confirm (their appointer, or the owner), and for main admins / the owner pictures with reports
 * or hidden by reports. All logged.
 */
export default function AvatarQueue() {
  const { t } = useI18n();
  const { avatarQueue, reloadAvatarQueue } = useAppData();

  useEffect(() => {
    reloadAvatarQueue();
  }, [reloadAvatarQueue]);

  return (
    <section className="space-y-3">
      <SectionHeading as="h3" title={t('avatars.queue.title')} subtitle={t('avatars.queue.subtitle')} />
      {avatarQueue.length === 0 ? (
        <EmptyState title={t('avatars.queue.empty')} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {avatarQueue.map((a) => (
            <QueuedAvatar key={a.path} item={a} />
          ))}
        </ul>
      )}
    </section>
  );
}

function QueuedAvatar({ item: a }) {
  const { t, locale } = useI18n();
  const { reloadAvatarQueue, refreshAvatars } = useAppData();
  const [mode, setMode] = useState(null); // reject | delete
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const person = { displayName: a.username || '—', avatarSeed: a.userId };

  async function act(fn, removes = false) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      forgetSignedUrl(a.path, AVATAR_BUCKET);
      if (removes) removeFile(a.path, AVATAR_BUCKET);
      refreshAvatars([a.userId]);
      await reloadAvatarQueue();
    } catch (err) {
      setError({ code: err.code || 'generic' });
      setBusy(false);
    }
  }

  return (
    <li className="surface space-y-2 p-3 text-sm">
      <div className="flex items-center gap-3">
        <Avatar user={person} path={a.path} size={96} className="!rounded-xl" />
        <div className="min-w-0 space-y-0.5 text-xs">
          <Link to={`/profile/${a.userId}`} className="font-semibold text-ink hover:underline dark:text-paper" dir="auto">
            {a.username || t('admin.users.noUsername')}
          </Link>
          {a.fullName && (
            <p dir="auto">
              {a.fullName}
              {a.workplace && <span className="text-ink-faint"> · {a.workplace}</span>}
            </p>
          )}
          <p className="text-ink-faint">
            {t(`avatars.kind.${a.kind}`)} · {formatDate(a.createdAt, locale)}
          </p>
          {a.queue === 'confirm' && (
            <p className="flex items-center gap-1 font-semibold text-bark dark:text-bark-light">
              <Clock className="h-3 w-3" aria-hidden="true" />
              {t('avatars.queue.confirmHint')}
            </p>
          )}
          {a.status === 'hidden' && (
            <p className="flex items-center gap-1 font-semibold text-bark dark:text-bark-light">
              <EyeOff className="h-3 w-3" aria-hidden="true" />
              {t(a.hiddenReason === 'reports' ? 'avatars.hiddenByReports' : 'avatars.hiddenByModerator')}
            </p>
          )}
        </div>
      </div>
      {a.reports > 0 && (
        <p className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="font-semibold text-danger">{t('comments.reportsCount', { count: a.reports })}</span>
          {Object.entries(a.reasons).map(([r, n]) => (
            <span key={r} className="chip !py-0 text-[10px]">
              {t(`comments.reasons.${r}`)} <span className="tnum" dir="ltr">×{n}</span>
            </span>
          ))}
          {a.lastReportAt && (
            <span className="text-ink-faint">
              {t('comments.queue.lastReport')} {formatDate(a.lastReportAt, locale)}{' '}
              <span dir="ltr">{formatTime(a.lastReportAt, locale)}</span>
            </span>
          )}
        </p>
      )}

      {mode === 'reject' ? (
        <RejectForm
          busy={busy}
          onSend={(reason) => act(() => confirmAvatar(a.userId, false, reason), true)}
          onCancel={() => setMode(null)}
        />
      ) : mode === 'delete' ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t('avatars.confirmModDelete')}</span>
          <button
            type="button"
            className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
            disabled={busy}
            onClick={() => act(() => moderateAvatar(a.userId, 'delete'), true)}
          >
            {t('avatars.delete')}
          </button>
          <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setMode(null)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : a.queue === 'confirm' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={busy} onClick={() => act(() => confirmAvatar(a.userId, true))}>
            {t('avatars.confirm')}
          </button>
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs text-danger" disabled={busy} onClick={() => setMode('reject')}>
            {t('avatars.reject')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={busy} onClick={() => act(() => moderateAvatar(a.userId, 'unhide'))}>
            {t(a.status === 'hidden' ? 'comments.unhide' : 'comments.keep')}
          </button>
          {a.status !== 'hidden' && (
            <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={busy} onClick={() => act(() => moderateAvatar(a.userId, 'hide'))}>
              {t('comments.hide')}
            </button>
          )}
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs text-danger" disabled={busy} onClick={() => setMode('delete')}>
            {t('avatars.delete')}
          </button>
        </div>
      )}
      <AvatarErrorText error={error} />
    </li>
  );
}
