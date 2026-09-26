import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseUrl, supabaseKey, authRedirectBase } from '../lib/supabase';
import { isPlaceholderEmail, normalizeUsername } from '../lib/username';
import { myAdminProfile, saveAdminProfile as saveAdminProfileRpc } from '../lib/labsApi';

/**
 * Accounts (roadmap step 4a).
 * - Username + password: through the Edge Function `account` (signup / login / recover), which
 *   resolves username → auth email on the server; the browser never sees another user's email.
 * - Google: supabase.auth.signInWithOAuth (PKCE). First sign-in → profile without username →
 *   the app sends the user to /auth/choose-username.
 * - profiles (id, username, role, created_at) are public; role fields are read-only for users.
 * - Admins also have an admin profile (step 5a: full name, workplace, position) — loaded here;
 *   until it is filled the database refuses every lab action (admin_profile_required).
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
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
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

  /** Save my admin profile; throws LabError (invalid_admin_profile with details {field: code}). */
  const saveAdminProfile = useCallback(async (values) => {
    const saved = await saveAdminProfileRpc(values);
    setAdminProfile(saved);
    return saved;
  }, []);

  const signUp = useCallback(async ({ username, password, email }) => {
    const data = await callAccount({ action: 'signup', username: normalizeUsername(username), password });
    await startSession(data.session);
    if (!email) return { emailSent: false };
    // Same flow as "add email" in the profile: Supabase sends a confirmation link to it.
    const { error } = await supabase.auth.updateUser(
      { email: email.trim() },
      { emailRedirectTo: authRedirectBase() },
    );
    return error ? { emailSent: false, emailError: mapAuthError(error) } : { emailSent: true };
  }, []);

  const logIn = useCallback(async ({ username, password }) => {
    const data = await callAccount({ action: 'login', username: normalizeUsername(username), password });
    await startSession(data.session);
  }, []);

  /** reauth: always show Google's account chooser (confirming it is you, e.g. before deleting). */
  const logInWithGoogle = useCallback(async (next = '/', { reauth = false } = {}) => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${authRedirectBase()}#${next}`,
        ...(reauth ? { queryParams: { prompt: 'select_account' } } : {}),
      },
    });
    if (error) throw new AuthError('oauth');
  }, []);

  const logOut = useCallback(async () => {
    await supabase.auth.signOut();
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
    await supabase.auth.signOut({ scope: 'local' });
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

  const changeEmail = useCallback(async (email) => {
    const { error } = await supabase.auth.updateUser(
      { email: email.trim() },
      { emailRedirectTo: authRedirectBase() },
    );
    if (error) throw new AuthError(mapAuthError(error));
  }, []);

  const changePassword = useCallback(async (password) => {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new AuthError(mapAuthError(error));
  }, []);

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

  const currentUser = useMemo(
    () => (profile && profile.id === userId ? authorFromProfile(profile) : null),
    [profile, userId],
  );

  const value = useMemo(
    () => ({
      configured: Boolean(supabase),
      session,
      user,
      email,
      pendingEmail,
      providers,
      profile: profile?.id === userId ? profile : null,
      currentUser,
      authLoading: authLoading || !profileReady,
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
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
