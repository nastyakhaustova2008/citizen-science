import { useParams, Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAppData } from '../context/AppDataContext';
import { observationTitle } from '../data/mockData';
import AddMeasurementWizard from '../components/wizard/AddMeasurementWizard';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/primitives';

export default function AddMeasurementPage() {
  const { slug } = useParams();
  const { t, locale } = useI18n();
  const { getObservation, campaignsLoading, campaignsError, reloadCampaigns } = useAppData();
  const observation = getObservation(slug);

  if (campaignsError) return <ErrorBlock onRetry={reloadCampaigns} />;
  if (campaignsLoading) return <LoadingBlock />;

  // Drafts (visible to admins only) do not take measurements — the database refuses them too.
  if (observation && observation.publication !== 'published') {
    return (
      <EmptyState
        title={t('labs.page.notPublished', { status: t(`labs.publication.${observation.publication}`) })}
        action={
          <Link to={`/observations/${observation.slug}`} className="btn-secondary mt-1">
            {t('observation.backToList')}
          </Link>
        }
      />
    );
  }

  if (!observation) {
    return (
      <EmptyState
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
            {observationTitle(observation, locale)}
          </p>
          <h1 className="font-serif text-2xl font-bold text-ink dark:text-paper">
            {t('wizard.title')}
          </h1>
        </div>
        <Link to={`/protocol/${observation.slug}`} className="btn-ghost">
          <FileText className="h-4 w-4" aria-hidden="true" />
          {t('observation.viewProtocol')}
        </Link>
      </div>

      <AddMeasurementWizard observation={observation} />
    </div>
  );
}
