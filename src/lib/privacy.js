/**
 * The privacy policy is a static page (public/privacy.html): it must load without JavaScript
 * (Google OAuth review). Sections per language: #he, #en, #ru.
 */
export function privacyUrl(locale) {
  return `${import.meta.env.BASE_URL}privacy.html#${locale}`;
}
