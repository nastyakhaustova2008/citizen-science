/**
 * Photo privacy and size: phone photos carry EXIF metadata, often with the exact GPS position,
 * and are several MB. redrawImage() decodes the file and redraws it on a canvas — the canvas
 * export has no metadata at all — shrinks it and encodes it as JPEG under a byte budget.
 * If the browser can't decode the file (e.g. HEIC in Chrome) it rejects with
 * UnsupportedImageError — callers must NOT fall back to the original file.
 *
 * Limits match the Storage bucket (migration 016: JPEG only, ≤ 1 MB per file).
 */

export class UnsupportedImageError extends Error {
  constructor() {
    super('unsupported_image');
    this.name = 'UnsupportedImageError';
  }
}

/** Measurement photos: longest side 1600 px, JPEG ≈ 0.8, under 900 KB (bucket limit 1 MB). */
export const MEASUREMENT_PHOTO = { maxSide: 1600, maxBytes: 900 * 1024 };

const QUALITIES = [0.8, 0.7, 0.6, 0.5];

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

/** Approximate byte size of a base64 data URL. */
function dataUrlBytes(url) {
  const comma = url.indexOf(',');
  return Math.floor(((url.length - comma - 1) * 3) / 4);
}

/**
 * File → JPEG data URL without any metadata, longest side ≤ maxSide, ≤ maxBytes.
 * Transparent areas (PNG) become white.
 */
export async function redrawImage(file, { maxSide, maxBytes } = MEASUREMENT_PHOTO) {
  let source;
  try {
    source = await decode(file);
  } catch {
    throw new UnsupportedImageError();
  }
  try {
    const w = source.width || source.naturalWidth;
    const h = source.height || source.naturalHeight;
    if (!w || !h) throw new UnsupportedImageError();
    let scale = Math.min(1, maxSide / Math.max(w, h));
    // Shrink further only if even the lowest quality is over the budget (very noisy photos).
    for (let attempt = 0; attempt < 4; attempt++, scale *= 0.8) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new UnsupportedImageError();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      for (const q of QUALITIES) {
        const url = canvas.toDataURL('image/jpeg', q);
        // A failed export returns "data:," — never hand back anything but a redrawn image.
        if (!url.startsWith('data:image/jpeg')) throw new UnsupportedImageError();
        if (dataUrlBytes(url) <= maxBytes) return url;
      }
    }
    throw new UnsupportedImageError();
  } finally {
    source.close?.();
  }
}

/** Measurement photo: metadata stripped, resized and compressed for upload. */
export const stripImageMetadata = (file) => redrawImage(file, MEASUREMENT_PHOTO);

/** data URL → Blob (for the upload). */
export async function dataUrlToBlob(url) {
  const res = await fetch(url);
  return res.blob();
}
