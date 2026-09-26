import { supabase } from './supabase';
import { dataUrlToBlob } from './image';

/**
 * Supabase Storage (migration 016). Buckets are private: images are shown only through
 * short-lived signed URLs, which Storage creates only for users its read policy allows.
 * Files get a random name (<uuid>.jpg) and are never overwritten.
 */

export const PHOTO_BUCKET = 'measurement-photos';

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

/** Signed URL for a file, or null (not allowed / missing). */
export async function signedUrl(path, bucket = PHOTO_BUCKET) {
  if (!supabase || !path) return null;
  const key = `${bucket}/${path}`;
  const hit = signed.get(key);
  if (hit && hit.until - Date.now() > 60_000) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) {
    signed.delete(key);
    return null;
  }
  signed.set(key, { url: data.signedUrl, until: Date.now() + SIGNED_TTL * 1000 });
  return data.signedUrl;
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
