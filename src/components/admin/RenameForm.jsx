import { useCallback, useState } from 'react';
import { useI18n } from '../../i18n';
import { normalizeUsername, usernameError, usernameKey } from '../../lib/username';
import { renameUser } from '../../lib/admin';
import { UsernameField } from '../auth/AuthUI';
import { AdminErrorText } from './AdminPanel';

/** Rename a user (same rules as sign-up; checked again by the database and logged there). */
export default function RenameForm({ user, onCancel, onDone }) {
  const { t } = useI18n();
  const [value, setValue] = useState(user.username || '');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const name = normalizeUsername(value);
  const sameKey = Boolean(user.username) && usernameKey(name) === usernameKey(user.username);
  const unchanged = name === user.username;
  // A case-only change of the user's own name is "taken" by themselves — that is fine.
  const onStatus = useCallback(
    (s) => setStatus(s === 'username_taken' && sameKey ? 'available' : s),
    [sameKey],
  );

  const invalid = !name || usernameError(name) || (status && !['available', 'checking'].includes(status));

  async function onSubmit(e) {
    e.preventDefault();
    if (invalid || unchanged) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await renameUser(user.id, name));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mt-3 space-y-3 rounded-lg border border-edge p-3 dark:border-white/10" onSubmit={onSubmit} noValidate>
      <UsernameField id={`rename-${user.id}`} value={value} onChange={setValue} status={unchanged ? null : status} onStatus={onStatus} />
      <p className="text-xs text-ink-faint">{t('admin.rename.logged')}</p>
      <AdminErrorText error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={busy || Boolean(invalid) || unchanged || status === 'checking'}>
          {busy ? t('auth.working') : t('admin.rename.submit')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
