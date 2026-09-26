/**
 * Photo privacy: phone photos carry EXIF metadata, often with the exact GPS position.
 * stripImageMetadata() decodes the file and redraws it on a canvas; the canvas export has
 * no metadata at all. If the browser can't decode the file (e.g. HEIC in Chrome) it rejects
 * with UnsupportedImageError — callers must NOT fall back to the original file.
 */

export class UnsupportedImageError extends Error {
  constructor() {
    super('unsupported_image');
    this.name = 'UnsupportedImageError';
  }
}

// Longest side after redrawing: keeps large photos under the browsers' canvas size limits.
const MAX_SIDE = 4096;

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      // Applies the EXIF rotation, so the photo isn't sideways once the EXIF is gone.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Fall through to <img> (older Safari has no createImageBitmap options).
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode(); // modern browsers apply EXIF rotation to <img> by default
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** File → data URL (PNG stays PNG, everything else becomes JPEG), without any metadata. */
export async function stripImageMetadata(file) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new UnsupportedImageError();
  }
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  if (!w || !h) throw new UnsupportedImageError();
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UnsupportedImageError();
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  source.close?.();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  const url = canvas.toDataURL(type, 0.9);
  // A failed export returns "data:," — never hand back anything but a redrawn image.
  if (!url.startsWith(`data:${type}`)) throw new UnsupportedImageError();
  return url;
}
