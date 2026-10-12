import { HttpError, errorResponse, jsonResponse, requireScannerAccess } from './_lib/firebase-auth.js';
import { createLotPage, parseLotRequest, resolveNotionKey } from './_lib/notion-lot.js';

/** Makes the lot's Notion page for a new project (the Notion key only lives on the server). */
export async function POST(request) {
  try {
    await requireScannerAccess(request, fetch, { rateLimit: 10 });

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

    const lot = parseLotRequest(payload);
    const result = await createLotPage(lot, { apiKey });
    return jsonResponse(result);
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET() {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

export const maxDuration = 60;
