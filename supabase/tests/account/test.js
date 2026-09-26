// Edge Function `account` — H6 actions (change-password / change-email) and what must stay as it was
// (login rate limit, delete re-auth). Runs the real supabase/functions/account/index.ts under Node
// with stand-ins for Deno and supabase-js (supabase-stub.js) and a fake Supabase Auth (fetch).
// Built and run by supabase/tests/run.sh. Prints PASS / FAIL per check; exit code 1 on a failure.
import { served } from './deno-env.js';
import { state } from './supabase-stub.js';
import '../../functions/account/index.ts';

const results = [];
const check = (name, ok, got) => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'} account: ${name}${ok || got === undefined ? '' : `  [${JSON.stringify(got)}]`}`);
};

const MIN = 60 * 1000;
function token(sub, { method = 'password', agoMs = 0, amr = true } = {}) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const payload = { sub, role: 'authenticated' };
  if (amr) payload.amr = [{ method, timestamp: Math.floor((Date.now() - agoMs) / 1000) }];
  return `${b({ alg: 'HS256' })}.${b(payload)}.sig-${Math.random().toString(36).slice(2)}`;
}

// Fake Supabase Auth: password grant (login) and PUT /user (change-email).
const PASSWORDS = new Map([['kid@noemail.mitzpe.invalid', 'right-password']]);
const fetchLog = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  fetchLog.push({ path: u.pathname, url: String(url), method: init.method, headers: init.headers, body: init.body });
  if (u.pathname === '/auth/v1/recover') return new Response('{}', { status: 200 });
  if (u.pathname === '/auth/v1/token') {
    const { email, password } = JSON.parse(init.body);
    if (PASSWORDS.get(email) === password || (email.endsWith('@noemail.mitzpe.invalid') && password === 'signup-password')) {
      return new Response(JSON.stringify({ access_token: token('u1'), refresh_token: 'r' }), { status: 200 });
    }
    return new Response(JSON.stringify({ error_code: 'invalid_credentials' }), { status: 400 });
  }
  if (u.pathname === '/auth/v1/user' && init.method === 'PUT') {
    const { email } = JSON.parse(init.body);
    if (email === 'taken@example.com') return new Response(JSON.stringify({ error_code: 'email_exists' }), { status: 422 });
    return new Response(JSON.stringify({ id: 'u1' }), { status: 200 });
  }
  return new Response('{}', { status: 404 });
};

async function call(body, bearer) {
  const headers = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await served.handler(new Request('https://fn.test/account', { method: 'POST', headers, body: JSON.stringify(body) }));
  return res.json();
}
const reset = () => {
  state.calls.length = 0;
  fetchLog.length = 0;
  state.buckets.clear();
  state.ticketMissing = false;
  state.taken.clear();
  state.signupUsername = 'ok';
};
const names = () => state.calls.map((c) => c.what).filter((w) => w !== 'rpc:rate_limit_take');

state.users.set('u1', { id: 'u1', username: 'kid', email: 'kid@noemail.mitzpe.invalid', last_sign_in_at: new Date().toISOString() });
state.users.set('g1', { id: 'g1', username: 'gkid', email: 'g@gmail.test', last_sign_in_at: new Date().toISOString() });

// ---- change-password -------------------------------------------------------------------------
reset();
check('change-password without a token → not_logged_in', (await call({ action: 'change-password', password: 'new-password-1' })).error === 'not_logged_in');

reset();
let r = await call({ action: 'change-password', password: 'new-password-1' }, token('u1', { agoMs: 20 * MIN }));
check('change-password, session signed in 20 min ago → reauth_required', r.error === 'reauth_required', r);
check('… and nothing was changed (no ticket, no update)', !names().includes('updateUserById') && !names().includes('rpc:account_change_ticket'), names());

reset();
r = await call({ action: 'change-password', password: 'short' }, token('u1'));
check('change-password: too short → password_short', r.error === 'password_short', r);

// Re-entering the current password = the existing `login` action: wrong ones are counted.
reset();
let codes = [];
for (let i = 0; i < 11; i++) codes.push((await call({ action: 'login', username: 'kid', password: `wrong-${i}` })).error);
check('re-auth with a wrong password: 10 × invalid_credentials, then too_many_attempts',
  codes.slice(0, 10).every((c) => c === 'invalid_credentials') && codes[10] === 'too_many_attempts', codes);
check('… even the right password is refused while the limit holds',
  (await call({ action: 'login', username: 'kid', password: 'right-password' })).error === 'too_many_attempts');

reset();
r = await call({ action: 'login', username: 'kid', password: 'right-password' });
check('re-auth with the right password → a new session (fresh sign-in time)', Boolean(r.session?.access_token), r);
const fresh = r.session.access_token;
state.calls.length = 0;
r = await call({ action: 'change-password', password: 'new-password-1' }, fresh);
check('change-password right after re-auth → ok', r.ok === true, r);
check('order: ticket → admin update → sign out other sessions',
  JSON.stringify(names()) === JSON.stringify(['rpc:account_change_ticket', 'updateUserById', 'signOut']), names());
const ticketCall = state.calls.find((c) => c.what === 'rpc:account_change_ticket');
check('the ticket carries no password (user + kind only)',
  ticketCall.args.p_kind === 'password' && ticketCall.args.p_user === 'u1' && ticketCall.args.p_email === null
  && !JSON.stringify(ticketCall.args).includes('new-password-1'), ticketCall.args);
check('other sessions: scope "others" with this session\'s token',
  state.calls.some((c) => c.what === 'signOut' && c.scope === 'others' && c.token === fresh));

reset();
r = await call({ action: 'change-password', password: 'new-password-2' }, token('g1', { method: 'oauth', agoMs: 2 * MIN }));
check('Google user, re-signed in with Google 2 min ago → ok', r.ok === true, r);
reset();
r = await call({ action: 'change-password', password: 'new-password-2' }, token('g1', { method: 'oauth', agoMs: 30 * MIN }));
check('Google user, Google sign-in 30 min ago → reauth_required', r.error === 'reauth_required', r);

reset();
r = await call({ action: 'change-password', password: 'new-password-3' }, token('u1', { method: 'recovery', agoMs: 1 * MIN }));
check('password-reset link (recovery sign-in 1 min ago) → ok', r.ok === true, r);

reset();
state.ticketMissing = true;
r = await call({ action: 'change-password', password: 'new-password-4' }, token('u1'));
check('before migration 021 (no ticket function) → still ok', r.ok === true && names().includes('updateUserById'), r);

reset();
state.users.get('u1').last_sign_in_at = new Date(Date.now() - 40 * MIN).toISOString();
r = await call({ action: 'change-password', password: 'new-password-5' }, token('u1', { amr: false }));
check('token without amr, last sign-in 40 min ago → reauth_required', r.error === 'reauth_required', r);
state.users.get('u1').last_sign_in_at = new Date().toISOString();

reset();
codes = [];
for (let i = 0; i < 11; i++) codes.push((await call({ action: 'change-password', password: 'new-password-6' }, token('u1'))).error || 'ok');
check('change limit: 10 per hour, then too_many_attempts', codes[9] === 'ok' && codes[10] === 'too_many_attempts', codes);

// ---- change-email ----------------------------------------------------------------------------
reset();
r = await call({ action: 'change-email', email: 'not-an-email' }, token('u1'));
check('change-email: invalid address → email_invalid', r.error === 'email_invalid', r);
r = await call({ action: 'change-email', email: 'x@noemail.mitzpe.invalid' }, token('u1'));
check('change-email: internal placeholder domain → email_invalid', r.error === 'email_invalid', r);

reset();
r = await call({ action: 'change-email', email: 'kid@example.com' }, token('u1', { agoMs: 16 * MIN }));
check('change-email, sign-in 16 min ago → reauth_required, Supabase Auth not called',
  r.error === 'reauth_required' && !fetchLog.some((f) => f.path === '/auth/v1/user'), r);

reset();
const t = token('u1');
r = await call({ action: 'change-email', email: ' kid@example.com ', redirectTo: 'https://app.test/' }, t);
const put = fetchLog.find((f) => f.path === '/auth/v1/user');
const tk = state.calls.find((c) => c.what === 'rpc:account_change_ticket');
check('change-email → ok: ticket for exactly this address, then PUT /user as the user',
  r.ok === true && tk.args.p_kind === 'email' && tk.args.p_email === 'kid@example.com'
  && put.method === 'PUT' && put.headers.Authorization === `Bearer ${t}` && JSON.parse(put.body).email === 'kid@example.com'
  && state.calls.indexOf(tk) >= 0, { r, tk: tk?.args, put });
check('change-email uses the publishable key (never the secret key) for the user call',
  put.headers.apikey === 'sb_publishable_test');

reset();
r = await call({ action: 'change-email', email: 'taken@example.com' }, token('u1'));
check('change-email: address used by another account → email_in_use', r.error === 'email_in_use', r);

// ---- delete: unchanged -----------------------------------------------------------------------
reset();
r = await call({ action: 'delete', username: 'kid', deleteMeasurements: false }, token('u1', { agoMs: 20 * MIN }));
check('delete: sign-in 20 min ago → reauth_required (as before)', r.error === 'reauth_required' && !names().includes('deleteUser'), r);
reset();
r = await call({ action: 'delete', username: 'kid', deleteMeasurements: false }, token('u1'));
check('delete: recent sign-in → ok (as before)', r.ok === true && names().includes('deleteUser'), r);

// ---- recover: unchanged answer ---------------------------------------------------------------
reset();
r = await call({ action: 'recover', username: 'kid', redirectTo: 'https://app.test/' });
check('recover: always { ok: true } (no hint whether the account has an email)', r.ok === true && !r.error, r);


// ---- H1: redirectTo only to production / localhost -----------------------------------------------
state.users.set('m1', { id: 'm1', username: 'mailkid', email: 'mailkid@example.com', last_sign_in_at: new Date().toISOString() });
const tick = () => new Promise((res) => setTimeout(res, 30));
async function recoverRedirect(redirectTo) {
  reset();
  await call({ action: 'recover', username: 'mailkid', redirectTo });
  await tick();
  const f = fetchLog.find((x) => x.path === '/auth/v1/recover');
  return f ? new URL(f.url).searchParams.get('redirect_to') : 'NOT CALLED';
}
check('recover: production URL is passed on',
  (await recoverRedirect('https://citizen-science-liart.vercel.app/')) === 'https://citizen-science-liart.vercel.app/');
check('recover: localhost:5173 is passed on',
  (await recoverRedirect('http://localhost:5173/')) === 'http://localhost:5173/');
for (const [what, url] of [
  ['a Vercel preview', 'https://citizen-science-git-x-team.vercel.app/'],
  ['another site', 'https://evil.example/'],
  ['a look-alike host', 'https://citizen-science-liart.vercel.app.evil.example/'],
  ['user:password@', 'https://x:y@citizen-science-liart.vercel.app/'],
  ['a #fragment', 'https://citizen-science-liart.vercel.app/#/auth/confirm'],
  ['another port on localhost', 'http://localhost:8080/'],
  ['javascript:', 'javascript:alert(1)'],
  ['not a string', 42],
]) {
  check(`recover: ${what} → dropped (Site URL)`, (await recoverRedirect(url)) === null);
}
reset();
await call({ action: 'change-email', email: 'kid2@example.com', redirectTo: 'https://evil.example/' }, token('u1'));
check('change-email: foreign redirectTo is not sent to Supabase Auth',
  !new URL(fetchLog.find((f) => f.path === '/auth/v1/user').url).searchParams.has('redirect_to'));
reset();
await call({ action: 'change-email', email: 'kid2@example.com', redirectTo: 'https://citizen-science-liart.vercel.app/' }, token('u1'));
check('change-email: production redirectTo is sent',
  new URL(fetchLog.find((f) => f.path === '/auth/v1/user').url).searchParams.get('redirect_to') === 'https://citizen-science-liart.vercel.app/');

// ---- M3: someone else's wrong passwords don't lock the student out ---------------------------------
const loginFrom = async (ip, password) => {
  const res = await served.handler(new Request('https://fn.test/account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify({ action: 'login', username: 'kid', password }),
  }));
  return res.json();
};
reset();
codes = [];
for (let i = 0; i < 12; i++) codes.push((await loginFrom('203.0.113.7', `wrong-${i}`)).error);
check('M3: attacker (one IP): 10 wrong, then too_many_attempts for that IP',
  codes.slice(0, 10).every((c) => c === 'invalid_credentials') && codes[10] === 'too_many_attempts', codes);
r = await loginFrom('198.51.100.20', 'right-password');
check('M3: the student from another network still signs in', Boolean(r.session), r);
check('M3: buckets store only a hash of the IP',
  [...state.buckets.keys()].every((b) => !b.includes('203.0.113.7')), [...state.buckets.keys()]);
check('M3: the right password does not count as a failure',
  (state.buckets.get('login:user:kid') || 0) === 10, state.buckets.get('login:user:kid'));
reset();
for (let i = 0; i < 100; i++) await loginFrom(`203.0.113.${(i % 50) + 1}`, `wrong-${i}`);
r = await loginFrom('198.51.100.20', 'right-password');
check('M3: 100 wrong passwords from many IPs in an hour → per-username cap holds',
  r.error === 'too_many_attempts', r);

// ---- M9: sign-up mark and safety net -------------------------------------------------------------
reset();
r = await call({ action: 'signup', username: 'New Kid', password: 'signup-password' });
const create = state.calls.find((c) => c.what === 'createUser');
check('signup: account created with app_metadata.mitzpe_signup = true',
  Boolean(r.session) && create?.attrs.app_metadata?.mitzpe_signup === true && create.attrs.user_metadata.mitzpe_username === 'New Kid',
  { r, attrs: create?.attrs });
check('signup: safety net called for the new account',
  state.calls.some((c) => c.what === 'rpc:account_signup_username' && c.args.p_user === 'new-user-1' && c.args.p_username === 'New Kid'));
reset();
state.signupUsername = 'taken';
r = await call({ action: 'signup', username: 'New Kid', password: 'signup-password' });
check('signup: name taken meanwhile → username_taken, only the just-created account deleted, no session',
  r.error === 'username_taken' && !r.session
  && JSON.stringify(state.calls.filter((c) => c.what === 'deleteUser').map((c) => c.id)) === '["new-user-1"]', { r, calls: names() });
reset();
state.signupUsername = 'not_allowed';
r = await call({ action: 'signup', username: 'New Kid', password: 'signup-password' });
check('signup: safety net says not_allowed → nothing deleted', Boolean(r.session) && !names().includes('deleteUser'), r);
reset();
state.signupUsername = 'missing';
r = await call({ action: 'signup', username: 'New Kid', password: 'signup-password' });
check('signup before migration 022 (no safety-net function) → still ok', Boolean(r.session) && !names().includes('deleteUser'), r);

// ---- username-check (022: the browser's way to ask) --------------------------------------------------
reset();
state.taken.add('kid');
check('username-check: free name → available', (await call({ action: 'username-check', username: 'Brand New' })).status === 'available');
check('username-check: taken name → taken', (await call({ action: 'username-check', username: 'Kid' })).status === 'taken');
check('username-check: invalid name → its validation code, no database call',
  (await call({ action: 'username-check', username: 'ab' })).status === 'too_short'
  && state.calls.filter((c) => c.what === 'rpc:username_available').length === 2);
reset();
const checkFrom = async (ip) => (await (await served.handler(new Request('https://fn.test/account', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
  body: JSON.stringify({ action: 'username-check', username: 'Brand New' }),
}))).json()).status;
const statuses = [];
for (let i = 0; i < 301; i++) statuses.push(await checkFrom('203.0.113.9'));
check('username-check: 300 per IP per 10 min, then unknown (no hint, sign-up still checks)',
  statuses.slice(0, 300).every((x) => x === 'available') && statuses[300] === 'unknown', statuses.slice(298));
check('username-check: another IP (another school) is not affected', (await checkFrom('198.51.100.30')) === 'available');

const failed = results.filter((x) => !x).length;
console.log(`account (Edge Function): ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
