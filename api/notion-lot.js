import { HttpError, errorResponse, jsonResponse, requireScannerAccess } from './_lib/firebase-auth.js';
import {
  createLotPage,
  listSubdivisions,
  parseLotRequest,
  parsePageId,
  parseSubdivision,
  resolveNotionKey,
  updateLotSubdivision
} from './_lib/notion-lot.js';

/**
 * The lot's Notion page (the Notion key only lives on the server):
 * - "create" (default): make the page for a new project
 * - "subdivisions": the Subdivision choices already in Notion
 * - "update-subdivision": change a lot page's Subdivision
 */
export async function POST(request) {
  try {
    await requireScannerAccess(request, fetch, { rateLimit: 20 });

    const apiKey = resolveNotionKey();
    if (!apiKey) {
      throw new HttpError(503, 'Notion is not set up on the server yet (NOTION_API_KEY is missing in Vercel).');
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      throw new HttpError(400, 'The request was not readable.');
    }

    const ctx = { apiKey };
    const action = payload?.action || 'create';
    if (action === 'subdivisions') {
      return jsonResponse({ subdivisions: await listSubdivisions(ctx) });
    }
    if (action === 'update-subdivision') {
      const result = await updateLotSubdivision({
        pageId: parsePageId(payload.pageId),
        subdivision: parseSubdivision(payload.subdivision)
      }, ctx);
      return jsonResponse(result);
    }
    if (action !== 'create') throw new HttpError(400, 'Unknown request.');

    const result = await createLotPage(parseLotRequest(payload), ctx);
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET() {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

export const maxDuration = 60;
