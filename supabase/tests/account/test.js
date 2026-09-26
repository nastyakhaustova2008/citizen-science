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
  fetchLog.push({ path: u.pathname, method: init.method, headers: init.headers, body: init.body });
  if (u.pathname === '/auth/v1/token') {
    const { email, password } = JSON.parse(init.body);
    if (PASSWORDS.get(email) === password) {
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

const failed = results.filter((x) => !x).length;
console.log(`account (Edge Function): ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
