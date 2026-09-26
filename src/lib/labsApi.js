import { supabase } from './supabase';
import { labToPayload, revisionFromApi } from './labs';
import { fetchAllPaged } from './paging';

/**
 * Lab editor API (roadmap steps 5a / 5b / 5c): thin wrappers over the RPCs in
 * supabase/migrations/010_lab_editor.sql, 011_lab_review.sql and 012_lab_revisions.sql.
 * Every rule is checked there; errors come back as
 * LabError { code, details } — details is the parsed JSON for invalid_lab ({path: code}),
 * structural_change ([path]), not_ready ({path: code}) and invalid_admin_profile ({field: code}).
 */

const CODES = [
  'not_logged_in',
  'not_allowed',
  'admin_profile_required',
  'admin_photo_required',
  'not_found',
  'edited_elsewhere',
  'invalid_lab',
  'structural_change',
  'has_measurements',
  'invalid_admin_profile',
  // 5b — review
  'bad_state',
  'not_ready',
  'round_changed',
  'own_lab',
  'edited_this_round',
  'already_reviewed',
  'comment_required',
  'comment_too_long',
  // 5c — revisions
  'own_revision',
];

export class LabError extends Error {
  constructor(code, details = null) {
    super(code);
    this.code = code;
    this.details = details;
  }
}

function parseDetails(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

async function rpc(name, args) {
  if (!supabase) throw new LabError('generic');
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (CODES.includes(error.message)) throw new LabError(error.message, parseDetails(error.details));
    console.error(`[labs] ${name}`, error);
    throw new LabError('generic');
  }
  return data;
}

/**
 * A set-returning RPC read in full, page by page (the Data API cuts at 1000 rows — paging.js).
 * `order` = [[column, ascending], …], ending with a unique column.
 */
async function rpcAll(name, args, order) {
  if (!supabase) throw new LabError('generic');
  try {
    const { rows } = await fetchAllPaged((o) =>
      order.reduce((q, [col, ascending]) => q.order(col, { ascending }), supabase.rpc(name, args, o)),
    );
    return rows;
  } catch (error) {
    if (CODES.includes(error?.message)) throw new LabError(error.message, parseDetails(error.details));
    console.error(`[labs] ${name}`, error);
    throw new LabError('generic');
  }
}

/** Save the whole editor state (new lab when lab.id is null). → { id, slug, editNo, changed } */
export async function saveLab(lab) {
  const { info, fields } = labToPayload(lab);
  const res = await rpc('lab_save', { p_id: lab.id, p_edit_no: lab.editNo, p_info: info, p_fields: fields });
  return { id: res.id, slug: res.slug, editNo: res.edit_no, changed: res.changed };
}

export const deleteLab = (id) => rpc('lab_delete', { p_id: id });

export const canEditLab = (id) => rpc('lab_can_edit', { p_id: id });

/** Every lab with who created it and what I may do (admins). */
export async function adminLabs() {
  const rows = await rpcAll('lab_admin_list', {}, [['updated_at', false], ['id', true]]);
  return (rows || []).map((r) => ({
    id: r.id,
    slug: r.slug,
    titleHe: r.title_he,
    titleEn: r.title_en,
    titleRu: r.title_ru,
    icon: r.icon,
    publication: r.publication,
    status: r.status,
    createdBy: r.created_by,
    creatorUsername: r.creator_username,
    creatorFullName: r.creator_full_name,
    canEdit: r.can_edit,
    canDelete: r.can_delete,
    measurementCount: Number(r.measurement_count),
    updatedAt: r.updated_at,
  }));
}

/** Lab change log, newest first. campaignId null = all labs; before = id of the last row shown. */
export async function labLog({ campaignId = null, limit = 30, before = null } = {}) {
  const rows = await rpc('lab_log', { p_campaign: campaignId, p_limit: limit, p_before: before });
  return (rows || []).map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    campaignId: r.campaign_id,
    slug: r.slug,
    titleHe: r.title_he,
    titleEn: r.title_en,
    titleRu: r.title_ru,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    details: r.details || {},
    round: r.round,
  }));
}

/* ---- Admin profile ------------------------------------------------ */

/** My admin profile, or null (not filled yet). */
export async function myAdminProfile(userId) {
  if (!supabase) throw new LabError('generic');
  const { data, error } = await supabase
    .from('admin_profiles')
    .select('full_name, workplace, position, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[labs] admin profile', error);
    throw new LabError('generic');
  }
  return data ? { fullName: data.full_name, workplace: data.workplace, position: data.position || '' } : null;
}

export async function saveAdminProfile({ fullName, workplace, position }) {
  const rows = await rpc('admin_profile_save', {
    p_full_name: fullName,
    p_workplace: workplace,
    p_position: position || null,
  });
  const r = rows?.[0];
  return r ? { fullName: r.full_name, workplace: r.workplace, position: r.position || '' } : null;
}

/* ---- Review (step 5b, migration 011) ------------------------------- */

/** Draft → in review. → the new edit_no. */
export const submitLab = (id, editNo) => rpc('lab_submit', { p_id: id, p_edit_no: editNo });

/** In review → draft. → the new edit_no. */
export const withdrawLab = (id) => rpc('lab_withdraw', { p_id: id });

/** verdict 'approve' | 'changes' (comment required). → { publication, approvals } */
export const reviewLab = (id, round, verdict, comment = '') =>
  rpc('lab_review', { p_id: id, p_round: round, p_verdict: verdict, p_comment: comment });

/**
 * Labs and revisions in review. kind: 'lab' | 'revision' (then revisionId is set; createdBy /
 * creator* = who proposed it). myState: can_review | own_lab | own_revision | edited_this_round |
 * already_reviewed.
 */
export async function reviewQueue() {
  const rows = await rpc('lab_review_queue', {});
  return (rows || []).map((r) => ({
    kind: r.kind || 'lab',
    revisionId: r.revision_id ?? null,
    id: r.id,
    slug: r.slug,
    titleHe: r.title_he,
    titleEn: r.title_en,
    titleRu: r.title_ru,
    icon: r.icon,
    createdBy: r.created_by,
    creatorUsername: r.creator_username,
    creatorFullName: r.creator_full_name,
    submittedAt: r.submitted_at,
    round: r.review_round,
    approvals: Number(r.approvals),
    myState: r.my_state,
  }));
}

/** Every verdict on a lab, newest first. */
export async function reviewHistory(id) {
  const rows = await rpc('lab_review_history', { p_id: id });
  return (rows || []).map((r) => ({
    id: r.id,
    round: r.round,
    verdict: r.verdict,
    comment: r.comment,
    at: r.at,
    reviewerId: r.reviewer_id,
    reviewerUsername: r.reviewer_username,
    reviewerFullName: r.reviewer_full_name,
    reviewerWorkplace: r.reviewer_workplace,
    currentRound: r.current_round,
    revisionId: r.revision_id ?? null, // null = the lab's own review
  }));
}

/**
 * Public credits of a published lab: { legacy, publishedAt, creator, approvers, update }.
 * legacy = published before peer review (no creator / approvers). update = the latest applied
 * revision { appliedAt, approvers } or null. People: { fullName, position, workplace }
 * (fullName null = former staff member).
 */
export async function labCredits(id) {
  const data = await rpc('lab_credits', { p_id: id });
  if (!data) return null;
  // avatar (017): path of the confirmed face photo — only for logged-in callers.
  const person = (p) =>
    p ? { fullName: p.full_name, position: p.position, workplace: p.workplace, at: p.at, avatar: p.avatar || null } : null;
  return {
    legacy: Boolean(data.legacy),
    publishedAt: data.published_at || null,
    creator: data.legacy ? null : person(data.creator),
    approvers: (data.approvers || []).map(person),
    update: data.update
      ? { appliedAt: data.update.applied_at, approvers: (data.update.approvers || []).map(person) }
      : null,
  };
}

/** Creator line of every reviewed published lab: { [campaignId]: { fullName, workplace } }. */
export async function allCredits() {
  const rows = await rpcAll('lab_credits_all', {}, [['campaign_id', true]]);
  return Object.fromEntries(
    (rows || []).map((r) => [r.campaign_id, { fullName: r.creator_full_name, workplace: r.creator_workplace }]),
  );
}

/* ---- Revisions of published labs (step 5c, migration 012) --------- */

/** The open revision of a lab (admins), or null. */
export async function getRevision(campaignId) {
  return revisionFromApi(await rpc('lab_revision_get', { p_campaign: campaignId }));
}

/**
 * Save the proposed structure (+ protocol) of a published lab. rev = the open revision the
 * editor loaded, or null to open one. → { revisionId, editNo, status, changed }; revisionId null
 * = no structural difference left (an open revision was closed).
 */
export async function saveRevision(campaignId, rev, { fields, protocol }) {
  const res = await rpc('lab_revision_save', {
    p_campaign: campaignId,
    p_rev: rev?.id ?? null,
    p_edit_no: rev?.editNo ?? null,
    p_fields: fields,
    p_protocol: protocol,
  });
  return { revisionId: res.revision_id, editNo: res.edit_no, status: res.status, changed: res.changed };
}

/** → the new edit_no */
export const submitRevision = (rev) => rpc('lab_revision_submit', { p_rev: rev.id, p_edit_no: rev.editNo });

/** → the new edit_no */
export const withdrawRevision = (rev) => rpc('lab_revision_withdraw', { p_rev: rev.id });

export const discardRevision = (rev) => rpc('lab_revision_discard', { p_rev: rev.id });

/** → { status: 'in_review' | 'draft' | 'applied', approvals } */
export const reviewRevision = (rev, verdict, comment = '') =>
  rpc('lab_revision_review', { p_rev: rev.id, p_round: rev.round, p_verdict: verdict, p_comment: comment });
