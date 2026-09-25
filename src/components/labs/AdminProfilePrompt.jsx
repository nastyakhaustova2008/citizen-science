import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import AdminProfileForm from './AdminProfileForm';

/**
 * An admin without an admin profile gets this dialog (once per page load; closing it is fine —
 * the app keeps working, only lab actions stay blocked until the profile is filled).
 * Not shown on the profile page (the form is there) or the auth pages.
 */
export default function AdminProfilePrompt() {
  const { t } = useI18n();
  const { adminProfile } = useAuth();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [justSaved, setJustSaved] = useState(false); // keep "saved" on screen for a moment
  const dialogRef = useRef(null);

  const open =
    (adminProfile === null || justSaved) && !dismissed && !pathname.startsWith('/profile') && !pathname.startsWith('/auth/');

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    dialogRef.current?.querySelector('input')?.focus();
    const onKey = (e) => e.key === 'Escape' && setDismissed(true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1100] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-profile-prompt-title"
        className="surface max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 shadow-lg sm:rounded-lg"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="admin-profile-prompt-title" className="font-serif text-xl font-bold text-ink dark:text-paper">
              {t('labs.adminProfile.promptTitle')}
            </h2>
            <p className="mt-1 text-sm text-ink-faint">{t('labs.adminProfile.promptBody')}</p>
          </div>
          <button type="button" className="btn-ghost !p-2" onClick={() => setDismissed(true)}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('common.close')}</span>
          </button>
        </div>
        <AdminProfileForm idBase="admin-profile-prompt" onSaved={() => {
            setJustSaved(true);
            setTimeout(() => setDismissed(true), 1200);
          }} />
        <button type="button" className="btn-ghost mt-2 w-full text-sm" onClick={() => setDismissed(true)}>
          {t('labs.adminProfile.later')}
        </button>
      </div>
    </div>
  );
}
