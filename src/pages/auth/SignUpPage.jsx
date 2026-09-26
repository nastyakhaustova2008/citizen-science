import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { passwordError } from '../../lib/username';
import {
  AuthCard,
  Field,
  FormError,
  GoogleButton,
  PrivacyConsent,
  Notice,
  SharedDeviceCheckbox,
  OrDivider,
  isolate,
  UsernameField,
  safeNext,
  usernameUsable,
} from '../../components/auth/AuthUI';
import { sharedPreference } from '../../lib/session';
import { EMAIL_FLOWS_ENABLED } from '../../lib/authConfig';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUpPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { session, authLoading, signUp } = useAuth();
  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState(null);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null); // { emailSent, emailError }
  const [shared, setShared] = useState(sharedPreference);

  if (done) {
    return (
      <AuthCard title={t('auth.signupTitle')}>
        {done.emailSent ? (
          <Notice>{t('auth.signupEmailSent', { email: isolate(email.trim()) })}</Notice>
        ) : (
          <>
            <FormError code={done.emailError} />
            <p className="text-sm text-ink-faint">{t('auth.signupEmailFailed')}</p>
          </>
        )}
        <button type="button" className="btn-primary w-full" onClick={() => navigate(next, { replace: true })}>
          {t('auth.continue')}
        </button>
      </AuthCard>
    );
  }

  if (!authLoading && session && !busy) return <Navigate to={next} replace />;

  const pwError = touched && password ? passwordError(password) : null;
  const mismatch = touched && password2 && password !== password2;
  const emailError = EMAIL_FLOWS_ENABLED && touched && email.trim() && !EMAIL_RE.test(email.trim());
  const canSubmit =
    usernameUsable(usernameStatus) && !passwordError(password) && password === password2 && !emailError;

  async function onSubmit(e) {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      const withEmail = EMAIL_FLOWS_ENABLED && email.trim();
      const result = await signUp({ username, password, email: withEmail || null, shared });
      if (withEmail) {
        setDone(result);
      } else {
        navigate(next, { replace: true });
      }
    } catch (err) {
      if (err.code === 'username_taken') setUsernameStatus('username_taken');
      else if (err.code === 'invalid_username') setUsernameStatus(err.detail || 'invalid_chars');
      setError(err.code === 'invalid_username' ? null : err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={t('auth.signupTitle')}
      intro={t('auth.privacyNote')}
      footer={
        <p>
          {t('auth.haveAccount')}{' '}
          <Link
            to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`}
            className="tap-link font-semibold text-ink underline dark:text-paper"
          >
            {t('auth.login')}
          </Link>
        </p>
      }
    >
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <UsernameField
          id="signup-username"
          value={username}
          onChange={setUsername}
          status={usernameStatus}
          onStatus={setUsernameStatus}
        />
        <Field
          id="signup-password"
          label={t('auth.password')}
          hint={t('auth.passwordHint')}
          error={pwError ? t(`auth.errors.${pwError}`) : null}
        >
          <input
            id="signup-password"
            type="password"
            className="input"
            dir="ltr"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={() => password && setTouched(true)}
            required
          />
        </Field>
        <Field
          id="signup-password2"
          label={t('auth.passwordRepeat')}
          error={mismatch ? t('auth.errors.password_mismatch') : null}
        >
          <input
            id="signup-password2"
            type="password"
            className="input"
            dir="ltr"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            required
          />
        </Field>
        {EMAIL_FLOWS_ENABLED && (
          <Field
            id="signup-email"
            label={t('auth.emailOptional')}
            hint={t('auth.emailHint')}
            error={emailError ? t('auth.errors.email_invalid') : null}
          >
            <input
              id="signup-email"
              type="email"
              className="input"
              dir="ltr"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
        )}
        <PasswordRecoveryHint />
        <SharedDeviceCheckbox id="signup-shared" checked={shared} onChange={setShared} />
        <FormError code={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy || !canSubmit}>
          {busy ? t('auth.working') : t('auth.submitSignup')}
        </button>
      </form>
      <OrDivider />
      <GoogleButton next={next} shared={shared} />
      <PrivacyConsent />
    </AuthCard>
  );
}

/** Honest recovery (H6): write the password down; without an email it can't be reset; or Google. */
function PasswordRecoveryHint() {
  const { t } = useI18n();
  return (
    <div className="rounded-lg border border-bark/40 bg-bark/5 p-3 text-sm" role="note">
      <p className="font-semibold">{t('auth.recoveryHint.title')}</p>
      <p className="mt-1 text-ink-faint">
        {t(EMAIL_FLOWS_ENABLED ? 'auth.recoveryHint.bodyEmail' : 'auth.recoveryHint.body')}
      </p>
    </div>
  );
}
