/**
 * Audit M1: our pages remove EXIF / GPS in the browser before uploading (image.js), but someone
 * could upload a file to Storage directly. Before a moderator approves a photo (and when a
 * moderator looks at a profile picture), the moderator's browser reads the file and checks it.
 *
 * checkJpeg(bytes: Uint8Array) → { ok, problems: [...] } where problems are:
 *   'not_jpeg'  — the file doesn't start like a JPEG
 *   'exif'      — an APP1 "Exif" block (may hold GPS, camera, date)
 *   'xmp'       — an APP1 XMP block (may hold location, names)
 *   'iptc'      — an APP13 (Photoshop / IPTC) block
 *   'metadata'  — any other application block (APP3–APP15), or a comment (COM)
 *   'trailing'  — data after the end of the image (e.g. a second file glued on)
 *   'broken'    — the structure could not be read to the end
 * Allowed: APP0 (JFIF) and APP2 (ICC colour profile) — what browsers write when they redraw.
 */
const TRAILING_SLACK = 32; // a few padding bytes after EOI are harmless

function ascii(b, from, len) {
  let s = '';
  for (let i = from; i < from + len && i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
}

export function checkJpeg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const problems = new Set();
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) {
    return { ok: false, problems: ['not_jpeg'] };
  }
  let pos = 2;
  let end = -1;
  while (pos < b.length) {
    if (b[pos] !== 0xff) {
      problems.add('broken');
      break;
    }
    while (b[pos] === 0xff && pos < b.length) pos++; // fill bytes
    const marker = b[pos];
    pos++;
    if (marker === 0xd9) {
      end = pos;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue; // no length
    if (pos + 1 >= b.length) {
      problems.add('broken');
      break;
    }
    const len = (b[pos] << 8) | b[pos + 1];
    if (len < 2 || pos + len > b.length) {
      problems.add('broken');
      break;
    }
    const data = pos + 2;
    if (marker === 0xe1) {
      if (ascii(b, data, 6) === 'Exif\0\0') problems.add('exif');
      else if (ascii(b, data, 28).startsWith('http://ns.adobe.com/xap/1.0/')) problems.add('xmp');
      else problems.add('metadata');
    } else if (marker === 0xed) {
      problems.add('iptc');
    } else if (marker >= 0xe3 && marker <= 0xef) {
      problems.add('metadata');
    } else if (marker === 0xfe) {
      problems.add('metadata');
    }
    pos += len;
    if (marker === 0xda) {
      // Entropy-coded data: runs until a marker that isn't a stuffed 0x00 or a restart marker.
      while (pos < b.length) {
        if (b[pos] === 0xff && pos + 1 < b.length) {
          const next = b[pos + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            pos += 2;
            continue;
          }
          if (next === 0xff) {
            pos += 1;
            continue;
          }
          break; // next segment (DHT / SOS of a progressive JPEG, or EOI)
        }
        pos++;
      }
    }
  }
  if (end < 0) problems.add('broken');
  else if (b.length - end > TRAILING_SLACK) problems.add('trailing');
  return { ok: problems.size === 0, problems: [...problems] };
}

/** Fetches a (signed) URL and checks it. null = could not be read (network) — say so, don't guess. */
export async function checkJpegUrl(url, { signal } = {}) {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return null;
    return checkJpeg(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

function dataUrlToBytes(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToDataUrl(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

/** The same for a data URL made in this browser (our own upload, before it is sent). */
export function checkJpegDataUrl(dataUrl) {
  return checkJpeg(dataUrlToBytes(dataUrl));
}

/**
 * A copy without the blocks checkJpeg flags (APP1, APP3–APP15, APP13, COM) and without anything
 * after the end of the image — for our OWN canvas output, in case a browser adds such a block
 * (they normally don't). → Uint8Array, or null if the structure can't be read.
 */
export function stripJpeg(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const keep = [b.subarray(0, 2)];
  let pos = 2;
  while (pos < b.length) {
    if (b[pos] !== 0xff) return null;
    const start = pos;
    while (b[pos] === 0xff && pos < b.length) pos++;
    const marker = b[pos];
    pos++;
    if (marker === 0xd9) {
      keep.push(b.subarray(start, pos));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      keep.push(b.subarray(start, pos));
      continue;
    }
    if (pos + 1 >= b.length) return null;
    const len = (b[pos] << 8) | b[pos + 1];
    if (len < 2 || pos + len > b.length) return null;
    pos += len;
    const drop = marker === 0xe1 || marker === 0xed || marker === 0xfe || (marker >= 0xe3 && marker <= 0xef);
    if (marker === 0xda) {
      while (pos < b.length) {
        if (b[pos] === 0xff && pos + 1 < b.length) {
          const next = b[pos + 1];
          if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
            pos += 2;
            continue;
          }
          if (next === 0xff) {
            pos += 1;
            continue;
          }
          break;
        }
        pos++;
      }
    }
    if (!drop) keep.push(b.subarray(start, pos));
  }
  const out = new Uint8Array(keep.reduce((n, k) => n + k.length, 0));
  let o = 0;
  for (const k of keep) {
    out.set(k, o);
    o += k.length;
  }
  return out;
}

/**
 * Our own upload: the redrawn data URL if it is clean, else a stripped copy if that is clean,
 * else null (the caller refuses the photo — never the original file).
 */
export function cleanJpegDataUrl(dataUrl) {
  const bytes = dataUrlToBytes(dataUrl);
  if (checkJpeg(bytes).ok) return dataUrl;
  const stripped = stripJpeg(bytes);
  return stripped && checkJpeg(stripped).ok ? bytesToDataUrl(stripped) : null;
}
