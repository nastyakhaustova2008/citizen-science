import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, ShieldPlus, ShieldMinus, Crown, PencilLine } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { useAppData } from '../../context/AppDataContext';
import { formatDate } from '../../lib/format';
import {
  canGrantAdmin,
  canRevokeAdmin,
  canMakeMainAdmin,
  canDemoteMainAdmin,
  canRename,
} from '../../lib/roles';
import { listUsers, grantAdmin, makeMainAdmin } from '../../lib/admin';
import { EmptyState, ErrorBlock, SkeletonText } from '../primitives';
import { Notice, isolate } from '../auth/AuthUI';
import { AdminErrorText } from './AdminPanel';
import RevokeConfirm from './RevokeConfirm';
import RenameForm from './RenameForm';

const PAGE = 25;
const smallBtn = 'btn-secondary !px-2.5 !py-1.5 text-xs';

/** Users with search, role, who granted it and when, and the actions the current admin may take. */
export default function UserList() {
  const { t } = useI18n();
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [done, setDone] = useState(null); // success message

  // Debounced search.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    listUsers({ search: query, limit: PAGE })
      .then((res) => {
        if (!alive) return;
        setUsers(res.users);
        setTotal(res.total);
      })
      .catch(() => alive && setLoadError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [query, nonce]);

  const [moreBusy, setMoreBusy] = useState(false);
  async function loadMore() {
    setMoreBusy(true);
    try {
      const res = await listUsers({ search: query, limit: PAGE, offset: users.length });
      setUsers((prev) => [...prev, ...res.users.filter((u) => !prev.some((p) => p.id === u.id))]);
      setTotal(res.total);
    } catch {
      setLoadError(true);
    } finally {
      setMoreBusy(false);
    }
  }

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const onChanged = useCallback(
    (message) => {
      setDone(message);
      reload();
    },
    [reload],
  );

  const me = profile ? { id: profile.id, role: profile.role } : null;

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search
          className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint"
          aria-hidden="true"
        />
        <input
          type="search"
          className="input ps-9"
          dir="auto"
          placeholder={t('admin.users.search')}
          aria-label={t('admin.users.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {done && <Notice>{done}</Notice>}

      {loading ? (
        <SkeletonText lines={4} />
      ) : loadError ? (
        <ErrorBlock onRetry={reload} />
      ) : users.length === 0 ? (
        <EmptyState title={t('admin.users.empty')} />
      ) : (
        <>
          <p className="text-xs text-ink-faint">
            {t('admin.users.count', { count: total })}
          </p>
          <ul className="space-y-2">
            {users.map((u) => (
              <UserRow key={u.id} user={u} me={me} onChanged={onChanged} />
            ))}
          </ul>
          {users.length < total && (
            <button type="button" className="btn-secondary" onClick={loadMore} disabled={moreBusy}>
              {moreBusy ? t('common.loading') : t('common.more')}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function UserRow({ user, me, onChanged }) {
  const { t, locale } = useI18n();
  const { reloadProfile } = useAuth();
  const { refreshAuthors } = useAppData();
  const [open, setOpen] = useState(null); // 'revoke' | 'demote' | 'rename'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const name = user.username || t('admin.users.noUsername');
  const isMe = me && user.id === me.id;

  // After any change: refresh the cached public profiles (map, tables) and, if it is me, my profile.
  const afterChange = (message, ids = [user.id]) => {
    refreshAuthors(ids);
    if (isMe) reloadProfile();
    setOpen(null);
    onChanged(message);
  };

  async function run(fn, message) {
    setBusy(true);
    setError(null);
    try {
      await fn(user.id);
      afterChange(message);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const toggle = (what) => {
    setError(null);
    setOpen((cur) => (cur === what ? null : what));
  };

  const actions = [];
  if (canGrantAdmin(me, user)) {
    actions.push(
      <button
        key="grant"
        type="button"
        className={smallBtn}
        disabled={busy}
        onClick={() => run(grantAdmin, t('admin.done.granted', { name: isolate(name) }))}
      >
        <ShieldPlus className="h-3.5 w-3.5" aria-hidden="true" />
        {t('admin.actions.grantAdmin')}
      </button>,
    );
  }
  if (canMakeMainAdmin(me, user)) {
    actions.push(
      <button
        key="main"
        type="button"
        className={smallBtn}
        disabled={busy}
        onClick={() => run(makeMainAdmin, t('admin.done.madeMain', { name: isolate(name) }))}
      >
        <Crown className="h-3.5 w-3.5" aria-hidden="true" />
        {t('admin.actions.makeMainAdmin')}
      </button>,
    );
  }
  if (canRevokeAdmin(me, user)) {
    actions.push(
      <button key="revoke" type="button" className={`${smallBtn} text-danger`} aria-expanded={open === 'revoke'} onClick={() => toggle('revoke')}>
        <ShieldMinus className="h-3.5 w-3.5" aria-hidden="true" />
        {t('admin.actions.revokeAdmin')}
      </button>,
    );
  }
  if (canDemoteMainAdmin(me, user)) {
    actions.push(
      <button key="demote" type="button" className={`${smallBtn} text-danger`} aria-expanded={open === 'demote'} onClick={() => toggle('demote')}>
        <ShieldMinus className="h-3.5 w-3.5" aria-hidden="true" />
        {t('admin.actions.demoteMainAdmin')}
      </button>,
    );
  }
  if (canRename(me, user)) {
    actions.push(
      <button key="rename" type="button" className={smallBtn} aria-expanded={open === 'rename'} onClick={() => toggle('rename')}>
        <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
        {t('admin.actions.rename')}
      </button>,
    );
  }

  return (
    <li className="surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Link to={`/profile/${user.id}`} className="font-semibold text-ink hover:underline dark:text-paper" dir="auto">
              {name}
            </Link>
            <span className={`chip ${user.role !== 'student' ? 'chip-active' : ''}`}>
              {user.role !== 'student' && <ShieldCheck className="h-3 w-3" aria-hidden="true" />}
              {t(`profile.role.${user.role}`)}
            </span>
            {isMe && <span className="text-xs text-ink-faint">({t('common.you')})</span>}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {user.grantedBy
              ? t('admin.users.grantedBy', {
                  name: isolate(user.grantedByUsername || t('auth.unknownAuthor')),
                  date: formatDate(user.grantedAt, locale),
                })
              : t('admin.users.joined', { date: formatDate(user.createdAt, locale) })}
          </p>
        </div>
        {actions.length > 0 && <div className="flex flex-wrap gap-1.5">{actions}</div>}
      </div>

      {error && (
        <div className="mt-2">
          <AdminErrorText error={error} />
        </div>
      )}

      {(open === 'revoke' || open === 'demote') && (
        <RevokeConfirm
          user={{ ...user, displayName: name }}
          mode={open}
          onCancel={() => setOpen(null)}
          onDone={(message, ids) => afterChange(message, ids)}
        />
      )}
      {open === 'rename' && (
        <RenameForm
          user={user}
          onCancel={() => setOpen(null)}
          onDone={(newName) =>
            afterChange(t('admin.done.renamed', { old: isolate(name), name: isolate(newName) }))
          }
        />
      )}
    </li>
  );
}
