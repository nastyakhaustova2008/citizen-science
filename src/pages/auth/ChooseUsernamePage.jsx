import { useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { LoadingBlock } from '../../components/primitives';
import { AuthCard, FormError, UsernameField, loginPath, safeNext } from '../../components/auth/AuthUI';

/** First Google sign-in: the profile has no username yet. Chosen once. */
export default function ChooseUsernamePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { session, authLoading, profile, chooseUsername } = useAuth();
  const [username, setUsername] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  if (authLoading) return <LoadingBlock />;
  if (!session) return <Navigate to={loginPath('/auth/choose-username')} replace />;
  if (profile?.username && !busy) return <Navigate to={next} replace />;

  async function onSubmit(e) {
    e.preventDefault();
    if (status !== 'available') return;
    setError(null);
    setBusy(true);
    try {
      await chooseUsername(username);
      navigate(next, { replace: true });
    } catch (err) {
      if (err.code === 'username_taken') setStatus('username_taken');
      else if (err.code === 'invalid_username') setStatus(err.detail || 'invalid_chars');
      else setError(err.code || 'generic');
      setBusy(false);
    }
  }

  return (
    <AuthCard title={t('auth.chooseTitle')} intro={t('auth.chooseBody')}>
      <form className="space-y-4" onSubmit={onSubmit} noValidate>
        <UsernameField id="choose-username" value={username} onChange={setUsername} status={status} onStatus={setStatus} />
        <p className="text-xs text-ink-faint">{t('auth.privacyNote')}</p>
        <FormError code={error} />
        <button type="submit" className="btn-primary w-full" disabled={busy || status !== 'available'}>
          {busy ? t('auth.working') : t('auth.chooseSubmit')}
        </button>
      </form>
    </AuthCard>
  );
}
