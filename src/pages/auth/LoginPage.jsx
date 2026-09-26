import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import {
  AuthCard,
  Field,
  FormError,
  GoogleButton,
  Notice,
  OrDivider,
  SharedDeviceCheckbox,
  safeNext,
} from '../../components/auth/AuthUI';
import { sharedPreference } from '../../lib/session';

export default function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { session, authLoading, logIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [shared, setShared] = useState(sharedPreference);

  if (!authLoading && session && !busy) return <Navigate to={next} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await logIn({ username, password, shared });
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.code || 'generic');
      setBusy(false);
    }
  }

  const withNext = (path) => (next === '/' ? path : `${path}?next=${encodeURIComponent(next)}`);

  return (
    <AuthCard
      title={t('auth.loginTitle')}
      footer={
        <>
          <p>
            {t('auth.noAccount')}{' '}
            <Link to={withNext('/signup')} className="tap-link font-semibold text-ink underline dark:text-paper">
              {t('auth.signup')}
            </Link>
          </p>
          <p>
            <Link to="/forgot-password" className="tap-link underline">
              {t('auth.forgot')}
            </Link>
          </p>
        </>
      }
    >
      {params.get('why') === 'add' && <Notice>{t('auth.loginToAdd')}</Notice>}
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <Field id="login-username" label={t('auth.username')}>
          <input
            id="login-username"
            className="input"
            dir="auto"
            autoComplete="username"
            autoCapitalize="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </Field>
        <Field id="login-password" label={t('auth.password')}>
          <input
            id="login-password"
            type="password"
            className="input"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>
        <SharedDeviceCheckbox id="login-shared" checked={shared} onChange={setShared} />
        <FormError code={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy || !username.trim() || !password}>
          {busy ? t('auth.working') : t('auth.submitLogin')}
        </button>
      </form>
      <OrDivider />
      <GoogleButton next={next} shared={shared} />
    </AuthCard>
  );
}
