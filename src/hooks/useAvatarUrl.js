import { useEffect, useState } from 'react';
import { AVATAR_BUCKET, signedUrl } from '../lib/storage';

/**
 * Signed URL of a profile picture (migration 017), or null while loading / not allowed / no path.
 * Requests of the same moment are batched in storage.js; URLs are cached until shortly before
 * they expire.
 */
export default function useAvatarUrl(path) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (path) signedUrl(path, AVATAR_BUCKET).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [path]);
  return url;
}
