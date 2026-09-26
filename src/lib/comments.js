/**
 * Comments on measurements (migration 015): the text rules, mirrored from the SQL functions
 * comment_clean / comment_detect_text / comment_link_error / comment_body_error /
 * link_domain_normalize / link_domain_error — same order of checks, same error codes.
 * The database is the real check; this is only for instant feedback in the form and for
 * making allowed links clickable.
 */

export const COMMENT_MAX = 1000;
export const EDIT_MINUTES = 15;
export const REPORT_REASONS = ['bullying', 'personal_info', 'spam', 'other'];

/** URL shorteners — never allowed (= comment_shorteners() in SQL). */
export const SHORTENERS = [
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'v.gd',
  'buff.ly', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 'shorturl.com', 'rb.gy', 'tiny.cc',
  't.ly', 's.id', 'bl.ink', 'lnkd.in', 'short.io', 'y2u.be', 'tr.im', 'soo.gd',
  'clck.ru', 'vk.cc', 'u.to', 'surl.li', 'qr.ae', 'shorte.st', 'adf.ly', 'tiny.one',
];

/** TLDs that make a bare word.word a link without "/" after it (= comment_bare_tlds()). */
const BARE_TLDS = [
  'com', 'net', 'org', 'info', 'biz', 'io', 'co', 'me', 'ly', 'gl', 'gd', 'tk', 'ml',
  'ga', 'cf', 'gq', 'xyz', 'top', 'site', 'online', 'app', 'dev', 'link', 'click',
  'live', 'store', 'shop', 'blog', 'news', 'tv', 'cc', 'ws', 'su', 'ru', 'ua', 'il',
  'uk', 'de', 'fr', 'es', 'eu', 'ca', 'ai', 'gg', 'page',
];

const SPACES = '\\s\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000';
const TRIM_RE = new RegExp(`^[${SPACES}]+|[${SPACES}]+$`, 'g');
const SPLIT_RE = new RegExp(`[${SPACES}]+`);
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Stored form (= comment_clean): NFC, LF, no control / invisible formatting chars, ≤2 empty lines, trimmed. */
export function cleanComment(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/[\u00AD\u200B\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(TRIM_RE, '');
}

/** Characters (code points), as Postgres char_length counts them. */
export const commentLength = (text) => [...text].length;

/** What the checks look at (= comment_detect_text). */
function detectText(text) {
  return String(text ?? '')
    .replace(/[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/g, '')
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll('。', '.');
}

/** host is one of the domains or a subdomain of one. */
export const domainMatches = (host, domains) =>
  (domains || []).some((d) => host === d || host.endsWith(`.${d}`));

function stripPunct(tok) {
  return tok.replace(/^[([{<"'«„“‘]+/, '').replace(/[)\]}>"'»”’.,;:!?]+$/, '');
}

/**
 * One whitespace-free token (already detectText'ed) → null (not a link) or
 * { error: code | null, host, scheme, rest } — rest = the part after "scheme://".
 */
function analyzeToken(rawTok, domains) {
  const tok = stripPunct(rawTok);
  if (!tok) return null;
  if (/^(javascript|vbscript):/.test(tok)) return { error: 'link_not_allowed', tok };
  let rest;
  let scheme = null;
  if (/^[a-z][a-z0-9+.-]*:[/\\]/.test(tok)) {
    scheme = tok.match(/^([a-z][a-z0-9+.-]*):/)[1];
    if (scheme !== 'http' && scheme !== 'https') return { error: 'link_not_allowed', tok };
    rest = tok.replace(/^[a-z][a-z0-9+.-]*:[/\\]*/, '');
  } else if (
    /^www\./.test(tok) ||
    /^[^/?#\\@:]+\.([a-z]{2,24}|xn--[a-z0-9-]+)[/?#:\\]/.test(tok) ||
    (/^[^/?#\\@:]+\.([a-z]{2,24}|xn--[a-z0-9-]+)$/.test(tok) &&
      (BARE_TLDS.includes(tok.match(/\.([a-z0-9-]+)$/)?.[1]) || /\.xn--[a-z0-9-]+$/.test(tok)))
  ) {
    rest = tok;
  } else {
    return null;
  }
  const rawHost = rest.match(/^[^/?#\\]*/)[0];
  if (/[@:]/.test(rawHost)) return { error: 'link_not_allowed', tok };
  const host = rawHost.replace(/\.$/, '');
  if (!HOST_RE.test(host) || /(^|\.)xn--/.test(host) || !/\.[a-z]{2,}$/.test(host)) {
    return { error: 'link_not_allowed', tok };
  }
  if (domainMatches(host, SHORTENERS)) return { error: 'link_shortener', host, tok };
  // domains null = the list isn't loaded: leave that check to the server.
  if (domains && !domainMatches(host, domains)) return { error: 'link_domain_not_allowed', host, tok };
  return { error: null, host, rawHost, scheme, rest, tok };
}

/**
 * Problem with a cleaned comment text (= comment_body_error): null or { code, host?, domains? }.
 * domains = the allowed link domains (null = not loaded: the domain check is left to the server).
 */
export function commentError(body, domains) {
  if (!body) return { code: 'empty' };
  if (commentLength(body) > COMMENT_MAX) return { code: 'too_long' };
  const d = detectText(body);
  for (const tok of d.split(SPLIT_RE)) {
    const a = analyzeToken(tok, domains);
    if (a?.error) {
      return a.error === 'link_domain_not_allowed'
        ? { code: a.error, host: a.host, domains: [...(domains || [])] }
        : a.host
          ? { code: a.error, host: a.host }
          : { code: a.error };
    }
  }
  if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/.test(d)) return { code: 'email_not_allowed' };
  if (
    /(^|[^0-9.+])0[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{2}([^0-9]|$)/.test(d) ||
    /(^|[^0-9.])\+?972[- ]?0?[0-9]{1,2}[- ]?[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{2}([^0-9]|$)/.test(d) ||
    /(^|[^0-9.])(\+7|8|\+380)[- ]?\(?[0-9]{2,3}\)?[- ]?[0-9]{3}[- ]?[0-9]{2}[- ]?[0-9]{2}([^0-9]|$)/.test(d) ||
    /\+[0-9]{1,3}[- ]?\(?[0-9]{1,4}\)?([- ]?[0-9]){6,10}([^0-9]|$)/.test(d)
  ) {
    return { code: 'phone_not_allowed' };
  }
  return null;
}

/**
 * Comment text → segments for display: { text } or { link: { href, host } }.
 * Only links to domains allowed NOW become clickable (a domain removed later → plain text);
 * a token with hidden / full-width characters is never clickable.
 */
export function commentSegments(body, domains) {
  const out = [];
  const push = (text) => {
    if (!text) return;
    const last = out[out.length - 1];
    if (last && last.text != null) last.text += text;
    else out.push({ text });
  };
  for (const part of String(body ?? '').split(/(\s+)/)) {
    const link = part && !/^\s+$/.test(part) ? linkFor(part, domains) : null;
    if (!link) {
      push(part);
      continue;
    }
    push(link.before);
    out.push({ link: { href: link.href, host: link.host } });
    push(link.after);
  }
  return out;
}

function linkFor(part, domains) {
  if (!domains) return null;
  const lower = part.toLowerCase();
  if (detectText(part) !== lower) return null;
  const a = analyzeToken(lower, domains);
  if (!a || a.error) return null;
  const start = lower.indexOf(a.tok);
  const orig = part.slice(start, start + a.tok.length);
  const origRest = orig.slice(orig.length - a.rest.length);
  const path = origRest.slice(a.rawHost.length);
  let url;
  try {
    url = new URL(`${a.scheme || 'https'}://${a.host}${path}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== a.host || url.username || url.password || url.port) {
    return null;
  }
  return {
    before: part.slice(0, start),
    after: part.slice(start + a.tok.length),
    href: url.href,
    host: a.host.replace(/^www\./, ''),
  };
}

/* ---- Allowed link domains (admin forms) --------------------------------------------- */

/** = link_domain_normalize: lower case, no scheme / path / "www." / trailing dot. */
export function normalizeDomain(text) {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

/** = link_domain_error: null | 'invalid_domain' | 'domain_shortener'. */
export function domainError(domain) {
  if (!HOST_RE.test(domain) || /(^|\.)xn--/.test(domain) || !/\.[a-z]{2,}$/.test(domain) || domain.length > 253) {
    return 'invalid_domain';
  }
  if (domainMatches(domain, SHORTENERS)) return 'domain_shortener';
  return null;
}

/** Can I still edit it (own, not hidden, < 15 minutes)? The server decides; this hides the button in time. */
export function editableUntil(comment) {
  return new Date(comment.createdAt).getTime() + EDIT_MINUTES * 60 * 1000;
}
