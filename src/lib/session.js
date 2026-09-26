/**
 * Where the login session is kept, and signing out cleanly (audit H6, "shared computer" mode).
 *
 * - The sign-in pages have a "This is a shared computer" checkbox. Its default: ON on computers,
 *   OFF on phones and tablets (no hover + coarse pointer); the last choice is remembered on this
 *   device (localStorage mitzpe.sharedDevice — a setting, not personal data).
 * - A shared-computer session lives in sessionStorage (gone when the browser is closed) and is
 *   marked with sessionStorage mitzpe.sharedSession = '1' in this tab. The mark is set when the
 *   sign-in starts (also before the Google redirect, which comes back to the same tab), so token
 *   refreshes keep writing to the same place. Otherwise the session is in localStorage as before.
 * - Signing out (button, "all devices", after inactivity, session ended elsewhere, account
 *   deleted) removes every Supabase key from both storages and reloads the page: nothing of the
 *   previous user stays in memory (author names, signed photo links, forms, queues).
 *   Why it happened is passed across the reload in sessionStorage mitzpe.signedOut (shown once).
 * All storage access is in try/catch: blocked storage means "not shared", nothing remembered.
 */

const PREF_KEY = 'mitzpe.sharedDevice';
const MARK_KEY = 'mitzpe.sharedSession';
const REASON_KEY = 'mitzpe.signedOut';
const PHOTO_PROMPT_KEY = 'mitzpe.photoPromptShown';

function store(kind) {
  try {
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
}
function read(kind, key) {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(kind, key, value) {
  try {
    if (value == null) store(kind)?.removeItem(key);
    else store(kind)?.setItem(key, value);
  } catch {
    // storage blocked
  }
}

/** Phones and tablets: the main pointer is a finger and there is no hover. */
export function isPersonalDevice() {
  try {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** The checkbox's starting value on this device. */
export function sharedPreference() {
  const saved = read('local', PREF_KEY);
  if (saved === '1') return true;
  if (saved === '0') return false;
  return !isPersonalDevice();
}

/** Called when a sign-in starts (password, sign-up, Google): remember the choice, mark this tab. */
export function beginSignIn(shared) {
  write('local', PREF_KEY, shared ? '1' : '0');
  write('session', MARK_KEY, shared ? '1' : null);
}

/** This tab's session is a shared-computer one. */
export function isSharedSession() {
  return read('session', MARK_KEY) === '1';
}

/** supabase-js storage: sessionStorage for shared-computer sessions, else localStorage. */
export const authStorage = {
  getItem(key) {
    return isSharedSession() ? read('session', key) : read('local', key);
  },
  setItem(key, value) {
    if (isSharedSession()) {
      write('session', key, value);
      write('local', key, null);
    } else {
      write('local', key, value);
      write('session', key, null);
    }
  },
  removeItem(key) {
    write('session', key, null);
    write('local', key, null);
  },
};

/* ----------------------------------------------------------------- unsaved work */

// What would be lost if the user were signed out now: 'measurement' (the wizard) | 'lab' (editor).
const unsaved = new Map();
export function setUnsavedWork(id, kind) {
  if (kind) unsaved.set(id, kind);
  else unsaved.delete(id);
}
export function unsavedWork() {
  return new Set(unsaved.values());
}

/* --------------------------------------------------------------------- sign out */

let signingOut = false;
/** True from the moment a sign-out starts: nothing may block the reload (beforeunload). */
export function isSigningOut() {
  return signingOut;
}
export function markSigningOut() {
  signingOut = true;
}

/** Removes the session (both storages, any Supabase key), the tab mark and per-user leftovers. */
export function clearAuthData() {
  for (const kind of ['local', 'session']) {
    const s = store(kind);
    if (!s) continue;
    try {
      const keys = [];
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k && k.startsWith('sb-')) keys.push(k);
      }
      keys.forEach((k) => s.removeItem(k));
    } catch {
      // storage blocked
    }
  }
  write('session', MARK_KEY, null);
  write('session', PHOTO_PROMPT_KEY, null);
}

/**
 * After the sign-out: clear everything and reload on the home page.
 * info: { reason: 'manual' | 'global' | 'idle' | 'expired' | 'deleted', google, shared }.
 */
export function finishSignOut(info) {
  signingOut = true;
  clearAuthData();
  write('session', REASON_KEY, JSON.stringify(info));
  try {
    window.history.replaceState(null, '', `${window.location.origin}${window.location.pathname}#/`);
  } catch {
    // ignore
  }
  window.location.reload();
}

/** The reason of the sign-out that caused this page load (read once), or null. */
export function takeSignOutInfo() {
  const raw = read('session', REASON_KEY);
  if (!raw) return null;
  write('session', REASON_KEY, null);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
