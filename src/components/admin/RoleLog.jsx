import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { formatDate, formatTime } from '../../lib/format';
import { roleLog } from '../../lib/admin';
import { EmptyState, ErrorBlock, SkeletonText } from '../primitives';
import { isolate } from '../auth/AuthUI';

const PAGE = 30;

/** Role changes and renames (who, what, to whom, when), newest first. Admins only (checked in SQL). */
export default function RoleLog() {
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
      const rows = await roleLog({ limit: PAGE });
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
      const rows = await roleLog({ limit: PAGE, before: events[events.length - 1].id });
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
  if (events.length === 0) return <EmptyState title={t('admin.log.empty')} />;

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

function PersonLink({ id, username }) {
  const { t } = useI18n();
  if (!id) return <span className="text-ink-faint">{t('auth.unknownAuthor')}</span>;
  return (
    <Link to={`/profile/${id}`} className="font-semibold hover:underline" dir="auto">
      {username || t('admin.users.noUsername')}
    </Link>
  );
}

function LogRow({ event: e }) {
  const { t, locale } = useI18n();
  const cascade = e.action === 'cascade_revoke';
  const role = (r) => (r ? t(`profile.role.${r}`) : '—');

  // Account deletion (014): the deletion itself, then one row per admin moved up the chain.
  if (e.action === 'account_deleted' || e.action === 'chain_moved') {
    const deleted = e.action === 'account_deleted';
    return (
      <li className={`py-2.5 text-sm ${deleted ? '' : 'ps-5'}`}>
        <p className="flex flex-wrap items-baseline gap-x-1.5">
          {deleted ? (
            <span className="text-ink-faint">{t('admin.log.deletedAccount')}</span>
          ) : (
            <PersonLink id={e.targetId} username={e.targetUsername} />
          )}
          <span className="text-ink-soft dark:text-paper/80">{t(`admin.log.actions.${e.action}`)}</span>
          {!deleted &&
            (e.movedUnder ? (
              <PersonLink id={e.movedUnder} username={e.movedUnderUsername} />
            ) : (
              <span className="text-ink-faint">{t('admin.log.noGranter')}</span>
            ))}
        </p>
        <p className="mt-0.5 text-xs text-ink-faint">
          <span className="me-2">
            {deleted ? t('admin.log.deletedRole', { role: role(e.oldRole) }) : t('admin.log.afterDeletion')}
          </span>
          <span>{formatDate(e.at, locale)}</span> <span dir="ltr">{formatTime(e.at, locale)}</span>
        </p>
      </li>
    );
  }

  let detail = null;
  if (e.action === 'rename') {
    detail = t('admin.log.renamedFromTo', {
      old: isolate(e.oldUsername || t('admin.users.noUsername')),
      name: isolate(e.newUsername || '—'),
    });
  } else if (e.action === 'sql_change' && e.oldUsername !== e.newUsername && e.newUsername) {
    detail = t('admin.log.renamedFromTo', { old: isolate(e.oldUsername || '—'), name: isolate(e.newUsername) });
  } else if (e.oldRole !== e.newRole) {
    detail = t('admin.log.roleChange', { old: role(e.oldRole), role: role(e.newRole) });
  }

  return (
    <li className={`py-2.5 text-sm ${cascade ? 'ps-5' : ''}`}>
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        {e.action === 'sql_change' ? (
          // "Changed directly in the database:" + the person; the change itself is in the detail line
          // (admin.log.actions.sql_change is empty on purpose — audit L9, confirmed).
          <span className="text-ink-faint">{t('admin.log.sql')}</span>
        ) : (
          <>
            <PersonLink id={e.actorId} username={e.actorUsername} />
            <span className="text-ink-soft dark:text-paper/80">{t(`admin.log.actions.${e.action}`)}</span>
          </>
        )}
        <PersonLink id={e.targetId} username={e.targetUsername} />
      </p>
      <p className="mt-0.5 text-xs text-ink-faint">
        {detail && <span className="me-2">{detail}</span>}
        {cascade && <span className="me-2">{t('admin.log.cascade')}</span>}
        {e.confirmedStaff && <span className="me-2">{t('admin.log.confirmedStaff')}</span>}
        <span>{formatDate(e.at, locale)}</span> <span dir="ltr">{formatTime(e.at, locale)}</span>
      </p>
    </li>
  );
}
