/**
 * Features that are still demos (mock data, nothing saved on the server). Hidden in production
 * until they are real (audit M7). The code stays; flip a flag once the feature has a backend.
 *   join  — "Join the campaign" buttons (a list kept only in memory, the same for everyone).
 *   forum — the Discussion tab of a lab (demo topics; new posts vanish on reload).
 */
export const FEATURES = {
  join: false,
  forum: false,
};
