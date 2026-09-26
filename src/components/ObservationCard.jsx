import { Link } from 'react-router-dom';
import { MapPin, Users, Wrench, BadgeCheck } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import { observationTitle, observationDesc } from '../data/mockData';
import ObsIcon from './ObsIcon';
import { labEquipment } from '../lib/labs';
import { FEATURES } from '../lib/features';
import MiniMap from './MiniMap';
import { StatusBadge, DifficultyBadge } from './primitives';

export default function ObservationCard({ observation }) {
  const { t, locale } = useI18n();
  const { labSummary, isJoined, toggleJoin, credits } = useAppData();
  const credit = credits[observation.id]; // reviewed labs only (step 5b)
  // Counts of ALL measurements + the mini-map as ~1 km cells (measurement_summary, 019).
  const { n: pointCount, participants, cells, cellsTotal } = labSummary(observation.id);
  const joined = isJoined(observation.id);

  return (
    <article className="surface card-hover flex flex-col overflow-hidden">
      <div className="flex items-start gap-3 p-4 pb-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-paper-sunk text-ink dark:bg-white/5 dark:text-paper">
          <ObsIcon name={observation.icon} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-serif text-base font-bold leading-snug text-ink dark:text-paper">
            <Link
              to={`/observations/${observation.slug}`}
              className="tap-link hover:underline focus-visible:outline-2"
              aria-label={t('a11y.openObservation', { name: observationTitle(observation, locale) })}
            >
              {observationTitle(observation, locale)}
            </Link>
          </h3>
          <p className="mt-0.5 line-clamp-1 text-sm text-ink-faint">
            {observationDesc(observation, locale)}
          </p>
          {credit && (
            <p className="mt-1 flex items-center gap-1 text-xs text-ink-faint">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden="true" />
              <span className="truncate" dir="auto">
                {credit.fullName
                  ? t('labs.credits.cardLine', { name: credit.fullName, workplace: credit.workplace })
                  : t('labs.credits.cardFormer')}
              </span>
            </p>
          )}
        </div>
      </div>

      <div className="px-4">
        <MiniMap
          center={observation.center}
          points={cells}
          scale={observation.scale}
        />
        {cellsTotal > cells.length && (
          <p className="mt-1 text-xs text-ink-faint">
            {t('card.mapPreviewPartial', { shown: cells.length, total: cellsTotal })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-sm text-ink-faint">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          <span className="tnum">{pointCount}</span> {t('units.points')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
          <span className="tnum">{participants}</span> {t('units.participants')}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 px-4">
        <StatusBadge status={observation.status} />
        <DifficultyBadge level={observation.difficulty} />
      </div>

      <div className="mt-2 flex items-start gap-2 px-4 text-xs text-ink-faint">
        <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" strokeWidth={1.75} />
        <span>
          <span className="font-medium">{t('card.equipment')}:</span>{' '}
          {labEquipment(observation, locale).join(' · ')}
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 p-4 pt-3">
        {FEATURES.join ? (
          <>
            <button
              type="button"
              onClick={() => toggleJoin(observation.id)}
              className={joined ? 'btn-secondary flex-1' : 'btn-primary flex-1'}
              aria-pressed={joined}
            >
              {joined ? t('common.joined') : t('common.join')}
            </button>
            <Link to={`/observations/${observation.slug}`} className="btn-ghost">
              {t('common.open')}
            </Link>
          </>
        ) : (
          <Link to={`/observations/${observation.slug}`} className="btn-primary flex-1">
            {t('common.open')}
          </Link>
        )}
      </div>
    </article>
  );
}
