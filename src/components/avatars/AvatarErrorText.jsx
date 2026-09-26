import { useI18n } from '../../i18n';

/** Error line for a picture action: avatars.errors.<code>, else the shared comments.errors.<code>. */
export default function AvatarErrorText({ error, className = '' }) {
  const { t } = useI18n();
  if (!error) return null;
  const code = error.code || 'generic';
  let text = t(`avatars.errors.${code}`);
  if (text.startsWith('avatars.errors.')) text = t(`comments.errors.${code}`);
  if (text.startsWith('comments.errors.')) text = t('comments.errors.generic');
  return (
    <p className={`text-xs text-danger ${className}`} role="alert">
      {text}
    </p>
  );
}
