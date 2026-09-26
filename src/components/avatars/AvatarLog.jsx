import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { formatDate, formatTime } from '../../lib/format';
import { avatarLog } from '../../lib/avatarsApi';
import { EmptyState, ErrorBlock, SkeletonText } from '../primitives';
import { isolate } from '../auth/AuthUI';

const PAGE = 30;
const SYSTEM = ['auto_confirm', 'auto_hide', 'expire', 'role_removed'];

/** Profile pictures log (uploads, confirmations, moderation). Admins only. No images. */
export default function AvatarLog() {
  const { t } = useI18n();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [moreBusy, setMoreBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const rows = await avatarLog({ limit: PAGE });
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
      const rows = await avatarLog({ limit: PAGE, before: events[events.length - 1].id });
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
  if (events.length === 0) return <EmptyState title={t('avatars.log.empty')} />;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-edge dark:divide-white/10">
        {events.map((e) => (
          <LogRow key={e.id} event={e} />
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

function LogRow({ event: e }) {
  const { t, locale } = useI18n();
  const user = e.userId ? e.username || t('admin.users.noUsername') : t('auth.unknownAuthor');
  return (
    <li className="py-2.5 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        {SYSTEM.includes(e.action) && !e.actorId ? (
          <span className="text-ink-faint">{t('labs.log.system')}</span>
        ) : e.actorId ? (
          <Link to={`/profile/${e.actorId}`} className="font-semibold hover:underline" dir="auto">
            {e.actorUsername || t('admin.users.noUsername')}
          </Link>
        ) : (
          <span className="text-ink-faint">{t('auth.unknownAuthor')}</span>
        )}
        <span className="text-ink-soft dark:text-paper/80">
          {t(`avatars.log.actions.${e.action}`, { user: isolate(user), count: e.reports })}
        </span>
      </p>
      <p className="mt-0.5 text-xs text-ink-faint">
        {e.kind && <span className="me-2">{t(`avatars.kind.${e.kind}`)}</span>}
        {e.reason && (
          <span className="me-2" dir="auto">
            {t('avatars.log.reason')} {e.reason}
          </span>
        )}
        {e.reports > 0 && e.action !== 'auto_hide' && (
          <span className="me-2">{t('comments.reportsCount', { count: e.reports })}</span>
        )}
        <span>{formatDate(e.at, locale)}</span> <span dir="ltr">{formatTime(e.at, locale)}</span>
      </p>
    </li>
  );
}
