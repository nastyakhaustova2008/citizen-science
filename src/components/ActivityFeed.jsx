import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import { useAuth } from '../context/AuthContext';
import { useRecentMeasurements } from '../hooks/useMeasurements';
import { observationTitle } from '../data/mockData';
import { relativeTime } from '../lib/format';
import { formatFieldValue } from '../lib/fields';
import { AuthorName, Avatar, EmptyState, ErrorBlock, Skeleton } from './primitives';

function timeText(t, iso) {
  const rel = relativeTime(iso);
  return t(rel.key, rel.count != null ? { count: rel.count } : undefined);
}

/**
 * Home page: the newest real measurements (audit M7 — before, a list from mockData). Logged-out
 * visitors see no names and no avatars, only "A participant" (audit H2, migration 020).
 */
export default function ActivityFeed() {
  const { t, locale } = useI18n();
  const { getObservation, getAuthor, loadAuthors } = useAppData();
  const { session } = useAuth();
  const { data: items, loading, error, reload } = useRecentMeasurements();

  useEffect(() => {
    if (session && items?.length) loadAuthors(items.map((m) => m.userId).filter(Boolean));
  }, [session, items, loadAuthors]);

  if (error) return <ErrorBlock onRetry={reload} />;
  if (loading && !items) return <Skeleton className="h-64" />;
  // Only labs this visitor can open (published; drafts for admins).
  const shown = (items || []).filter((m) => getObservation(m.observationId));
  if (!shown.length) return <EmptyState icon={Activity} title={t('home.activityEmpty')} />;

  return (
    <ol className="surface divide-y divide-edge dark:divide-white/10">
      {shown.map((m) => {
        const obs = getObservation(m.observationId);
        const author = session ? getAuthor(m.userId) : null;
        const primary = obs.primaryField;
        return (
          <li key={m.id} className="flex items-start gap-3 p-3.5 text-sm">
            {session && author ? <Avatar user={author} size={28} /> : null}
            <div className="min-w-0 flex-1">
              <p className="text-ink dark:text-paper">
                {session ? (
                  <AuthorName user={author} className="font-semibold" />
                ) : (
                  <span className="font-semibold">{t('home.activityParticipant')}</span>
                )}{' '}
                <span className="text-ink-faint">{t('home.activityAction')}</span>{' '}
                <Link
                  to={`/observations/${obs.slug}?tab=map&point=${encodeURIComponent(m.id)}`}
                  className="tap-link font-medium text-ink underline-offset-2 hover:underline dark:text-paper"
                  dir="auto"
                >
                  {observationTitle(obs, locale)}
                </Link>
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {m.placeLabel && (
                  <>
                    <span dir="auto">{m.placeLabel}</span> ·{' '}
                  </>
                )}
                {primary && m.value != null && (
                  <>
                    <span className="tnum" dir="ltr">
                      {formatFieldValue(primary, m.value, { locale, t })}
                    </span>{' '}
                    ·{' '}
                  </>
                )}
                {timeText(t, m.timestamp)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
