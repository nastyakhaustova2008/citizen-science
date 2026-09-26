// Deno globals for the Edge Function `account` under Node (tests only). Imported before the function.
const ENV = {
  SUPABASE_URL: 'https://project.test',
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_test' }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_test' }),
};
export const served = { handler: null };
globalThis.Deno = {
  env: { get: (k) => ENV[k] },
  serve: (handler) => {
    served.handler = handler;
  },
};
