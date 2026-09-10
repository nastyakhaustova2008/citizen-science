import { useI18n } from '../i18n';

export default function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-edge py-6 text-center text-xs text-ink-faint dark:border-white/10">
      <div className="mx-auto max-w-content px-4">
        <p>
          {t('app.name')} · {t('app.tagline')}
        </p>
        <p className="mt-1 opacity-80">{t('states.offlineHint')}</p>
      </div>
    </footer>
  );
}
