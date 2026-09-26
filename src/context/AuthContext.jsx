import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseUrl, supabaseKey, authRedirectBase } from '../lib/supabase';
import { isPlaceholderEmail, normalizeUsername } from '../lib/username';
import { myAdminProfile, saveAdminProfile as saveAdminProfileRpc } from '../lib/labsApi';
import { myAvatar as fetchMyAvatar } from '../lib/avatarsApi';
import { EMAIL_FLOWS_ENABLED } from '../lib/authConfig';
import { authStorage, beginSignIn, finishSignOut, isSharedSession, isSigningOut, markSigningOut } from '../lib/session';

/**
 * Accounts (roadmap step 4a).
 * - Username + password: through the Edge Function `account` (signup / login / recover), which
 *   resolves username → auth email on the server; the browser never sees another user's email.
 * - Google: supabase.auth.signInWithOAuth (PKCE). First sign-in → profile without username →
 *   the app sends the user to /auth/choose-username.
 * - profiles (id, username, role, created_at) are readable by logged-in users only (020); role fields
 *   are read-only for users.
 * - Admins also have an admin profile (step 5a: full name, workplace, position) — loaded here;
 *   until it is filled the database refuses every lab action (admin_profile_required).
 * - Sessions (audit H6): "shared computer" sign-ins keep the session in sessionStorage and sign
 *   out after inactivity (lib/session.js, components/auth/SessionUI.jsx). Every sign-out clears
 *   both storages and reloads the page (finishSignOut) — also when the session ends elsewhere
 *   ("sign out on all devices", password changed on another device).
 * - Password / email changes go through the Edge Function (change-password / change-email): the
 *   server wants a sign-in of THIS session within 15 minutes (else reauth_required → the UI asks
 *   for the password or Google, components/auth/Reauth.jsx), and migration 021 refuses changes
 *   made directly through Supabase Auth.
 * - My profile picture (017): { avatar, rejected, confirmerUsername, required } — admins need a
 *   confirmed face photo for lab work once the owner turns the switch on (admin_photo_required).
 * Error codes → strings.js auth.errors.<code>.
 */

export const PROFILE_COLUMNS = 'id, username, role, created_at';

/** A profiles row → the "author" shape the UI uses (same fields as mock users where it matters). */
export function authorFromProfile(row) {
  return {
    id: row.id,
    displayName: row.username || '—',
    username: row.username,
    avatarSeed: row.id,
    role: row.role,
    joinedAt: row.created_at,
    kind: 'real',
  };
}

export class AuthError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

async function callAccount(body, accessToken = null) {
  if (!supabaseUrl) throw new AuthError('generic');
  const headers = { 'Content-Type': 'application/json', apikey: supabaseKey };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  let res;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/account`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthError('network');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) throw new AuthError('generic');
  if (data.error) throw new AuthError(data.error, data.detail);
  return data;
}

async function startSession(session) {
  const { error } = await supabase.auth.setSession(session);
  if (error) throw new AuthError('generic');
}

/** Supabase error → our code (strings.js auth.errors.<code>). */
function mapAuthError(error) {
  const code = error?.code || '';
  if (code === 'email_exists' || code === 'email_address_not_authorized') return 'email_in_use';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'email_invalid';
  if (code === 'weak_password') return 'password_short';
  if (code === 'same_password') return 'same_password';
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') return 'too_many_attempts';
  if (code === 'otp_expired' || code === 'bad_code_verifier' || code === 'flow_state_expired') return 'link_invalid';
  if (code === 'reauthentication_needed') return 'relogin_needed';
  return 'generic';
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState(false);
  const [profileNonce, setProfileNonce] = useState(0);
  const [oauthError, setOauthError] = useState(null);
  // A session existed in this page: its end (SIGNED_OUT from elsewhere) must clear and reload.
  const hadSession = useRef(false);
  const signedOutInfo = useRef({ google: false, shared: false });

  useEffect(() => {
    if (!supabase) return undefined;
    // Google sign-in comes back as ?code=… (exchanged by supabase-js) or ?error=….
    const params = new URLSearchParams(window.location.search);
    if (params.get('error')) setOauthError(params.get('error_description') || params.get('error'));
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setAuthLoading(false);
      if (params.has('code') || params.has('error')) {
        window.history.replaceState(null, '', authRedirectBase() + window.location.hash);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // Another tab's sign-in (supabase-js relays it): not this tab's session if this tab's storage
      // doesn't hold it — a shared-computer session stays in its own tab.
      if (next && event !== 'INITIAL_SESSION' && !authStorage.getItem(supabase.auth.storageKey)) return;
      if (next) {
        hadSession.current = true;
        const providers = next.user?.app_metadata?.providers || [];
        signedOutInfo.current = { google: providers.includes('google'), shared: isSharedSession() };
      }
      // Ended elsewhere (all devices, refresh refused, another tab): same clean-up as a sign-out.
      if (event === 'SIGNED_OUT' && hadSession.current && !isSigningOut()) {
        markSigningOut();
        finishSignOut({ reason: 'expired', ...signedOutInfo.current });
        return;
      }
      setSession(next);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const userId = session?.user?.id ?? null;

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setProfileError(false);
      return undefined;
    }
    let alive = true;
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(PROFILE_COLUMNS)
        .eq('id', userId)
        .maybeSingle();
      if (!alive) return;
      if (error || !data) {
        console.error('[auth] profile load failed', error);
        setProfileError(true);
        setProfile(null);
        return;
      }
      setProfileError(false);
      setProfile(data);
    })();
    return () => {
      alive = false;
    };
  }, [userId, profileNonce]);

  const reloadProfile = useCallback(() => setProfileNonce((n) => n + 1), []);

  // Admin profile: undefined = not loaded / not an admin, null = not filled yet, object = filled.
  const isAdmin = ['admin', 'main_admin', 'owner'].includes(profile?.id === userId ? profile?.role : null);
  const [adminProfile, setAdminProfile] = useState(undefined);
  const [adminProfileNonce, setAdminProfileNonce] = useState(0);
  useEffect(() => {
    if (!isAdmin || !userId) {
      setAdminProfile(undefined);
      return undefined;
    }
    let alive = true;
    myAdminProfile(userId)
      .then((p) => alive && setAdminProfile(p))
      .catch(() => alive && setAdminProfile(undefined));
    return () => {
      alive = false;
    };
  }, [isAdmin, userId, adminProfileNonce]);

  const reloadAdminProfile = useCallback(() => setAdminProfileNonce((n) => n + 1), []);

  // My profile picture: undefined = not loaded, else the avatar_me result.
  const hasUsername = Boolean(profile?.id === userId && profile?.username);
  const [myAvatar, setMyAvatar] = useState(undefined);
  const [myAvatarNonce, setMyAvatarNonce] = useState(0);
  useEffect(() => {
    if (!userId || !hasUsername) {
      setMyAvatar(undefined);
      return undefined;
    }
    let alive = true;
    fetchMyAvatar()
      .then((a) => alive && setMyAvatar(a))
      .catch(() => alive && setMyAvatar(undefined));
    return () => {
      alive = false;
    };
    // The role matters too: a role change deletes the picture (017).
  }, [userId, hasUsername, profile?.role, myAvatarNonce]);
  const reloadMyAvatar = useCallback(() => setMyAvatarNonce((n) => n + 1), []);

  /** Save my admin profile; throws LabError (invalid_admin_profile with details {field: code}). */
  const saveAdminProfile = useCallback(async (values) => {
    const saved = await saveAdminProfileRpc(values);
    setAdminProfile(saved);
    return saved;
  }, []);

  /** Password / email change through the Edge Function (recent sign-in checked on the server). */
  const callWithSession = useCallback(async (body) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new AuthError('not_logged_in');
    return callAccount(body, token);
  }, []);

  const changeEmail = useCallback(
    async (email) => {
      await callWithSession({ action: 'change-email', email: email.trim(), redirectTo: authRedirectBase() });
      await supabase.auth.refreshSession(); // shows the pending address (user.new_email)
    },
    [callWithSession],
  );

  /** Signs out the other sessions of this account too (the server does it after the change). */
  const changePassword = useCallback(
    (password) => callWithSession({ action: 'change-password', password }),
    [callWithSession],
  );

  /** shared: the "shared computer" checkbox (session in sessionStorage, sign-out after inactivity). */
  const signUp = useCallback(
    async ({ username, password, email, shared }) => {
      const data = await callAccount({ action: 'signup', username: normalizeUsername(username), password });
      beginSignIn(Boolean(shared));
      await startSession(data.session);
      if (!email || !EMAIL_FLOWS_ENABLED) return { emailSent: false };
      // Same flow as "add email" in the profile: Supabase sends a confirmation link to it.
      try {
        await changeEmail(email);
        return { emailSent: true };
      } catch (err) {
        return { emailSent: false, emailError: err.code || 'generic' };
      }
    },
    [changeEmail],
  );

  /** shared: undefined = keep this tab's mode (signing in again to confirm it is you). */
  const logIn = useCallback(async ({ username, password, shared }) => {
    const data = await callAccount({ action: 'login', username: normalizeUsername(username), password });
    if (shared !== undefined) beginSignIn(Boolean(shared));
    await startSession(data.session);
  }, []);

  /**
   * reauth: confirming it is you (e.g. before deleting). Google's account chooser is shown then and
   * on shared computers — the browser may still be signed in to someone else's Google account.
   */
  const logInWithGoogle = useCallback(async (next = '/', { reauth = false, shared } = {}) => {
    if (shared !== undefined) beginSignIn(Boolean(shared));
    const chooser = reauth || isSharedSession();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${authRedirectBase()}#${next}`,
        ...(chooser ? { queryParams: { prompt: 'select_account' } } : {}),
      },
    });
    if (error) throw new AuthError('oauth');
  }, []);

  /**
   * Sign out: scope 'local' (this browser; the server ends this session) or 'global' (every
   * device). reason (for the message after the reload): 'manual' | 'global' | 'idle'.
   * Always clears the stored session and reloads, even if the server can't be reached.
   */
  const logOut = useCallback(async ({ scope = 'local', reason } = {}) => {
    const info = { ...signedOutInfo.current, shared: isSharedSession() };
    markSigningOut();
    try {
      const { error } = await supabase.auth.signOut({ scope });
      if (error) console.warn('[auth] sign out', error.code || error.message);
    } catch (err) {
      console.warn('[auth] sign out', err?.message);
    }
    finishSignOut({ ...info, reason: reason || (scope === 'global' ? 'global' : 'manual') });
  }, []);

  /**
   * "Delete my account" (migration 014): what will happen — {role, canDelete, measurements,
   * adminsMoved, movedUnder: {id, username} | null, labsCreated, drafts, openRevisions}.
   */
  const accountDeletePreview = useCallback(async () => {
    const { data, error } = await supabase.rpc('account_delete_preview');
    if (error || !data) throw new AuthError(error?.message === 'not_logged_in' ? 'not_logged_in' : 'generic');
    return {
      role: data.role,
      canDelete: data.can_delete,
      measurements: data.measurements,
      adminsMoved: data.admins_moved,
      movedUnder: data.moved_under,
      labsCreated: data.labs_created,
      drafts: data.drafts,
      openRevisions: data.open_revisions,
      // 015 (0 until the migration runs)
      comments: data.comments ?? 0,
      commentsOnMeasurements: data.comments_on_measurements ?? 0,
      // 016: stored measurement photos (always deleted)
      photos: data.photos ?? 0,
      // 017: a profile picture (always deleted)
      avatar: Boolean(data.avatar),
    };
  }, []);

  /**
   * Deletes the account on the server (Edge Function). Throws AuthError, e.g. 'reauth_required'
   * (sign in again first) or 'username_mismatch'. Does NOT sign out: the caller leaves the
   * profile page first, then calls finishAccountDeletion().
   */
  const deleteAccount = useCallback(async ({ username, deleteMeasurements }) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new AuthError('not_logged_in');
    await callAccount(
      { action: 'delete', username: normalizeUsername(username), deleteMeasurements: Boolean(deleteMeasurements) },
      token,
    );
  }, []);

  /** After deleteAccount: the server sessions are gone, so only the local one is cleared. */
  const finishAccountDeletion = useCallback(async () => {
    const info = { ...signedOutInfo.current, shared: isSharedSession() };
    markSigningOut();
    await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
    finishSignOut({ ...info, reason: 'deleted' });
  }, []);

  /**
   * "Forgot password": by email (Supabase directly) or by username (Edge Function).
   * Always resolves the same way — the page shows one generic message either way.
   */
  const requestReset = useCallback(async (identifier) => {
    const value = identifier.trim();
    if (value.includes('@')) {
      const { error } = await supabase.auth.resetPasswordForEmail(value, { redirectTo: authRedirectBase() });
      if (error) console.warn('[auth] reset request', error.code);
      return;
    }
    await callAccount({ action: 'recover', username: normalizeUsername(value), redirectTo: authRedirectBase() });
  }, []);

  /** 'available' | 'taken' | a username validation code. */
  const checkUsername = useCallback(async (name) => {
    const { data, error } = await supabase.rpc('username_available', { p_username: name });
    if (error) throw new AuthError('generic');
    return data;
  }, []);

  const chooseUsername = useCallback(
    async (name) => {
      const { error } = await supabase.rpc('set_my_username', { p_username: normalizeUsername(name) });
      if (error) {
        if (error.message === 'invalid_username') throw new AuthError('invalid_username', error.details);
        if (['already_set', 'username_taken', 'not_logged_in'].includes(error.message)) {
          throw new AuthError(error.message);
        }
        throw new AuthError('generic');
      }
      reloadProfile();
    },
    [reloadProfile],
  );

  /** Email link (token_hash template): type 'recovery' | 'email_change' | 'email'. */
  const verifyEmailLink = useCallback(async ({ tokenHash, type }) => {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new AuthError(mapAuthError(error) === 'generic' ? 'link_invalid' : mapAuthError(error));
  }, []);

  const user = session?.user ?? null;
  const email = user && !isPlaceholderEmail(user.email) ? user.email : null;
  const pendingEmail = user?.new_email && !isPlaceholderEmail(user.new_email) ? user.new_email : null;
  // How this account can sign in: 'email' (username + password) and/or 'google'.
  const providers = useMemo(
    () => user?.app_metadata?.providers || (user?.app_metadata?.provider ? [user.app_metadata.provider] : []),
    [user],
  );
  const profileReady = !userId || profileError || profile?.id === userId;

  const myAvatarPath = myAvatar?.avatar && myAvatar.avatar.status !== 'hidden' ? myAvatar.avatar.path : null;
  const currentUser = useMemo(
    () => (profile && profile.id === userId ? { ...authorFromProfile(profile), avatarPath: myAvatarPath } : null),
    [profile, userId, myAvatarPath],
  );

  const value = useMemo(
    () => ({
      configured: Boolean(supabase),
      session,
      // This tab's session is a "shared computer" one (sessionStorage, sign-out after inactivity).
      sharedSession: Boolean(session) && isSharedSession(),
      user,
      email,
      pendingEmail,
      providers,
      profile: profile?.id === userId ? profile : null,
      currentUser,
      authLoading: authLoading || !profileReady,
      // The stored session has been checked (profile may still be loading): reads that depend on
      // being logged in (authors, audit H2) wait for this instead of asking twice.
      sessionReady: !authLoading,
      needsUsername: Boolean(userId && profile?.id === userId && !profile.username),
      oauthError,
      clearOauthError: () => setOauthError(null),
      signUp,
      logIn,
      logInWithGoogle,
      logOut,
      accountDeletePreview,
      deleteAccount,
      finishAccountDeletion,
      requestReset,
      checkUsername,
      chooseUsername,
      changeEmail,
      changePassword,
      verifyEmailLink,
      reloadProfile,
      adminProfile,
      adminProfileComplete: Boolean(adminProfile),
      reloadAdminProfile,
      saveAdminProfile,
      myAvatar,
      setMyAvatar,
      reloadMyAvatar,
      // Admin with a confirmed face photo (needed for lab work when myAvatar.required).
      adminPhotoConfirmed: myAvatar?.avatar?.kind === 'admin' && myAvatar.avatar.status === 'confirmed',
    }),
    [
      session,
      user,
      email,
      pendingEmail,
      providers,
      profile,
      userId,
      currentUser,
      authLoading,
      profileReady,
      oauthError,
      signUp,
      logIn,
      logInWithGoogle,
      logOut,
      accountDeletePreview,
      deleteAccount,
      finishAccountDeletion,
      requestReset,
      checkUsername,
      chooseUsername,
      changeEmail,
      changePassword,
      verifyEmailLink,
      reloadProfile,
      adminProfile,
      reloadAdminProfile,
      saveAdminProfile,
      myAvatar,
      reloadMyAvatar,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
