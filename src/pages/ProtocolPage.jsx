import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, FileDown, Wrench } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import { observationTitle } from '../data/mockData';
import { METRICS, metricLabel } from '../data/metrics';
import ObsIcon from '../components/ObsIcon';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/primitives';

function StepList({ title, items }) {
  return (
    <section className="surface p-4">
      <h2 className="mb-2 font-serif text-base font-bold text-ink dark:text-paper">{title}</h2>
      <ol className="space-y-2 ps-5 text-sm marker:font-mono marker:text-moss list-decimal">
        {items.map((it, i) => (
          <li key={i} className="leading-relaxed">
            {it}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function ProtocolPage() {
  const { slug } = useParams();
  const { t, locale } = useI18n();
  const { getObservation, campaignsLoading, campaignsError, reloadCampaigns } = useAppData();
  const observation = getObservation(slug);

  if (campaignsError) return <ErrorBlock onRetry={reloadCampaigns} />;
  if (campaignsLoading) return <LoadingBlock />;

  if (!observation) {
    return <EmptyState title={t('observation.notFound')} />;
  }
  const metric = METRICS[observation.metric];
  const Back = locale === 'he' ? ArrowRight : ArrowLeft;

  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <Link to={`/observations/${observation.slug}`} className="btn-ghost -ms-2 text-sm">
        <Back className="h-4 w-4" aria-hidden="true" />
        {t('protocol.backToObservation')}
      </Link>

      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-paper-sunk text-ink dark:bg-white/5 dark:text-paper">
            <ObsIcon name={observation.icon} className="h-5 w-5" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              {observationTitle(observation, locale)}
            </p>
            <h1 className="font-serif text-2xl font-bold text-ink dark:text-paper">
              {t('protocol.title')}
            </h1>
          </div>
        </div>
        <p className="text-sm text-ink-faint">{t('protocol.subtitle')}</p>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => window.print()}
        >
          <FileDown className="h-4 w-4" aria-hidden="true" />
          {t('protocol.downloadPdf')}
        </button>
      </header>

      <div className="surface flex items-start gap-2 p-3 text-sm">
        <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-moss" aria-hidden="true" strokeWidth={1.75} />
        <span>
          <span className="font-semibold">{t('card.equipment')}:</span>{' '}
          {observation.equipment.join(' · ')}
        </span>
      </div>

      <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
        {t('protocol.rangeNote', {
          min: metric.plausible[0],
          max: metric.plausible[1],
          unit: metric.unit,
        })}
      </p>

      <StepList title={t('protocol.sections.prepare')} items={t('protocol.prepare')} />
      <StepList title={t('protocol.sections.measure')} items={t('protocol.measure')} />
      <StepList title={t('protocol.sections.record')} items={t('protocol.record')} />
      <StepList title={t('protocol.sections.safety')} items={t('protocol.safety')} />

      <div className="pt-2">
        <Link to={`/observations/${observation.slug}/add`} className="btn-primary">
          {t('observation.addMeasurement')} — {metricLabel(observation.metric, locale)}
        </Link>
      </div>
    </article>
  );
}
