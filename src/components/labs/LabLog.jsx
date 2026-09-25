import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { observationTitle } from '../../data/mockData';
import { formatDate, formatTime } from '../../lib/format';
import { labLog } from '../../lib/labsApi';
import { EmptyState, ErrorBlock, SkeletonText } from '../primitives';

const PAGE = 30;

/** Lab changes (who, what, which lab, when), newest first. Admins only (checked in SQL). */
export default function LabLog({ campaignId = null }) {
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
      const rows = await labLog({ campaignId, limit: PAGE });
      setEvents(rows);
      setHasMore(rows.length === PAGE);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  async function loadMore() {
    setMoreBusy(true);
    try {
      const rows = await labLog({ campaignId, limit: PAGE, before: events[events.length - 1].id });
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
  if (events.length === 0) return <EmptyState title={t('labs.log.empty')} />;

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

/** Changed columns → "title (EN), map center, icon" (per-language columns get the language). */
function infoList(columns, t) {
  const seen = new Set();
  const out = [];
  for (const k of columns) {
    const lang = k.match(/_(he|en|ru)$/)?.[1];
    const base = k.replace(/_(he|en|ru)$/, '').replace(/_(lat|lng)$/, '');
    const label = `${t(`labs.log.columns.${base}`)}${lang ? ` (${lang.toUpperCase()})` : ''}`;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out.join(', ');
}

function LogRow({ event: e }) {
  const { t, locale } = useI18n();
  const title = observationTitle(e, locale) || e.titleHe || e.titleEn || '—';
  const d = e.details || {};
  const parts = [];
  if (d.info?.length) parts.push(t('labs.log.changedInfo', { list: infoList(d.info, t) }));
  if (d.fields_added?.length) parts.push(t('labs.log.fieldsAdded', { list: d.fields_added.join(', ') }));
  if (d.fields_changed?.length) parts.push(t('labs.log.fieldsChanged', { list: d.fields_changed.join(', ') }));
  if (d.fields_removed?.length) parts.push(t('labs.log.fieldsRemoved', { list: d.fields_removed.join(', ') }));
  // revision_save: the structural changes it proposes (paths from lab_revision_diff)
  if (d.changes?.length) {
    const list = d.changes.map((c) => (c === 'protocol' ? t('labs.log.columns.protocol') : c.replace(/^field\./, '').replace('.option.', ' → ')));
    parts.push(t('labs.log.revisionChanges', { list: list.join(', ') }));
  }

  return (
    <li className="py-2.5 text-sm">
      <p className="flex flex-wrap items-baseline gap-x-1.5">
        {e.action === 'publish' || e.action === 'revision_apply' ? (
          <span className="text-ink-faint">{t('labs.log.system')}</span>
        ) : e.actorId ? (
          <Link to={`/profile/${e.actorId}`} className="font-semibold hover:underline" dir="auto">
            {e.actorUsername || t('admin.users.noUsername')}
          </Link>
        ) : (
          <span className="text-ink-faint">{t('auth.unknownAuthor')}</span>
        )}
        <span className="text-ink-soft dark:text-paper/80">{t(`labs.log.actions.${e.action}`)}</span>
        {e.campaignId && e.slug ? (
          <Link to={`/observations/${e.slug}`} className="font-semibold hover:underline" dir="auto">
            {title}
          </Link>
        ) : (
          <span className="font-semibold" dir="auto">
            {title}
          </span>
        )}
      </p>
      {parts.length > 0 && <p className="mt-0.5 text-xs text-ink-soft dark:text-paper/70">{parts.join(' · ')}</p>}
      <p className="mt-0.5 text-xs text-ink-faint">
        {e.round != null && e.action !== 'create' && e.action !== 'edit' && e.action !== 'revision_save' && (
          <span className="me-2">{t('labs.review.round', { n: e.round })}</span>
        )}
        <span>{formatDate(e.at, locale)}</span> <span dir="ltr">{formatTime(e.at, locale)}</span>
      </p>
    </li>
  );
}
