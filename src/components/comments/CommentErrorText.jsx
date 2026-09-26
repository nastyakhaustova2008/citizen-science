import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { COMMENT_MAX } from '../../lib/comments';
import { isolate } from '../auth/AuthUI';

/**
 * Error line for a comment / link domain error: a CommentError from the server
 * ({ code, details }) or a local check result ({ code, host, domains }).
 */
export default function CommentErrorText({ error, className = '' }) {
  const { t } = useI18n();
  const { linkDomains } = useAppData();
  if (!error) return null;
  const d = error.details || error;
  const domains = d.domains || linkDomains || [];
  let text = t(`comments.errors.${error.code || 'generic'}`, {
    max: COMMENT_MAX,
    host: isolate(d.host || ''),
    domains: isolate(domains.join(', ')),
  });
  if (text.startsWith('comments.errors.')) text = t('comments.errors.generic');
  return (
    <p className={`text-xs text-danger ${className}`} role="alert">
      {text}
    </p>
  );
}
