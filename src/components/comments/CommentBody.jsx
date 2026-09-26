import { Fragment, useMemo } from 'react';
import { ExternalLink } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { commentSegments } from '../../lib/comments';

/**
 * Comment text: plain text in the writer's direction (dir="auto"). Only links to the allowed
 * domains are clickable; they show the domain and open outside Mitzpe.
 */
export default function CommentBody({ body, className = '' }) {
  const { t } = useI18n();
  const { linkDomains } = useAppData();
  const segments = useMemo(() => commentSegments(body, linkDomains), [body, linkDomains]);
  const hasLink = segments.some((s) => s.link);
  return (
    <>
      <p dir="auto" className={`whitespace-pre-line break-words ${className}`}>
        {segments.map((s, i) =>
          s.link ? (
            <a
              key={i}
              href={s.link.href}
              target="_blank"
              rel="noopener noreferrer nofollow ugc"
              dir="ltr"
              title={t('comments.leaving', { host: s.link.host })}
              className="inline-flex items-center gap-0.5 font-semibold text-moss-dark underline underline-offset-2 dark:text-moss-light"
            >
              {s.link.host}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only"> {t('comments.opensOutside')}</span>
            </a>
          ) : (
            <Fragment key={i}>{s.text}</Fragment>
          ),
        )}
      </p>
      {hasLink && <p className="mt-0.5 text-[11px] text-ink-faint">{t('comments.linkNote')}</p>}
    </>
  );
}
