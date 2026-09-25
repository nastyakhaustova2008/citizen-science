import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { AuthCard, Field, FormError, Notice } from '../../components/auth/AuthUI';

/**
 * Always the same answer, whether the account exists and whether it has an email —
 * nobody can learn that from a username. The "no email → ask an admin" text is always shown.
 */
export default function ForgotPasswordPage() {
  const { t } = useI18n();
  const { requestReset } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await requestReset(identifier);
      setSent(true);
    } catch (err) {
      setError(err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title={t('auth.forgotTitle')}
      intro={sent ? null : t('auth.forgotBody')}
      footer={
        <Link to="/login" className="underline">
          {t('auth.backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <Notice>{t('auth.forgotSent')}</Notice>
      ) : (
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <Field id="forgot-identifier" label={t('auth.identifier')}>
            <input
              id="forgot-identifier"
              className="input"
              dir="auto"
              autoComplete="username"
              autoCapitalize="off"
              spellCheck={false}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              required
            />
          </Field>
          <FormError code={error} />
          <button type="submit" className="btn-primary w-full" disabled={busy || !identifier.trim()}>
            {busy ? t('auth.working') : t('auth.sendLink')}
          </button>
        </form>
      )}
      <p className="text-sm text-ink-faint">{t('auth.forgotNoEmail')}</p>
    </AuthCard>
  );
}
