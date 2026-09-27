import { lazy, Suspense } from 'react';
import { RotateCw } from 'lucide-react';
import { useI18n } from '../i18n';
import { SkeletonText } from '../components/primitives';

/**
 * Code splitting (audit L8): big parts that most visitors never open (lab editor and review,
 * admin panel, charts, forum) load only when needed. If the part can't be loaded — usually a tab
 * left open across a new deploy (the old file names are gone) or the network — a short message
 * with "Reload" is shown instead of a blank page.
 */
export function lazyPart(loader) {
  const Part = lazy(() =>
    loader().catch((err) => {
      console.error('[lazy] could not load part of the app', err);
      return { default: LoadFailed };
    }),
  );
  return function LazyPart(props) {
    return (
      <Suspense fallback={<SkeletonText lines={4} className="py-4" />}>
        <Part {...props} />
      </Suspense>
    );
  };
}

function LoadFailed() {
  const { t } = useI18n();
  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
      <p className="max-w-sm text-sm text-ink-soft dark:text-paper/80">{t('states.partLoadFailed')}</p>
      <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
        <RotateCw className="h-4 w-4" aria-hidden="true" />
        {t('states.reloadPage')}
      </button>
    </div>
  );
}
