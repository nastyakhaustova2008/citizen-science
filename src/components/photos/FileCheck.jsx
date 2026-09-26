import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useI18n } from '../../i18n';
import { checkJpegUrl } from '../../lib/jpegCheck';
import { PHOTO_BUCKET, signedUrl } from '../../lib/storage';

// One check per file per page load (files are never overwritten — no update policy).
const results = new Map(); // `${bucket}/${path}` → Promise<result | null>

/**
 * Audit M1: the moderator's browser reads the stored file and looks for hidden data (EXIF / GPS,
 * XMP, IPTC, comments, extra data) before approving or when reviewing a picture.
 * → 'checking' | { ok, problems } | null (could not read the file). enabled=false → undefined.
 */
export function useFileCheck(path, bucket = PHOTO_BUCKET, enabled = true) {
  const key = `${bucket}/${path}`;
  const [state, setState] = useState(enabled && path ? 'checking' : undefined);
  useEffect(() => {
    if (!enabled || !path) {
      setState(undefined);
      return undefined;
    }
    let alive = true;
    setState('checking');
    if (!results.has(key)) {
      const p = signedUrl(path, bucket).then((url) => (url ? checkJpegUrl(url) : null));
      p.then((r) => r === null && results.delete(key)); // try again next time
      results.set(key, p);
    }
    results.get(key).then((r) => alive && setState(r));
    return () => {
      alive = false;
    };
  }, [key, path, bucket, enabled]);
  return state;
}

/**
 * The result for the moderator. `children` = the action offered when hidden data was found
 * (e.g. "Remove — personal information").
 */
export function FileCheckNotice({ check, children }) {
  const { t } = useI18n();
  if (check === undefined) return null;
  if (check === 'checking') {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink-faint" aria-live="polite">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
        {t('photos.fileCheck.checking')}
      </p>
    );
  }
  if (check === null) {
    return <p className="text-[11px] text-ink-faint">{t('photos.fileCheck.unreadable')}</p>;
  }
  if (check.ok) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-moss">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        {t('photos.fileCheck.ok')}
      </p>
    );
  }
  return (
    <div className="space-y-1.5 rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs" role="alert">
      <p className="flex items-start gap-1.5 font-semibold text-danger">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        {t('photos.fileCheck.flagged')}
      </p>
      <ul className="list-disc ps-5 text-ink-soft dark:text-paper/80">
        {check.problems.map((p) => (
          <li key={p}>{t(`photos.fileCheck.problems.${p}`)}</li>
        ))}
      </ul>
      {children}
    </div>
  );
}
