import { useI18n } from '../../i18n';

/** Error line for a photo action: photos.errors.<code>, else the shared comments.errors.<code>. */
export default function PhotoErrorText({ error, className = '' }) {
  const { t } = useI18n();
  if (!error) return null;
  const code = error.code || 'generic';
  let text = t(`photos.errors.${code}`);
  if (text.startsWith('photos.errors.')) text = t(`comments.errors.${code}`);
  if (text.startsWith('comments.errors.')) text = t('comments.errors.generic');
  return (
    <p className={`text-xs text-danger ${className}`} role="alert">
      {text}
    </p>
  );
}
