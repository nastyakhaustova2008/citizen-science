import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, supabaseUrl, supabaseKey, authRedirectBase } from '../lib/supabase';
import { isPlaceholderEmail, normalizeUsername } from '../lib/username';

/**
 * Accounts (roadmap step 4a).
 * - Username + password: through the Edge Function `account` (signup / login / recover), which
 *   resolves username → auth email on the server; the browser never sees another user's email.
 * - Google: supabase.auth.signInWithOAuth (PKCE). First sign-in → profile without username →
 *   the app sends the user to /auth/choose-username.
 * - profiles (id, username, role, created_at) are public; role fields are read-only for users.
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

async function callAccount(body) {
  if (!supabaseUrl) throw new AuthError('generic');
  let res;
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey },
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

  const logInWithGoogle = useCallback(async (next = '/') => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${authRedirectBase()}#${next}` },
    });
    if (error) throw new AuthError('oauth');
  }, []);

  const logOut = useCallback(async () => {
    await supabase.auth.signOut();
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
      requestReset,
      checkUsername,
      chooseUsername,
      changeEmail,
      changePassword,
      verifyEmailLink,
      reloadProfile,
    }),
    [
      session,
      user,
      email,
      pendingEmail,
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
      requestReset,
      checkUsername,
      chooseUsername,
      changeEmail,
      changePassword,
      verifyEmailLink,
      reloadProfile,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
}
