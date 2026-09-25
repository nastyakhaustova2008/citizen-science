import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../../i18n';

/** Error line for a LabError code (strings.js labs.errors.<code>). */
export function LabErrorText({ error }) {
  const { t } = useI18n();
  if (!error) return null;
  if (error.code === 'admin_profile_required') return <AdminProfileRequired />;
  let text = t(`labs.errors.${error.code}`);
  if (text.startsWith('labs.errors.')) text = t('labs.errors.generic');
  return (
    <p className="flex items-start gap-1.5 text-sm text-danger" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {text}
    </p>
  );
}

/** "Fill in your admin profile first" with a link to the form in the own profile. */
export function AdminProfileRequired() {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink dark:text-paper" role="alert">
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
        <span>{t('labs.adminProfile.required')}</span>
      </p>
      <Link to="/profile#admin-profile" className="btn-secondary mt-2 !py-1.5 text-xs">
        {t('labs.adminProfile.fillIn')}
      </Link>
    </div>
  );
}
