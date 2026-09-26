import { useState } from 'react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { Field, FormError } from './AuthUI';

/**
 * "Sign in again" (audit H6): the server wants a sign-in of this session within the last 15 minutes
 * before deleting the account or changing the password / email (Edge Function `account` →
 * reauth_required). The password goes through the normal sign-in (action `login`), so wrong ones
 * count against the per-username limit; Google comes back to `googleReturn` (a path with #hash).
 * The account's own methods only: password (username accounts) and/or Google.
 * Used inside forms: Enter in the password field signs in, it never submits the outer form.
 */
export default function Reauth({ idBase, googleReturn, onDone, title, text, submitLabel }) {
  const { t } = useI18n();
  const { profile, providers, logIn, logInWithGoogle } = useAuth();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const hasGoogle = providers.includes('google');
  const hasPassword = providers.includes('email') || !hasGoogle;

  async function onPassword() {
    if (!password || busy) return;
    setError(null);
    setBusy(true);
    try {
      await logIn({ username: profile.username, password });
      setPassword('');
      onDone?.();
    } catch (err) {
      setError(err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setError(null);
    setBusy(true);
    try {
      await logInWithGoogle(googleReturn, { reauth: true });
    } catch (err) {
      setError(err.code || 'oauth');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-edge p-3 dark:border-white/10">
      <p className="text-sm font-semibold">{title || t('auth.reauth.title')}</p>
      <p className="text-sm text-ink-faint">
        {text || t(hasPassword ? (hasGoogle ? 'auth.reauth.textBoth' : 'auth.reauth.textPassword') : 'auth.reauth.textGoogle')}
      </p>
      {hasPassword && (
        <div className="space-y-2">
          <Field id={`${idBase}-reauth-password`} label={t('auth.currentPassword')}>
            <input
              id={`${idBase}-reauth-password`}
              type="password"
              className="input"
              dir="ltr"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onPassword();
                }
              }}
            />
          </Field>
          <button type="button" className="btn-primary" disabled={busy || !password} onClick={onPassword}>
            {busy ? t('auth.working') : submitLabel || t('auth.reauth.submit')}
          </button>
        </div>
      )}
      {hasGoogle && (
        <button type="button" className="btn-secondary w-full" disabled={busy} onClick={onGoogle}>
          <span className="font-bold" aria-hidden="true">
            G
          </span>
          {t('auth.withGoogle')}
        </button>
      )}
      <FormError code={error} />
    </div>
  );
}
