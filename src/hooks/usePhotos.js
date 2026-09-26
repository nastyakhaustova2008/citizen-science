import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppData } from '../context/AppDataContext';
import { listPhotos, moderatePhoto, reportPhoto, withdrawPhoto } from '../lib/photosApi';
import { forgetSignedUrl, removeFile } from '../lib/storage';

/**
 * The stored photos of one measurement (migration 016) that this user may see, loaded when the
 * point panel opens. Logged-in users only. Actions throw CommentError (shared moderation texts).
 * After a photo is deleted (removed / withdrawn) the file is deleted right away through the
 * Storage API; if that fails, the daily sweep does it.
 */
export default function usePhotos(measurementId) {
  const { currentUser, reloadPhotoQueue } = useAppData();
  const loggedIn = Boolean(currentUser);
  const [photos, setPhotos] = useState([]);
  const [canModerate, setCanModerate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // The measurement the current list belongs to (the panel can switch points).
  const [loadedFor, setLoadedFor] = useState(null);
  const request = useRef(0);

  const load = useCallback(async () => {
    if (!loggedIn || !measurementId) {
      request.current++;
      setPhotos([]);
      setCanModerate(false);
      setLoadedFor(null);
      return;
    }
    const mine = ++request.current;
    setLoading(true);
    setError(false);
    try {
      const res = await listPhotos(measurementId);
      if (mine !== request.current) return;
      setPhotos(res.photos);
      setCanModerate(res.canModerate);
    } catch {
      if (mine !== request.current) return;
      setPhotos([]);
      setCanModerate(false);
      setError(true);
    } finally {
      if (mine === request.current) {
        setLoadedFor(measurementId);
        setLoading(false);
      }
    }
  }, [loggedIn, measurementId]);

  useEffect(() => {
    load();
  }, [load]);

  const replace = (next) => setPhotos((prev) => prev.map((p) => (p.path === next.path ? next : p)));
  const afterChange = (next) => {
    replace(next);
    forgetSignedUrl(next.path);
    if (next.status === 'removed' || next.status === 'withdrawn') removeFile(next.path);
  };

  const withdraw = useCallback(async (photo) => {
    afterChange(await withdrawPhoto(photo.path));
  }, []);

  const moderate = useCallback(
    async (photo, action, reason) => {
      afterChange(await moderatePhoto(photo.path, action, reason));
      reloadPhotoQueue();
    },
    [reloadPhotoQueue],
  );

  const report = useCallback(
    async (photo, reason) => {
      const res = await reportPhoto(photo.path, reason);
      setPhotos((prev) =>
        prev.map((p) =>
          p.path === photo.path ? { ...p, reported: true, status: res.hidden ? 'hidden' : p.status } : p,
        ),
      );
      if (res.hidden) forgetSignedUrl(photo.path);
      return res;
    },
    [],
  );

  const byPath = useCallback((path) => photos.find((p) => p.path === path) || null, [photos]);
  const ready = loggedIn && loadedFor === measurementId && !loading;

  return { photos, byPath, ready, canModerate, loading, error, reload: load, withdraw, moderate, report, loggedIn };
}
