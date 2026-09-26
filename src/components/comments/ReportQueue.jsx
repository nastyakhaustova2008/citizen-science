import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { observationTitle } from '../../data/mockData';
import { formatDate, formatTime } from '../../lib/format';
import { moderateComment } from '../../lib/commentsApi';
import { AuthorName, EmptyState, SectionHeading } from '../primitives';
import CommentBody from './CommentBody';
import CommentErrorText from './CommentErrorText';

/**
 * Admin panel → Comments: comments with open reports on labs I may moderate (the badge).
 * Keep (dismiss the reports, show again), hide, or delete — all logged.
 */
export default function ReportQueue() {
  const { t } = useI18n();
  const { commentReports, reloadCommentReports, loadAuthors } = useAppData();

  useEffect(() => {
    reloadCommentReports();
  }, [reloadCommentReports]);
  useEffect(() => {
    loadAuthors(commentReports.map((c) => c.authorId));
  }, [commentReports, loadAuthors]);

  return (
    <section className="space-y-3">
      <SectionHeading as="h3" title={t('comments.queue.title')} subtitle={t('comments.queue.subtitle')} />
      {commentReports.length === 0 ? (
        <EmptyState title={t('comments.queue.empty')} />
      ) : (
        <ul className="space-y-3">
          {commentReports.map((c) => (
            <ReportedComment key={c.id} comment={c} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ReportedComment({ comment: c }) {
  const { t, locale } = useI18n();
  const { getAuthor, reloadCommentReports, reloadIssues } = useAppData();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const title = observationTitle(c, locale) || c.titleHe || '—';

  async function act(action) {
    setBusy(true);
    setError(null);
    try {
      await moderateComment(c.id, action);
      await reloadCommentReports();
      if (c.kind === 'issue') reloadIssues();
    } catch (err) {
      setError({ code: err.code || 'generic', details: err.details });
      setBusy(false);
    }
  }

  return (
    <li className="surface space-y-2 p-3 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-faint">
        <AuthorName user={getAuthor(c.authorId)} className="font-semibold text-ink dark:text-paper" />
        <span>·</span>
        <Link
          to={`/observations/${c.slug}?tab=map&point=${encodeURIComponent(c.measurementId)}`}
          className="font-semibold hover:underline"
          dir="auto"
        >
          {title}
        </Link>
        <span>·</span>
        <span>{formatDate(c.createdAt, locale)}</span>
        {c.kind === 'issue' && <span className="chip !py-0 text-[10px] text-danger">{t('comments.issue')}</span>}
      </p>
      {c.hidden && (
        <p className="flex items-center gap-1 text-[11px] font-semibold text-bark dark:text-bark-light">
          <EyeOff className="h-3 w-3" aria-hidden="true" />
          {t(c.hiddenReason === 'reports' ? 'comments.hiddenByReports' : 'comments.hiddenByModerator')}
        </p>
      )}
      <div className="rounded-lg bg-paper-sunk p-2 dark:bg-white/5">
        <CommentBody body={c.body} />
      </div>
      <p className="flex flex-wrap gap-1.5 text-[11px]">
        <span className="font-semibold text-danger">{t('comments.reportsCount', { count: c.reports })}</span>
        {Object.entries(c.reasons).map(([r, n]) => (
          <span key={r} className="chip !py-0 text-[10px]">
            {t(`comments.reasons.${r}`)} <span className="tnum" dir="ltr">×{n}</span>
          </span>
        ))}
        {c.lastReportAt && (
          <span className="text-ink-faint">
            {t('comments.queue.lastReport')} {formatDate(c.lastReportAt, locale)}{' '}
            <span dir="ltr">{formatTime(c.lastReportAt, locale)}</span>
          </span>
        )}
      </p>
      {confirmDelete ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t('comments.confirmModDelete')}</span>
          <button
            type="button"
            className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
            disabled={busy}
            onClick={() => act('delete')}
          >
            {t('comments.delete')}
          </button>
          <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setConfirmDelete(false)}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={busy} onClick={() => act('unhide')}>
            {t(c.hidden ? 'comments.unhide' : 'comments.keep')}
          </button>
          {!(c.hidden && c.hiddenReason === 'moderator') && (
            <button type="button" className="btn-secondary !px-2.5 !py-1.5 text-xs" disabled={busy} onClick={() => act('hide')}>
              {t('comments.hide')}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary !px-2.5 !py-1.5 text-xs text-danger"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            {t('comments.delete')}
          </button>
        </div>
      )}
      <CommentErrorText error={error} />
    </li>
  );
}
