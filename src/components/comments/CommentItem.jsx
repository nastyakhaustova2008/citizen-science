import { useState } from 'react';
import { Link } from 'react-router-dom';
import { EyeOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { relativeTime } from '../../lib/format';
import { REPORT_REASONS, editableUntil } from '../../lib/comments';
import { Avatar, AuthorName } from '../primitives';
import CommentBody from './CommentBody';
import CommentForm from './CommentForm';
import CommentErrorText from './CommentErrorText';

const action = 'tap-target rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-faint hover:bg-paper-sunk hover:text-ink dark:hover:bg-white/5 dark:hover:text-paper';

// Real comments: relative to now (not the demo data's reference date).
function relText(t, iso) {
  const r = relativeTime(iso, new Date());
  return t(r.key, r.count != null ? { count: r.count } : undefined);
}

/**
 * One comment: author, time, "edited", text (links only to allowed domains), and the actions
 * this user may take — own: edit (15 min) / delete; others: report; moderators: hide / show /
 * keep (dismiss reports) / delete. The server re-checks every one of them.
 */
export default function CommentItem({ comment: c, thread }) {
  const { t } = useI18n();
  const { getAuthor } = useAppData();
  const [mode, setMode] = useState(null); // edit | delete | modDelete | report
  const [reason, setReason] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const author = getAuthor(c.authorId);
  const canEdit = c.mine && c.canEdit && Date.now() < editableUntil(c);
  const mod = thread.canModerate;

  async function run(fn, after) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setMode(null);
      after?.(res);
    } catch (err) {
      setError({ code: err.code || 'generic', details: err.details });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex gap-2">
      <Avatar user={author} size={24} />
      <div className="min-w-0 flex-1">
        <p className="text-xs">
          {author ? (
            <Link to={`/profile/${c.authorId}`} className="font-semibold hover:underline">
              <AuthorName user={author} />
            </Link>
          ) : (
            <AuthorName user={author} className="font-semibold" />
          )}{' '}
          {c.kind === 'issue' && <span className="chip !py-0 text-[10px] text-danger">{t('comments.issue')}</span>}
          <span className="text-ink-faint"> · {relText(t, c.createdAt)}</span>
          {c.editedAt && <span className="text-ink-faint"> · {t('comments.edited')}</span>}
        </p>
        {c.hidden && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-bark dark:text-bark-light">
            <EyeOff className="h-3 w-3" aria-hidden="true" />
            {t(c.hiddenReason === 'reports' ? 'comments.hiddenByReports' : 'comments.hiddenByModerator')}
            {!mod && c.mine && <span className="font-normal"> — {t('comments.hiddenMine')}</span>}
          </p>
        )}

        {mode === 'edit' ? (
          <div className="mt-1">
            <CommentForm
              id={`comment-edit-${c.id}`}
              initial={c.body}
              autoFocus
              placeholder={t('comments.edit')}
              onSubmit={(body) => thread.edit(c.id, body).then(() => setMode(null))}
              onCancel={() => setMode(null)}
            />
          </div>
        ) : (
          <div className={`mt-0.5 text-sm ${c.kind === 'issue' ? 'text-danger' : ''} ${c.hidden ? 'opacity-70' : ''}`}>
            <CommentBody body={c.body} />
          </div>
        )}

        {mod && c.reports > 0 && (
          <p className="mt-0.5 text-[11px] font-semibold text-danger">{t('comments.reportsCount', { count: c.reports })}</p>
        )}

        {mode === 'report' ? (
          <fieldset className="mt-1.5 space-y-1.5 rounded-lg border border-edge p-2 dark:border-white/10">
            <legend className="px-1 text-xs font-semibold">{t('comments.reportTitle')}</legend>
            {REPORT_REASONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-xs">
                <input type="radio" name={`report-${c.id}`} checked={reason === r} onChange={() => setReason(r)} />
                {t(`comments.reasons.${r}`)}
              </label>
            ))}
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                className="btn-primary !px-2.5 !py-1 text-xs"
                disabled={!reason || busy}
                onClick={() =>
                  run(
                    () => thread.report(c, reason),
                    (res) => setNotice(res.hidden ? 'comments.reportHidden' : 'comments.reportDone'),
                  )
                }
              >
                {t('comments.reportSend')}
              </button>
              <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setMode(null)}>
                {t('common.cancel')}
              </button>
            </div>
          </fieldset>
        ) : mode === 'delete' || mode === 'modDelete' ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span>{t(mode === 'delete' ? 'comments.confirmDelete' : 'comments.confirmModDelete')}</span>
            <button
              type="button"
              className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
              disabled={busy}
              onClick={() => run(() => (mode === 'delete' ? thread.remove(c) : thread.moderate(c, 'delete')))}
            >
              {t('comments.delete')}
            </button>
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setMode(null)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          mode !== 'edit' && (
            <div className="mt-0.5 flex flex-wrap gap-x-1">
              {canEdit && (
                <button type="button" className={action} onClick={() => setMode('edit')}>
                  {t('comments.edit')}
                </button>
              )}
              {c.mine && (
                <button type="button" className={action} onClick={() => setMode('delete')}>
                  {t('comments.delete')}
                </button>
              )}
              {!c.mine && !c.hidden && !c.reported && (
                <button type="button" className={action} onClick={() => setMode('report')}>
                  {t('comments.report')}
                </button>
              )}
              {!c.mine && c.reported && <span className="px-1.5 py-0.5 text-[11px] text-ink-faint">{t('comments.reported')}</span>}
              {mod && (
                <>
                  {c.hidden ? (
                    <button type="button" className={action} disabled={busy} onClick={() => run(() => thread.moderate(c, 'unhide'))}>
                      {t('comments.unhide')}
                    </button>
                  ) : (
                    <>
                      {c.reports > 0 && (
                        <button type="button" className={action} disabled={busy} onClick={() => run(() => thread.moderate(c, 'unhide'))}>
                          {t('comments.keep')}
                        </button>
                      )}
                      <button type="button" className={action} disabled={busy} onClick={() => run(() => thread.moderate(c, 'hide'))}>
                        {t('comments.hide')}
                      </button>
                    </>
                  )}
                  {!c.mine && (
                    <button type="button" className={`${action} !text-danger`} onClick={() => setMode('modDelete')}>
                      {t('comments.delete')}
                    </button>
                  )}
                </>
              )}
            </div>
          )
        )}
        {notice && (
          <p className="mt-1 text-[11px] text-ink-faint" role="status">
            {t(notice)}
          </p>
        )}
        <CommentErrorText error={error} className="mt-1" />
      </div>
    </li>
  );
}
