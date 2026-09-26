import { useEffect, useState } from 'react';
import { BadgeCheck, UserRound } from 'lucide-react';
import { useI18n } from '../../i18n';
import { formatDate } from '../../lib/format';
import { labCredits } from '../../lib/labsApi';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../primitives';

/**
 * "Name, position · workplace" (a deleted account → "former staff member"), with the admin's
 * confirmed face photo for logged-in viewers (017; the server sends it only to them).
 */
function Person({ p }) {
  const { t } = useI18n();
  if (!p?.fullName) return <span className="text-ink-faint">{t('labs.review.formerStaff')}</span>;
  return (
    <span dir="auto" className="inline-flex items-center gap-1.5">
      {p.avatar && <Avatar user={{ displayName: p.fullName, avatarSeed: p.fullName }} path={p.avatar} size={24} className="!rounded-full" />}
      <span>
        <span className="font-semibold text-ink dark:text-paper">{p.fullName}</span>
        {p.position && <span>, {p.position}</span>}
        {p.workplace && <span className="text-ink-faint"> · {p.workplace}</span>}
      </span>
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
  // Photos are sent only to logged-in users: read again when that changes.
  const { currentUser } = useAuth();
  const viewerId = currentUser?.id ?? null;

  useEffect(() => {
    let alive = true;
    setCredits(undefined);
    labCredits(campaignId)
      .then((c) => alive && setCredits(c))
      .catch(() => alive && setCredits(null));
    return () => {
      alive = false;
    };
  }, [campaignId, viewerId]);

  if (!credits) return null;
  // Latest approved revision (5c): "Updated on …, approved by …".
  const update = credits.update && (
    <div className="flex items-start gap-2">
      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
      <div>
        <p className="text-ink-faint">{t('labs.credits.updated', { date: formatDate(credits.update.appliedAt, locale) })}</p>
        <ul className="mt-0.5 space-y-0.5">
          {credits.update.approvers.map((a, i) => (
            <li key={i}>
              <Person p={a} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
  if (credits.legacy) {
    if (!update) return <p className="text-xs text-ink-faint">{t('labs.credits.legacy')}</p>;
    return (
      <section className="surface space-y-2 p-3 text-sm" aria-label={t('labs.credits.title')}>
        <p className="text-xs text-ink-faint">{t('labs.credits.legacy')}</p>
        {update}
      </section>
    );
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
      {update}
    </section>
  );
}
