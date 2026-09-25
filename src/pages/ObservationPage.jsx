import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams, Link, useNavigate } from 'react-router-dom';
import { Plus, FileText, Map as MapIcon, Table2, BarChart3, MessagesSquare, ArrowLeft, ArrowRight, PencilLine, EyeOff } from 'lucide-react';

import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import { observationTitle, observationDesc } from '../data/mockData';
import { fieldLabel } from '../lib/fields';
import { useAuth } from '../context/AuthContext';
import { isAdminRole } from '../lib/roles';
import { canEditLab } from '../lib/labsApi';

import Tabs, { TabPanel } from '../components/Tabs';
import ObservationMap from '../components/map/ObservationMap';
import DataTable from '../components/data/DataTable';
import StatsSummary from '../components/data/StatsSummary';
import ObservationCharts from '../components/charts/ObservationCharts';
import Discussion from '../components/discussion/Discussion';
import {
  StatusBadge,
  DifficultyBadge,
  EmptyState,
  ErrorBlock,
  LoadingBlock,
  Skeleton,
} from '../components/primitives';
import ObsIcon from '../components/ObsIcon';

export default function ObservationPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const {
    getObservation,
    campaignsLoading,
    campaignsError,
    reloadCampaigns,
    measurementsFor,
    measurementsLoading: loading,
    measurementsError: error,
    reloadMeasurements: retry,
    topicsFor,
    isJoined,
    toggleJoin,
  } = useAppData();

  const observation = getObservation(slug);

  // "Edit" for the lab's author, main admins and the owner (asked from the database).
  const { profile } = useAuth();
  const isAdmin = isAdminRole(profile?.role);
  const [canEdit, setCanEdit] = useState(false);
  const obsId = observation?.id;
  useEffect(() => {
    setCanEdit(false);
    if (!isAdmin || !obsId) return undefined;
    let alive = true;
    canEditLab(obsId)
      .then((ok) => alive && setCanEdit(Boolean(ok)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin, obsId]);

  const measurements = useMemo(
    () => (observation ? measurementsFor(observation.id) : []),
    [observation, measurementsFor],
  );
  const topicCount = observation ? topicsFor(observation.id).length : 0;

  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'map';
  const setTab = (id) => setParams({ tab: id }, { replace: true });

  if (campaignsError) return <ErrorBlock onRetry={reloadCampaigns} />;
  if (campaignsLoading) return <LoadingBlock />;

  if (!observation) {
    return (
      <EmptyState
        icon={MapIcon}
        title={t('observation.notFound')}
        body={t('observation.notFoundBody')}
        action={
          <Link to="/" className="btn-secondary mt-1">
            {t('observation.backToList')}
          </Link>
        }
      />
    );
  }

  const joined = isJoined(observation.id);
  const published = observation.publication === 'published';
  const Back = locale === 'he' ? ArrowRight : ArrowLeft;

  const tabs = [
    { id: 'map', label: t('observation.tabs.map'), icon: MapIcon },
    { id: 'data', label: t('observation.tabs.data'), icon: Table2, count: measurements.length },
    { id: 'charts', label: t('observation.tabs.charts'), icon: BarChart3 },
    { id: 'discussion', label: t('observation.tabs.discussion'), icon: MessagesSquare, count: topicCount },
  ];

  return (
    <div className="space-y-5">
      <Link to="/" className="btn-ghost -ms-2 text-sm">
        <Back className="h-4 w-4" aria-hidden="true" />
        {t('observation.backToList')}
      </Link>

      {!published && (
        <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink dark:text-paper">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
          {t('labs.page.notPublished', { status: t(`labs.publication.${observation.publication}`) })}
        </p>
      )}

      {/* Header */}
      <header className="space-y-3">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-paper-sunk text-ink dark:bg-white/5 dark:text-paper">
            <ObsIcon name={observation.icon} className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-2xl font-bold leading-tight text-ink dark:text-paper">
              {observationTitle(observation, locale)}
            </h1>
            <p className="mt-1 text-sm text-ink-faint">{observationDesc(observation, locale)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={observation.status} />
          <DifficultyBadge level={observation.difficulty} />
          {observation.primaryField && (
            <span className="chip">{fieldLabel(observation.primaryField, locale)}</span>
          )}
          <span className="chip">{t(`regions.${observation.region}`)}</span>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {published && (
            <Link to={`/observations/${observation.slug}/add`} className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('observation.addMeasurement')}
            </Link>
          )}
          <button
            type="button"
            className={joined ? 'btn-secondary' : 'btn-secondary'}
            onClick={() => toggleJoin(observation.id)}
            aria-pressed={joined}
          >
            {joined ? t('common.joined') : t('common.join')}
          </button>
          <Link to={`/protocol/${observation.slug}`} className="btn-ghost">
            <FileText className="h-4 w-4" aria-hidden="true" />
            {t('observation.viewProtocol')}
          </Link>
          {canEdit && (
            <Link to={`/labs/${observation.id}/edit`} className="btn-ghost">
              <PencilLine className="h-4 w-4" aria-hidden="true" />
              {t('labs.page.edit')}
            </Link>
          )}
        </div>

        <p className="rounded-lg border border-edge bg-paper-sunk/50 p-3 text-xs text-ink-faint dark:border-white/10 dark:bg-white/5">
          {t('observation.protocolNote')}
        </p>
      </header>

      <Tabs tabs={tabs} active={tab} onChange={setTab} idBase="obs" />

      {error ? (
        <ErrorBlock onRetry={retry} />
      ) : loading ? (
        tab === 'map' ? (
          <Skeleton className="h-[520px] rounded-xl" />
        ) : (
          <LoadingBlock />
        )
      ) : (
        <>
          <TabPanel id="map" active={tab} idBase="obs">
            <ObservationMap observation={observation} measurements={measurements} />
          </TabPanel>

          <TabPanel id="data" active={tab} idBase="obs">
            <div className="space-y-4">
              <StatsSummary measurements={measurements} scale={observation.scale} />
              <DataTable observation={observation} measurements={measurements} />
            </div>
          </TabPanel>

          <TabPanel id="charts" active={tab} idBase="obs">
            {!observation.scale ? (
              <EmptyState title={t('charts.noPrimary')} />
            ) : measurements.length === 0 ? (
              <EmptyState title={t('charts.noData')} />
            ) : (
              <ObservationCharts observation={observation} measurements={measurements} />
            )}
          </TabPanel>

          <TabPanel id="discussion" active={tab} idBase="obs">
            <Discussion observationId={observation.id} />
          </TabPanel>
        </>
      )}
    </div>
  );
}
