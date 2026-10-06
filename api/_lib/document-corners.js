import { AI_CONFIG } from './ai-config.js';
import { fetchWithExponentialBackoff } from './ai-retry.js';
import { sanitizeUpstreamAiError } from './ai-auth.js';

export const DOCUMENT_CORNERS_PROMPT = `
Find the main document (a receipt, invoice, check or envelope) in this photo and return where its four corners are.

- Each corner is a point with x and y from 0 to 1000. x runs across the photo from its left edge, y runs down from its top edge.
- Give the four corners in clockwise order, starting with the corner closest to the top-left of the photo.
- Also say which way the document's lines of text run in the photo, as textDirection:
  - upright: lines run left to right, letters stand up normally.
  - reads_top_to_bottom: lines run downward and the tops of the letters point to the right of the photo.
  - reads_bottom_to_top: lines run upward and the tops of the letters point to the left of the photo.
  - upside_down: lines run right to left and the letters are upside down.
- Follow the edge of the paper itself and leave out the table, keyboard, hands and everything else around it.
- If there is no single document clearly visible, return found as false and an empty corners list.
`;

export const DOCUMENT_CORNERS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    found: { type: 'BOOLEAN' },
    textDirection: { type: 'STRING', enum: ['upright', 'reads_top_to_bottom', 'reads_bottom_to_top', 'upside_down'] },
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
    return {
      found: parsed.found === true,
      textDirection: parsed.textDirection || 'upright',
      corners: Array.isArray(parsed.corners) ? parsed.corners : []
    };
  } catch {
    // Corner finding is a convenience; an unreadable answer just means "not found"
    return { found: false, textDirection: 'upright', corners: [] };
  }
}
