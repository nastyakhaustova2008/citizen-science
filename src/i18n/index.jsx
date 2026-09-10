import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { STRINGS, LOCALES, DEFAULT_LOCALE } from './strings';

const STORAGE_KEY = 'mitzpe.locale';

const I18nContext = createContext(null);

/** Resolve a dot path ("map.panel.value") against an object. */
function resolve(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
}

/** Replace {placeholders} in a template string. */
function interpolate(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match,
  );
}

function readInitialLocale() {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES[stored]) return stored;
  } catch {
    /* ignore */
  }
  return DEFAULT_LOCALE;
}

export function I18nProvider({ children }) {
  const [locale, setLocale] = useState(readInitialLocale);

  useEffect(() => {
    const meta = LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE];
    const root = document.documentElement;
    root.setAttribute('lang', meta.htmlLang);
    root.setAttribute('dir', meta.dir);
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
  }, [locale]);

  const t = useCallback(
    (key, vars) => {
      const dict = STRINGS[locale] ?? STRINGS[DEFAULT_LOCALE];
      let value = resolve(dict, key);
      if (value == null && locale !== DEFAULT_LOCALE) {
        value = resolve(STRINGS[DEFAULT_LOCALE], key);
      }
      if (value == null) {
        if (import.meta.env.DEV) console.warn(`[i18n] missing key: ${key}`);
        return key;
      }
      return typeof value === 'string' ? interpolate(value, vars) : value;
    },
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      dir: (LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE]).dir,
      isRTL: (LOCALES[locale] ?? LOCALES[DEFAULT_LOCALE]).dir === 'rtl',
      locales: LOCALES,
      t,
    }),
    [locale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within <I18nProvider>');
  return ctx;
}

/** Convenience hook when only the translate fn is needed. */
export function useT() {
  return useI18n().t;
}
