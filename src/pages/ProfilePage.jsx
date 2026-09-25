import { useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Award,
  Sunrise,
  CalendarCheck,
  Layers,
  ShieldCheck,
  MapPin,
  Flag,
} from 'lucide-react';

import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import {
  getUser,
  CURRENT_USER_ID,
  USER_BADGES,
  monthlyContributions,
  getObservation,
  observationTitle,
} from '../data/mockData';

import { Avatar, EmptyState, SectionHeading, Skeleton, LoadingBlock, ErrorBlock } from '../components/primitives';
import MiniMap from '../components/MiniMap';
import ContributionGraph from '../components/ContributionGraph';
import { formatDate } from '../lib/format';

const BADGE_ICON = {
  firstMeasurement: MapPin,
  tenMeasurements: Award,
  threeCampaigns: Layers,
  earlyBird: Sunrise,
  consistent: CalendarCheck,
  peerReview: Flag,
};

export default function ProfilePage() {
  const { userId } = useParams();
  const id = userId || CURRENT_USER_ID;
  const { t, locale } = useI18n();
  const {
    measurements,
    measurementsLoading: loading,
    measurementsError: error,
    reloadMeasurements: retry,
  } = useAppData();

  const user = getUser(id);
  const myPoints = useMemo(
    () => measurements.filter((m) => m.userId === id),
    [measurements, id],
  );
  const contributions = useMemo(() => monthlyContributions(id), [id]);
  const badges = USER_BADGES[id] || [];

  const campaigns = useMemo(() => {
    const ids = [...new Set(myPoints.map((m) => m.observationId))];
    return ids.map(getObservation).filter(Boolean);
  }, [myPoints]);

  if (!user) {
    return <EmptyState title={t('observation.notFound')} />;
  }

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock onRetry={retry} />;

  const center = myPoints[0] ? [myPoints[0].lat, myPoints[0].lng] : [31.9, 34.9];

  return (
    <div className="space-y-8" key={id}>
      {/* Identity */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <Avatar user={user} size={72} className="!rounded-xl" />
        <div className="flex-1">
          <h1 className="font-serif text-2xl font-bold text-ink dark:text-paper">
            {user.displayName}
          </h1>
          <p className="text-sm text-ink-faint">
            {user.school} · {user.class}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="chip">
              {user.role === 'mentor' && <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
              {t(`profile.role.${user.role}`)}
            </span>
            <span className="chip">{t(`regions.${user.region}`)}</span>
            <span className="text-ink-faint">
              {t('profile.activeSince', { date: formatDate(user.joinedAt, locale) })}
            </span>
          </div>
        </div>
        <dl className="flex gap-6">
          <div className="text-center">
            <dt className="text-xs text-ink-faint">{t('profile.measurements')}</dt>
            <dd className="tnum text-2xl font-semibold text-ink dark:text-paper">{myPoints.length}</dd>
          </div>
          <div className="text-center">
            <dt className="text-xs text-ink-faint">{t('profile.campaignsJoined')}</dt>
            <dd className="tnum text-2xl font-semibold text-ink dark:text-paper">{campaigns.length}</dd>
          </div>
        </dl>
      </header>

      {/* Map of own points */}
      <section>
        <SectionHeading as="h2" title={t('profile.myPoints')} />
        {myPoints.length === 0 ? (
          <EmptyState icon={MapPin} title={t('profile.myPointsEmpty')} />
        ) : (
          <MiniMap
            center={center}
            points={myPoints}
            metric={getObservation(myPoints[0].observationId)?.metric}
            heightClass="h-72"
          />
        )}
        {campaigns.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {campaigns.map((c) => (
              <li key={c.id}>
                <Link to={`/observations/${c.slug}`} className="chip hover:chip-active">
                  {observationTitle(c, locale)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Contribution graph */}
      <section>
        <SectionHeading as="h2" title={t('profile.contributions')} />
        {loading ? <Skeleton className="h-24" /> : <ContributionGraph data={contributions} />}
      </section>

      {/* Badges */}
      <section>
        <SectionHeading as="h2" title={t('profile.badges')} />
        {badges.length === 0 ? (
          <EmptyState icon={Award} title={t('profile.badgesEmpty')} />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {badges.map((key) => {
              const Icon = BADGE_ICON[key] || Award;
              return (
                <li key={key} className="surface flex items-start gap-3 p-3.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge text-bark dark:border-white/10">
                    <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-ink dark:text-paper">
                      {t(`badges.${key}.name`)}
                    </p>
                    <p className="text-xs text-ink-faint">{t(`badges.${key}.desc`)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
