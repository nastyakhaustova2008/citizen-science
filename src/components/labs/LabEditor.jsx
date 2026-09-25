import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, ListChecks, BookOpen, Eye, Save, Trash2, AlertTriangle, RotateCcw } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAppData } from '../../context/AppDataContext';
import { LANGS, labToPayload, validateLab, line, block, splitPublished, revisionShape, submitChecklist } from '../../lib/labs';
import { saveLab, deleteLab, saveRevision } from '../../lib/labsApi';
import Tabs from '../Tabs';
import { Notice } from '../auth/AuthUI';
import LangSwitch from './LangSwitch';
import InfoForm from './InfoForm';
import FieldsEditor from './FieldsEditor';
import ProtocolForm from './ProtocolForm';
import FormPreview from './FormPreview';
import SubmitPanel from './SubmitPanel';
import RevisionPanel from './RevisionPanel';
import { LabErrorText } from './LabErrorText';

const tabOfPath = (path) => {
  if (path.startsWith('info.protocol')) return 'protocol';
  if (path.startsWith('info.')) return 'info';
  return 'fields';
};

const langOfPath = (path) => {
  const m = path.match(/_(he|en|ru)$/);
  return m ? m[1] : null;
};

/** Number of empty texts per language (titles, descriptions, labels of active fields / options). */
function missingTexts(lab) {
  const out = { he: 0, en: 0, ru: 0 };
  for (const l of LANGS) {
    if (!line(lab.title[l])) out[l] += 1;
    if (!block(lab.desc[l])) out[l] += 1;
    for (const f of lab.fields) {
      if (f.archived) continue;
      if (!line(f.label[l])) out[l] += 1;
      for (const o of f.options) if (!o.archived && !line(o.label[l])) out[l] += 1;
    }
  }
  return out;
}

/** After a save: every field / option now exists in the database (keys locked). */
const markSaved = (lab, res) => ({
  ...lab,
  id: res.id,
  slug: res.slug,
  editNo: res.editNo,
  slugEdited: true,
  fields: lab.fields.map((f) => ({
    ...f,
    saved: true,
    keyEdited: true,
    options: f.options.map((o) => ({ ...o, saved: true, keyEdited: true })),
  })),
});

/**
 * The lab editor (step 5a): Info · Fields · Protocol · Preview, one save for everything, plus the
 * review panel (5b: checklist, submit, withdraw). Drafts: anything goes (lab_save); in review:
 * like a draft, but must stay complete, and every save resets the approvals.
 * Published labs (5c): `live` = the published lab, `revision` = its open revision (or null);
 * `initial` = live with the revision on top (labs.js → labWithRevision). One Save splits the
 * changes: texts, labels, help, order, icon, map… go live at once (lab_save over the live
 * structure); structure and protocol go into the revision (lab_revision_save) and need 3 approvals.
 */
export default function LabEditor({ initial, live = null, revision = null, onReload }) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { refreshCampaigns } = useAppData();
  const [lab, setLab] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [tab, setTab] = useState('info');
  const [lang, setLang] = useState(locale);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [liveLab, setLiveLab] = useState(live); // published lab as it is now (after cosmetic saves)
  const [rev, setRev] = useState(revision);

  const isNew = !lab.id;
  const published = lab.publication === 'published';
  const strict = lab.publication !== 'draft';
  const dirty = useMemo(
    () => isNew || JSON.stringify(labToPayload(lab)) !== JSON.stringify(labToPayload(saved)),
    [lab, saved, isNew],
  );
  const missing = useMemo(() => missingTexts(lab), [lab]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const update = (fn) => {
    setNotice(null);
    setLab(fn);
  };

  /** A checklist item was clicked: its tab and language, and the missing field texts marked (cards open). */
  function goto(item) {
    setTab(item.tab);
    if (item.langs?.length) setLang(item.langs[0]);
    const missingFields = Object.fromEntries(
      Object.entries(submitChecklist(lab)).filter(([k]) => /^fields\.\d+\./.test(k)),
    );
    setErrors(missingFields);
  }

  function showErrors(errs) {
    setErrors(errs);
    const first = Object.keys(errs)[0];
    if (first) {
      setTab(tabOfPath(first));
      const l = langOfPath(first);
      if (l) setLang(l);
    }
  }

  /** Published lab: cosmetic part live, structural part into the revision. */
  async function savePublished() {
    const { cosmetic, revision: proposal, structural } = splitPublished(liveLab, lab);
    let nextLive = liveLab;
    let changed = false;
    if (JSON.stringify(labToPayload(cosmetic)) !== JSON.stringify(labToPayload(liveLab))) {
      const res = await saveLab(cosmetic);
      nextLive = markSaved(cosmetic, res);
      changed = changed || res.changed;
      setLiveLab(nextLive);
    }
    let nextRev = rev;
    const savedProposal = splitPublished(liveLab, saved).revision;
    const revChanged = revisionShape(nextLive, proposal) !== revisionShape(nextLive, savedProposal);
    if ((structural.length > 0 && !rev) || (rev && revChanged)) {
      const r = await saveRevision(lab.id, rev, proposal);
      nextRev = r.revisionId
        ? { ...(rev || { round: 0, approvals: 0 }), id: r.revisionId, editNo: r.editNo, status: r.status }
        : null;
      // in review: a new round (approvals reset)
      if (rev && r.revisionId && r.changed && rev.status === 'in_review') nextRev.round = rev.round + 1;
      changed = changed || r.changed;
      setRev(nextRev);
    }
    const next = markSaved({ ...lab, editNo: nextLive.editNo }, { id: lab.id, slug: lab.slug, editNo: nextLive.editNo });
    setLab(next);
    setSaved(next);
    setErrors({});
    setNotice(!changed ? t('labs.editor.nothingChanged') : nextRev ? t('labs.revision.savedWithRevision') : t('labs.editor.saved'));
    await refreshCampaigns();
  }

  async function onSave() {
    setServerError(null);
    setNotice(null);
    const errs = validateLab(lab, { strict });
    if (Object.keys(errs).length) {
      showErrors(errs);
      return;
    }
    setBusy(true);
    try {
      if (published) {
        await savePublished();
        return;
      }
      const res = await saveLab(lab);
      const next = markSaved(lab, res);
      setLab(next);
      setSaved(next);
      setErrors({});
      setNotice(res.changed ? t('labs.editor.saved') : t('labs.editor.nothingChanged'));
      await refreshCampaigns();
      if (isNew) navigate(`/labs/${res.id}/edit`, { replace: true });
    } catch (err) {
      if (err.code === 'invalid_lab' && err.details) showErrors(err.details);
      else setServerError(err);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    setServerError(null);
    try {
      await deleteLab(lab.id);
      await refreshCampaigns();
      navigate('/profile#admin', { replace: true });
    } catch (err) {
      setServerError(err);
      setBusy(false);
    }
  }

  const errorCount = (id) => Object.keys(errors).filter((k) => tabOfPath(k) === id).length || null;
  const tabs = [
    { id: 'info', label: t('labs.tabs.info'), icon: FileText, count: errorCount('info') },
    { id: 'fields', label: t('labs.tabs.fields'), icon: ListChecks, count: errorCount('fields') },
    { id: 'protocol', label: t('labs.tabs.protocol'), icon: BookOpen, count: errorCount('protocol') },
    { id: 'preview', label: t('labs.tabs.preview'), icon: Eye },
  ];
  const errorTotal = Object.keys(errors).length;

  return (
    <div className="space-y-4 pb-24">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="font-serif text-2xl font-bold text-ink dark:text-paper">
            {isNew ? t('labs.editor.newTitle') : t('labs.editor.editTitle')}
          </h1>
          <span className={`chip ${published ? 'chip-active' : ''}`}>{t(`labs.publication.${lab.publication}`)}</span>
        </div>
        {!isNew && published && (
          <Link to={`/observations/${lab.slug}`} className="text-sm text-ink-faint underline underline-offset-2">
            {t('labs.editor.openLab')}
          </Link>
        )}
        {published ? (
          <p className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-ink dark:text-paper">
            {t('labs.editor.publishedRules')}
          </p>
        ) : (
          <p className="text-sm text-ink-faint">
            {lab.publication === 'in_review' ? t('labs.editor.inReviewRules') : t('labs.editor.draftRules')}
          </p>
        )}
      </header>

      {published ? (
        <RevisionPanel
          lab={lab}
          live={liveLab}
          rev={rev}
          dirty={dirty}
          onGoto={goto}
          onChanged={(next) => setRev(next)}
          onDiscarded={onReload}
        />
      ) : (
        <SubmitPanel
          lab={lab}
          dirty={dirty}
          onGoto={goto}
          onChanged={({ publication, editNo }) => {
            setLab((d) => ({ ...d, publication, editNo }));
            setSaved((d) => ({ ...d, publication, editNo }));
            setNotice(null);
            setServerError(null);
          }}
        />
      )}

      {tab !== 'preview' && (
        <div className="sticky top-[61px] z-20 -mx-4 bg-paper/90 px-4 py-2 backdrop-blur dark:bg-char/90 sm:mx-0 sm:rounded-lg sm:px-2">
          <LangSwitch value={lang} onChange={setLang} missing={missing} label={t('labs.editor.textLanguage')} />
        </div>
      )}

      <Tabs tabs={tabs} active={tab} onChange={setTab} idBase="lab-editor" />
      <div role="tabpanel" id={`lab-editor-panel-${tab}`} aria-labelledby={`lab-editor-${tab}`}>
        {tab === 'info' && <InfoForm lab={lab} update={update} lang={lang} errors={errors} published={published} />}
        {tab === 'fields' && (
          <FieldsEditor lab={lab} update={update} lang={lang} errors={errors} live={published ? liveLab : null} />
        )}
        {tab === 'protocol' && (
          <ProtocolForm lab={lab} update={update} lang={lang} errors={errors} live={published ? liveLab : null} />
        )}
        {tab === 'preview' && <FormPreview lab={lab} />}
      </div>

      {!isNew && lab.publication === 'draft' && (
        <div className="border-t border-edge pt-4 dark:border-white/10">
          {confirmDelete ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm">{t('labs.editor.deleteConfirm')}</span>
              <button type="button" className="btn-secondary text-danger" disabled={busy} onClick={onDelete}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                {t('labs.editor.deleteYes')}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <button type="button" className="btn-ghost text-sm text-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {t('labs.editor.deleteDraft')}
            </button>
          )}
        </div>
      )}

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 z-[1001] border-t border-edge bg-paper-raised/95 backdrop-blur dark:border-white/10 dark:bg-char-raised/95">
        <div className="mx-auto flex max-w-content flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1 space-y-1 text-sm" aria-live="polite">
            {serverError?.code === 'edited_elsewhere' ? (
              <div className="flex flex-wrap items-center gap-2">
                <LabErrorText error={serverError} />
                <button type="button" className="btn-secondary !py-1.5 text-xs" onClick={onReload}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('labs.editor.reload')}
                </button>
              </div>
            ) : serverError ? (
              <LabErrorText error={serverError} />
            ) : errorTotal > 0 ? (
              <p className="flex items-center gap-1.5 text-danger">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t('labs.editor.fixErrors', { count: errorTotal })}
              </p>
            ) : notice ? (
              <Notice>{notice}</Notice>
            ) : (
              <p className="text-ink-faint">{dirty ? t('labs.editor.unsaved') : t('labs.editor.allSaved')}</p>
            )}
          </div>
          <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={onSave}>
            <Save className="h-4 w-4" aria-hidden="true" />
            {busy ? t('labs.saving') : isNew ? t('labs.editor.createDraft') : t('labs.editor.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
