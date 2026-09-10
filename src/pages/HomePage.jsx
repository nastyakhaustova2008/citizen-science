import { useMemo, useState } from 'react';
import { MapPin, School, Radio, Search } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import { useMockLoad } from '../hooks/useMockLoad';
import {
  OBSERVATIONS,
  NETWORK_STATS,
  ACTIVITY_FEED,
  observationTitle,
  observationDesc,
} from '../data/mockData';
import { METRICS } from '../data/metrics';

import Counter from '../components/Counter';
import FilterBar from '../components/FilterBar';
import ObservationCard from '../components/ObservationCard';
import ActivityFeed from '../components/ActivityFeed';
import { CardSkeleton, EmptyState, ErrorBlock, SectionHeading, Skeleton } from '../components/primitives';

const ALL = '__all__';

export default function HomePage() {
  const { t, locale } = useI18n();
  const { measurements } = useAppData();
  const { loading, error, retry } = useMockLoad([]);

  const [query, setQuery] = useState('');
  const [topic, setTopic] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [region, setRegion] = useState(ALL);

  const liveStats = useMemo(
    () => ({
      measurements: measurements.length,
      schools: NETWORK_STATS.schools,
      activeObservations: NETWORK_STATS.activeObservations,
    }),
    [measurements.length],
  );

  const regions = useMemo(
    () => [...new Set(OBSERVATIONS.map((o) => o.region))],
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return OBSERVATIONS.filter((o) => {
      if (topic !== ALL && o.metric !== topic) return false;
      if (status !== ALL && o.status !== status) return false;
      if (region !== ALL && o.region !== region) return false;
      if (!q) return true;
      return (
        observationTitle(o, locale).toLowerCase().includes(q) ||
        observationDesc(o, locale).toLowerCase().includes(q) ||
        o.equipment.join(' ').toLowerCase().includes(q)
      );
    });
  }, [query, topic, status, region, locale]);

  const hasActiveFilters = topic !== ALL || status !== ALL || region !== ALL || query.trim() !== '';

  const selects = [
    {
      key: 'topic',
      label: t('home.filters.topic'),
      value: topic,
      onChange: setTopic,
      options: [
        { value: ALL, label: t('common.all') },
        ...Object.keys(METRICS).map((k) => ({ value: k, label: t(`topics.${k}`) })),
      ],
    },
    {
      key: 'status',
      label: t('home.filters.status'),
      value: status,
      onChange: setStatus,
      options: [
        { value: ALL, label: t('common.all') },
        { value: 'collecting', label: t('status.collecting') },
        { value: 'completed', label: t('status.completed') },
      ],
    },
    {
      key: 'region',
      label: t('home.filters.region'),
      value: region,
      onChange: setRegion,
      options: [
        { value: ALL, label: t('common.all') },
        ...regions.map((r) => ({ value: r, label: t(`regions.${r}`) })),
      ],
    },
  ];

  return (
    <div className="space-y-10">
      {/* Intro */}
      <section>
        <h1 className="font-serif text-2xl font-bold text-ink sm:text-3xl dark:text-paper">
          {t('app.name')} — {t('app.tagline')}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-faint sm:text-base">
          {t('app.intro')}
        </p>
      </section>

      {/* Live counters */}
      <section aria-label={t('a11y.counterRegion')}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {loading ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-[76px]" />)
          ) : (
            <>
              <Counter label={t('home.counters.measurements')} value={liveStats.measurements} icon={MapPin} />
              <Counter label={t('home.counters.schools')} value={liveStats.schools} icon={School} />
              <Counter
                label={t('home.counters.active')}
                value={liveStats.activeObservations}
                icon={Radio}
              />
            </>
          )}
        </div>
      </section>

      {/* Campaigns */}
      <section>
        <SectionHeading as="h2" title={t('home.title')} subtitle={t('home.subtitle')} />
        <FilterBar
          selects={selects}
          query={query}
          onQuery={setQuery}
          onReset={() => {
            setQuery('');
            setTopic(ALL);
            setStatus(ALL);
            setRegion(ALL);
          }}
          hasActiveFilters={hasActiveFilters}
        />

        {error ? (
          <ErrorBlock onRetry={retry} />
        ) : loading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={Search} title={t('home.emptyTitle')} body={t('home.emptyBody')} />
        ) : (
          <>
            <p className="mb-3 text-sm text-ink-faint" aria-live="polite">
              {t('home.resultsCount', { count: filtered.length })}
            </p>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((o) => (
                <ObservationCard key={o.id} observation={o} />
              ))}
            </div>
          </>
        )}
      </section>

      {/* Activity */}
      <section>
        <SectionHeading
          as="h2"
          title={t('home.activityTitle')}
          subtitle={t('home.activitySubtitle')}
        />
        {loading ? <Skeleton className="h-64" /> : <ActivityFeed items={ACTIVITY_FEED} />}
      </section>
    </div>
  );
}
