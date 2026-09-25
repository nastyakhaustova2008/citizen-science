/**
 * Admin roles (roadmap step 4b). The database enforces every rule —
 * supabase/migrations/009_admin_roles.sql (security-definer functions + RLS). These helpers
 * only decide which buttons to show; keep them in line with the SQL.
 *
 *   owner       one user, set only in SQL. Makes / unmakes main admins, revokes any admin,
 *               renames anyone (themselves included, username only).
 *   main_admin  grants admin to students, revokes any regular admin, renames students + admins.
 *   admin       grants admin to students, revokes only admins they granted, renames students.
 *   Nobody revokes themselves.
 *
 * `me` / `user`: { id, role, username?, grantedBy? } (grantedBy = profiles.role_granted_by).
 */

export const ROLE_RANK = { student: 0, admin: 1, main_admin: 2, owner: 3 };

export const roleRank = (role) => ROLE_RANK[role] ?? 0;

export const isAdminRole = (role) => roleRank(role) >= 1;

export function canGrantAdmin(me, user) {
  return isAdminRole(me?.role) && user.id !== me.id && user.role === 'student' && Boolean(user.username);
}

export function canRevokeAdmin(me, user) {
  return (
    isAdminRole(me?.role) &&
    user.id !== me.id &&
    user.role === 'admin' &&
    (me.role === 'owner' || me.role === 'main_admin' || user.grantedBy === me.id)
  );
}

export function canMakeMainAdmin(me, user) {
  return (
    me?.role === 'owner' &&
    user.id !== me.id &&
    (user.role === 'student' || user.role === 'admin') &&
    Boolean(user.username)
  );
}

export function canDemoteMainAdmin(me, user) {
  return me?.role === 'owner' && user.role === 'main_admin';
}

export function canRename(me, user) {
  return isAdminRole(me?.role) && (me.role === 'owner' || roleRank(user.role) < roleRank(me.role));
}
