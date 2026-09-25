import { useEffect, useState } from 'react';
import { BadgeCheck, UserRound } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatDate } from '../../lib/format';
import { labCredits } from '../../lib/labsApi';

/** "Name, position · workplace" (a deleted account → "former staff member"). */
function Person({ p }) {
  const { t } = useI18n();
  if (!p?.fullName) return <span className="text-ink-faint">{t('labs.review.formerStaff')}</span>;
  return (
    <span dir="auto">
      <span className="font-semibold text-ink dark:text-paper">{p.fullName}</span>
      {p.position && <span>, {p.position}</span>}
      {p.workplace && <span className="text-ink-faint"> · {p.workplace}</span>}
    </span>
  );
}

/**
 * Public credits of a published lab (everyone, also logged out): who created it and which three
 * admins approved it, when. Labs from before peer review say so.
 */
export default function LabCredits({ campaignId }) {
  const { t, locale } = useI18n();
  const [credits, setCredits] = useState(undefined);

  useEffect(() => {
    let alive = true;
    setCredits(undefined);
    labCredits(campaignId)
      .then((c) => alive && setCredits(c))
      .catch(() => alive && setCredits(null));
    return () => {
      alive = false;
    };
  }, [campaignId]);

  if (!credits) return null;
  if (credits.legacy) {
    return <p className="text-xs text-ink-faint">{t('labs.credits.legacy')}</p>;
  }
  return (
    <section className="surface space-y-2 p-3 text-sm" aria-label={t('labs.credits.title')}>
      <p className="flex items-start gap-2">
        <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-moss" aria-hidden="true" />
        <span>
          <span className="text-ink-faint">{t('labs.credits.createdBy')} </span>
          <Person p={credits.creator} />
        </span>
      </p>
      <div className="flex items-start gap-2">
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
        <div>
          <p className="text-ink-faint">
            {t('labs.credits.approvedBy', { date: formatDate(credits.publishedAt, locale) })}
          </p>
          <ul className="mt-0.5 space-y-0.5">
            {credits.approvers.map((a, i) => (
              <li key={i}>
                <Person p={a} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
