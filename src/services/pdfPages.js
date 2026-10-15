/**
 * Turns one page of a plan PDF into an image on the phone, so a floor plan PDF can be used
 * without converting it first. pdf.js (Mozilla's PDF reader) is only downloaded when a PDF is picked.
 */

// Big enough to read room names when zoomed in, small enough for phone memory limits
export const FULL_PAGE_LONGEST_SIDE = 4000;
export const THUMBNAIL_LONGEST_SIDE = 260;
export const MAX_PAGES_SHOWN = 30;

export function isPdfFile(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

/** Scale that makes the page's longest side about `longestSide` pixels. */
export function scaleForLongestSide(width, height, longestSide) {
  const longest = Math.max(Number(width) || 0, Number(height) || 0);
  return longest > 0 ? longestSide / longest : 1;
}

/** "Plans Lot 5.pdf", page 2 -> "Plans Lot 5 - page 2.png" */
export function pageImageName(pdfName, pageNumber) {
  const base = String(pdfName || 'Floor plan').replace(/\.pdf$/i, '').trim() || 'Floor plan';
  return `${base} - page ${pageNumber}.png`;
}

export async function openPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
}

async function renderPageToCanvas(pdf, pageNumber, longestSide) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: scaleForLongestSide(base.width, base.height, longestSide) });
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');
  // White paper behind the drawing (PDF pages can be transparent)
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

/** Small preview of a page, as a data: URL. */
export async function renderPageThumbnail(pdf, pageNumber) {
  const canvas = await renderPageToCanvas(pdf, pageNumber, THUMBNAIL_LONGEST_SIDE);
  return canvas.toDataURL('image/jpeg', 0.7);
}

/** The full page as a PNG file, ready to upload as the floor plan. */
export async function renderPageAsImageFile(pdf, pageNumber, pdfName) {
  const canvas = await renderPageToCanvas(pdf, pageNumber, FULL_PAGE_LONGEST_SIDE);
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => (result ? resolve(result) : reject(new Error('Could not turn the page into an image.'))), 'image/png');
  });
  return new File([blob], pageImageName(pdfName, pageNumber), { type: 'image/png', lastModified: Date.now() });
}
