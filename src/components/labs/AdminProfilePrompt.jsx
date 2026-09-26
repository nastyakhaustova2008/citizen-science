import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import AdminProfileForm from './AdminProfileForm';

/**
 * An admin without an admin profile gets this dialog (once per page load; closing it is fine —
 * the app keeps working, only lab actions stay blocked until the profile is filled).
 * With the profile filled but no face photo (017), it asks for the photo instead (a link to the
 * profile, where the upload with consent is) — at most once per browser session (sessionStorage);
 * the notice in the profile stays until there is a photo.
 * Not shown on the profile page (the form is there) or the auth pages.
 */
// sessionStorage key: the photo window was shown in this browser session.
const PHOTO_PROMPT_KEY = 'mitzpe.photoPromptShown';

function photoPromptShown() {
  try {
    return window.sessionStorage.getItem(PHOTO_PROMPT_KEY) === '1';
  } catch {
    return false; // storage blocked: the window may show once per page load
  }
}

function markPhotoPromptShown() {
  try {
    window.sessionStorage.setItem(PHOTO_PROMPT_KEY, '1');
  } catch {
    // storage blocked: nothing to remember
  }
}

export default function AdminProfilePrompt() {
  const { t } = useI18n();
  const { adminProfile, myAvatar } = useAuth();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(false);
  const [justSaved, setJustSaved] = useState(false); // keep "saved" on screen for a moment
  const [photoShownBefore] = useState(photoPromptShown);
  const dialogRef = useRef(null);

  const needsProfile = adminProfile === null || justSaved;
  // Admin profile filled, but no face photo yet (or it was rejected).
  const needsPhoto =
    !needsProfile && !photoShownBefore && Boolean(adminProfile) && myAvatar !== undefined && !myAvatar.avatar;
  const open =
    (needsProfile || needsPhoto) && !dismissed && !pathname.startsWith('/profile') && !pathname.startsWith('/auth/');

  // Remember the photo window as soon as it appears (closing, following the link or reloading
  // all count): at most once per browser session.
  useEffect(() => {
    if (open && needsPhoto) markPhotoPromptShown();
  }, [open, needsPhoto]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    dialogRef.current?.querySelector('input, a')?.focus();
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
              {t(needsPhoto ? 'avatars.promptTitle' : 'labs.adminProfile.promptTitle')}
            </h2>
            <p className="mt-1 text-sm text-ink-faint">
              {t(needsPhoto ? (myAvatar.required ? 'avatars.promptBodyRequired' : 'avatars.promptBody') : 'labs.adminProfile.promptBody')}
            </p>
          </div>
          <button type="button" className="btn-ghost !p-2" onClick={() => setDismissed(true)}>
            <X className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">{t('common.close')}</span>
          </button>
        </div>
        {needsPhoto ? (
          <Link to="/profile#profile-picture" className="btn-primary" onClick={() => setDismissed(true)}>
            {t('avatars.goToPhoto')}
          </Link>
        ) : (
          <AdminProfileForm idBase="admin-profile-prompt" onSaved={() => {
              setJustSaved(true);
              setTimeout(() => setDismissed(true), 1200);
            }} />
        )}
        <button type="button" className="btn-ghost mt-2 w-full text-sm" onClick={() => setDismissed(true)}>
          {t('labs.adminProfile.later')}
        </button>
      </div>
    </div>
  );
}
