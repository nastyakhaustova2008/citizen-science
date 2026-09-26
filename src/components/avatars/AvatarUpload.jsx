import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, EyeOff, ImagePlus, Trash2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useAuth } from '../../context/AuthContext';
import { prepareAvatar } from '../../lib/image';
import { removeMyAvatar, setMyAvatar as saveMyAvatar, UploadError } from '../../lib/avatarsApi';
import { AVATAR_BUCKET, removeFile } from '../../lib/storage';
import { isolate } from '../auth/AuthUI';
import { Avatar, SectionHeading, SkeletonText } from '../primitives';
import AvatarErrorText from './AvatarErrorText';

const ADMIN_ROLES = ['admin', 'main_admin', 'owner'];

/**
 * Own profile → picture (017). Students: any image (a drawing or an avatar is suggested).
 * Admins: a photo of their own face with consent; it waits for their appointer's confirmation
 * (the owner's is confirmed at once) and every new photo waits again.
 * The browser sends a 256 px square without metadata; the old file is deleted right away.
 */
export default function AvatarUpload() {
  const { t } = useI18n();
  const { currentUser, profile, myAvatar, setMyAvatar } = useAuth();
  const [preview, setPreview] = useState(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const isAdmin = ADMIN_ROLES.includes(profile?.role);
  const current = myAvatar?.avatar || null;

  async function pick(file) {
    setError(null);
    setPreview(null);
    if (!file) return;
    try {
      setPreview(await prepareAvatar(file));
    } catch {
      // Never fall back to the original file: it may carry the GPS position.
      setError({ code: 'unsupported' });
    }
  }

  async function run(fn) {
    setBusy(true);
    setError(null);
    const old = current?.path;
    try {
      const next = await fn();
      setMyAvatar(next);
      setPreview(null);
      setConsent(false);
      setConfirmRemove(false);
      if (old && old !== next.avatar?.path) removeFile(old, AVATAR_BUCKET);
    } catch (err) {
      setError({ code: err instanceof UploadError ? `upload_${err.code}` : err.code || 'generic' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="profile-picture" className="scroll-mt-4">
      <SectionHeading
        as="h2"
        title={t(isAdmin ? 'avatars.adminTitle' : 'avatars.title')}
        subtitle={t(isAdmin ? 'avatars.adminSubtitle' : 'avatars.subtitle')}
      />
      <div className="surface max-w-xl space-y-3 p-4 text-sm">
        {myAvatar === undefined ? (
          <SkeletonText lines={2} />
        ) : (
          <>
            {isAdmin && myAvatar.required && current?.status !== 'confirmed' && (
              <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-2.5 text-ink dark:text-paper" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                {t('avatars.requiredNote')}
              </p>
            )}

            <div className="flex items-center gap-4">
              {preview ? (
                <img src={preview} alt={t('avatars.previewAlt')} width={72} height={72} className="h-[72px] w-[72px] rounded-xl border border-edge object-cover dark:border-white/10" />
              ) : (
                <Avatar user={currentUser} size={72} path={current?.path ?? null} className="!rounded-xl" />
              )}
              <div className="min-w-0 flex-1 space-y-1">
                <Status current={current} rejected={myAvatar.rejected} confirmer={myAvatar.confirmerUsername} />
              </div>
            </div>

            <p className="text-xs text-ink-faint">{t(isAdmin ? 'avatars.adminHint' : 'avatars.studentHint')}</p>

            <div className="flex flex-wrap items-center gap-2">
              <label className="btn-secondary cursor-pointer !py-1.5 text-xs">
                <ImagePlus className="h-4 w-4" aria-hidden="true" />
                {t(current ? 'avatars.change' : 'avatars.choose')}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    pick(file);
                  }}
                />
              </label>
              {current && !preview && (
                <button type="button" className="btn-ghost !py-1.5 text-xs text-danger" onClick={() => setConfirmRemove(true)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t('avatars.remove')}
                </button>
              )}
            </div>

            {preview && (
              <div className="space-y-2 rounded-lg border border-edge p-3 dark:border-white/10">
                {isAdmin && (
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-0.5 accent-bark" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                    <span>{t('avatars.consent')}</span>
                  </label>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary !py-1.5 text-xs"
                    disabled={busy || (isAdmin && !consent)}
                    onClick={() => run(() => saveMyAvatar(preview, isAdmin && consent))}
                  >
                    {busy ? t('common.loading') : t('avatars.save')}
                  </button>
                  <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setPreview(null)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}

            {confirmRemove && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span>{t(isAdmin ? 'avatars.confirmRemoveAdmin' : 'avatars.confirmRemove')}</span>
                <button
                  type="button"
                  className="btn-primary !bg-danger !px-2.5 !py-1 text-xs hover:!bg-danger/90"
                  disabled={busy}
                  onClick={() => run(removeMyAvatar)}
                >
                  {t('avatars.remove')}
                </button>
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setConfirmRemove(false)}>
                  {t('common.cancel')}
                </button>
              </div>
            )}

            <AvatarErrorText error={error} />
          </>
        )}
      </div>
    </section>
  );
}

function Status({ current, rejected, confirmer }) {
  const { t } = useI18n();
  const line = (Icon, cls, text) => (
    <p className={`flex items-start gap-1.5 text-xs ${cls}`}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
  if (!current) {
    if (rejected) {
      return line(
        AlertTriangle,
        'text-danger',
        rejected.reason ? t('avatars.rejectedWithReason', { reason: isolate(rejected.reason) }) : t('avatars.rejected'),
      );
    }
    return line(ImagePlus, 'text-ink-faint', t('avatars.none'));
  }
  if (current.status === 'hidden') {
    return line(EyeOff, 'font-semibold text-bark dark:text-bark-light',
      t(current.hiddenReason === 'reports' ? 'avatars.hiddenByReportsMine' : 'avatars.hiddenByModeratorMine'));
  }
  if (current.status === 'pending') {
    return line(Clock, 'font-semibold text-bark dark:text-bark-light',
      confirmer ? t('avatars.pendingMine', { name: isolate(confirmer) }) : t('avatars.pendingMineNoName'));
  }
  if (current.status === 'confirmed') return line(CheckCircle2, 'text-ok', t('avatars.confirmedMine'));
  return line(CheckCircle2, 'text-ok', t('avatars.activeMine'));
}
