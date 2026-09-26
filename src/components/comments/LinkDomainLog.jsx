import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { formatDate, formatTime } from '../../lib/format';
import { linkDomainLog } from '../../lib/commentsApi';
import { EmptyState, ErrorBlock, SkeletonText } from '../primitives';

const PAGE = 30;

/** Allowed link domains: who added / removed / proposed / approved / rejected what, when. Admins only. */
export default function LinkDomainLog() {
  const { t, locale } = useI18n();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const rows = await linkDomainLog({ limit: PAGE });
      setEvents(rows);
      setHasMore(rows.length === PAGE);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    setMoreBusy(true);
    try {
      const rows = await linkDomainLog({ limit: PAGE, before: events[events.length - 1].id });
      setEvents((prev) => [...prev, ...rows]);
      setHasMore(rows.length === PAGE);
    } catch {
      setError(true);
    } finally {
      setMoreBusy(false);
    }
  }

  if (loading) return <SkeletonText lines={4} />;
  if (error && events.length === 0) return <ErrorBlock onRetry={load} />;
  if (events.length === 0) return <EmptyState title={t('comments.domainLog.empty')} />;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-edge dark:divide-white/10">
        {events.map((e) => (
          <li key={e.id} className="py-2.5 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-1.5">
              {e.actorId ? (
                <Link to={`/profile/${e.actorId}`} className="font-semibold hover:underline" dir="auto">
                  {e.actorUsername || t('admin.users.noUsername')}
                </Link>
              ) : (
                <span className="text-ink-faint">{t('auth.unknownAuthor')}</span>
              )}
              <span className="text-ink-soft dark:text-paper/80">{t(`comments.domainLog.actions.${e.action}`)}</span>
              <span className="font-semibold" dir="ltr">
                {e.domain}
              </span>
            </p>
            {e.note && (
              <p className="mt-0.5 whitespace-pre-line break-words text-xs text-ink-soft dark:text-paper/70" dir="auto">
                {e.note}
              </p>
            )}
            <p className="mt-0.5 text-xs text-ink-faint">
              <span>{formatDate(e.at, locale)}</span> <span dir="ltr">{formatTime(e.at, locale)}</span>
            </p>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button type="button" className="btn-secondary" onClick={loadMore} disabled={moreBusy}>
          {moreBusy ? t('common.loading') : t('common.more')}
        </button>
      )}
    </div>
  );
}
