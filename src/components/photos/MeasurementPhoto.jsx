import { useState } from 'react';
import { Clock, EyeOff, ImageOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { REPORT_REASONS } from '../../lib/comments';
import { REMOVE_REASONS } from '../../lib/photosApi';
import { photoState } from '../../lib/fields';
import { LoginPrompt, Skeleton } from '../primitives';
import PhotoImage from './PhotoImage';
import ReasonPicker from './ReasonPicker';
import PhotoErrorText from './PhotoErrorText';
import { FileCheckNotice, useFileCheck } from './FileCheck';

const action = 'tap-target rounded px-1.5 py-0.5 text-[11px] font-semibold text-ink-faint hover:bg-paper-sunk hover:text-ink dark:hover:bg-white/5 dark:hover:text-paper';

/**
 * One photo field of a measurement in the point panel (016).
 * Value true → attached before photos were stored (no file); "removed" → deleted; a path → the
 * stored photo, shown per its status: approved — every logged-in user; pending / hidden — only its
 * author (with a note) and the lab's moderators. Actions: author — delete; others — report;
 * moderators — approve / keep / show again, hide, remove with a reason. The server re-checks all.
 */
export default function MeasurementPhoto({ field, label, value, alt, photos }) {
  const { t } = useI18n();
  const [mode, setMode] = useState(null); // report | remove | withdraw
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const state = photoState(value);
  const p = state === 'stored' && photos.ready ? photos.byPath(value) : null;
  const mod = photos.canModerate;
  // Audit M1: moderators see whether the stored file still has hidden data (location…).
  // Only when there is a decision to make (waiting, hidden, reported) — each check downloads the file.
  const decide = Boolean(p && (p.status === 'pending' || p.status === 'hidden' || (p.status === 'approved' && p.reports > 0)));
  const check = useFileCheck(p?.path, undefined, Boolean(mod) && decide);

  async function run(fn, after) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      setMode(null);
      after?.(res);
    } catch (err) {
      setError({ code: err.code || 'generic' });
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (state === 'legacy') {
    body = <Note icon={ImageOff}>{t('fields.photo.legacy')}</Note>;
  } else if (state === 'removed' || (p && (p.status === 'removed' || p.status === 'withdrawn'))) {
    body = (
      <Note icon={ImageOff}>
        {p?.status === 'withdrawn'
          ? t('photos.withdrawn')
          : p?.removedReason && (p.mine || mod)
            ? t('photos.removedWithReason', { reason: t(`photos.removeReasons.${p.removedReason}`) })
            : t('fields.photo.removed')}
      </Note>
    );
  } else if (!photos.loggedIn) {
    body = <LoginPrompt className="text-xs" message={t('photos.loginToSee')} />;
  } else if (!photos.ready) {
    body = <Skeleton className="h-48 w-full rounded-lg" />;
  } else if (photos.error) {
    body = <Note icon={ImageOff}>{t('photos.loadError')}</Note>;
  } else if (!p) {
    body = <Note icon={Clock}>{t('photos.notAvailable')}</Note>;
  } else {
    body = (
      <>
        {p.status === 'pending' && (
          <Note icon={Clock} strong>
            {p.mine && !mod ? t('photos.pendingMine') : t('photos.pendingMod')}
          </Note>
        )}
        {p.status === 'hidden' && (
          <Note icon={EyeOff} strong>
            {t(p.hiddenReason === 'reports' ? 'photos.hiddenByReports' : 'photos.hiddenByModerator')}
            {!mod && p.mine && <span className="font-normal"> — {t('photos.hiddenMine')}</span>}
          </Note>
        )}
        <PhotoImage path={p.path} alt={alt} dim={p.status !== 'approved'} className="mt-1" />
        <FileCheckNotice check={check}>
          <button
            type="button"
            className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
            disabled={busy}
            onClick={() => run(() => photos.moderate(p, 'remove', 'personal_info'))}
          >
            {t('photos.fileCheck.removeForData')}
          </button>
        </FileCheckNotice>
        {mod && p.reports > 0 && (
          <p className="mt-0.5 text-[11px] font-semibold text-danger">{t('comments.reportsCount', { count: p.reports })}</p>
        )}
        {mode === 'report' ? (
          <ReasonPicker
            name={`photo-report-${p.path}`}
            title={t('photos.reportTitle')}
            reasons={REPORT_REASONS}
            labelKey="comments.reasons"
            sendLabel={t('comments.reportSend')}
            busy={busy}
            onSend={(r) =>
              run(
                () => photos.report(p, r),
                (res) => setNotice(res.hidden ? 'photos.reportHidden' : 'comments.reportDone'),
              )
            }
            onCancel={() => setMode(null)}
          />
        ) : mode === 'remove' ? (
          <ReasonPicker
            name={`photo-remove-${p.path}`}
            title={t('photos.removeTitle')}
            reasons={REMOVE_REASONS}
            labelKey="photos.removeReasons"
            sendLabel={t('photos.removeSend')}
            danger
            busy={busy}
            onSend={(r) => run(() => photos.moderate(p, 'remove', r))}
            onCancel={() => setMode(null)}
          />
        ) : mode === 'withdraw' ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
            <span>{t('photos.confirmWithdraw')}</span>
            <button
              type="button"
              className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
              disabled={busy}
              onClick={() => run(() => photos.withdraw(p))}
            >
              {t('photos.withdraw')}
            </button>
            <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setMode(null)}>
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <div className="mt-0.5 flex flex-wrap gap-x-1">
            {mod && p.status === 'pending' && (
              <button
                type="button"
                className={action}
                disabled={busy || check === 'checking'}
                onClick={() => run(() => photos.moderate(p, 'approve'))}
              >
                {t('photos.approve')}
              </button>
            )}
            {mod && p.status === 'hidden' && (
              <button type="button" className={action} disabled={busy} onClick={() => run(() => photos.moderate(p, 'approve'))}>
                {t('comments.unhide')}
              </button>
            )}
            {mod && p.status === 'approved' && p.reports > 0 && (
              <button type="button" className={action} disabled={busy} onClick={() => run(() => photos.moderate(p, 'approve'))}>
                {t('comments.keep')}
              </button>
            )}
            {mod && p.status === 'approved' && (
              <button type="button" className={action} disabled={busy} onClick={() => run(() => photos.moderate(p, 'hide'))}>
                {t('comments.hide')}
              </button>
            )}
            {mod && (
              <button type="button" className={`${action} !text-danger`} onClick={() => setMode('remove')}>
                {t('photos.remove')}
              </button>
            )}
            {p.mine && (
              <button type="button" className={action} onClick={() => setMode('withdraw')}>
                {t('photos.withdraw')}
              </button>
            )}
            {!p.mine && p.status === 'approved' && !p.reported && (
              <button type="button" className={action} onClick={() => setMode('report')}>
                {t('comments.report')}
              </button>
            )}
            {!p.mine && p.reported && <span className="px-1.5 py-0.5 text-[11px] text-ink-faint">{t('comments.reported')}</span>}
          </div>
        )}
      </>
    );
  }

  return (
    <figure>
      <figcaption className="mb-1 text-xs text-ink-faint">
        {label}
        {field.archived && <span className="ms-1 italic">({t('fields.archived')})</span>}
      </figcaption>
      {body}
      {notice && (
        <p className="mt-1 text-[11px] text-ink-faint" role="status">
          {t(notice)}
        </p>
      )}
      <PhotoErrorText error={error} className="mt-1" />
    </figure>
  );
}

function Note({ icon: Icon, strong = false, children }) {
  return (
    <p className={`flex items-start gap-1.5 text-xs ${strong ? 'font-semibold text-bark dark:text-bark-light' : 'text-ink-faint'}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
