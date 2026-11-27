import { DOCUMENT_EXTRACTION_PROMPT, GEMINI_RESPONSE_SCHEMA } from './_lib/document-prompt.js';
import { QUOTE_EXTRACTION_PROMPT, QUOTE_RESPONSE_SCHEMA } from './_lib/quote-prompt.js';
import {
  VOICE_EXPENSE_SCHEMA,
  TRANSLATE_PUNCH_SCHEMA,
  buildVoiceExpensePrompt,
  buildTranslatePunchPrompt
} from './_lib/voice-prompt.js';
import { AI_CONFIG } from './_lib/ai-config.js';
import { fetchWithBackupModel, geminiUrl } from './_lib/ai-retry.js';
import {
  HttpError,
  errorResponse,
  jsonResponse,
  requireScannerAccess
} from './_lib/firebase-auth.js';
import { resolveServerGeminiKey, sanitizeUpstreamAiError } from './_lib/ai-auth.js';
import { generateDocumentCorners } from './_lib/document-corners.js';

const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_TRANSLATE_BYTES = 32 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/wav',
  'audio/aac'
]);

function normalizeMimeType(raw) {
  return String(raw || '').split(';')[0].trim().toLowerCase();
}

function parseGeminiJson(text) {
  const cleaned = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

/**
 * Reads one document with Gemini. Returns the extracted fields and which model read them
 * (the backup model when Google said the main one was busy).
 */
export async function generateDocumentData({
  bytes = null,
  mimeType = '',
  apiKey,
  prompt = DOCUMENT_EXTRACTION_PROMPT,
  schema = GEMINI_RESPONSE_SCHEMA,
  fetchImpl = fetch
}) {
  const parts = [{ text: prompt }];
  if (bytes && bytes.byteLength > 0 && mimeType) {
    parts.push({
      inlineData: {
        data: Buffer.from(bytes).toString('base64'),
        mimeType
      }
    });
  }

  const { response, model } = await fetchWithBackupModel(
    [AI_CONFIG.primaryModel, AI_CONFIG.backupModel],
    geminiUrl,
    {
      method: 'POST',
      // Each try may take up to 35 seconds; all tries together stay under the 60-second server limit
      timeoutMs: 35000,
      deadlineMs: 55000,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: schema,
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
    .trim();
  if (!text) {
    throw new HttpError(502, 'AI extraction returned an empty response. Please try again.');
  }

  try {
    return { data: parseGeminiJson(text), model };
  } catch (error) {
    console.error('Gemini returned invalid JSON:', error);
    throw new HttpError(502, 'AI extraction returned unreadable data. Please try again.');
  }
}

export async function POST(request) {
  try {
    await requireScannerAccess(request);

    const apiKey = resolveServerGeminiKey();
    if (!apiKey) {
      throw new HttpError(503, 'AI processing is not configured on the server. Please configure GEMINI_API_KEY.');
    }

    const mode = (request.headers.get('x-document-mode') || '').toLowerCase();

    // Text-only Spanish punch-packet translation mode
    if (mode === 'translate-punch') {
      const declaredLength = Number(request.headers.get('content-length') || 0);
      if (declaredLength > MAX_TRANSLATE_BYTES) {
        throw new HttpError(413, 'Translation request is too large.');
      }
      const rawText = await request.text();
      if (!rawText || rawText.length > MAX_TRANSLATE_BYTES) {
        throw new HttpError(400, 'Translation payload is empty or too large.');
      }
      let payload;
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new HttpError(400, 'Invalid JSON payload.');
      }
      const { data, model } = await generateDocumentData({
        apiKey,
        prompt: buildTranslatePunchPrompt(payload),
        schema: TRANSLATE_PUNCH_SCHEMA
      });
      return jsonResponse({ data, readByBackupAi: model !== AI_CONFIG.primaryModel });
    }

    const mimeType = normalizeMimeType(request.headers.get('x-document-mime') || '');
    const isVoiceMode = mode === 'voice-expense';

    if (isVoiceMode) {
      if (!ALLOWED_AUDIO_MIME_TYPES.has(mimeType)) {
        throw new HttpError(415, 'Unsupported audio recording format.');
      }
    } else if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      throw new HttpError(415, 'Only PDF, JPEG, PNG, and WebP documents are supported.');
    }

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > MAX_DOCUMENT_BYTES) {
      throw new HttpError(413, 'This document is too large. Please use a file smaller than 4 MB.');
    }

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new HttpError(400, 'The selected document is empty.');
    }
    if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
      throw new HttpError(413, 'This document is too large. Please use a file smaller than 4 MB.');
    }

    // The crop screen asks for just the document's corners (photos only)
    if ((request.headers.get('x-document-task') || '').toLowerCase() === 'corners') {
      if (mimeType === 'application/pdf') {
        throw new HttpError(415, 'Corner finding works on photos only.');
      }
      const corners = await generateDocumentCorners({ bytes, mimeType, apiKey });
      return jsonResponse({ corners });
    }

    let prompt = DOCUMENT_EXTRACTION_PROMPT;
    let schema = GEMINI_RESPONSE_SCHEMA;
    let geminiMime = mimeType;

    if (mode === 'quote') {
      prompt = QUOTE_EXTRACTION_PROMPT;
      schema = QUOTE_RESPONSE_SCHEMA;
    } else if (mode === 'voice-expense') {
      if (geminiMime === 'audio/m4a' || geminiMime === 'audio/x-m4a') geminiMime = 'audio/mp4';
      if (geminiMime === 'audio/mp3') geminiMime = 'audio/mpeg';
      prompt = buildVoiceExpensePrompt({
        localDate: request.headers.get('x-local-date') || '',
        activeProjectName: decodeURIComponent(request.headers.get('x-active-project') || ''),
        knownSubs: decodeURIComponent(request.headers.get('x-known-subs') || '')
      });
      schema = VOICE_EXPENSE_SCHEMA;
    }

    const { data, model } = await generateDocumentData({
      bytes,
      mimeType: geminiMime,
      apiKey,
      prompt,
      schema
    });
    // Lets the draft show that the backup model read this receipt (worth a closer look)
    return jsonResponse({ data, readByBackupAi: model !== AI_CONFIG.primaryModel });
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET() {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

export const maxDuration = 60;
