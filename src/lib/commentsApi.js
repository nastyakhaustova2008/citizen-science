import { supabase } from './supabase';

/**
 * Comments API (migration 015): thin wrappers over the security-definer RPCs. Every rule is
 * checked there; errors come back as CommentError { code, details } — details is the parsed
 * JSON detail (link_domain_not_allowed: { host, domains }). Texts: strings.js comments.errors.<code>.
 */

const CODES = [
  'not_logged_in',
  'no_username',
  'not_allowed',
  'not_found',
  'bad_request',
  'rate_limited',
  'empty',
  'too_long',
  'email_not_allowed',
  'phone_not_allowed',
  'link_not_allowed',
  'link_shortener',
  'link_domain_not_allowed',
  'edit_window_closed',
  'comment_hidden',
  'already_reported',
  // allowed link domains
  'invalid_domain',
  'domain_shortener',
  'domain_exists',
  'proposal_pending',
  'already_decided',
  'reason_required',
  'reason_too_long',
  'comment_too_long',
];

export class CommentError extends Error {
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
  if (!supabase) throw new CommentError('generic');
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (CODES.includes(error.message)) throw new CommentError(error.message, parseDetails(error.details));
    console.error(`[comments] ${name}`, error);
    throw new CommentError('generic');
  }
  return data;
}

function fromRow(r) {
  return {
    id: r.id,
    measurementId: r.measurement_id,
    authorId: r.author_id,
    kind: r.kind,
    body: r.body,
    lang: r.lang,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    hidden: r.hidden,
    hiddenReason: r.hidden_reason,
    mine: r.mine,
    canEdit: r.can_edit,
    reported: r.reported,
    reports: r.reports ?? 0,
  };
}

/** → { canModerate, comments } (oldest first; hidden ones only for moderators and their author). */
export async function listComments(measurementId) {
  const res = await rpc('comment_list', { p_measurement: measurementId });
  return { canModerate: Boolean(res?.can_moderate), comments: (res?.comments || []).map(fromRow) };
}

/** kind: 'comment' | 'issue' (a problem with the data). lang = the UI language now. */
export async function addComment(measurementId, body, lang, kind = 'comment') {
  return fromRow(await rpc('comment_add', { p_measurement: measurementId, p_body: body, p_lang: lang, p_kind: kind }));
}

export async function editComment(id, body) {
  return fromRow(await rpc('comment_edit', { p_id: id, p_body: body }));
}

export const deleteComment = (id) => rpc('comment_delete', { p_id: id });

/** action: 'hide' | 'unhide' (also "keep": dismisses the reports) | 'delete' → the comment or null. */
export async function moderateComment(id, action) {
  const res = await rpc('comment_moderate', { p_id: id, p_action: action });
  return res ? fromRow(res) : null;
}

/** → { hidden } — true when this was the 3rd report and the comment is now hidden. */
export async function reportComment(id, reason) {
  const res = await rpc('comment_report', { p_id: id, p_reason: reason });
  return { hidden: Boolean(res?.hidden) };
}

/** Measurement ids with a visible "problem" report. */
export async function issueMeasurements() {
  return (await rpc('comment_issue_measurements', {})) || [];
}

/** The allowed link domains. */
export async function linkDomains() {
  return (await rpc('comment_link_domains', {})) || [];
}

/** Reported comments I may moderate (admins). */
export async function reportQueue() {
  const rows = (await rpc('comment_report_queue', {})) || [];
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

export async function commentLog({ limit = 30, before = null } = {}) {
  const rows = await rpc('comment_log', { p_limit: limit, p_before: before });
  return (rows || []).map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    commentId: r.comment_id,
    measurementId: r.measurement_id,
    campaignId: r.campaign_id,
    slug: r.slug,
    titleHe: r.title_he,
    titleEn: r.title_en,
    titleRu: r.title_ru,
    kind: r.kind,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    authorId: r.author_id,
    authorUsername: r.author_username,
    reports: r.reports,
  }));
}

/* ---- Allowed link domains (admins) ----------------------------------------------------- */

/** → { canManage, domains: [...], proposals: [...] } */
export async function linkDomainAdminView() {
  const res = await rpc('link_domain_admin_view', {});
  return {
    canManage: Boolean(res?.can_manage),
    domains: (res?.domains || []).map((d) => ({
      domain: d.domain,
      addedAt: d.added_at,
      addedBy: d.added_by,
      addedByUsername: d.added_by_username,
    })),
    proposals: (res?.proposals || []).map((p) => ({
      id: p.id,
      domain: p.domain,
      reason: p.reason,
      status: p.status,
      proposedBy: p.proposed_by,
      proposedByUsername: p.proposed_by_username,
      createdAt: p.created_at,
      decidedBy: p.decided_by,
      decidedByUsername: p.decided_by_username,
      decidedAt: p.decided_at,
      decisionComment: p.decision_comment,
      mine: p.mine,
    })),
  };
}

export async function linkDomainPendingCount() {
  return (await rpc('link_domain_pending_count', {})) || 0;
}

export const addLinkDomain = (domain) => rpc('link_domain_add', { p_domain: domain });
export const removeLinkDomain = (domain) => rpc('link_domain_remove', { p_domain: domain });
export const proposeLinkDomain = (domain, reason) => rpc('link_domain_propose', { p_domain: domain, p_reason: reason });
export const decideLinkDomain = (id, approve, comment) =>
  rpc('link_domain_decide', { p_id: id, p_approve: approve, p_comment: comment || null });

export async function linkDomainLog({ limit = 30, before = null } = {}) {
  const rows = await rpc('link_domain_log', { p_limit: limit, p_before: before });
  return (rows || []).map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    domain: r.domain,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    proposalId: r.proposal_id,
    note: r.note,
  }));
}
