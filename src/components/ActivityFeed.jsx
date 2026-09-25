import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import { getUser, observationTitle } from '../data/mockData';
import { METRICS } from '../data/metrics';
import { relativeTime, formatValueWithUnit } from '../lib/format';
import { Avatar, EmptyState } from './primitives';
import { Activity } from 'lucide-react';

function timeText(t, iso) {
  const rel = relativeTime(iso);
  return t(rel.key, rel.count != null ? { count: rel.count } : undefined);
}

export default function ActivityFeed({ items }) {
  const { t, locale } = useI18n();
  const { getObservation } = useAppData();

  if (!items?.length) {
    return <EmptyState icon={Activity} title={t('home.activityEmpty')} />;
  }

  return (
    <ol className="surface divide-y divide-edge dark:divide-white/10">
      {items.map((it) => {
        const user = getUser(it.userId);
        const obs = getObservation(it.observationId);
        const metric = METRICS[it.metric];
        return (
          <li key={it.id} className="flex items-start gap-3 p-3.5 text-sm">
            <Avatar user={user} size={28} />
            <div className="min-w-0 flex-1">
              <p className="text-ink dark:text-paper">
                <span className="font-semibold">{user?.displayName}</span>{' '}
                <span className="text-ink-faint">{t('home.activityAction')}</span>{' '}
                <Link
                  to={`/observations/${obs?.slug}`}
                  className="font-medium text-ink underline-offset-2 hover:underline dark:text-paper"
                >
                  {observationTitle(obs, locale)}
                </Link>
              </p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {t('home.activityAt', { place: it.placeLabel })} ·{' '}
                <span className="tnum">
                  {formatValueWithUnit(it.value, metric?.unit, {
                    locale,
                    decimals: metric?.decimals ?? 1,
                  })}
                </span>{' '}
                · {timeText(t, it.timestamp)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
