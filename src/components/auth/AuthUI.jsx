import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { normalizeUsername, usernameError } from '../../lib/username';
import { LoadingBlock } from '../primitives';

/** Wrap an LTR value (email) for interpolation into RTL/LTR text: Unicode first-strong isolate. */
export const isolate = (value) => `\u2068${value}\u2069`;

/** Only same-app paths ("/…", not "//host") — never redirect to another site. */
export function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function loginPath(next, why) {
  const q = new URLSearchParams({ next });
  if (why) q.set('why', why);
  return `/login?${q}`;
}

/** Centered frosted card used by all auth pages. */
export function AuthCard({ title, intro, children, footer }) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="surface p-5 sm:p-6">
        <h1 className="font-serif text-2xl font-bold text-ink dark:text-paper">{title}</h1>
        {intro && <p className="mt-1 text-sm text-ink-faint">{intro}</p>}
        <div className="mt-5 space-y-4">{children}</div>
      </div>
      {footer && <div className="mt-4 space-y-1 text-center text-sm text-ink-faint">{footer}</div>}
    </div>
  );
}

export function Field({ id, label, hint, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="mt-1 text-xs text-ink-faint">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

/** Error box for an auth error code (strings.js auth.errors.<code>). */
export function FormError({ code }) {
  const { t } = useI18n();
  if (!code) return null;
  const key = `auth.errors.${code}`;
  const text = t(key);
  return (
    <p className="flex items-start gap-1.5 text-sm text-danger" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {text === key ? t('auth.errors.generic') : text}
    </p>
  );
}

export function Notice({ children }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-moss/40 bg-moss/10 p-3 text-sm text-ink dark:text-paper" role="status">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function OrDivider() {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 text-xs text-ink-faint" aria-hidden="true">
      <span className="h-px flex-1 bg-edge dark:bg-white/10" />
      {t('auth.or')}
      <span className="h-px flex-1 bg-edge dark:bg-white/10" />
    </div>
  );
}

export function GoogleButton({ next }) {
  const { t } = useI18n();
  const { logInWithGoogle } = useAuth();
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary w-full"
        disabled={busy}
        onClick={async () => {
          setError(null);
          setBusy(true);
          try {
            await logInWithGoogle(next);
          } catch (err) {
            setError(err.code || 'oauth');
            setBusy(false);
          }
        }}
      >
        <span className="font-bold" aria-hidden="true">
          G
        </span>
        {t('auth.withGoogle')}
      </button>
      <FormError code={error} />
    </div>
  );
}

/**
 * Username input with the local rules and a (debounced) availability check.
 * onStatus(status): 'available' | 'taken' | a validation code | 'checking' | null.
 */
export function UsernameField({ id, value, onChange, status, onStatus }) {
  const { t } = useI18n();
  const { checkUsername } = useAuth();
  const name = normalizeUsername(value);

  useEffect(() => {
    if (!name) {
      onStatus(null);
      return undefined;
    }
    const local = usernameError(name);
    if (local) {
      onStatus(local);
      return undefined;
    }
    onStatus('checking');
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const result = await checkUsername(name);
        if (alive) onStatus(result === 'taken' ? 'username_taken' : result);
      } catch {
        if (alive) onStatus(null);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [name, checkUsername, onStatus]);

  const isError = status && !['available', 'checking'].includes(status);
  let hint = t('auth.usernameHint');
  if (status === 'checking') hint = t('auth.checking');
  if (status === 'available') hint = t('auth.usernameAvailable');

  return (
    <Field
      id={id}
      label={t('auth.username')}
      hint={hint}
      error={isError ? t(`auth.errors.${status}`) : null}
    >
      <input
        id={id}
        className="input"
        dir="auto"
        autoComplete="username"
        autoCapitalize="off"
        spellCheck={false}
        maxLength={40}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={isError || undefined}
        aria-describedby={isError ? `${id}-error` : `${id}-hint`}
        required
      />
    </Field>
  );
}

/** Wrap a route that needs a logged-in user; otherwise → /login?next=…. */
export function RequireAuth({ why, children }) {
  const { session, authLoading } = useAuth();
  const location = useLocation();
  if (authLoading) return <LoadingBlock />;
  if (!session) return <Navigate to={loginPath(location.pathname + location.search, why)} replace />;
  return children;
}

/** Logged in without a username (first Google sign-in) → choose one before anything else. */
export function UsernameGate() {
  const { needsUsername } = useAuth();
  const location = useLocation();
  if (!needsUsername || location.pathname.startsWith('/auth/')) return null;
  const next = encodeURIComponent(location.pathname + location.search);
  return <Navigate to={`/auth/choose-username?next=${next}`} replace />;
}

/** Google sign-in came back with an error (?error=… in the URL). */
export function OAuthErrorBanner() {
  const { oauthError, clearOauthError } = useAuth();
  const { t } = useI18n();
  if (!oauthError) return null;
  return (
    <div className="mx-auto mb-4 flex w-full max-w-md items-start justify-between gap-3 rounded-lg border border-danger/40 p-3">
      <FormError code="oauth" />
      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={clearOauthError}>
        {t('common.close')}
      </button>
    </div>
  );
}
