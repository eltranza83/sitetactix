/**
 * Photo helpers shared by the scanner, the receipt editor and the punch list.
 */

/**
 * Shrinks a photo to fit inside maxWidth x maxHeight and saves it as a JPEG
 * named "<original name>_compressed.jpg". If the browser cannot read the photo,
 * the original file comes back unchanged.
 */
export function compressImage(file, maxWidth = 1200, maxHeight = 1200, quality = 0.8) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else if (height > maxHeight) {
        width = Math.round((width * maxHeight) / height);
        height = maxHeight;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);

      canvas.toBlob((blob) => {
        if (!blob) {
          resolve(file);
          return;
        }
        const baseName = String(file.name || 'photo').replace(/\.[^/.]+$/, '');
        resolve(new File([blob], `${baseName}_compressed.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now()
        }));
      }, 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(file);
    };
    img.src = objectUrl;
  });
}

/**
 * Album and X-Ray pin photos: shrunk from a full phone photo (3-8 MB) to about 0.5-1 MB,
 * still large enough to read wire labels and pipe sizes when zoomed in.
 */
export function compressSitePhoto(file) {
  return compressImage(file, 2400, 2400, 0.85);
}

/**
 * True for Google's small Drive thumbnails (lh3.googleusercontent.com), which the app's security
 * rules allow. They are short-lived, so they are shown but never saved.
 */
export function isGoogleThumbnail(link) {
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && url.hostname.endsWith('.googleusercontent.com');
  } catch {
    return false;
  }
}

/** Turns a data: URL (a photo or PDF kept on the phone) back into a file blob. */
export function dataUrlToBlob(dataUrl, fallbackType = 'image/jpeg') {
  const [meta = '', base64 = ''] = String(dataUrl || '').split(',');
  const mimeType = meta.match(/^data:(.*?);base64$/)?.[1] || fallbackType;
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/** Saves a file to the device (the link is kept briefly so slower phones, like iPhones, finish first). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/** Reads a file as a data: URL (kept on the phone for offline use). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * The address to show a saved photo: the offline copy if there is one, otherwise a
 * Drive thumbnail of the given size ('w200', 'w400' or 'w1000') for Drive links.
 */
export function getDisplayImageUrl(url, base64, size = 'w400') {
  if (base64) return base64;
  if (!url) return '';
  if (url.startsWith('data:')) return url;

  const driveIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
  if (driveIdMatch && driveIdMatch[1]) {
    const sz = ['w200', 'w400', 'w1000'].includes(size) ? size : 'w200';
    return `https://drive.google.com/thumbnail?id=${driveIdMatch[1]}&sz=${sz}`;
  }
  return url;
}
