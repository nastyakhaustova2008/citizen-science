import { useCallback, useEffect, useState } from 'react';
import { Link2, Plus, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { formatDate } from '../../lib/format';
import { cleanComment, domainError, normalizeDomain } from '../../lib/comments';
import {
  addLinkDomain,
  decideLinkDomain,
  linkDomainAdminView,
  proposeLinkDomain,
  removeLinkDomain,
} from '../../lib/commentsApi';
import { EmptyState, ErrorBlock, SectionHeading, SkeletonText } from '../primitives';
import { isolate } from '../auth/AuthUI';
import CommentErrorText from './CommentErrorText';

const smallBtn = 'btn-secondary !px-2.5 !py-1.5 text-xs';

/**
 * Admin panel → Comments → allowed link domains. Every admin sees the list; main admins and
 * the owner add / remove domains and decide proposals; other admins propose one with a reason
 * and see what was decided. Everything is logged (Log → Link domains).
 */
export default function LinkDomains() {
  const { t } = useI18n();
  const { reloadLinkDomains, reloadLinkProposals } = useAppData();
  const [view, setView] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setError(false);
    try {
      setView(await linkDomainAdminView());
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const changed = useCallback(async () => {
    await load();
    reloadLinkDomains();
    reloadLinkProposals();
  }, [load, reloadLinkDomains, reloadLinkProposals]);

  if (error) return <ErrorBlock onRetry={load} />;
  if (!view) return <SkeletonText lines={3} />;

  const pending = view.proposals.filter((p) => p.status === 'pending');
  const decided = view.proposals.filter((p) => p.status !== 'pending');

  return (
    <section className="space-y-4">
      <SectionHeading as="h3" title={t('comments.domains.title')} subtitle={t('comments.domains.subtitle')} />

      <ul className="flex flex-wrap gap-2">
        {view.domains.map((d) => (
          <DomainChip key={d.domain} domain={d} canRemove={view.canManage} onChanged={changed} />
        ))}
      </ul>

      {view.canManage ? <AddDomain onChanged={changed} /> : <ProposeDomain onChanged={changed} />}

      {view.canManage && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">{t('comments.domains.pendingTitle')}</h4>
          {pending.length === 0 ? (
            <p className="text-xs text-ink-faint">{t('comments.domains.noPending')}</p>
          ) : (
            <ul className="space-y-2">
              {pending.map((p) => (
                <Proposal key={p.id} proposal={p} canDecide onChanged={changed} />
              ))}
            </ul>
          )}
        </div>
      )}

      {(view.canManage ? decided : view.proposals).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            {t(view.canManage ? 'comments.domains.decidedTitle' : 'comments.domains.mineTitle')}
          </h4>
          <ul className="space-y-2">
            {(view.canManage ? decided : view.proposals).map((p) => (
              <Proposal key={p.id} proposal={p} onChanged={changed} />
            ))}
          </ul>
        </div>
      )}
      {!view.canManage && view.proposals.length === 0 && view.domains.length === 0 && (
        <EmptyState title={t('comments.domains.empty')} />
      )}
    </section>
  );
}

function DomainChip({ domain: d, canRemove, onChanged }) {
  const { t, locale } = useI18n();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const by = d.addedBy ? d.addedByUsername || t('admin.users.noUsername') : null;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await removeLinkDomain(d.domain);
      await onChanged();
    } catch (err) {
      setError({ code: err.code || 'generic' });
      setBusy(false);
    }
  }

  return (
    <li className="chip !py-1 text-xs" title={by ? t('comments.domains.addedBy', { name: by, date: formatDate(d.addedAt, locale) }) : undefined}>
      <Link2 className="h-3 w-3" aria-hidden="true" />
      <span dir="ltr">{d.domain}</span>
      {canRemove &&
        (confirm ? (
          <span className="ms-1 inline-flex items-center gap-1">
            <span>{t('comments.domains.confirmRemove')}</span>
            <button type="button" className="font-semibold text-danger underline" disabled={busy} onClick={remove}>
              {t('comments.domains.remove')}
            </button>
            <button type="button" className="underline" onClick={() => setConfirm(false)}>
              {t('common.cancel')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="tap-target ms-0.5 rounded p-0.5 hover:text-danger"
            aria-label={t('comments.domains.removeDomain', { domain: d.domain })}
            onClick={() => setConfirm(true)}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ))}
      <CommentErrorText error={error} />
    </li>
  );
}

function AddDomain({ onChanged }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const domain = normalizeDomain(text);
  const live = domain ? domainError(domain) : null;

  async function submit(e) {
    e.preventDefault();
    if (!domain || live || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addLinkDomain(domain);
      setText('');
      await onChanged();
    } catch (err) {
      setError({ code: err.code || 'generic' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-1.5" onSubmit={submit} noValidate>
      <label className="label" htmlFor="domain-add">
        {t('comments.domains.addLabel')}
      </label>
      <div className="flex gap-2">
        <input
          id="domain-add"
          className="input flex-1"
          dir="ltr"
          placeholder="example.org"
          autoCapitalize="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
        <button type="submit" className="btn-secondary" disabled={!domain || Boolean(live) || busy}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('comments.domains.add')}
        </button>
      </div>
      <p className="text-[11px] text-ink-faint">{t('comments.domains.subdomainsHint')}</p>
      <CommentErrorText error={error || (live ? { code: live } : null)} />
    </form>
  );
}

function ProposeDomain({ onChanged }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const domain = normalizeDomain(text);
  const live = domain ? domainError(domain) : null;
  const cleanReason = cleanComment(reason);

  async function submit(e) {
    e.preventDefault();
    if (!domain || live || !cleanReason || busy) return;
    setBusy(true);
    setError(null);
    try {
      await proposeLinkDomain(domain, cleanReason);
      setText('');
      setReason('');
      setSent(true);
      await onChanged();
    } catch (err) {
      setError({ code: err.code || 'generic' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="surface space-y-2 p-3" onSubmit={submit} noValidate>
      <h4 className="text-sm font-semibold">{t('comments.domains.proposeTitle')}</h4>
      <p className="text-xs text-ink-faint">{t('comments.domains.proposeHint')}</p>
      <div>
        <label className="label" htmlFor="domain-propose">
          {t('comments.domains.domainLabel')}
        </label>
        <input
          id="domain-propose"
          className="input"
          dir="ltr"
          placeholder="example.org"
          autoCapitalize="off"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
            setSent(false);
          }}
        />
      </div>
      <div>
        <label className="label" htmlFor="domain-reason">
          {t('comments.domains.reason')}
        </label>
        <textarea
          id="domain-reason"
          rows={2}
          dir="auto"
          maxLength={500}
          className="input py-2 text-sm"
          placeholder={t('comments.domains.reasonPlaceholder')}
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            setError(null);
            setSent(false);
          }}
        />
      </div>
      <CommentErrorText error={error || (live ? { code: live } : null)} />
      {sent && (
        <p className="text-xs text-moss-dark dark:text-moss-light" role="status">
          {t('comments.domains.proposed')}
        </p>
      )}
      <button type="submit" className="btn-primary" disabled={!domain || Boolean(live) || !cleanReason || busy}>
        {t('comments.domains.proposeSend')}
      </button>
    </form>
  );
}

function Proposal({ proposal: p, canDecide = false, onChanged }) {
  const { t, locale } = useI18n();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const proposer = p.proposedBy ? p.proposedByUsername || t('admin.users.noUsername') : t('auth.unknownAuthor');
  const decider = p.decidedBy ? p.decidedByUsername || t('admin.users.noUsername') : t('auth.unknownAuthor');
  const statusCls = { pending: 'text-bark', approved: 'text-moss-dark dark:text-moss-light', rejected: 'text-danger' };

  async function decide(approve) {
    setBusy(true);
    setError(null);
    try {
      await decideLinkDomain(p.id, approve, cleanComment(comment));
      await onChanged();
    } catch (err) {
      setError({ code: err.code || 'generic' });
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-edge p-2.5 text-sm dark:border-white/10">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold" dir="ltr">
          {p.domain}
        </span>
        <span className={`text-xs font-semibold ${statusCls[p.status]}`}>{t(`comments.domains.status.${p.status}`)}</span>
      </p>
      <p className="mt-0.5 whitespace-pre-line break-words text-xs" dir="auto">
        {p.reason}
      </p>
      <p className="mt-0.5 text-[11px] text-ink-faint">
        {t('comments.domains.proposedBy', { name: isolate(proposer), date: formatDate(p.createdAt, locale) })}
      </p>
      {p.status !== 'pending' && (
        <p className="mt-0.5 text-[11px] text-ink-faint">
          {t('comments.domains.decidedBy', { name: isolate(decider), date: formatDate(p.decidedAt, locale) })}
          {p.decisionComment && (
            <span className="block text-xs text-ink dark:text-paper" dir="auto">
              {p.decisionComment}
            </span>
          )}
        </p>
      )}
      {canDecide && (
        <div className="mt-2 space-y-1.5">
          <label className="sr-only" htmlFor={`decide-${p.id}`}>
            {t('comments.domains.decisionComment')}
          </label>
          <input
            id={`decide-${p.id}`}
            className="input text-sm"
            dir="auto"
            maxLength={500}
            placeholder={t('comments.domains.decisionComment')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className={smallBtn} disabled={busy} onClick={() => decide(true)}>
              {t('comments.domains.approve')}
            </button>
            <button type="button" className={`${smallBtn} text-danger`} disabled={busy} onClick={() => decide(false)}>
              {t('comments.domains.reject')}
            </button>
          </div>
        </div>
      )}
      <CommentErrorText error={error} className="mt-1" />
    </li>
  );
}
