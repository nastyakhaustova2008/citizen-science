import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../../i18n';
import { revokePreview, revokeAdmin, demoteMainAdmin } from '../../lib/admin';
import { SkeletonText } from '../primitives';
import { isolate } from '../auth/AuthUI';
import { AdminErrorText } from './AdminPanel';

/**
 * Confirmation before a revoke: lists everyone who will lose admin (the user + their chain).
 * mode 'revoke'  — a regular admin (cascade).
 * mode 'demote'  — owner removes main-admin status: "make regular admin" (chain stays)
 *                  or "make student" (cascade).
 * The ids shown are sent with the request; if the chain changed meanwhile the database answers
 * chain_changed and the list is reloaded.
 */
export default function RevokeConfirm({ user, mode, onCancel, onDone }) {
  const { t } = useI18n();
  const [chain, setChain] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [demoteTo, setDemoteTo] = useState('admin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setChain(await revokePreview(user.id));
    } catch (err) {
      setLoadError(err);
    }
  }, [user.id]);

  useEffect(() => {
    load();
  }, [load]);

  const cascade = mode === 'revoke' || demoteTo === 'student';
  const below = (chain || []).filter((u) => u.depth > 0);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    const ids = chain.map((u) => u.id);
    try {
      if (mode === 'revoke') {
        await revokeAdmin(user.id, ids);
        onDone(t('admin.done.revoked', { count: ids.length }), ids);
      } else if (demoteTo === 'admin') {
        await demoteMainAdmin(user.id, 'admin');
        onDone(t('admin.done.demotedToAdmin', { name: isolate(user.displayName) }), [user.id]);
      } else {
        await demoteMainAdmin(user.id, 'student', ids);
        onDone(t('admin.done.revoked', { count: ids.length }), ids);
      }
    } catch (err) {
      setError(err);
      if (err.code === 'chain_changed') load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-danger/40 bg-danger/5 p-3">
      {mode === 'demote' && (
        <fieldset className="space-y-2">
          <legend className="label">{t('admin.demote.title', { name: isolate(user.displayName) })}</legend>
          {['admin', 'student'].map((opt) => (
            <label key={opt} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`demote-${user.id}`}
                value={opt}
                checked={demoteTo === opt}
                onChange={() => setDemoteTo(opt)}
                className="mt-1"
              />
              <span>
                <span className="font-semibold">{t(`admin.demote.${opt}`)}</span>
                <span className="block text-xs text-ink-faint">{t(`admin.demote.${opt}Hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {loadError ? (
        <AdminErrorText error={loadError} />
      ) : !chain ? (
        <SkeletonText lines={2} />
      ) : cascade ? (
        <div>
          <p className="flex items-start gap-1.5 text-sm font-semibold text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {t('admin.revoke.willLose', { count: chain.length })}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {chain.map((u) => (
              <li key={u.id} className="flex items-center gap-2" style={{ paddingInlineStart: `${u.depth * 1}rem` }}>
                <span aria-hidden="true" className="text-ink-faint">
                  {u.depth > 0 ? '↳' : '•'}
                </span>
                <span dir="auto">{u.username || t('admin.users.noUsername')}</span>
                <span className="text-xs text-ink-faint">{t(`profile.role.${u.role}`)}</span>
              </li>
            ))}
          </ul>
          {below.length > 0 && <p className="mt-2 text-xs text-ink-faint">{t('admin.revoke.noRestore')}</p>}
        </div>
      ) : (
        <p className="text-sm">
          {below.length > 0
            ? t('admin.demote.chainStays', { count: below.length })
            : t('admin.demote.noChain')}
        </p>
      )}

      <AdminErrorText error={error} />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary !bg-danger hover:!bg-danger/90"
          disabled={busy || !chain}
          onClick={onConfirm}
        >
          {busy
            ? t('auth.working')
            : mode === 'revoke'
              ? t('admin.revoke.confirm', { count: chain?.length ?? 1 })
              : demoteTo === 'admin'
                ? t('admin.demote.confirmAdmin')
                : t('admin.revoke.confirm', { count: chain?.length ?? 1 })}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}
