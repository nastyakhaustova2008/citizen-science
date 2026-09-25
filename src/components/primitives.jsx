import {
  AlertTriangle,
  Inbox,
  RotateCw,
  CheckCircle2,
  Clock3,
  Flag,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useI18n } from '../i18n';
import { avatarDataUri } from '../lib/media';

/* ---------------------------------------------------------------- Skeletons */

export function Skeleton({ className = '', ...rest }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" {...rest} />;
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="surface p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-4 w-1/2" />
      </div>
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16 rounded-full" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- States */

export function LoadingBlock({ label }) {
  const { t } = useI18n();
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 py-16 text-ink-faint"
      role="status"
      aria-live="polite"
    >
      <RotateCw className="h-5 w-5 animate-spin" aria-hidden="true" />
      <p className="text-sm">{label || t('states.loadingTitle')}</p>
    </div>
  );
}

export function EmptyState({ title, body, icon: Icon = Inbox, action }) {
  const { t } = useI18n();
  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-14 text-center">
      <Icon className="h-8 w-8 text-moss" aria-hidden="true" strokeWidth={1.5} />
      <h3 className="text-base font-semibold text-ink dark:text-paper">{title || t('states.emptyTitle')}</h3>
      {body && <p className="max-w-sm text-sm text-ink-faint">{body}</p>}
      {action}
    </div>
  );
}

export function ErrorBlock({ onRetry }) {
  const { t } = useI18n();
  return (
    <div className="surface flex flex-col items-center gap-3 px-6 py-14 text-center" role="alert">
      <AlertTriangle className="h-8 w-8 text-danger" aria-hidden="true" strokeWidth={1.5} />
      <h3 className="text-base font-semibold text-ink dark:text-paper">{t('states.errorTitle')}</h3>
      <p className="max-w-sm text-sm text-ink-faint">{t('states.errorBody')}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-1" onClick={onRetry}>
          <RotateCw className="h-4 w-4" aria-hidden="true" />
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Avatar */

export function Avatar({ user, size = 32, className = '' }) {
  if (!user) return null;
  return (
    <img
      src={avatarDataUri(user.avatarSeed, user.displayName)}
      alt={user.displayName}
      width={size}
      height={size}
      className={`shrink-0 rounded-lg border border-edge object-cover dark:border-white/10 ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/** Author name for getAuthor() results: username, demo user (+ "demo" chip), or "unknown". */
export function AuthorName({ user, className = '' }) {
  const { t } = useI18n();
  if (!user) return <span className={`text-ink-faint ${className}`}>{t('auth.unknownAuthor')}</span>;
  return (
    <span className={className}>
      <span dir="auto">{user.displayName}</span>
      {user.kind === 'demo' && (
        <span className="chip ms-1.5 !px-1.5 !py-0 text-[10px]" title={t('auth.demoHint')}>
          {t('auth.demoAuthor')}
        </span>
      )}
    </span>
  );
}

/** "Log in to …" line with a link back to the current page. */
export function LoginPrompt({ message, className = '' }) {
  const { t } = useI18n();
  const location = useLocation();
  const next = encodeURIComponent(location.pathname + location.search);
  return (
    <p className={`text-sm text-ink-faint ${className}`}>
      {message}{' '}
      <Link to={`/login?next=${next}`} className="font-semibold text-ink underline dark:text-paper">
        {t('auth.login')}
      </Link>
    </p>
  );
}

/* ---------------------------------------------------------------- Badges */

export function StatusBadge({ status }) {
  const { t } = useI18n();
  const collecting = status === 'collecting';
  return (
    <span
      className={`chip ${
        collecting
          ? 'border-moss/50 bg-moss/10 text-ink dark:text-paper'
          : 'border-edge text-ink-faint'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${collecting ? 'bg-ok' : 'bg-ink-faint'}`}
        aria-hidden="true"
      />
      {collecting ? t('status.collecting') : t('status.completed')}
    </span>
  );
}

export function DifficultyBadge({ level }) {
  const { t } = useI18n();
  const dots = { easy: 1, medium: 2, hard: 3 }[level] || 1;
  return (
    <span className="chip" title={`${t('card.difficulty')}: ${t(`difficulty.${level}`)}`}>
      <span className="flex gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 w-1.5 rounded-full ${i < dots ? 'bg-bark' : 'bg-edge'}`}
          />
        ))}
      </span>
      {t(`difficulty.${level}`)}
    </span>
  );
}

export function VerificationBadge({ status, withLabel = true }) {
  const { t } = useI18n();
  const map = {
    verified: { Icon: CheckCircle2, cls: 'text-ok', label: t('map.panel.verified') },
    pending: { Icon: Clock3, cls: 'text-ink-faint', label: t('map.panel.pending') },
    flagged: { Icon: Flag, cls: 'text-danger', label: t('map.panel.flagged') },
  };
  const { Icon, cls, label } = map[status] || map.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {withLabel && label}
      {!withLabel && <span className="sr-only">{label}</span>}
    </span>
  );
}

/* ---------------------------------------------------------------- Layout bits */

export function SectionHeading({ title, subtitle, action, as: Tag = 'h2' }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Tag className="text-lg font-bold text-ink dark:text-paper">{title}</Tag>
        {subtitle && <p className="mt-0.5 text-sm text-ink-faint">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="surface px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="tnum mt-1 text-xl font-semibold text-ink dark:text-paper">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}
