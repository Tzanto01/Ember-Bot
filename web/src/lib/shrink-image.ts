const maxEdge = 1920;

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Re-encodes a picked picture on the device: upright (EXIF orientation applied), at most 1920 px on the long edge,
 * as WebP (quality 0.82) or, where the browser can't write WebP, as JPEG on white (quality 0.85). Re-encoding drops
 * the file's metadata. Resolves null when the file can't be decoded (for example HEIC in most browsers).
 */
export async function shrinkImage(file: Blob): Promise<Blob | null> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const webp = await encode(canvas, 'image/webp', 0.82);
    if (webp?.type === 'image/webp') return webp;
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    const jpeg = await encode(canvas, 'image/jpeg', 0.85);
    return jpeg?.type === 'image/jpeg' ? jpeg : null;
  } finally {
    bitmap.close();
  }
}

/** The blob's bytes as a plain base64 string (no `data:` prefix). */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}
