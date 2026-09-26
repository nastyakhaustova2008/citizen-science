import { supabase } from './supabase';

/**
 * Admin API (roadmap step 4b): thin wrappers over the security-definer RPCs in
 * supabase/migrations/009_admin_roles.sql (+ the staff confirmation from 010). Every rule is checked there; errors come back as
 * AdminError with a code → strings.js admin.errors.<code> (username rule codes → auth.errors).
 * Nothing here returns emails or whether a user has one.
 */

const CODES = [
  'not_logged_in',
  'not_allowed',
  'bad_target',
  'no_username',
  'chain_changed',
  'unchanged',
  'username_taken',
  'invalid_username',
  'staff_not_confirmed',
];

export class AdminError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

async function rpc(name, args) {
  if (!supabase) throw new AdminError('generic');
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    if (CODES.includes(error.message)) throw new AdminError(error.message, error.details);
    console.error(`[admin] ${name}`, error);
    throw new AdminError('generic');
  }
  return data;
}

/** One page of users (search by username), highest role first. → { users, total } */
export async function listUsers({ search = '', limit = 25, offset = 0 } = {}) {
  const rows = await rpc('admin_list_users', { p_search: search || null, p_limit: limit, p_offset: offset });
  return {
    users: (rows || []).map((r) => ({
      id: r.id,
      username: r.username,
      role: r.role,
      grantedBy: r.role_granted_by,
      grantedByUsername: r.granted_by_username,
      grantedAt: r.role_granted_at,
      createdAt: r.created_at,
    })),
    total: rows?.[0]?.total ?? 0,
  };
}

/** The user + every admin below them in the grant chain (depth 0 = the user). */
export async function revokePreview(userId) {
  const rows = await rpc('admin_revoke_preview', { p_target: userId });
  return (rows || []).map((r) => ({ id: r.id, username: r.username, role: r.role, depth: r.depth }));
}

/** confirmStaff: the granting admin confirmed this person is a teacher or staff member (010). */
export const grantAdmin = (userId, confirmStaff) =>
  rpc('admin_grant_admin', { p_target: userId, p_confirm_staff: confirmStaff === true });

/** confirmedIds = the ids the confirmation showed; if the chain changed since → 'chain_changed'. */
export const revokeAdmin = (userId, confirmedIds) =>
  rpc('admin_revoke_admin', { p_target: userId, p_confirmed: confirmedIds });

/** A student needs confirmStaff (an admin was confirmed when granted). */
export const makeMainAdmin = (userId, confirmStaff = false) =>
  rpc('owner_make_main_admin', { p_target: userId, p_confirm_staff: confirmStaff === true });

/** mode 'admin' (keeps admin and their chain) | 'student' (full cascade, needs confirmedIds). */
export const demoteMainAdmin = (userId, mode, confirmedIds = null) =>
  rpc('owner_demote_main_admin', { p_target: userId, p_mode: mode, p_confirmed: confirmedIds });

/** → the stored (normalized) username. */
export const renameUser = (userId, username) =>
  rpc('admin_rename_user', { p_target: userId, p_username: username });

/** Role changes and renames, newest first. `before` = id of the last row already shown. */
export async function roleLog({ limit = 30, before = null } = {}) {
  const rows = await rpc('admin_role_log', { p_limit: limit, p_before: before });
  return (rows || []).map((r) => ({
    id: r.id,
    at: r.at,
    action: r.action,
    actorId: r.actor_id,
    actorUsername: r.actor_username,
    targetId: r.target_id,
    targetUsername: r.target_username,
    oldRole: r.old_role,
    newRole: r.new_role,
    oldUsername: r.old_username,
    newUsername: r.new_username,
    causeId: r.cause_id,
    confirmedStaff: r.confirmed_staff,
    movedUnder: r.moved_under,
    movedUnderUsername: r.moved_under_username,
  }));
}
