import { AI_CONFIG } from './ai-config.js';
import { fetchWithExponentialBackoff } from './ai-retry.js';
import { sanitizeUpstreamAiError } from './ai-auth.js';

export const DOCUMENT_CORNERS_PROMPT = `
Find the main document (a receipt, invoice, check or envelope) in this photo and return where its four corners are.

- Each corner is a point with x and y from 0 to 1000. x runs across the photo from its left edge, y runs down from its top edge.
- Give the corners in clockwise order, starting at the document's OWN top-left corner. That is the corner where the document's text would start if the document were held upright. If the photo shows the document sideways or upside down, the first corner is not the top-left of the photo.
- Follow the edge of the paper itself and leave out the table, keyboard, hands and everything else around it.
- If there is no single document clearly visible, return found as false and an empty corners list.
`;

export const DOCUMENT_CORNERS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    corners: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          x: { type: 'NUMBER' },
          y: { type: 'NUMBER' }
        },
        required: ['x', 'y']
      }
    }
  },
  required: ['found', 'corners']
};

export async function generateDocumentCorners({ bytes, mimeType, apiKey, fetchImpl = fetch }) {
  const model = AI_CONFIG.primaryModel;
  const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const response = await fetchWithExponentialBackoff(
    targetUrl,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: DOCUMENT_CORNERS_PROMPT },
            { inlineData: { data: Buffer.from(bytes).toString('base64'), mimeType } }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: DOCUMENT_CORNERS_SCHEMA,
          temperature: 0
        }
      })
    },
    AI_CONFIG.retry,
    fetchImpl
  );

  if (!response.ok) {
    throw sanitizeUpstreamAiError(response.status);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts
    ?.map(part => part.text || '')
    .join('')
    .trim() || '';

  try {
    const parsed = JSON.parse(text.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    return { found: parsed.found === true, corners: Array.isArray(parsed.corners) ? parsed.corners : [] };
  } catch {
    // Corner finding is a convenience; an unreadable answer just means "not found"
    return { found: false, corners: [] };
  }
}
