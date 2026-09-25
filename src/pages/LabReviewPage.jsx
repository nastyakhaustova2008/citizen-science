import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Lock, ThumbsUp, MessageSquareWarning, Hourglass } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from '../context/AuthContext';
import { useAppData } from '../context/AppDataContext';
import { observationTitle } from '../data/mockData';
import { isAdminRole } from '../lib/roles';
import { labFromCampaign } from '../lib/labs';
import { reviewHistory, reviewLab } from '../lib/labsApi';
import { EmptyState, ErrorBlock, LoadingBlock, SectionHeading } from '../components/primitives';
import { Notice } from '../components/auth/AuthUI';
import LabSummary from '../components/labs/LabSummary';
import FormPreview from '../components/labs/FormPreview';
import ReviewHistory, { reviewerName } from '../components/labs/ReviewHistory';
import { APPROVALS_NEEDED } from '../components/labs/SubmitPanel';
import { AdminProfileRequired, LabErrorText } from '../components/labs/LabErrorText';

/**
 * /labs/:id/review — admins review a lab that is in review (step 5b): read-only summary, form
 * preview, the verdicts so far, and Approve / Request changes. The database decides who may
 * (lab_review): not the author, not whoever edited this round, once per round.
 */
export default function LabReviewPage() {
  const { id } = useParams();
  const { t, locale } = useI18n();
  const { profile, adminProfile } = useAuth();
  const { getObservation, campaignsLoading, campaignsError, reloadCampaigns, refreshCampaigns, reviewQueue, reloadReviewQueue } =
    useAppData();
  const campaign = getObservation(id);
  const [history, setHistory] = useState([]);
  const [comment, setComment] = useState('');
  const [mode, setMode] = useState(null); // 'approve' | 'changes'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const campaignId = campaign?.id;
  const loadHistory = useCallback(async () => {
    if (!campaignId) return;
    try {
      setHistory(await reviewHistory(campaignId));
    } catch {
      setHistory([]);
    }
  }, [campaignId]);

  useEffect(() => {
    loadHistory();
    reloadReviewQueue();
  }, [loadHistory, reloadReviewQueue]);

  const Back = locale === 'he' ? ArrowRight : ArrowLeft;
  const back = (
    <Link to="/profile#admin" className="btn-ghost -ms-2 text-sm">
      <Back className="h-4 w-4" aria-hidden="true" />
      {t('labs.editor.backToAdmin')}
    </Link>
  );

  if (!isAdminRole(profile?.role)) return <EmptyState icon={Lock} title={t('labs.review.adminsOnly')} />;
  if (campaignsError) return <ErrorBlock onRetry={reloadCampaigns} />;
  if (campaignsLoading) return <LoadingBlock />;
  if (!campaign) return <EmptyState title={t('observation.notFound')} />;

  const entry = reviewQueue.find((q) => q.id === campaign.id);
  const inReview = campaign.publication === 'in_review';
  const approvals = history.filter((r) => r.round === campaign.reviewRound && r.verdict === 'approve');
  const title = observationTitle(campaign, locale) || campaign.titleHe || campaign.slug;

  async function submit(verdict) {
    setBusy(true);
    setError(null);
    try {
      const res = await reviewLab(campaign.id, campaign.reviewRound, verdict, verdict === 'changes' ? comment : '');
      await Promise.all([refreshCampaigns(), reloadReviewQueue(), loadHistory()]);
      setResult(res.publication === 'published' ? 'published' : verdict === 'changes' ? 'changes' : 'approved');
      setMode(null);
      setComment('');
    } catch (err) {
      setError(err);
      if (err.code === 'round_changed') {
        await refreshCampaigns();
        reloadReviewQueue();
        loadHistory();
      }
    } finally {
      setBusy(false);
    }
  }

  const blocked = entry && entry.myState !== 'can_review' ? entry.myState : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8">
      {back}
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t('labs.review.title')}</p>
        <h1 className="font-serif text-2xl font-bold text-ink dark:text-paper" dir="auto">
          {title}
        </h1>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="chip chip-active">{t(`labs.publication.${campaign.publication}`)}</span>
          {inReview && (
            <span className="inline-flex items-center gap-1">
              <Hourglass className="h-4 w-4 text-moss" aria-hidden="true" />
              {t('labs.submit.approvals', { n: approvals.length, needed: APPROVALS_NEEDED })}
              {approvals.length > 0 && (
                <span className="text-ink-faint" dir="auto">
                  ({approvals.map((r) => reviewerName(r, t)).join(', ')})
                </span>
              )}
            </span>
          )}
          {entry?.creatorFullName && (
            <span className="text-ink-faint" dir="auto">
              · {t('labs.list.by', { name: entry.creatorFullName })}
            </span>
          )}
        </p>
        <Link to={`/observations/${campaign.slug}`} className="text-sm text-ink-faint underline underline-offset-2">
          {t('labs.review.openLabPage')}
        </Link>
      </header>

      {result && (
        <Notice>
          {t(`labs.review.done.${result}`)}{' '}
          {result === 'published' && (
            <Link to={`/observations/${campaign.slug}`} className="underline">
              {t('labs.review.openLabPage')}
            </Link>
          )}
        </Notice>
      )}

      {/* Decision */}
      {inReview && (
        <section className="surface space-y-3 border-moss/50 p-4" aria-labelledby="review-decision">
          <h2 id="review-decision" className="font-serif text-lg font-bold text-ink dark:text-paper">
            {t('labs.review.yourDecision')}
          </h2>
          {adminProfile === null ? (
            <AdminProfileRequired />
          ) : blocked ? (
            <p className="flex items-start gap-2 text-sm text-ink-soft dark:text-paper/80">
              <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t(`labs.review.blocked.${blocked}`)}
            </p>
          ) : (
            <>
              <p className="text-sm text-ink-faint">{t('labs.review.checkHint')}</p>
              {mode === 'changes' ? (
                <div className="space-y-2">
                  <label htmlFor="review-comment" className="label">
                    {t('labs.review.commentLabel')}
                  </label>
                  <textarea
                    id="review-comment"
                    rows={4}
                    maxLength={2000}
                    className="input py-2"
                    dir="auto"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                  />
                  <p className="text-xs text-ink-faint">{t('labs.review.commentHint')}</p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn-primary" disabled={busy || !comment.trim()} onClick={() => submit('changes')}>
                      <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
                      {t('labs.review.sendChanges')}
                    </button>
                    <button type="button" className="btn-ghost" onClick={() => setMode(null)}>
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              ) : mode === 'approve' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">{t('labs.review.approveConfirm')}</span>
                  <button type="button" className="btn-primary" disabled={busy} onClick={() => submit('approve')}>
                    <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                    {t('labs.review.approve')}
                  </button>
                  <button type="button" className="btn-ghost" onClick={() => setMode(null)}>
                    {t('common.cancel')}
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-primary" onClick={() => setMode('approve')}>
                    <ThumbsUp className="h-4 w-4" aria-hidden="true" />
                    {t('labs.review.approve')}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => setMode('changes')}>
                    <MessageSquareWarning className="h-4 w-4" aria-hidden="true" />
                    {t('labs.review.requestChanges')}
                  </button>
                </div>
              )}
            </>
          )}
          {error && <LabErrorText error={error} />}
        </section>
      )}
      {!inReview && !result && (
        <p className="rounded-lg border border-edge p-3 text-sm text-ink-faint dark:border-white/10">
          {t(`labs.review.notInReview.${campaign.publication}`)}
        </p>
      )}

      <LabSummary campaign={campaign} />

      <section>
        <SectionHeading as="h2" title={t('labs.review.formPreview')} />
        <FormPreview lab={labFromCampaign(campaign)} />
      </section>

      {history.length > 0 && (
        <section>
          <SectionHeading as="h2" title={t('labs.review.history')} />
          <ReviewHistory history={history} />
        </section>
      )}
    </div>
  );
}
