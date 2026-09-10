/**
 * Deterministic inline placeholders — no network requests, works offline.
 * Avatars: initials on a muted band. Photos: a soft abstract "site" tile.
 */

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const AVATAR_BG = ['#5A7A5F', '#8B6F47', '#43604A', '#6E5638', '#3E6B8A', '#9A8F6B'];

export function initials(name) {
  const parts = String(name).trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]).join('').toUpperCase();
}

export function avatarDataUri(seed, label) {
  const bg = AVATAR_BG[hash(seed) % AVATAR_BG.length];
  const text = initials(label || seed);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 80 80">
    <rect width="80" height="80" fill="${bg}"/>
    <text x="40" y="40" dy="0.35em" text-anchor="middle" font-family="Assistant, system-ui, sans-serif"
      font-size="30" font-weight="600" fill="#F7F4ED">${text}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const PHOTO_PALETTES = [
  ['#DCE3D5', '#A9BE9C', '#6E8A6F', '#3E5540'],
  ['#E8E0CE', '#C9B994', '#9A7F53', '#6E5638'],
  ['#D5DEE3', '#9DB2BE', '#5F7C8B', '#37475C'],
  ['#E3DAD2', '#C6A98F', '#8B6F47', '#5A463A'],
];

export function photoDataUri(seed, w = 640, h = 420) {
  const h1 = hash(seed);
  const pal = PHOTO_PALETTES[h1 % PHOTO_PALETTES.length];
  const horizon = 0.45 + ((h1 >> 3) % 30) / 100;
  const sunX = 10 + ((h1 >> 5) % 80);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 100 66">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${pal[2]}"/><stop offset="1" stop-color="${pal[1]}"/>
      </linearGradient>
      <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[3]}"/>
      </linearGradient>
    </defs>
    <rect width="100" height="66" fill="url(#sky)"/>
    <circle cx="${sunX}" cy="${horizon * 66 - 12}" r="6" fill="${pal[0]}" opacity="0.65"/>
    <rect y="${horizon * 66}" width="100" height="${66 - horizon * 66}" fill="url(#ground)"/>
    <path d="M0 ${horizon * 66} Q 25 ${horizon * 66 - 5}, 50 ${horizon * 66 + 2} T 100 ${horizon * 66}"
      stroke="${pal[3]}" stroke-width="0.6" fill="none" opacity="0.5"/>
    <rect x="${45 + (h1 % 10)}" y="${horizon * 66 - 8}" width="2.4" height="10" fill="${pal[3]}" opacity="0.7"/>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
