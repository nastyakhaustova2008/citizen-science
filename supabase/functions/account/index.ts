// Edge Function `account` — username accounts on top of Supabase Auth (roadmap step 4a).
// Plain JavaScript (the file is .ts only because the dashboard editor expects index.ts).
// Deploy: Supabase Dashboard → Edge Functions → Deploy a new function → Via Editor,
// name `account`, paste this file, turn "Verify JWT" OFF (callers are not logged in yet).
//
// Why it exists: Supabase Auth logs in by email, but students log in by username and
// nobody may learn another user's email (or whether they have one) from the username.
// So the username → email lookup happens only here, with the secret key, and the email
// never leaves the server.
//
// Actions (POST JSON { action, ... }), every reply is HTTP 200 JSON unless the function crashes:
//   signup    { username, password }      → { session } | { error }
//             Creates the user with an internal placeholder email (never receives mail),
//             confirmed, so no email is sent. A real email is added afterwards by the browser
//             (updateUser → confirmation link), exactly like "add email" in the profile.
//   login     { username, password }      → { session } | { error: 'invalid_credentials' | 'too_many_attempts' }
//   recover   { username, redirectTo }    → { ok: true } always, immediately; the reset email
//             (only for a real, confirmed email) is sent in the background, so neither the
//             answer nor its timing tells whether the account has an email.
//   client-ip {}                          → which client IP this function sees (to verify that it
//             cannot be spoofed — see CLAUDE.md → «Аккаунты» → «Проверка IP»).
//   delete    { username, deleteMeasurements } + header Authorization: Bearer <user's access token>
//             → { ok: true } | { error: 'not_logged_in' | 'too_many_attempts' | 'reauth_required'
//             | 'username_mismatch' | 'owner_cannot_delete' | 'no_username' }
//             "Delete my account" (migration 014). Only the logged-in user, only themselves; the
//             session must have signed in within REAUTH_MAX_AGE_MINUTES (shared school computers).
//             All their files in Storage are removed before the auth user (016); if that fails
//             → { error: 'storage_failed' } and nothing else has happened that can't be repeated.
//   sweep     {} + header x-mitzpe-cron: <CRON_SECRET> → { ok, removed, left } | 401
//             Removes the files queued in private.storage_trash through the Storage API (the
//             database cannot delete Storage files itself). Called daily by pg_cron + pg_net
//             (supabase/SETUP_AUTH.md → 19). Without the CRON_SECRET secret it is disabled.
//
// Rate limits (table private.rate_limit_hits via rpc rate_limit_take; IPs stored only as HMAC):
//   signup: SIGNUP_LIMIT_PER_IP per hour per IP (default 30 — a whole class behind one school
//           NAT must fit) and SIGNUP_LIMIT_GLOBAL per hour in total (default 150; the IP cannot
//           help an attacker past this one even if it were spoofed).
//   login:  10 failed attempts per username per 15 min (IP-independent) + Supabase Auth's own
//           per-IP limit (the client IP is forwarded with Sb-Forwarded-For).
//   recover: 20 per IP and 3 per username per hour.
//   delete:  DELETE_LIMIT_PER_USER (default 10) per account and DELETE_LIMIT_PER_IP (default 30)
//            per IP per hour, every attempt counts.
// Limits are Edge Function secrets (Dashboard → Edge Functions → Secrets), no redeploy needed.
//
// Username rules are a copy of src/lib/username.js and public.username_error() in
// supabase/migrations/006_profiles_auth.sql — keep all three identical (same codes).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
// Sb-Forwarded-For only works with a secret key (sb_secret_…), not the legacy service_role key.
const SECRET_KEY = readKeyMap('SUPABASE_SECRET_KEYS') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const PLACEHOLDER_DOMAIN = Deno.env.get('PLACEHOLDER_EMAIL_DOMAIN') || 'noemail.mitzpe.invalid';
// Which request header carries the real client IP: 'auto' (default), 'cf-connecting-ip',
// 'x-real-ip', 'x-forwarded-for-last' or 'none'. Never the left-most X-Forwarded-For entry —
// the browser can put anything there.
const CLIENT_IP_HEADER = (Deno.env.get('CLIENT_IP_HEADER') || 'auto').toLowerCase();

const LIMITS = {
  signupPerIp: envInt('SIGNUP_LIMIT_PER_IP', 30),
  signupGlobal: envInt('SIGNUP_LIMIT_GLOBAL', 150),
  loginFailsPerUser: envInt('LOGIN_FAIL_LIMIT_PER_USER', 10),
  recoverPerIp: envInt('RECOVER_LIMIT_PER_IP', 20),
  recoverPerUser: envInt('RECOVER_LIMIT_PER_USER', 3),
  deletePerUser: envInt('DELETE_LIMIT_PER_USER', 10),
  deletePerIp: envInt('DELETE_LIMIT_PER_IP', 30),
  // "Delete my account" needs a sign-in (password or Google) at most this long ago.
  reauthMaxAgeMinutes: envInt('REAUTH_MAX_AGE_MINUTES', 15),
};
// Shared with the pg_cron job that calls `sweep` (stored in Vault on the database side).
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const HOUR = 3600;
const LOGIN_WINDOW = 15 * 60;

const admin = createClient(SUPABASE_URL, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function readKeyMap(name) {
  try {
    const map = JSON.parse(Deno.env.get(name) || '{}');
    return map.default || Object.values(map)[0] || null;
  } catch {
    return null;
  }
}

function envInt(name, fallback) {
  const n = Number.parseInt(Deno.env.get(name) || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

/* ------------------------------------------------------------ username rules */
// Copy of src/lib/username.js.

const LETTER = 'A-Za-zА-Яа-яЁёא-ת';
const RESERVED = new Set([
  'admin', 'administrator', 'owner', 'root', 'system', 'support', 'moderator', 'mitzpe',
  'מנהל', 'מנהלת', 'מנהל מערכת', 'מערכת', 'מצפה',
  'админ', 'администратор', 'модератор', 'владелец', 'система',
]);

function normalizeUsername(raw) {
  return String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

function usernameKey(name) {
  let out = '';
  for (const ch of name) out += /[A-ZА-ЯЁ]/.test(ch) ? ch.toLowerCase() : ch;
  return out;
}

function usernameError(name) {
  if (!name) return 'required';
  const length = [...name].length;
  if (length < 3) return 'too_short';
  if (length > 24) return 'too_long';
  if (!new RegExp(`^[0-9${LETTER} .]+$`).test(name)) return 'invalid_chars';
  if (!new RegExp(`^[0-9${LETTER}]`).test(name)) return 'bad_start';
  if (/[ .]\./.test(name)) return 'bad_dots';
  if (!new RegExp(`[${LETTER}]`).test(name)) return 'no_letter';
  if (/[A-Za-z]/.test(name) && /[А-Яа-яЁё]/.test(name)) return 'mixed_scripts';
  if (RESERVED.has(usernameKey(name))) return 'reserved';
  return null;
}

function passwordError(password) {
  if (typeof password !== 'string' || [...password].length < 8) return 'password_short';
  if (new TextEncoder().encode(password).length > 72) return 'password_long'; // bcrypt limit
  return null;
}

/* ------------------------------------------------------------------ client IP */

const PRIVATE_IP =
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|::ffff:(10|127|192\.168)\.|f[cd][0-9a-f]{2}:|fe80:)/i;
const IP_SHAPE = /^[0-9a-f:.]{3,45}$/i;

function header(req, name) {
  const v = (req.headers.get(name) || '').trim();
  return IP_SHAPE.test(v) ? v : null;
}

/**
 * The end-user IP as set by the platform, or null.
 * 'auto': CF-Connecting-IP (Cloudflare overwrites whatever the browser sends), then X-Real-IP.
 * Returning null is the safe failure: nothing is forwarded, everyone shares one bucket.
 */
function clientIp(req) {
  const xffLast = () => {
    const parts = (req.headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim());
    for (let i = parts.length - 1; i >= 0; i--) {
      if (IP_SHAPE.test(parts[i]) && !PRIVATE_IP.test(parts[i])) return parts[i];
    }
    return null;
  };
  switch (CLIENT_IP_HEADER) {
    case 'none':
      return { ip: null, source: 'none' };
    case 'cf-connecting-ip':
      return { ip: header(req, 'cf-connecting-ip'), source: 'cf-connecting-ip' };
    case 'x-real-ip':
      return { ip: header(req, 'x-real-ip'), source: 'x-real-ip' };
    case 'x-forwarded-for-last':
      return { ip: xffLast(), source: 'x-forwarded-for-last' };
    default: {
      const cf = header(req, 'cf-connecting-ip');
      if (cf) return { ip: cf, source: 'cf-connecting-ip' };
      const real = header(req, 'x-real-ip');
      if (real) return { ip: real, source: 'x-real-ip' };
      return { ip: null, source: 'none' };
    }
  }
}

async function hmac(value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function ipBucket(prefix, ip) {
  return `${prefix}:ip:${ip ? await hmac(ip) : 'unknown'}`;
}

async function take(bucket, max, windowSeconds, record = true) {
  const { data, error } = await admin.rpc('rate_limit_take', {
    p_bucket: bucket,
    p_max: max,
    p_window_seconds: windowSeconds,
    p_record: record,
  });
  if (error) throw error;
  return data === true;
}

/* --------------------------------------------------------------- auth calls */

function authHeaders(ip) {
  const h = { apikey: SECRET_KEY, 'Content-Type': 'application/json' };
  if (ip) h['Sb-Forwarded-For'] = ip;
  return h;
}

/** Password grant; returns { session } or { status } on failure. */
async function passwordGrant(email, password, ip) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: authHeaders(ip),
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    await res.body?.cancel();
    return { status: res.status };
  }
  const data = await res.json();
  // Only the tokens go back to the browser (it calls supabase.auth.setSession with them).
  return { session: { access_token: data.access_token, refresh_token: data.refresh_token } };
}

async function lookup(username) {
  const { data, error } = await admin.rpc('account_lookup', { p_username: username });
  if (error) throw error;
  return data?.[0] || null;
}

const isPlaceholder = (email) => !email || email.toLowerCase().endsWith(`@${PLACEHOLDER_DOMAIN}`);

/* ------------------------------------------------------------------ actions */

async function signup(req, body) {
  const username = normalizeUsername(body.username);
  const uErr = usernameError(username);
  if (uErr) return json({ error: 'invalid_username', detail: uErr });
  const pErr = passwordError(body.password);
  if (pErr) return json({ error: pErr });

  const { ip } = clientIp(req);
  if (!(await take(await ipBucket('signup', ip), LIMITS.signupPerIp, HOUR))) {
    return json({ error: 'too_many_attempts' });
  }
  if (!(await take('signup:global', LIMITS.signupGlobal, HOUR))) {
    return json({ error: 'too_many_attempts' });
  }

  const available = async () => {
    const { data, error } = await admin.rpc('username_available', { p_username: username });
    if (error) throw error;
    return data;
  };
  const before = await available();
  if (before === 'taken') return json({ error: 'username_taken' });
  if (before !== 'available') return json({ error: 'invalid_username', detail: before });

  const email = `${crypto.randomUUID()}@${PLACEHOLDER_DOMAIN}`;
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password: body.password,
    email_confirm: true,
    user_metadata: { mitzpe_username: username },
  });
  if (createError) {
    if ((await available()) === 'taken') return json({ error: 'username_taken' });
    if (createError.code === 'weak_password') return json({ error: 'password_short' });
    console.error('[account] createUser failed', createError.code, createError.message);
    return json({ error: 'signup_failed' });
  }

  const result = await passwordGrant(email, body.password, ip);
  if (!result.session) return json({ error: 'signup_login_failed' });
  return json({ session: result.session });
}

async function login(req, body) {
  const username = normalizeUsername(body.username);
  if (usernameError(username) || typeof body.password !== 'string' || !body.password) {
    return json({ error: 'invalid_credentials' });
  }
  const bucket = `login:user:${usernameKey(username)}`;
  if (!(await take(bucket, LIMITS.loginFailsPerUser, LOGIN_WINDOW, false))) {
    return json({ error: 'too_many_attempts' });
  }

  const { ip } = clientIp(req);
  const account = await lookup(username);
  // Unknown user and wrong password look the same. Google-only accounts have no password.
  const result = account?.email ? await passwordGrant(account.email, body.password, ip) : { status: 400 };
  if (result.session) return json({ session: result.session });

  if (result.status === 429) return json({ error: 'too_many_attempts' });
  await take(bucket, LIMITS.loginFailsPerUser, LOGIN_WINDOW, true);
  return json({ error: 'invalid_credentials' });
}

async function sendReset(req, username, redirectTo) {
  const { ip } = clientIp(req);
  if (!(await take(await ipBucket('recover', ip), LIMITS.recoverPerIp, HOUR))) return;
  if (!(await take(`recover:user:${usernameKey(username)}`, LIMITS.recoverPerUser, HOUR))) return;
  const account = await lookup(username);
  if (!account || !account.email_confirmed || isPlaceholder(account.email)) return;
  const url = new URL(`${SUPABASE_URL}/auth/v1/recover`);
  if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(ip),
    body: JSON.stringify({ email: account.email }),
  });
  if (!res.ok) console.warn('[account] recover failed', res.status);
  await res.body?.cancel();
}

function recover(req, body) {
  const username = normalizeUsername(body.username);
  const redirectTo =
    typeof body.redirectTo === 'string' && /^https?:\/\//.test(body.redirectTo) ? body.redirectTo : null;
  if (!usernameError(username)) {
    const work = sendReset(req, username, redirectTo).catch((err) =>
      console.error('[account] recover error', err?.message),
    );
    // Answer first; the email (if any) is sent after the response.
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
  }
  return json({ ok: true });
}

/* ------------------------------------------------------------ delete account */

function bearer(req) {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '');
  return m ? m[1] : null;
}

/**
 * When THIS session signed in (ms), from the access token's `amr` claim — it keeps the time of
 * the password / Google sign-in across token refreshes, and belongs to this session only, so a
 * fresh sign-in on another device does not make an old session on a shared computer "recent".
 * The token has already been verified by auth.getUser. Falls back to the user's last_sign_in_at.
 */
function sessionSignedInAt(token, user) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')));
    const times = (Array.isArray(claims.amr) ? claims.amr : [])
      .map((a) => Number(a?.timestamp))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (times.length) return Math.max(...times) * 1000;
  } catch {
    // fall through
  }
  const last = Date.parse(user.last_sign_in_at || '');
  return Number.isFinite(last) ? last : null;
}

const DELETE_ERRORS = new Set(['username_mismatch', 'owner_cannot_delete', 'no_username']);

/* ------------------------------------------------------------ storage files */

/** Removes [{bucket, path}] through the Storage API (secret key), 100 per request. */
async function removeFiles(list) {
  const byBucket = new Map();
  for (const f of list || []) {
    if (!f?.bucket || !f?.path) continue;
    if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, []);
    byBucket.get(f.bucket).push(f.path);
  }
  for (const [bucket, paths] of byBucket) {
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) console.error('[account] storage remove failed', bucket, error.message);
    }
  }
}

async function accountFiles(userId) {
  const { data, error } = await admin.rpc('account_storage_objects', { p_user: userId });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function sweep(req) {
  if (!CRON_SECRET || !sameSecret(req.headers.get('x-mitzpe-cron') || '', CRON_SECRET)) {
    return json({ error: 'not_allowed' }, 401);
  }
  let removed = 0;
  let left = 0;
  // A few rounds: each call forgets files that are gone and hands out the next batch.
  for (let round = 0; round < 4; round++) {
    const { data, error } = await admin.rpc('storage_sweep', { p_limit: 500 });
    if (error) throw error;
    removed += data?.done || 0;
    const pending = data?.pending || [];
    left = pending.length;
    if (!pending.length) break;
    await removeFiles(pending);
  }
  return json({ ok: true, removed, left });
}

async function deleteAccount(req, body) {
  const token = bearer(req);
  if (!token) return json({ error: 'not_logged_in' });
  const { data: got, error: userError } = await admin.auth.getUser(token);
  const user = got?.user;
  if (userError || !user) return json({ error: 'not_logged_in' });

  const { ip } = clientIp(req);
  if (!(await take(await ipBucket('delete', ip), LIMITS.deletePerIp, HOUR))) {
    return json({ error: 'too_many_attempts' });
  }
  if (!(await take(`delete:user:${user.id}`, LIMITS.deletePerUser, HOUR))) {
    return json({ error: 'too_many_attempts' });
  }

  const signedInAt = sessionSignedInAt(token, user);
  if (!signedInAt || Date.now() - signedInAt > LIMITS.reauthMaxAgeMinutes * 60 * 1000) {
    return json({ error: 'reauth_required' });
  }

  const deleteMeasurements = body.deleteMeasurements === true;
  const { data: prep, error: prepError } = await admin.rpc('account_delete_prepare', {
    p_user: user.id,
    p_username: normalizeUsername(body.username),
    p_delete_measurements: deleteMeasurements,
  });
  if (prepError) {
    if (DELETE_ERRORS.has(prepError.message)) return json({ error: prepError.message });
    throw prepError;
  }

  // Files (016): always deleted, also when the measurements are kept. Before the auth user, so a
  // failure leaves an account the user can simply delete again.
  const files = await accountFiles(user.id);
  if (files.length) {
    await removeFiles(files);
    if ((await accountFiles(user.id)).length) return json({ error: 'storage_failed' });
  }

  // Everything above is safe to repeat, so if this fails the user just tries again.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) throw deleteError;

  const { error: finishError } = await admin.rpc('account_delete_finish', {
    p_user: user.id,
    p_anon: prep.anon_id,
    p_delete_measurements: deleteMeasurements,
  });
  // The account is gone already; leftovers go with the 30-day cleanup (008).
  if (finishError) console.error('[account] delete finish failed', finishError.message);
  return json({ ok: true });
}

function clientIpInfo(req) {
  const chosen = clientIp(req);
  return json({
    ...chosen,
    mode: CLIENT_IP_HEADER,
    seen: {
      'cf-connecting-ip': req.headers.get('cf-connecting-ip'),
      'x-real-ip': req.headers.get('x-real-ip'),
      'x-forwarded-for': req.headers.get('x-forwarded-for'),
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  try {
    switch (body?.action) {
      case 'signup':
        return await signup(req, body);
      case 'login':
        return await login(req, body);
      case 'recover':
        return recover(req, body);
      case 'client-ip':
        return clientIpInfo(req);
      case 'delete':
        return await deleteAccount(req, body);
      case 'sweep':
        return await sweep(req);
      default:
        return json({ error: 'bad_request' }, 400);
    }
  } catch (err) {
    console.error('[account] failed', err?.message || err);
    return json({ error: 'server_error' }, 500);
  }
});
