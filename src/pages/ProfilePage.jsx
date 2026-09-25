import { useEffect, useMemo } from 'react';
import { useParams, Link, Navigate, useLocation } from 'react-router-dom';
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
import { useAuth } from '../context/AuthContext';
import { USER_BADGES, monthlyContributions, observationTitle } from '../data/mockData';

import { Avatar, EmptyState, SectionHeading, Skeleton, LoadingBlock, ErrorBlock } from '../components/primitives';
import MiniMap from '../components/MiniMap';
import ContributionGraph from '../components/ContributionGraph';
import AccountSettings from '../components/auth/AccountSettings';
import AdminPanel from '../components/admin/AdminPanel';
import AdminProfileForm from '../components/labs/AdminProfileForm';
import { loginPath } from '../components/auth/AuthUI';
import { formatDate } from '../lib/format';
import { monthlyCounts } from '../lib/stats';
import { isAdminRole } from '../lib/roles';

const BADGE_ICON = {
  firstMeasurement: MapPin,
  tenMeasurements: Award,
  threeCampaigns: Layers,
  earlyBird: Sunrise,
  consistent: CalendarCheck,
  peerReview: Flag,
};

/**
 * /profile → the logged-in user (logged out → login). /profile/:userId → anyone:
 * a real user (profiles) or a demo author of the seeded measurements (mockData, marked "demo").
 */
export default function ProfilePage() {
  const { userId } = useParams();
  const { session, authLoading } = useAuth();
  const ownId = session?.user?.id ?? null;
  if (!userId) {
    if (authLoading) return <LoadingBlock />;
    if (!ownId) return <Navigate to={loginPath('/profile')} replace />;
  }
  return <ProfileView id={userId || ownId} isOwn={!userId || userId === ownId} />;
}

function ProfileView({ id, isOwn }) {
  const { t, locale } = useI18n();
  const {
    getAuthor,
    isAuthorResolved,
    loadAuthors,
    getObservation,
    campaignsLoading,
    campaignsError,
    reloadCampaigns,
    measurements,
    measurementsLoading,
    measurementsError,
    reloadMeasurements,
  } = useAppData();

  const loading = campaignsLoading || measurementsLoading;
  const error = campaignsError || measurementsError;
  const retry = () => {
    if (campaignsError) reloadCampaigns();
    if (measurementsError) reloadMeasurements();
  };

  useEffect(() => {
    loadAuthors([id]);
  }, [id, loadAuthors]);

  const user = getAuthor(id);
  const isDemo = user?.kind === 'demo';
  const myPoints = useMemo(
    () => measurements.filter((m) => m.userId === id),
    [measurements, id],
  );
  // Demo authors keep their mock history; real users get it from their real measurements.
  const contributions = useMemo(
    () => (isDemo ? monthlyContributions(id) : monthlyCounts(myPoints)),
    [isDemo, id, myPoints],
  );
  const badges = isDemo ? USER_BADGES[id] || [] : [];

  const campaigns = useMemo(() => {
    const ids = [...new Set(myPoints.map((m) => m.observationId))];
    return ids.map(getObservation).filter(Boolean);
  }, [myPoints, getObservation]);

  // /profile#admin-profile, #admin: scroll to that section once it is on screen.
  const { hash } = useLocation();
  const ready = isAuthorResolved(id) && Boolean(user) && !loading && !error;
  useEffect(() => {
    if (!ready || !hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }, [ready, hash]);

  if (!isAuthorResolved(id)) return <LoadingBlock />;
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
          <h1 className="font-serif text-2xl font-bold text-ink dark:text-paper" dir="auto">
            {user.displayName}
          </h1>
          {isDemo && (
            <p className="text-sm text-ink-faint">
              {user.school} · {user.class}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="chip">
              {user.role !== 'student' && <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
              {t(`profile.role.${user.role}`)}
            </span>
            {isDemo && <span className="chip">{t(`regions.${user.region}`)}</span>}
            {isDemo && (
              <span className="chip" title={t('auth.demoHint')}>
                {t('auth.demoAuthor')}
              </span>
            )}
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
            scale={getObservation(myPoints[0].observationId)?.scale}
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

      {/* Badges (demo authors only for now) */}
      {isDemo && (
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
      )}

      {isOwn && user.kind === 'real' && isAdminRole(user.role) && (
        <>
          <section id="admin-profile" className="scroll-mt-4">
            <SectionHeading as="h2" title={t('labs.adminProfile.title')} subtitle={t('labs.adminProfile.subtitle')} />
            <div className="surface max-w-xl p-4">
              <AdminProfileForm />
            </div>
          </section>
          <AdminPanel />
        </>
      )}

      {isOwn && <AccountSettings />}
    </div>
  );
}
