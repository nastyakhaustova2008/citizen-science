import { useState } from 'react';
import { LogOut, MonitorSmartphone } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { passwordError } from '../../lib/username';
import { SectionHeading } from '../primitives';
import { Field, FormError, Notice, isolate } from './AuthUI';
import DeleteAccount from './DeleteAccount';
import Reauth from './Reauth';
import { EMAIL_FLOWS_ENABLED } from '../../lib/authConfig';

export const ACCOUNT_HASH = '#account';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Own profile → "Account": email (add / change — hidden until emails reach users), password, sign
 * out (here / on all devices), delete account (not the owner).
 * Password and email changes need a recent sign-in (server: Edge Function, reauth_required → the
 * card asks for the password or Google and then retries).
 */
export default function AccountSettings() {
  const { t } = useI18n();
  const { profile } = useAuth();
  return (
    <section id="account" className="scroll-mt-4">
      <SectionHeading as="h2" title={t('auth.account.title')} />
      <div className="grid gap-4 md:grid-cols-2">
        <EmailCard />
        <PasswordCard />
      </div>
      <SignOutCard />
      {profile && profile.role !== 'owner' && <DeleteAccount />}
    </section>
  );
}

function SignOutCard() {
  const { t } = useI18n();
  const { logOut, sharedSession } = useAuth();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = (scope) => {
    setBusy(true);
    logOut({ scope });
  };

  return (
    <div className="surface mt-4 max-w-2xl space-y-3 p-4">
      <h3 className="text-sm font-semibold text-ink dark:text-paper">{t('auth.signOut.title')}</h3>
      {sharedSession && (
        <p className="flex items-start gap-1.5 text-sm text-ink-faint">
          <MonitorSmartphone className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('auth.shared.reminder')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary" disabled={busy} onClick={() => run('local')}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          {t('auth.logout')}
        </button>
        {!confirmAll && (
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmAll(true)}>
            {t('auth.signOut.everywhere')}
          </button>
        )}
      </div>
      {confirmAll && (
        <div className="space-y-2 rounded-lg border border-edge p-3 text-sm dark:border-white/10">
          <p>{t('auth.signOut.everywhereText')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => run('global')}>
              {busy ? t('auth.working') : t('auth.signOut.everywhereConfirm')}
            </button>
            <button type="button" className="btn-secondary" disabled={busy} onClick={() => setConfirmAll(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmailCard() {
  const { t } = useI18n();
  const { email, pendingEmail, changeEmail } = useAuth();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sentTo, setSentTo] = useState(null);
  const [reauth, setReauth] = useState(false);

  const invalid = value.trim() && !EMAIL_RE.test(value.trim());

  if (!EMAIL_FLOWS_ENABLED) {
    // Confirmation emails don't reach users yet (N2): nothing to add or change here for now.
    return (
      <div className="surface space-y-3 p-4">
        <h3 className="text-sm font-semibold text-ink dark:text-paper">{t('auth.account.email')}</h3>
        {email ? (
          <p className="text-sm" dir="ltr">
            {email}
          </p>
        ) : (
          <p className="text-sm text-ink-faint">{t('auth.account.noEmail')}</p>
        )}
        <p className="text-xs text-ink-faint">{t('auth.account.emailSoon')}</p>
      </div>
    );
  }

  async function submit() {
    if (!value.trim() || invalid) return;
    setError(null);
    setBusy(true);
    try {
      await changeEmail(value);
      setSentTo(value.trim());
      setValue('');
    } catch (err) {
      if (err.code === 'reauth_required') setReauth(true);
      setError(err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    submit();
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
      {reauth ? (
        <Reauth
          idBase="email"
          googleReturn={`/profile${ACCOUNT_HASH}`}
          onDone={() => {
            setReauth(false);
            submit();
          }}
        />
      ) : (
        <FormError code={error} />
      )}
      <button type="submit" className="btn-primary" disabled={busy || reauth || !value.trim() || invalid}>
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
  const [reauth, setReauth] = useState(false);

  const pwError = password ? passwordError(password) : null;
  const mismatch = password2 && password !== password2;

  async function submit() {
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
      if (err.code === 'reauth_required') setReauth(true);
      setError(err.code || 'generic');
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    submit();
  }

  return (
    <form className="surface space-y-3 p-4" onSubmit={onSubmit} noValidate>
      <h3 className="text-sm font-semibold text-ink dark:text-paper">{t('auth.account.password')}</h3>
      {done && <Notice>{t('auth.account.passwordChangedOthers')}</Notice>}
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
      {reauth ? (
        <Reauth
          idBase="password"
          googleReturn={`/profile${ACCOUNT_HASH}`}
          onDone={() => {
            setReauth(false);
            submit();
          }}
        />
      ) : (
        <FormError code={error} />
      )}
      <button
        type="submit"
        className="btn-primary"
        disabled={busy || reauth || !password || Boolean(pwError) || password !== password2}
      >
        {busy ? t('auth.working') : t('auth.account.changePassword')}
      </button>
    </form>
  );
}
