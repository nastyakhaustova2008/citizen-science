import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, PencilLine, Trash2, Search } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { useAppData } from '../../context/AppDataContext';
import { observationTitle } from '../../data/mockData';
import { formatDate } from '../../lib/format';
import { adminLabs, deleteLab } from '../../lib/labsApi';
import { EmptyState, ErrorBlock, SkeletonText } from '../primitives';
import { isolate } from '../auth/AuthUI';
import ObsIcon from '../ObsIcon';
import { AdminProfileRequired, LabErrorText } from './LabErrorText';

const smallBtn = 'btn-secondary !px-2.5 !py-1.5 text-xs';

/** Admin panel → Labs: "New lab", my drafts, and every lab with who made it and what I may do. */
export default function LabList() {
  const { t } = useI18n();
  const { profile, adminProfile } = useAuth();
  const [labs, setLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setLabs(await adminLabs());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const { locale } = useI18n();
  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      labs.filter(
        (l) => !q || [l.titleHe, l.titleEn, l.titleRu, l.slug].some((s) => (s || '').toLowerCase().includes(q)),
      ),
    [labs, q],
  );
  const mine = shown.filter((l) => l.createdBy === profile?.id && l.publication !== 'published');
  const others = shown.filter((l) => !mine.includes(l));

  return (
    <div className="space-y-5">
      {adminProfile === null ? (
        <AdminProfileRequired />
      ) : (
        <Link to="/labs/new" className="btn-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('labs.list.new')}
        </Link>
      )}

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <input
          type="search"
          className="input ps-9"
          dir="auto"
          placeholder={t('labs.list.search')}
          aria-label={t('labs.list.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <SkeletonText lines={4} />
      ) : error ? (
        <ErrorBlock onRetry={load} />
      ) : (
        <>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-soft dark:text-paper/80">{t('labs.list.myDrafts')}</h3>
            {mine.length === 0 ? (
              <p className="text-sm text-ink-faint">{t('labs.list.noDrafts')}</p>
            ) : (
              <ul className="space-y-2">
                {mine.map((l) => (
                  <LabRow key={l.id} lab={l} locale={locale} onChanged={load} />
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-sm font-semibold text-ink-soft dark:text-paper/80">{t('labs.list.all')}</h3>
            {others.length === 0 ? (
              <EmptyState title={t('labs.list.empty')} />
            ) : (
              <ul className="space-y-2">
                {others.map((l) => (
                  <LabRow key={l.id} lab={l} locale={locale} onChanged={load} />
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function LabRow({ lab, locale, onChanged }) {
  const { t } = useI18n();
  const { refreshCampaigns } = useAppData();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const title = observationTitle(lab, locale) || lab.titleHe || lab.titleEn || lab.slug;
  const creator = lab.creatorFullName || lab.creatorUsername;

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteLab(lab.id);
      await refreshCampaigns();
      onChanged();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <li className="surface p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-paper-sunk dark:bg-white/5">
            <ObsIcon name={lab.icon} className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              {lab.publication === 'published' ? (
                <Link to={`/observations/${lab.slug}`} className="font-semibold text-ink hover:underline dark:text-paper" dir="auto">
                  {title}
                </Link>
              ) : (
                <span className="font-semibold text-ink dark:text-paper" dir="auto">
                  {title}
                </span>
              )}
              <span className={`chip ${lab.publication === 'published' ? '' : 'chip-active'}`}>
                {t(`labs.publication.${lab.publication}`)}
              </span>
            </p>
            <p className="mt-0.5 text-xs text-ink-faint">
              {creator && t('labs.list.by', { name: isolate(creator) })}
              {creator && ' · '}
              {t('labs.list.updated', { date: formatDate(lab.updatedAt, locale) })}
              {' · '}
              {t('labs.list.measurements', { count: lab.measurementCount })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {lab.canEdit && (
            <Link to={`/labs/${lab.id}/edit`} className={smallBtn}>
              <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
              {t('labs.list.edit')}
            </Link>
          )}
          {lab.canDelete && !confirm && (
            <button type="button" className={`${smallBtn} text-danger`} onClick={() => setConfirm(true)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('labs.list.delete')}
            </button>
          )}
        </div>
      </div>
      {confirm && (
        <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-edge pt-2 dark:border-white/10">
          <span className="text-sm">{t('labs.list.deleteConfirm')}</span>
          <button type="button" className={`${smallBtn} text-danger`} disabled={busy} onClick={remove}>
            {t('labs.editor.deleteYes')}
          </button>
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setConfirm(false)}>
            {t('common.cancel')}
          </button>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <LabErrorText error={error} />
        </div>
      )}
    </li>
  );
}
