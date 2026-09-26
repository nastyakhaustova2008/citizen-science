// Stand-in for npm:@supabase/supabase-js@2 inside the Edge Function `account` (tests only).
// Records every call in `state.calls`; behaviour is set per test through `state`.
export const state = {
  calls: [],
  users: new Map(), // id → { id, last_sign_in_at }
  revoked: new Set(), // access tokens whose session was signed out
  buckets: new Map(), // rate_limit_take: bucket → hits
  ticketMissing: false, // simulate "before migration 021" (PGRST202)
  taken: new Set(), // username_available → 'taken' for these
  signupUsername: 'ok', // answer of account_signup_username, or 'missing' (before 022)
};

function decode(token) {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString());
  } catch {
    return null;
  }
}

export function createClient() {
  return {
    rpc: async (name, args) => {
      state.calls.push({ what: `rpc:${name}`, args });
      if (name === 'rate_limit_take') {
        const n = state.buckets.get(args.p_bucket) || 0;
        if (n >= args.p_max) return { data: false, error: null };
        if (args.p_record) state.buckets.set(args.p_bucket, n + 1);
        return { data: true, error: null };
      }
      if (name === 'account_change_ticket') {
        if (state.ticketMissing) {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.account_change_ticket' } };
        }
        return { data: null, error: null };
      }
      if (name === 'account_lookup') {
        const u = [...state.users.values()].find((x) => x.username === args.p_username);
        return { data: u ? [{ user_id: u.id, email: u.email, email_confirmed: true }] : [], error: null };
      }
      if (name === 'username_available') {
        return { data: state.taken.has(args.p_username.toLowerCase()) ? 'taken' : 'available', error: null };
      }
      if (name === 'account_signup_username') {
        if (state.signupUsername === 'missing') {
          return { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.account_signup_username' } };
        }
        return { data: state.signupUsername, error: null };
      }
      if (name === 'account_delete_prepare') return { data: { anon_id: 'anon' }, error: null };
      if (name === 'account_storage_objects') return { data: [], error: null };
      if (name === 'account_delete_finish') return { data: {}, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    auth: {
      getUser: async (token) => {
        const claims = decode(token);
        const user = claims && state.users.get(claims.sub);
        if (!user || state.revoked.has(token)) return { data: { user: null }, error: { status: 401 } };
        return { data: { user }, error: null };
      },
      admin: {
        updateUserById: async (id, attrs) => {
          state.calls.push({ what: 'updateUserById', id, attrs });
          return { data: { user: state.users.get(id) }, error: null };
        },
        signOut: async (token, scope) => {
          state.calls.push({ what: 'signOut', token, scope });
          return { data: null, error: null };
        },
        deleteUser: async (id) => {
          state.calls.push({ what: 'deleteUser', id });
          return { data: null, error: null };
        },
        createUser: async (attrs) => {
          state.calls.push({ what: 'createUser', attrs });
          return { data: { user: { id: 'new-user-1', app_metadata: attrs.app_metadata } }, error: null };
        },
      },
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
  };
}
