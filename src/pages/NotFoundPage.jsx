import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useI18n } from '../i18n';

export default function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <Compass className="mx-auto h-10 w-10 text-moss" strokeWidth={1.5} aria-hidden="true" />
      <h1 className="mt-4 font-serif text-2xl font-bold text-ink dark:text-paper">
        {t('notFound.title')}
      </h1>
      <p className="mt-2 text-sm text-ink-faint">{t('notFound.body')}</p>
      <Link to="/" className="btn-primary mt-5">
        {t('notFound.home')}
      </Link>
    </div>
  );
}
