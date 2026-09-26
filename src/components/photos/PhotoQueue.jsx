import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { observationTitle } from '../../data/mockData';
import { formatDate, formatTime } from '../../lib/format';
import { moderatePhoto, REMOVE_REASONS } from '../../lib/photosApi';
import { forgetSignedUrl, removeFile } from '../../lib/storage';
import { AuthorName, QueueState, SectionHeading } from '../primitives';
import PhotoImage from './PhotoImage';
import ReasonPicker from './ReasonPicker';
import PhotoErrorText from './PhotoErrorText';
import { FileCheckNotice, useFileCheck } from './FileCheck';

/**
 * Admin panel → Comments & photos: measurement photos waiting for approval, reported or hidden by
 * reports, on labs I moderate (the badge). Approve / keep / show again, hide, or remove with a
 * reason — all logged.
 */
export default function PhotoQueue() {
  const { t } = useI18n();
  const { photoQueue, reloadPhotoQueue, loadAuthors, queueStatus } = useAppData();

  useEffect(() => {
    reloadPhotoQueue();
  }, [reloadPhotoQueue]);
  useEffect(() => {
    loadAuthors(photoQueue.map((p) => p.ownerId));
  }, [photoQueue, loadAuthors]);

  return (
    <section className="space-y-3">
      <SectionHeading as="h3" title={t('photos.queue.title')} subtitle={t('photos.queue.subtitle')} />
      <QueueState
        status={queueStatus.photos}
        isEmpty={photoQueue.length === 0}
        onRetry={reloadPhotoQueue}
        emptyTitle={t('photos.queue.empty')}
      >
        <ul className="grid gap-3 sm:grid-cols-2">
          {photoQueue.map((p) => (
            <QueuedPhoto key={p.path} photo={p} />
          ))}
        </ul>
      </QueueState>
    </section>
  );
}

function QueuedPhoto({ photo: p }) {
  const { t, locale } = useI18n();
  const { getAuthor, reloadPhotoQueue } = useAppData();
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const title = observationTitle(p, locale) || p.titleHe || '—';
  // Audit M1: look for hidden data (location…) in the stored file before approving.
  const check = useFileCheck(p.path);

  async function act(action, reason) {
    setBusy(true);
    setError(null);
    try {
      const res = await moderatePhoto(p.path, action, reason);
      forgetSignedUrl(p.path);
      if (res.status === 'removed') removeFile(p.path);
      await reloadPhotoQueue();
    } catch (err) {
      setError({ code: err.code || 'generic' });
      setBusy(false);
    }
  }

  return (
    <li className="surface space-y-2 p-3 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-faint">
        <AuthorName user={getAuthor(p.ownerId)} className="font-semibold text-ink dark:text-paper" />
        <span>·</span>
        <Link
          to={`/observations/${p.slug}?tab=map&point=${encodeURIComponent(p.measurementId)}`}
          className="font-semibold hover:underline"
          dir="auto"
        >
          {title}
        </Link>
        <span>·</span>
        <span>{formatDate(p.createdAt, locale)}</span>
      </p>
      {p.status === 'pending' && (
        <p className="flex items-center gap-1 text-[11px] font-semibold text-bark dark:text-bark-light">
          <Clock className="h-3 w-3" aria-hidden="true" />
          {t('photos.queue.pending')}
        </p>
      )}
      {p.status === 'hidden' && (
        <p className="flex items-center gap-1 text-[11px] font-semibold text-bark dark:text-bark-light">
          <EyeOff className="h-3 w-3" aria-hidden="true" />
          {t(p.hiddenReason === 'reports' ? 'photos.hiddenByReports' : 'photos.hiddenByModerator')}
        </p>
      )}
      <PhotoImage path={p.path} alt={t('photos.alt')} />
      <FileCheckNotice check={check}>
        <button
          type="button"
          className="btn-primary !bg-danger !px-2.5 !py-1.5 text-xs hover:!bg-danger/90"
          disabled={busy}
          onClick={() => act('remove', 'personal_info')}
        >
          {t('photos.fileCheck.removeForData')}
        </button>
      </FileCheckNotice>
      {p.reports > 0 && (
        <p className="flex flex-wrap gap-1.5 text-[11px]">
          <span className="font-semibold text-danger">{t('comments.reportsCount', { count: p.reports })}</span>
          {Object.entries(p.reasons).map(([r, n]) => (
            <span key={r} className="chip !py-0 text-[10px]">
              {t(`comments.reasons.${r}`)} <span className="tnum" dir="ltr">×{n}</span>
            </span>
          ))}
          {p.lastReportAt && (
            <span className="text-ink-faint">
              {t('comments.queue.lastReport')} {formatDate(p.lastReportAt, locale)}{' '}
              <span dir="ltr">{formatTime(p.lastReportAt, locale)}</span>
            </span>
          )}
        </p>
      )}
      {removing ? (
        <ReasonPicker
          name={`queue-remove-${p.path}`}
          title={t('photos.removeTitle')}
          reasons={REMOVE_REASONS}
          labelKey="photos.removeReasons"
          sendLabel={t('photos.removeSend')}
          danger
          busy={busy}
          onSend={(r) => act('remove', r)}
          onCancel={() => setRemoving(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5 text-xs"
            disabled={busy || check === 'checking'}
            onClick={() => act('approve')}
          >
            {t(p.status === 'pending' ? 'photos.approve' : p.status === 'hidden' ? 'comments.unhide' : 'comments.keep')}
          </button>
          {p.status === 'approved' && (
            <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={busy} onClick={() => act('hide')}>
              {t('comments.hide')}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5 text-xs text-danger"
            disabled={busy}
            onClick={() => setRemoving(true)}
          >
            {t('photos.remove')}
          </button>
        </div>
      )}
      <PhotoErrorText error={error} />
    </li>
  );
}
