import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { passwordError } from '../../lib/username';
import { AuthCard, Field, FormError, Notice } from '../../components/auth/AuthUI';

/**
 * Target of the email links (token_hash templates, see CLAUDE.md → «Аккаунты»):
 *   #/auth/confirm?token_hash=…&type=recovery      → choose a new password
 *   #/auth/confirm?token_hash=…&type=email_change  → confirm a new email
 *   #/auth/confirm?token_hash=…&type=email         → confirm sign-up email (direct sign-ups)
 * The link is only used when the user presses the button, so mail scanners that open
 * links cannot use it up.
 */
export default function ConfirmPage() {
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (!tokenHash || !['recovery', 'email_change', 'email'].includes(type)) return <InvalidLink />;
  return type === 'recovery' ? (
    <NewPassword tokenHash={tokenHash} />
  ) : (
    <ConfirmEmail tokenHash={tokenHash} type={type} />
  );
}

function InvalidLink() {
  const { t } = useI18n();
  return (
    <AuthCard title={t('auth.confirmEmailTitle')}>
      <FormError code="link_invalid" />
      <Link to="/forgot-password" className="btn-secondary w-full">
        {t('auth.forgotTitle')}
      </Link>
    </AuthCard>
  );
}

function NewPassword({ tokenHash }) {
  const { t } = useI18n();
  const { verifyEmailLink, changePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const pwError = password ? passwordError(password) : null;
  const mismatch = password2 && password !== password2;

  async function onSubmit(e) {
    e.preventDefault();
    if (passwordError(password) || password !== password2) return;
    setError(null);
    setBusy(true);
    try {
      if (!verified) {
        await verifyEmailLink({ tokenHash, type: 'recovery' });
        setVerified(true);
      }
      await changePassword(password);
      setDone(true);
    } catch (err) {
      setError(err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <AuthCard title={t('auth.newPasswordTitle')}>
        <Notice>{t('auth.passwordSaved')}</Notice>
        <Link to="/profile" className="btn-primary w-full">
          {t('auth.continue')}
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('auth.newPasswordTitle')}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field
          id="reset-password"
          label={t('auth.newPassword')}
          hint={t('auth.passwordHint')}
          error={pwError ? t(`auth.errors.${pwError}`) : null}
        >
          <input
            id="reset-password"
            type="password"
            className="input"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <Field
          id="reset-password2"
          label={t('auth.passwordRepeat')}
          error={mismatch ? t('auth.errors.password_mismatch') : null}
        >
          <input
            id="reset-password2"
            type="password"
            className="input"
            dir="ltr"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
          />
        </Field>
        <FormError code={error} />
        {error === 'link_invalid' && (
          <Link to="/forgot-password" className="block text-sm underline">
            {t('auth.forgotTitle')}
          </Link>
        )}
        <button
          type="submit"
          className="btn-primary w-full"
          disabled={busy || Boolean(pwError) || !password || password !== password2}
        >
          {busy ? t('auth.working') : t('auth.savePassword')}
        </button>
      </form>
    </AuthCard>
  );
}

function ConfirmEmail({ tokenHash, type }) {
  const { t } = useI18n();
  const { verifyEmailLink } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  return (
    <AuthCard title={t('auth.confirmEmailTitle')} intro={done ? null : t('auth.confirmEmailBody')}>
      {done ? (
        <>
          <Notice>{t('auth.emailConfirmed')}</Notice>
          <Link to="/profile" className="btn-primary w-full">
            {t('auth.continue')}
          </Link>
        </>
      ) : (
        <>
          <FormError code={error} />
          <button
            type="button"
            className="btn-primary w-full"
            disabled={busy}
            onClick={async () => {
              setError(null);
              setBusy(true);
              try {
                await verifyEmailLink({ tokenHash, type });
                setDone(true);
              } catch (err) {
                setError(err.code || 'link_invalid');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t('auth.working') : t('auth.confirmEmailButton')}
          </button>
        </>
      )}
    </AuthCard>
  );
}
