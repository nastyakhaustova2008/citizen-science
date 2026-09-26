import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { normalizeUsername, usernameKey } from '../../lib/username';
import { SkeletonText } from '../primitives';
import { Field, FormError, Notice, isolate } from './AuthUI';
import Reauth from './Reauth';

export const DELETE_ACCOUNT_HASH = '#delete-account';

/**
 * Own profile → "Delete account" (migration 014 + Edge Function `account`, action `delete`).
 * Warning with what is deleted / what stays, measurements: keep anonymous or delete, type the
 * username to confirm. The server also wants a recent sign-in (shared school computers): on
 * reauth_required the panel asks for the password or Google and comes back here
 * (/profile#delete-account). Not shown to the owner (the server refuses too).
 */
export default function DeleteAccount() {
  const { t } = useI18n();
  const { hash } = useLocation();
  const [open, setOpen] = useState(hash === DELETE_ACCOUNT_HASH);

  useEffect(() => {
    if (hash === DELETE_ACCOUNT_HASH) setOpen(true);
  }, [hash]);

  return (
    <section id="delete-account" className="scroll-mt-4">
      <div className="surface mt-6 max-w-2xl space-y-3 p-4">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-danger">
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {t('auth.deleteAccount.title')}
        </h3>
        {open ? (
          <DeletePanel onCancel={() => setOpen(false)} />
        ) : (
          <>
            <p className="text-sm text-ink-faint">{t('auth.deleteAccount.intro')}</p>
            <button type="button" className="btn-secondary" onClick={() => setOpen(true)}>
              {t('auth.deleteAccount.open')}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

function DeletePanel({ onCancel }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { profile, accountDeletePreview, deleteAccount, finishAccountDeletion } = useAuth();

  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [removeMeasurements, setRemoveMeasurements] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [reauth, setReauth] = useState(false);
  const [reauthDone, setReauthDone] = useState(false);

  useEffect(() => {
    let alive = true;
    accountDeletePreview()
      .then((p) => alive && setPreview(p))
      .catch((err) => alive && setLoadError(err.code || 'generic'));
    return () => {
      alive = false;
    };
  }, [accountDeletePreview]);

  const username = profile?.username || '';
  const matches = Boolean(username) && usernameKey(normalizeUsername(typed)) === usernameKey(username);

  async function onDelete(e) {
    e.preventDefault();
    if (!matches || busy) return;
    setError(null);
    setReauthDone(false);
    setBusy(true);
    try {
      await deleteAccount({
        username: typed,
        deleteMeasurements: removeMeasurements && preview?.measurements > 0,
      });
    } catch (err) {
      const code = err.code || 'generic';
      if (code === 'reauth_required') setReauth(true);
      setError(code);
      setBusy(false);
      return;
    }
    // Leave the (own) profile page first, then drop the local session: finishAccountDeletion
    // clears the stored session and reloads the home page, which says the account was deleted.
    navigate('/', { replace: true });
    await finishAccountDeletion();
  }

  if (loadError) return <FormError code={loadError} />;
  if (!preview) return <SkeletonText lines={4} />;
  if (!preview.canDelete) return <p className="text-sm">{t('auth.deleteAccount.ownerCannot')}</p>;

  const isAdmin = preview.role !== 'student';

  return (
    <form className="space-y-4" onSubmit={onDelete} noValidate>
      <div className="space-y-3 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm">
        <p className="flex items-start gap-1.5 font-semibold text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('auth.deleteAccount.irreversible')}
        </p>
        <div>
          <p className="font-semibold">{t('auth.deleteAccount.willDelete')}</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            <li>{t('auth.deleteAccount.itemProfile', { name: isolate(username) })}</li>
            <li>{t('auth.deleteAccount.itemSignIn')}</li>
            {isAdmin && <li>{t('auth.deleteAccount.itemAdminProfile')}</li>}
            <li>{t('auth.deleteAccount.itemComments', { count: preview.comments })}</li>
            {preview.photos > 0 && <li>{t('auth.deleteAccount.itemPhotos', { count: preview.photos })}</li>}
            {preview.avatar && <li>{t('auth.deleteAccount.itemAvatar')}</li>}
            <li>{t('auth.deleteAccount.itemLogs')}</li>
          </ul>
        </div>
        {isAdmin && (
          <div>
            <p className="font-semibold">{t('auth.deleteAccount.adminTitle')}</p>
            <ul className="mt-1 list-disc space-y-0.5 ps-5">
              {preview.labsCreated > 0 && (
                <li>{t('auth.deleteAccount.labsCreated', { count: preview.labsCreated })}</li>
              )}
              {preview.drafts > 0 && <li>{t('auth.deleteAccount.drafts', { count: preview.drafts })}</li>}
              {preview.openRevisions > 0 && (
                <li>{t('auth.deleteAccount.openRevisions', { count: preview.openRevisions })}</li>
              )}
              <li>{t('auth.deleteAccount.reviewsStay')}</li>
              {preview.adminsMoved > 0 && (
                <li>
                  {preview.movedUnder
                    ? t('auth.deleteAccount.adminsMoved', {
                        count: preview.adminsMoved,
                        name: isolate(preview.movedUnder.username || t('admin.users.noUsername')),
                      })
                    : t('auth.deleteAccount.adminsMovedNoOne', { count: preview.adminsMoved })}
                </li>
              )}
            </ul>
          </div>
        )}
      </div>

      {preview.measurements > 0 && (
        <fieldset className="space-y-2">
          <legend className="label">
            {t('auth.deleteAccount.measurementsTitle', { count: preview.measurements })}
          </legend>
          {[
            ['keep', false],
            ['remove', true],
          ].map(([opt, value]) => (
            <label key={opt} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="delete-measurements"
                checked={removeMeasurements === value}
                onChange={() => setRemoveMeasurements(value)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{t(`auth.deleteAccount.${opt}`)}</span>
                <span className="block text-xs text-ink-faint">{t(`auth.deleteAccount.${opt}Hint`)}</span>
                {value && preview.commentsOnMeasurements > 0 && (
                  <span className="block text-xs text-ink-faint">
                    {t('auth.deleteAccount.commentsOnMeasurements', { count: preview.commentsOnMeasurements })}
                  </span>
                )}
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <Field
        id="delete-confirm"
        label={t('auth.deleteAccount.confirmLabel', { name: isolate(username) })}
        hint={t('auth.deleteAccount.confirmHint')}
      >
        <input
          id="delete-confirm"
          type="text"
          className="input"
          dir="auto"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </Field>

      {reauth ? (
        <Reauth
          idBase="delete"
          googleReturn={`/profile${DELETE_ACCOUNT_HASH}`}
          title={t('auth.deleteAccount.reauthTitle')}
          text={t('auth.deleteAccount.reauthText')}
          submitLabel={t('auth.deleteAccount.reauthSubmit')}
          onDone={() => {
            setReauth(false);
            setError(null);
            setReauthDone(true);
          }}
        />
      ) : (
        <FormError code={error} />
      )}
      {reauthDone && <Notice>{t('auth.deleteAccount.reauthDone')}</Notice>}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          className="btn-primary !bg-danger hover:!bg-danger/90"
          disabled={busy || !matches || reauth}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          {busy ? t('auth.working') : t('auth.deleteAccount.submit')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          {t('auth.deleteAccount.cancel')}
        </button>
      </div>
    </form>
  );
}
