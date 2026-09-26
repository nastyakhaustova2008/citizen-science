import { useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import { Menu, X, Moon, Sun, Languages, Telescope, LogIn, LogOut } from 'lucide-react';
import { useI18n } from '../i18n';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './primitives';
import { useAppData } from '../context/AppDataContext';

/** Number of labs waiting for my review (admins), on the profile links. */
function ReviewBadge({ count }) {
  const { t } = useI18n();
  if (!count) return null;
  return (
    <span className="tnum rounded-full bg-bark px-1.5 text-xs font-semibold text-paper-raised" title={t('admin.todoBadge', { count })}>
      {count}
      <span className="sr-only"> {t('admin.todoBadge', { count })}</span>
    </span>
  );
}

function LanguageMenu() {
  const { locale, setLocale, locales, t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        className="btn-ghost px-2.5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('a11y.langSelect')}
        onClick={() => setOpen((o) => !o)}
      >
        <Languages className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase">{locale}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
          <ul
            role="menu"
            className="surface absolute end-0 z-50 mt-1 w-36 overflow-hidden p-1 text-sm"
          >
            {Object.entries(locales).map(([code, meta]) => (
              <li key={code} role="none">
                <button
                  role="menuitemradio"
                  aria-checked={code === locale}
                  className={`w-full rounded px-3 py-2 text-start transition hover:bg-paper-sunk dark:hover:bg-white/5 ${
                    code === locale ? 'font-semibold text-ink dark:text-paper' : 'text-ink-faint'
                  }`}
                  onClick={() => {
                    setLocale(code);
                    setOpen(false);
                  }}
                >
                  {meta.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  const { t } = useI18n();
  return (
    <button
      type="button"
      className="btn-ghost px-2.5"
      onClick={toggle}
      aria-label={t('a11y.themeToggle')}
      title={t('nav.toggleTheme')}
    >
      {isDark ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
    </button>
  );
}

const navItemClass = ({ isActive }) =>
  `rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive
      ? 'bg-paper-sunk text-ink dark:bg-white/10 dark:text-paper'
      : 'text-ink-faint hover:text-ink dark:hover:text-paper'
  }`;

export default function Header() {
  const { t } = useI18n();
  const { currentUser, session, authLoading, logOut, sharedSession } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Labs to review + reported comments + link domain proposals waiting for this admin.
  const { adminTodoCount } = useAppData();
  const location = useLocation();
  const loggedIn = Boolean(session);
  const onAuthPage = ['/login', '/signup'].includes(location.pathname);
  // Come back to the current page after logging in (not to the login page itself).
  const next = onAuthPage ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;

  const links = [
    { to: '/', label: t('nav.home'), end: true },
    ...(loggedIn ? [{ to: '/profile', label: t('nav.profile'), badge: adminTodoCount }] : []),
  ];

  return (
    <header className="sticky top-0 z-30 border-b border-edge bg-paper/85 backdrop-blur dark:border-white/10 dark:bg-char/85">
      <div className="mx-auto flex max-w-content items-center gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5 text-ink dark:text-paper">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-ink text-paper dark:bg-moss dark:text-char">
            <Telescope className="h-5 w-5" aria-hidden="true" strokeWidth={1.75} />
          </span>
          <span className="leading-tight">
            <span className="block font-serif text-base font-bold">{t('app.name')}</span>
            <span className="hidden text-xs text-ink-faint sm:block">{t('app.tagline')}</span>
          </span>
        </Link>

        <nav className="mx-auto hidden items-center gap-1 md:flex" aria-label={t('nav.menu')}>
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={navItemClass}>
              {l.label}
              {l.badge ? <span className="ms-1.5"><ReviewBadge count={l.badge} /></span> : null}
            </NavLink>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1 md:ms-0">
          <LanguageMenu />
          <ThemeToggle />
          {!authLoading && loggedIn && currentUser && (
            <Link
              to="/profile"
              className="ms-1 hidden items-center gap-2 rounded-lg px-1.5 py-1 text-sm font-semibold text-ink hover:bg-paper-sunk sm:flex dark:text-paper dark:hover:bg-white/5"
              aria-label={t('nav.profile')}
            >
              <Avatar user={currentUser} size={32} />
              <span className="max-w-[12rem] truncate" dir="auto">
                {currentUser.displayName}
              </span>
              <ReviewBadge count={adminTodoCount} />
            </Link>
          )}
          {!authLoading && loggedIn && (
            <button
              type="button"
              className="btn-ghost hidden px-2 sm:inline-flex"
              onClick={() => logOut()}
              title={t('auth.logout')}
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {/* On a shared computer the word is shown too, so nobody has to look for it. */}
              <span className={sharedSession ? '' : 'sr-only'}>{t('auth.logout')}</span>
            </button>
          )}
          {!authLoading && !loggedIn && (
            <div className="ms-1 hidden items-center gap-1 sm:flex">
              <Link to={`/login${next}`} className="btn-ghost">
                <LogIn className="h-4 w-4" aria-hidden="true" />
                {t('auth.login')}
              </Link>
              <Link to={`/signup${next}`} className="btn-primary">
                {t('auth.signup')}
              </Link>
            </div>
          )}
          <button
            type="button"
            className="btn-ghost relative px-2 md:hidden"
            aria-label={adminTodoCount ? `${t('nav.menu')} — ${t('admin.todoBadge', { count: adminTodoCount })}` : t('nav.menu')}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            {!mobileOpen && adminTodoCount > 0 && (
              <span className="absolute end-1 top-1 h-2 w-2 rounded-full bg-bark" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav
          className="border-t border-edge px-4 py-2 md:hidden dark:border-white/10"
          aria-label={t('nav.menu')}
        >
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2.5 text-sm font-semibold ${
                  isActive ? 'bg-paper-sunk dark:bg-white/10' : 'text-ink-faint'
                }`
              }
            >
              {l.label}
              {l.badge ? <span className="ms-1.5"><ReviewBadge count={l.badge} /></span> : null}
            </NavLink>
          ))}
          <div className="mt-1 border-t border-edge pt-2 dark:border-white/10">
            {loggedIn ? (
              <>
                {currentUser && (
                  <p className="flex items-center gap-2 px-3 py-2 text-sm font-semibold" dir="auto">
                    <Avatar user={currentUser} size={24} />
                    {currentUser.displayName}
                  </p>
                )}
                <button
                  type="button"
                  className="block w-full rounded-lg px-3 py-2.5 text-start text-sm font-semibold text-ink-faint"
                  onClick={() => {
                    setMobileOpen(false);
                    logOut();
                  }}
                >
                  {t('auth.logout')}
                </button>
                {sharedSession && <p className="px-3 pb-2 text-xs text-ink-faint">{t('auth.shared.reminder')}</p>}
              </>
            ) : (
              <>
                <Link
                  to={`/login${next}`}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-faint"
                >
                  {t('auth.login')}
                </Link>
                <Link
                  to={`/signup${next}`}
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-ink-faint"
                >
                  {t('auth.signup')}
                </Link>
              </>
            )}
          </div>
        </nav>
      )}
    </header>
  );
}
