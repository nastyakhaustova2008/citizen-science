import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { passwordError } from '../../lib/username';
import { SectionHeading } from '../primitives';
import { Field, FormError, Notice, isolate } from './AuthUI';
import DeleteAccount from './DeleteAccount';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Own profile → "Account": email (add / change), password, log out, delete account (not the owner). */
export default function AccountSettings() {
  const { t } = useI18n();
  const { logOut, profile } = useAuth();
  return (
    <section>
      <SectionHeading as="h2" title={t('auth.account.title')} />
      <div className="grid gap-4 md:grid-cols-2">
        <EmailCard />
        <PasswordCard />
      </div>
      <button type="button" className="btn-secondary mt-4" onClick={logOut}>
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t('auth.logout')}
      </button>
      {profile && profile.role !== 'owner' && <DeleteAccount />}
    </section>
  );
}

function EmailCard() {
  const { t } = useI18n();
  const { email, pendingEmail, changeEmail } = useAuth();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(null);

  const invalid = value.trim() && !EMAIL_RE.test(value.trim());

  async function onSubmit(e) {
    e.preventDefault();
    if (!value.trim() || invalid) return;
    setError(null);
    setBusy(true);
    try {
      await changeEmail(value);
      setSentTo(value.trim());
      setValue('');
    } catch (err) {
      setError(err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="surface space-y-3 p-4" onSubmit={onSubmit} noValidate>
      <h3 className="text-sm font-semibold text-ink dark:text-paper">{t('auth.account.email')}</h3>
      {email ? (
        <p className="text-sm" dir="ltr">
          {email}
        </p>
      ) : (
        <p className="text-sm text-ink-faint">{t('auth.account.noEmail')}</p>
      )}
      {pendingEmail && !sentTo && (
        <p className="text-xs text-ink-faint">{t('auth.account.pending', { email: isolate(pendingEmail) })}</p>
      )}
      {sentTo && (
        <Notice>{t('auth.account.emailSent', { email: isolate(sentTo) })}</Notice>
      )}
      <Field
        id="account-email"
        label={t('auth.account.newEmail')}
        hint={t('auth.emailHint')}
        error={invalid ? t('auth.errors.email_invalid') : null}
      >
        <input
          id="account-email"
          type="email"
          className="input"
          dir="ltr"
          autoComplete="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <FormError code={error} />
      <button type="submit" className="btn-primary" disabled={busy || !value.trim() || invalid}>
        {busy ? t('auth.working') : email ? t('auth.account.changeEmail') : t('auth.account.addEmail')}
      </button>
    </form>
  );
}

function PasswordCard() {
  const { t } = useI18n();
  const { changePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const pwError = password ? passwordError(password) : null;
  const mismatch = password2 && password !== password2;

  async function onSubmit(e) {
    e.preventDefault();
    if (passwordError(password) || password !== password2) return;
    setError(null);
    setDone(false);
    setBusy(true);
    try {
      await changePassword(password);
      setDone(true);
      setPassword('');
      setPassword2('');
    } catch (err) {
      setError(err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="surface space-y-3 p-4" onSubmit={onSubmit} noValidate>
      <h3 className="text-sm font-semibold text-ink dark:text-paper">{t('auth.account.password')}</h3>
      {done && <Notice>{t('auth.account.passwordChanged')}</Notice>}
      <Field
        id="account-password"
        label={t('auth.newPassword')}
        hint={t('auth.passwordHint')}
        error={pwError ? t(`auth.errors.${pwError}`) : null}
      >
        <input
          id="account-password"
          type="password"
          className="input"
          dir="ltr"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Field
        id="account-password2"
        label={t('auth.passwordRepeat')}
        error={mismatch ? t('auth.errors.password_mismatch') : null}
      >
        <input
          id="account-password2"
          type="password"
          className="input"
          dir="ltr"
          autoComplete="new-password"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
        />
      </Field>
      <FormError code={error} />
      <button
        type="submit"
        className="btn-primary"
        disabled={busy || !password || Boolean(pwError) || password !== password2}
      >
        {busy ? t('auth.working') : t('auth.account.changePassword')}
      </button>
    </form>
  );
}
