import { supabase } from './supabase';
import { CommentError } from './commentsApi';

/**
 * Measurement photos API (migration 016): thin wrappers over the security-definer RPCs.
 * Every rule is checked there. Errors come back as CommentError { code } (texts:
 * strings.js comments.errors.<code>), the same as comments — the moderation flow is shared.
 */

const CODES = [
  'not_logged_in',
  'no_username',
  'not_allowed',
  'not_found',
  'bad_request',
  'bad_state',
  'reason_required',
  'already_reported',
  'rate_limited',
];

/** Moderator's reasons for removing a photo (shown to its author). */
export const REMOVE_REASONS = ['people', 'personal_info', 'off_topic', 'other'];

async function rpc(name, args) {
  if (!supabase) throw new CommentError('generic');
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (CODES.includes(error.message)) throw new CommentError(error.message);
    console.error(`[photos] ${name}`, error);
    throw new CommentError('generic');
  }
  return data;
}

function fromRow(r) {
  return {
    path: r.path,
    measurementId: r.measurement_id,
    fieldKey: r.field_key,
    ownerId: r.owner_id,
    // pending | approved | hidden | removed | withdrawn
    status: r.status,
    createdAt: r.created_at,
    hiddenReason: r.hidden_reason,
    removedReason: r.removed_reason,
    mine: r.mine,
    reported: r.reported,
    reports: r.reports ?? 0,
  };
}

/** → { canModerate, photos } for one measurement (what this user may see). */
export async function listPhotos(measurementId) {
  const res = await rpc('photo_list', { p_measurement: measurementId });
  return { canModerate: Boolean(res?.can_moderate), photos: (res?.photos || []).map(fromRow) };
}

/** The author deletes their own photo. */
export async function withdrawPhoto(path) {
  return fromRow(await rpc('photo_withdraw', { p_path: path }));
}

/** action: 'approve' (also unhide / keep) | 'hide' | 'remove' (reason from REMOVE_REASONS). */
export async function moderatePhoto(path, action, reason = null) {
  return fromRow(await rpc('photo_moderate', { p_path: path, p_action: action, p_reason: reason }));
}

/** → { hidden } — true when this was the 3rd report and the photo is now hidden. */
export async function reportPhoto(path, reason) {
  const res = await rpc('photo_report', { p_path: path, p_reason: reason });
  return { hidden: Boolean(res?.hidden) };
}

/** Photos waiting for me (admins): pending, reported or hidden by reports, on labs I moderate. */
export async function photoQueue() {
  const rows = (await rpc('photo_queue', {})) || [];
  return rows.map((r) => ({
    ...fromRow(r),
    campaignId: r.campaign_id,
    slug: r.slug,
    titleHe: r.title_he,
    titleEn: r.title_en,
    titleRu: r.title_ru,
    lastReportAt: r.last_report_at,
    reasons: r.reasons || {},
  }));
}

export async function photoLog({ limit = 30, before = null } = {}) {
  const rows = await rpc('photo_log', { p_limit: limit, p_before: before });
  return (rows || []).map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    path: r.path,
    measurementId: r.measurement_id,
    campaignId: r.campaign_id,
    slug: r.slug,
    titleHe: r.title_he,
    titleEn: r.title_en,
    titleRu: r.title_ru,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    authorId: r.author_id,
    authorUsername: r.author_username,
    reports: r.reports,
    reason: r.reason,
  }));
}
