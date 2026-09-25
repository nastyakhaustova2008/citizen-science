import { CheckCircle2, MessageSquareWarning } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatDate } from '../../lib/format';

/** Name of a reviewer: full name from the admin profile, else username, else "former staff member". */
export function reviewerName(r, t) {
  return r.reviewerFullName || r.reviewerUsername || t('labs.review.formerStaff');
}

/**
 * Verdicts on a lab (admins), grouped by review round, newest first.
 * `onlyChangesOf` = a round number → only the change requests of that round (the editor's banner).
 */
export default function ReviewHistory({ history, onlyChangesOf = null }) {
  const { t, locale } = useI18n();
  const rows = onlyChangesOf == null ? history : history.filter((r) => r.round === onlyChangesOf && r.verdict === 'changes');
  if (rows.length === 0) return null;
  const rounds = [...new Set(rows.map((r) => r.round))];
  return (
    <div className="space-y-3">
      {rounds.map((round) => (
        <section key={round}>
          {onlyChangesOf == null && (
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t('labs.review.round', { n: round })}
            </h3>
          )}
          <ul className="space-y-2">
            {rows
              .filter((r) => r.round === round)
              .map((r) => {
                const changes = r.verdict === 'changes';
                const Icon = changes ? MessageSquareWarning : CheckCircle2;
                return (
                  <li
                    key={r.id}
                    className={`rounded-lg border p-3 text-sm ${
                      changes ? 'border-warn/40 bg-warn/10' : 'border-edge dark:border-white/10'
                    }`}
                  >
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                      <Icon className={`h-4 w-4 shrink-0 ${changes ? 'text-warn' : 'text-ok'}`} aria-hidden="true" />
                      <span className="font-semibold" dir="auto">
                        {reviewerName(r, t)}
                      </span>
                      {r.reviewerWorkplace && (
                        <span className="text-ink-faint" dir="auto">
                          · {r.reviewerWorkplace}
                        </span>
                      )}
                      <span className="text-ink-soft dark:text-paper/80">
                        {changes ? t('labs.review.requestedChanges') : t('labs.review.approved')}
                      </span>
                      <span className="text-xs text-ink-faint">{formatDate(r.at, locale)}</span>
                    </p>
                    {r.comment && (
                      <p className="mt-1.5 whitespace-pre-line text-ink dark:text-paper" dir="auto">
                        {r.comment}
                      </p>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
