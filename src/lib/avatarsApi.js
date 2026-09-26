import { supabase } from './supabase';
import { CommentError, reportRpc } from './commentsApi';
import { AVATAR_BUCKET, UploadError, uploadPhoto } from './storage';

/**
 * Profile pictures API (migration 017): thin wrappers over the security-definer RPCs. Every rule
 * is checked there. Errors come back as CommentError { code } (texts: avatars.errors.<code>, then
 * the shared comments.errors.<code>) — reports and moderation work like comments.
 */

const CODES = [
  'not_logged_in',
  'no_username',
  'not_allowed',
  'not_found',
  'bad_request',
  'bad_state',
  'photo_missing',
  'consent_required',
  'reason_too_long',
  'already_reported',
  'rate_limited',
];

async function rpc(name, args) {
  if (!supabase) throw new CommentError('generic');
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (CODES.includes(error.message)) throw new CommentError(error.message);
    console.error(`[avatars] ${name}`, error);
    throw new CommentError('generic');
  }
  return data;
}

export function avatarFromRow(r) {
  if (!r) return null;
  return {
    userId: r.user_id,
    path: r.path,
    // student | admin
    kind: r.kind,
    // student: active | hidden; admin: pending | confirmed | hidden
    status: r.status,
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
    hiddenReason: r.hidden_reason,
    mine: r.mine,
    reported: r.reported,
    reports: r.reports ?? 0,
  };
}

function meFromRow(r) {
  return {
    avatar: avatarFromRow(r?.avatar),
    rejected: r?.rejected ? { reason: r.rejected.reason, at: r.rejected.at } : null,
    confirmerUsername: r?.confirmer_username || null,
    // The owner's switch: admins need a confirmed photo for lab work.
    required: Boolean(r?.required),
  };
}

/** → { avatar, rejected, confirmerUsername, required } */
export async function myAvatar() {
  return meFromRow(await rpc('avatar_me', {}));
}

/**
 * Upload a prepared JPEG data URL (image.js prepareAvatar) and use it as my picture.
 * Admins must pass consent = true. Throws UploadError (upload) or CommentError (RPC).
 */
export async function setMyAvatar(dataUrl, consent = false) {
  const path = await uploadPhoto(dataUrl, AVATAR_BUCKET);
  return meFromRow(await rpc('avatar_set', { p_path: path, p_consent: Boolean(consent) }));
}

export async function removeMyAvatar() {
  return meFromRow(await rpc('avatar_remove', {}));
}

/** { userId: path } of the pictures I may see next to names (logged-in users only). */
export async function avatarPaths(ids) {
  return (await rpc('avatar_paths', { p_ids: ids })) || {};
}

/** One user's picture with what I may do: { avatar, canModerate, canConfirm } | null. */
export async function getAvatar(userId) {
  const r = await rpc('avatar_get', { p_user: userId });
  if (!r) return null;
  return { avatar: avatarFromRow(r.avatar), canModerate: Boolean(r.can_moderate), canConfirm: Boolean(r.can_confirm) };
}

/** → { hidden } — true when this report hid a student picture (3 reports). */
export async function reportAvatar(userId, reason) {
  const res = await reportRpc('avatar_report', { p_user: userId, p_reason: reason }, rpc);
  return { hidden: Boolean(res?.hidden) };
}

/** Confirmer: approve (true) or reject (false, optional reason) a pending admin photo. */
export async function confirmAvatar(userId, approve, reason = null) {
  return avatarFromRow(await rpc('avatar_confirm', { p_user: userId, p_approve: approve, p_reason: reason || null }));
}

/** Main admins / owner. action: 'hide' | 'unhide' (also "keep") | 'delete' → the picture or null. */
export async function moderateAvatar(userId, action) {
  return avatarFromRow(await rpc('avatar_moderate', { p_user: userId, p_action: action }));
}

/** What waits for me: admin photos to confirm; reported pictures (main admins / owner). */
export async function avatarQueue() {
  const rows = (await rpc('avatar_queue', {})) || [];
  return rows.map((r) => ({
    ...avatarFromRow(r),
    username: r.username,
    fullName: r.full_name,
    workplace: r.workplace,
    queue: r.queue, // confirm | reported
    reasons: r.reasons || {},
    lastReportAt: r.last_report_at,
  }));
}

export async function avatarLog({ limit = 30, before = null } = {}) {
  const rows = await rpc('avatar_log', { p_limit: limit, p_before: before });
  return (rows || []).map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    userId: r.user_id,
    username: r.username,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    kind: r.kind,
    reports: r.reports,
    reason: r.reason,
  }));
}

export { UploadError };
