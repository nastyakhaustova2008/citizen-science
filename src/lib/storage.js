import { supabase } from './supabase';
import { dataUrlToBlob } from './image';

/**
 * Supabase Storage (migration 016). Buckets are private: images are shown only through
 * short-lived signed URLs, which Storage creates only for users its read policy allows.
 * Files get a random name (<uuid>.jpg) and are never overwritten.
 */

export const PHOTO_BUCKET = 'measurement-photos';
export const AVATAR_BUCKET = 'avatars';

// Signed URLs live 15 minutes; a cached one is reused while it has at least a minute left.
const SIGNED_TTL = 15 * 60;
const signed = new Map(); // `${bucket}/${path}` → { url, until }

export class UploadError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/**
 * Uploads a JPEG data URL → its path. code: 'not_allowed' (the upload rules refused: daily
 * limit, storage full, no username), 'too_large', 'network' / 'generic'.
 */
export async function uploadPhoto(dataUrl, bucket = PHOTO_BUCKET) {
  if (!supabase) throw new UploadError('generic');
  const path = `${crypto.randomUUID()}.jpg`;
  let blob;
  try {
    blob = await dataUrlToBlob(dataUrl);
  } catch {
    throw new UploadError('generic');
  }
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' });
  if (error) {
    const status = Number(error.status) || Number(error.statusCode) || 0;
    console.error('[storage] upload failed', error);
    if (status === 413 || /size/i.test(error.message || '')) throw new UploadError('too_large');
    if (status === 403 || /row-level security|unauthorized/i.test(error.message || '')) throw new UploadError('not_allowed');
    if (error.name === 'StorageUnknownError') throw new UploadError('network');
    throw new UploadError('generic');
  }
  return path;
}

// Requests made in the same tick are sent together (a list of avatars → one request per bucket).
const waiting = new Map(); // bucket → Map(path → [resolve])
const inFlight = new Map(); // `${bucket}/${path}` → Promise

async function flush(bucket) {
  const batch = waiting.get(bucket);
  waiting.delete(bucket);
  if (!batch) return;
  const paths = [...batch.keys()];
  let rows = [];
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(paths, SIGNED_TTL);
    if (!error) rows = data || [];
  } catch {
    rows = [];
  }
  const byPath = new Map(rows.filter((r) => r.signedUrl && !r.error).map((r) => [r.path, r.signedUrl]));
  for (const [path, resolvers] of batch) {
    const url = byPath.get(path) || null;
    const key = `${bucket}/${path}`;
    if (url) signed.set(key, { url, until: Date.now() + SIGNED_TTL * 1000 });
    else signed.delete(key);
    inFlight.delete(key);
    resolvers.forEach((r) => r(url));
  }
}

/** Signed URL for a file, or null (not allowed / missing). */
export function signedUrl(path, bucket = PHOTO_BUCKET) {
  if (!supabase || !path) return Promise.resolve(null);
  const key = `${bucket}/${path}`;
  const hit = signed.get(key);
  if (hit && hit.until - Date.now() > 60_000) return Promise.resolve(hit.url);
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = new Promise((resolve) => {
    if (!waiting.has(bucket)) {
      waiting.set(bucket, new Map());
      queueMicrotask(() => flush(bucket));
    }
    const batch = waiting.get(bucket);
    batch.set(path, [...(batch.get(path) || []), resolve]);
  });
  inFlight.set(key, promise);
  return promise;
}

/** Forget a cached URL (after a status change: the file may no longer be visible). */
export function forgetSignedUrl(path, bucket = PHOTO_BUCKET) {
  signed.delete(`${bucket}/${path}`);
}

/**
 * Best effort: deletes a file the database has queued (or an own file never attached). If it
 * fails, the daily sweep (Edge Function) deletes it.
 */
export async function removeFile(path, bucket = PHOTO_BUCKET) {
  forgetSignedUrl(path, bucket);
  if (!supabase || !path) return;
  try {
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) console.warn('[storage] remove failed (the daily sweep retries)', error.message);
  } catch (err) {
    console.warn('[storage] remove failed (the daily sweep retries)', err);
  }
}
