import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { LoginPrompt, SkeletonText } from '../primitives';
import { isolate } from '../auth/AuthUI';
import CommentItem from './CommentItem';
import CommentForm from './CommentForm';

/**
 * Comments of one measurement (point panel). Logged-in users only: read, write, report.
 * thread = useComments(measurementId). The comment's language = the UI language now.
 */
export default function CommentThread({ thread }) {
  const { t, locale } = useI18n();
  const { currentUser, linkDomains } = useAppData();

  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
        {t('comments.title')}
        {currentUser && !thread.loading && !thread.error ? ` (${thread.comments.length})` : ''}
      </h3>
      {!currentUser ? (
        <LoginPrompt className="text-xs" message={t('comments.loginToRead')} />
      ) : (
        <>
          {thread.loading ? (
            <SkeletonText lines={2} />
          ) : thread.error ? (
            <p className="text-xs text-danger">
              {t('comments.loadError')}{' '}
              <button type="button" className="font-semibold underline" onClick={thread.reload}>
                {t('common.retry')}
              </button>
            </p>
          ) : thread.comments.length === 0 ? (
            <p className="text-xs text-ink-faint">{t('comments.empty')}</p>
          ) : (
            <ul className="space-y-3">
              {thread.comments.map((c) => (
                <CommentItem key={c.id} comment={c} thread={thread} />
              ))}
            </ul>
          )}
          <div className="mt-3">
            <CommentForm
              id="pp-comment"
              placeholder={t('comments.placeholder')}
              onSubmit={(body) => thread.add(body, locale)}
            />
            {linkDomains && (
              <p className="mt-1 text-[11px] text-ink-faint">
                {t('comments.rules', { domains: isolate(linkDomains.join(', ')) })}
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
