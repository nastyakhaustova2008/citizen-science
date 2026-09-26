import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, LogOut, MonitorSmartphone, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { IDLE_SIGN_OUT_MINUTES, IDLE_WARNING_SECONDS } from '../../lib/authConfig';
import { takeSignOutInfo, unsavedWork } from '../../lib/session';
import { Notice } from './AuthUI';

/**
 * Session pieces of the page frame (audit H6, see lib/session.js):
 *  - IdleSignOut: on a shared computer, sign out after IDLE_SIGN_OUT_MINUTES without activity in
 *    this tab, with a warning IDLE_WARNING_SECONDS before (says what unsent work would be lost).
 *  - SharedReminder: a slim "shared computer — don't forget to sign out" bar with the button.
 *  - SignedOutNotice: after the reload that follows a sign-out, why it happened (+ "also sign out
 *    of Google" on a shared computer when the account uses Google).
 */

// Real input only. Not 'scroll': the page also scrolls by itself (scroll into view, route change),
// and a user's own scrolling always comes with wheel / touch / keys / pointer events.
const ACTIVITY = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'touchmove'];
const LIMIT_MS = IDLE_SIGN_OUT_MINUTES * 60 * 1000;
const WARN_MS = IDLE_WARNING_SECONDS * 1000;

export function IdleSignOut() {
  const { sharedSession, logOut } = useAuth();
  const [secondsLeft, setSecondsLeft] = useState(null); // null = no warning
  const last = useRef(Date.now());
  const warning = secondsLeft !== null;
  const warningRef = useRef(false);
  warningRef.current = warning;

  useEffect(() => {
    if (!sharedSession) return undefined;
    last.current = Date.now();
    let signingOut = false;
    // While the warning is shown only its button counts: a cat on the keyboard shouldn't.
    const onActivity = () => {
      if (!warningRef.current) last.current = Date.now();
    };
    const tick = () => {
      const idle = Date.now() - last.current;
      if (idle >= LIMIT_MS) {
        if (!signingOut) {
          signingOut = true;
          logOut({ reason: 'idle' });
        }
      } else if (idle >= LIMIT_MS - WARN_MS) {
        setSecondsLeft(Math.max(0, Math.ceil((LIMIT_MS - idle) / 1000)));
      } else if (warningRef.current) {
        setSecondsLeft(null);
      }
    };
    ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));
    // Timers are slowed down in background tabs: also check when the tab comes back.
    document.addEventListener('visibilitychange', tick);
    const id = window.setInterval(tick, 1000);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity, { capture: true }));
      document.removeEventListener('visibilitychange', tick);
      window.clearInterval(id);
    };
  }, [sharedSession, logOut]);

  if (!sharedSession || !warning) return null;
  return (
    <IdleWarning
      secondsLeft={secondsLeft}
      onStay={() => {
        last.current = Date.now();
        setSecondsLeft(null);
      }}
      onSignOut={() => logOut({ reason: 'manual' })}
    />
  );
}

function IdleWarning({ secondsLeft, onStay, onSignOut }) {
  const { t } = useI18n();
  const stayRef = useRef(null);
  const [lost] = useState(unsavedWork);

  useEffect(() => {
    stayRef.current?.focus();
  }, []);

  return (
    <div className="fixed inset-0 z-[1200] flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-body"
        className="surface w-full max-w-md space-y-3 rounded-b-none p-5 shadow-lg sm:rounded-lg"
      >
        <h2 id="idle-title" className="font-serif text-xl font-bold text-ink dark:text-paper">
          {t('auth.idle.title')}
        </h2>
        <p id="idle-body" className="text-sm">
          {t('auth.idle.body', { minutes: IDLE_SIGN_OUT_MINUTES })}{' '}
          <span className="font-semibold" dir="auto">
            {t('auth.idle.countdown', { seconds: secondsLeft })}
          </span>
        </p>
        {lost.has('measurement') && (
          <p className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm font-semibold text-danger" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('auth.idle.measurementLost')}
          </p>
        )}
        {lost.has('lab') && (
          <p className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/5 p-3 text-sm font-semibold text-danger" role="alert">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('auth.idle.labLost')}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button ref={stayRef} type="button" className="btn-primary" onClick={onStay}>
            {t('auth.idle.stay')}
          </button>
          <button type="button" className="btn-secondary" onClick={onSignOut}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            {t('auth.logout')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SharedReminder() {
  const { t } = useI18n();
  const { sharedSession, logOut } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!sharedSession) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-edge bg-paper-sunk/70 px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5">
      <MonitorSmartphone className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t('auth.shared.reminder')}</span>
      <button
        type="button"
        className="btn-ghost px-2 py-1 text-sm"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          logOut();
        }}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {t('auth.logout')}
      </button>
    </div>
  );
}

const REASON_TEXT = {
  manual: 'auth.signedOut.manual',
  global: 'auth.signedOut.global',
  idle: 'auth.signedOut.idle',
  expired: 'auth.signedOut.expired',
  deleted: 'auth.deleteAccount.done',
};

export function SignedOutNotice() {
  const { t } = useI18n();
  const [info, setInfo] = useState(takeSignOutInfo);
  if (!info || !REASON_TEXT[info.reason]) return null;
  return (
    <div className="mb-4 flex items-start gap-2">
      <div className="min-w-0 flex-1 space-y-2">
        <Notice>{t(REASON_TEXT[info.reason], { minutes: IDLE_SIGN_OUT_MINUTES })}</Notice>
        {info.google && info.shared && (
          <p className="flex items-start gap-1.5 rounded-lg border border-bark/40 bg-bark/5 p-3 text-sm" role="note">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-bark" aria-hidden="true" />
            {t('auth.signedOut.google')}
          </p>
        )}
      </div>
      <button type="button" className="btn-ghost !p-2" onClick={() => setInfo(null)}>
        <X className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{t('common.close')}</span>
      </button>
    </div>
  );
}
