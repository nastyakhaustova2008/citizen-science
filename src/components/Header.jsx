import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Menu, X, Moon, Sun, Languages, Telescope } from 'lucide-react';
import { useI18n } from '../i18n';
import { useTheme } from '../context/ThemeContext';
import { useAppData } from '../context/AppDataContext';
import { Avatar } from './primitives';

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
  const { currentUser } = useAppData();
  const [mobileOpen, setMobileOpen] = useState(false);

  const links = [
    { to: '/', label: t('nav.home'), end: true },
    { to: '/profile', label: t('nav.profile') },
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
            </NavLink>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1 md:ms-0">
          <LanguageMenu />
          <ThemeToggle />
          <Link
            to="/profile"
            className="ms-1 hidden sm:block"
            aria-label={t('nav.profile')}
          >
            <Avatar user={currentUser} size={32} />
          </Link>
          <button
            type="button"
            className="btn-ghost px-2 md:hidden"
            aria-label={t('nav.menu')}
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
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
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
