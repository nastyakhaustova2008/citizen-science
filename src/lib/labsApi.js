import { supabase } from './supabase';
import { labToPayload } from './labs';

/**
 * Lab editor API (roadmap step 5a): thin wrappers over the RPCs in
 * supabase/migrations/010_lab_editor.sql. Every rule is checked there; errors come back as
 * LabError { code, details } — details is the parsed JSON for invalid_lab ({path: code}),
 * structural_change ([path]) and invalid_admin_profile ({field: code}).
 */

const CODES = [
  'not_logged_in',
  'not_allowed',
  'admin_profile_required',
  'not_found',
  'edited_elsewhere',
  'invalid_lab',
  'structural_change',
  'has_measurements',
  'invalid_admin_profile',
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
  const rows = await rpc('lab_admin_list', {});
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
