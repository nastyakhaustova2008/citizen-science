import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, Undo2, Trash2, CheckCircle2, Circle, GitPullRequestDraft, Hourglass } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { LOCALES } from '../../i18n/strings';
import { submitChecklist, checklistItems, structuralChanges } from '../../lib/labs';
import { submitRevision, withdrawRevision, discardRevision, reviewHistory } from '../../lib/labsApi';
import { Notice } from '../auth/AuthUI';
import { LabErrorText } from './LabErrorText';
import ReviewHistory, { reviewerName } from './ReviewHistory';
import { APPROVALS_NEEDED } from './SubmitPanel';

/** "New field: wind", "Protocol", … — one line per structural change (labs.js → structuralChanges). */
export function ChangeList({ changes }) {
  const { t } = useI18n();
  if (!changes.length) return null;
  return (
    <ul className="space-y-0.5 text-sm">
      {changes.map((c, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          <span>
            {t(`labs.revision.changes.${c.kind}`)}
            {c.key && (
              <>
                {' '}
                <code dir="ltr" className="text-xs">
                  {c.key}
                </code>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Revision of a published lab (step 5c), in the editor: the structural changes waiting for
 * review, the checklist, submit / withdraw / discard, and the reviewers' change requests.
 * `lab` = editor state (live + revision), `live` = the published lab, `rev` = the open revision
 * (labs.js → revisionFromApi) or null. `onChanged(rev)` after submit / withdraw;
 * `onDiscarded()` after discard (the editor reloads).
 */
export default function RevisionPanel({ lab, live, rev, dirty, onGoto, onChanged, onDiscarded }) {
  const { t } = useI18n();
  const { reloadReviewQueue } = useAppData();
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirm, setConfirm] = useState(null); // 'withdraw' | 'discard'

  const loadHistory = useCallback(async () => {
    if (!rev) return setHistory([]);
    try {
      setHistory((await reviewHistory(lab.id)).filter((r) => r.revisionId === rev.id));
    } catch {
      setHistory([]);
    }
    return undefined;
  }, [lab.id, rev]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const changes = useMemo(() => structuralChanges(live, lab), [live, lab]);
  const items = useMemo(() => checklistItems(submitChecklist(lab), lab), [lab]);
  if (!rev && changes.length === 0) {
    return <p className="text-xs text-ink-faint">{t('labs.revision.none')}</p>;
  }

  const approvals = history.filter((r) => rev && r.round === rev.round && r.verdict === 'approve');
  const changeRequests = rev?.status === 'draft' && history.some((r) => r.round === rev.round && r.verdict === 'changes');

  async function act(fn, after, message) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fn();
      reloadReviewQueue();
      setConfirm(null);
      setNotice(message);
      after(res);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const inReview = rev?.status === 'in_review';
  const Icon = inReview ? Hourglass : GitPullRequestDraft;

  return (
    <section className="surface space-y-3 border-warn/50 p-4" aria-labelledby="revision-panel-title">
      <h2 id="revision-panel-title" className="flex items-center gap-2 font-serif text-lg font-bold text-ink dark:text-paper">
        <Icon className="h-5 w-5 text-warn" aria-hidden="true" />
        {!rev ? t('labs.revision.unsavedTitle') : inReview ? t('labs.revision.inReviewTitle') : t('labs.revision.draftTitle')}
      </h2>
      <p className="text-sm text-ink-soft dark:text-paper/80">{t('labs.revision.explain', { needed: APPROVALS_NEEDED })}</p>
      {rev?.proposerName && <p className="text-xs text-ink-faint">{t('labs.revision.proposedBy', { name: rev.proposerName })}</p>}

      <div>
        <p className="label">{t('labs.revision.changesTitle')}</p>
        {changes.length ? <ChangeList changes={changes} /> : <p className="text-sm text-ink-faint">{t('labs.revision.noChangesLeft')}</p>}
      </div>

      {changeRequests && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-warn">{t('labs.submit.changesRequested')}</p>
          <ReviewHistory history={history} onlyChangesOf={rev.round} />
        </div>
      )}

      {inReview && (
        <p className="text-sm">
          {t('labs.submit.approvals', { n: approvals.length, needed: APPROVALS_NEEDED })}
          {approvals.length > 0 && (
            <span className="text-ink-faint" dir="auto">
              {' '}
              ({approvals.map((r) => reviewerName(r, t)).join(', ')})
            </span>
          )}
          <span className="block text-xs text-ink-faint">{t('labs.revision.editResets')}</span>
        </p>
      )}

      {rev?.status === 'draft' &&
        (items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ok">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {t('labs.submit.ready')}
          </p>
        ) : (
          <div>
            <p className="text-sm">{t('labs.submit.missingIntro')}</p>
            <ul className="mt-1.5 space-y-1">
              {items.map((it) => (
                <li key={it.kind} className="flex items-start gap-2 text-sm">
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                  <button type="button" className="text-start underline underline-offset-2" onClick={() => onGoto(it)}>
                    {t(`labs.submit.items.${it.kind}`, {
                      langs: (it.langs || []).map((l) => LOCALES[l].label).join(', '),
                      keys: (it.keys || []).join(', '),
                    })}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}

      {!rev && <p className="text-sm text-warn">{t('labs.revision.saveToOpen')}</p>}
      {rev && dirty && <p className="text-sm text-warn">{t('labs.submit.saveFirst')}</p>}
      {notice && <Notice>{notice}</Notice>}
      {error && <LabErrorText error={error} />}

      {rev && (
        <div className="flex flex-wrap items-center gap-2">
          {rev.status === 'draft' && (
            <button
              type="button"
              className="btn-primary"
              disabled={busy || dirty || items.length > 0}
              onClick={() =>
                act(
                  () => submitRevision(rev),
                  (editNo) => onChanged({ ...rev, status: 'in_review', round: rev.round + 1, editNo }),
                  t('labs.revision.submitted'),
                )
              }
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              {t('labs.revision.submit')}
            </button>
          )}
          {confirm ? (
            <>
              <span className="text-sm">{t(`labs.revision.${confirm}Confirm`)}</span>
              <button
                type="button"
                className="btn-secondary !py-1.5 text-sm"
                disabled={busy}
                onClick={() =>
                  confirm === 'withdraw'
                    ? act(() => withdrawRevision(rev), (editNo) => onChanged({ ...rev, status: 'draft', editNo }), t('labs.revision.withdrawn'))
                    : act(() => discardRevision(rev), () => onDiscarded(), t('labs.revision.discarded'))
                }
              >
                {t(`labs.revision.${confirm}`)}
              </button>
              <button type="button" className="btn-ghost !py-1.5 text-sm" onClick={() => setConfirm(null)}>
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <>
              {inReview && (
                <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setConfirm('withdraw')}>
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  {t('labs.revision.withdraw')}
                </button>
              )}
              <button type="button" className="btn-ghost !py-1.5 text-sm text-danger" onClick={() => setConfirm('discard')}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t('labs.revision.discard')}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
