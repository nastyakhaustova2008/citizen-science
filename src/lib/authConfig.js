/**
 * Account settings that are the same for everyone (audit H6).
 *
 * EMAIL_FLOWS_ENABLED — everything that needs an email to reach the user: "forgot password" by
 * email, adding / changing an email (profile and sign-up). Supabase's built-in mailer only
 * delivers to the project team, so until our own SMTP (Brevo, NEXT_GOALS N2) is set up these
 * flows would say "we sent a link" and nothing would arrive. N2: set to true after testing that
 * the emails arrive. The server side is ready (Edge Function `account`: recover, change-email).
 */
export const EMAIL_FLOWS_ENABLED = false;

/** Shared-computer mode: signed out after this long without any activity in the tab… */
export const IDLE_SIGN_OUT_MINUTES = 30;
/** …after a warning shown this long before. */
export const IDLE_WARNING_SECONDS = 60;
