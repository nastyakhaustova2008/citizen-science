import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { useI18n } from '../../i18n';
import { signedUrl } from '../../lib/storage';
import { Skeleton } from '../primitives';

/**
 * A photo from the private bucket, through a short-lived signed URL. Storage creates the URL only
 * when its read policy allows this user (016); otherwise a "could not load" line is shown.
 */
export default function PhotoImage({ path, alt, className = '', dim = false }) {
  const { t } = useI18n();
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error

  useEffect(() => {
    let alive = true;
    setState('loading');
    setUrl(null);
    signedUrl(path).then((u) => {
      if (!alive) return;
      setUrl(u);
      setState(u ? 'ready' : 'error');
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (state === 'loading') return <Skeleton className="h-48 w-full rounded-lg" />;
  if (state === 'error') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ink-faint">
        <ImageOff className="h-4 w-4" aria-hidden="true" />
        {t('photos.loadError')}
      </p>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setState('error')}
      className={`w-full rounded-lg border border-edge dark:border-white/10 ${dim ? 'opacity-60' : ''} ${className}`}
    />
  );
}
