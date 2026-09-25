import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, Undo2, CheckCircle2, Circle, ClipboardCheck, Hourglass } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { LOCALES } from '../../i18n/strings';
import { submitChecklist, checklistItems } from '../../lib/labs';
import { submitLab, withdrawLab, reviewHistory } from '../../lib/labsApi';
import { Notice } from '../auth/AuthUI';
import { LabErrorText } from './LabErrorText';
import ReviewHistory, { reviewerName } from './ReviewHistory';

export const APPROVALS_NEEDED = 3;

/**
 * Review status of a lab for the people who may edit it (step 5b):
 * draft → checklist + "Submit for review" (+ the change requests of the last round);
 * in review → approvals so far + "Withdraw". `lab` is the editor state (labs.js).
 * `onGoto(item)` jumps to the tab / language of a checklist item (editor only).
 * `onChanged({ publication, editNo })` after submit / withdraw.
 */
export default function SubmitPanel({ lab, dirty = false, onGoto, onChanged, compact = false }) {
  const { t } = useI18n();
  const { refreshCampaigns, reloadReviewQueue } = useAppData();
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!lab.id) return;
    try {
      setHistory(await reviewHistory(lab.id));
    } catch {
      setHistory([]);
    }
  }, [lab.id]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory, lab.editNo]);

  const missing = useMemo(() => submitChecklist(lab), [lab]);
  const items = useMemo(() => checklistItems(missing, lab), [missing, lab]);
  const ready = items.length === 0;
  const currentRound = history[0]?.currentRound ?? null;
  const approvals = history.filter((r) => r.round === currentRound && r.verdict === 'approve');
  // Change requests that sent the lab back to draft in the current round (cleared by resubmitting).
  const lastChanges = history.find((r) => r.verdict === 'changes' && r.round === currentRound);

  async function act(fn, next, message) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const editNo = await fn();
      await refreshCampaigns();
      reloadReviewQueue();
      setNotice(message);
      setConfirmWithdraw(false);
      onChanged?.({ publication: next, editNo });
      loadHistory();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!lab.id || lab.publication === 'published') return null;

  if (lab.publication === 'in_review') {
    return (
      <section className="surface space-y-3 border-moss/50 p-4" aria-labelledby="submit-panel-title">
        <h2 id="submit-panel-title" className="flex items-center gap-2 font-serif text-lg font-bold text-ink dark:text-paper">
          <Hourglass className="h-5 w-5 text-moss" aria-hidden="true" />
          {t('labs.submit.inReviewTitle')}
        </h2>
        <p className="text-sm">
          {t('labs.submit.approvals', { n: approvals.length, needed: APPROVALS_NEEDED })}
          {approvals.length > 0 && (
            <span className="text-ink-faint" dir="auto">
              {' '}
              ({approvals.map((r) => reviewerName(r, t)).join(', ')})
            </span>
          )}
        </p>
        {!compact && <p className="text-xs text-ink-faint">{t('labs.submit.editResets')}</p>}
        {notice && <Notice>{notice}</Notice>}
        {error && <LabErrorText error={error} />}
        {confirmWithdraw ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{t('labs.submit.withdrawConfirm')}</span>
            <button type="button" className="btn-secondary !py-1.5 text-sm" disabled={busy}
              onClick={() => act(() => withdrawLab(lab.id), 'draft', t('labs.submit.withdrawn'))}>
              {t('labs.submit.withdraw')}
            </button>
            <button type="button" className="btn-ghost !py-1.5 text-sm" onClick={() => setConfirmWithdraw(false)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-secondary !py-1.5 text-sm" onClick={() => setConfirmWithdraw(true)}>
            <Undo2 className="h-4 w-4" aria-hidden="true" />
            {t('labs.submit.withdraw')}
          </button>
        )}
      </section>
    );
  }

  // Draft
  return (
    <section className="surface space-y-3 p-4" aria-labelledby="submit-panel-title">
      <h2 id="submit-panel-title" className="flex items-center gap-2 font-serif text-lg font-bold text-ink dark:text-paper">
        <ClipboardCheck className="h-5 w-5 text-moss" aria-hidden="true" />
        {t('labs.submit.title')}
      </h2>

      {lastChanges && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-warn">{t('labs.submit.changesRequested')}</p>
          <ReviewHistory history={history} onlyChangesOf={lastChanges.round} />
        </div>
      )}

      {ready ? (
        <p className="flex items-center gap-2 text-sm text-ok">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          {t('labs.submit.ready')}
        </p>
      ) : (
        <div>
          <p className="text-sm">{t('labs.submit.missingIntro')}</p>
          <ul className="mt-1.5 space-y-1">
            {items.map((it) => {
              const text = t(`labs.submit.items.${it.kind}`, {
                langs: (it.langs || []).map((l) => LOCALES[l].label).join(', '),
                keys: (it.keys || []).join(', '),
              });
              return (
                <li key={it.kind} className="flex items-start gap-2 text-sm">
                  <Circle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                  {onGoto ? (
                    <button type="button" className="text-start underline underline-offset-2 hover:text-ink-soft" onClick={() => onGoto(it)}>
                      {text}
                    </button>
                  ) : (
                    <span>{text}</span>
                  )}
                </li>
              );
            })}
          </ul>
          {!onGoto && (
            <Link to={`/labs/${lab.id}/edit`} className="btn-secondary mt-2 !py-1.5 text-xs">
              {t('labs.submit.openEditor')}
            </Link>
          )}
        </div>
      )}

      {!compact && <p className="text-xs text-ink-faint">{t('labs.submit.rules', { needed: APPROVALS_NEEDED })}</p>}
      {dirty && ready && <p className="text-sm text-warn">{t('labs.submit.saveFirst')}</p>}
      {notice && <Notice>{notice}</Notice>}
      {error && <LabErrorText error={error} />}
      <button
        type="button"
        className="btn-primary"
        disabled={!ready || dirty || busy}
        onClick={() => act(() => submitLab(lab.id, lab.editNo), 'in_review', t('labs.submit.submitted'))}
      >
        <Send className="h-4 w-4" aria-hidden="true" />
        {busy ? t('labs.saving') : t('labs.submit.button')}
      </button>
    </section>
  );
}
