/**
 * Finding the corners of the document in a photo, so the crop screen can start on the paper's edges.
 */

const MIN_AREA = 0.08; // the document must cover at least 8% of the photo
const MIN_SIDE = 0.05;

/**
 * Checks the corners the AI returned (4 points, 0-1000, clockwise from the document's own top-left)
 * and turns them into 0-1 points. Returns null for anything that does not look like a real document.
 */
export function parseDetectedCorners(raw) {
  if (!raw || raw.found !== true || !Array.isArray(raw.corners) || raw.corners.length !== 4) return null;

  const points = [];
  for (const corner of raw.corners) {
    const x = Number(corner?.x);
    const y = Number(corner?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    points.push({
      x: Math.min(1, Math.max(0, x / 1000)),
      y: Math.min(1, Math.max(0, y / 1000))
    });
  }

  // Shoelace area; positive means clockwise on screen (y points down)
  let area2 = 0;
  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    area2 += a.x * b.y - b.x * a.y;
  }
  if (area2 / 2 < MIN_AREA) return null;

  for (let i = 0; i < 4; i++) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SIDE) return null;
    // Every turn must go the same way, otherwise the shape is twisted or concave
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross <= 0) return null;
  }

  return points;
}

/**
 * Asks the server for the document's corners. Resolves to four 0-1 points, or null when
 * nothing usable came back (signed out, slow, error, or no clear document), so the crop
 * screen simply starts where it always has.
 */
export async function detectDocumentCorners(blob, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  try {
    const { getFirebaseAuthInstance } = await import('./firebase.js');
    const user = getFirebaseAuthInstance()?.currentUser;
    if (!user || !blob || blob.size === 0) return null;

    const idToken = await user.getIdToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl('/api/extract-document', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${idToken}`,
          'content-type': 'application/octet-stream',
          'x-document-mime': blob.type || 'image/jpeg',
          'x-document-task': 'corners'
        },
        body: blob,
        signal: controller.signal
      });
      if (!response.ok) return null;
      const payload = await response.json();
      return parseDetectedCorners(payload?.corners);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
