// Browser stand-ins for the app's code under Node (imported FIRST by api.js): since 021 the app
// keeps the Supabase session in window.localStorage / sessionStorage (src/lib/session.js). Without
// them the session is silently not stored and every "logged-in" query went out as anon.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  get length() { return this.map.size; }
  key(i) { return [...this.map.keys()][i] ?? null; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}
if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    location: { origin: 'http://localhost', pathname: '/', hash: '', reload() {} },
    addEventListener() {},
    removeEventListener() {},
  };
}
