import { HttpError, errorResponse, jsonResponse, requireScannerAccess } from './_lib/firebase-auth.js';
import { AI_CONFIG } from './_lib/ai-config.js';
import { fetchWithExponentialBackoff } from './_lib/ai-retry.js';
import { resolveServerGeminiKey, readAndValidateJsonBody, sanitizeUpstreamAiError } from './_lib/ai-auth.js';

export const OBSERVER_SYSTEM_INSTRUCTION = `You are the Cognitive Preference Observer for SiteTactix (J.A.R.V.I.S.).
Your role is to analyze a builder's conversational input and detect any emerging, implied, or explicit behavioral preferences.

Categories:
- "information_depth": bottom line vs full history vs itemized details
- "response_style": brevity, conciseness, directness
- "formatting_preference": bullet points, tabular, single sentence
- "workflow_preference": preview before send, approval gating
- "terminology": term distinctions, naming conventions

Output Format (strict JSON):
If a preference is expressed or implied:
{
  "hasPreference": true,
  "category": "information_depth" | "response_style" | "formatting_preference" | "workflow_preference" | "terminology",
  "inferredIntent": "<concise_slug_e_g_concise_bottom_line>",
  "preferenceStatement": "<generalized behavioral instruction for the AI>",
  "confidence": 0.50 to 1.0,
  "evidence": "<reasoning>",
  "source": "inferred" | "explicit"
}

If no preference is expressed (just asking for regular construction data):
{
  "hasPreference": false
}`;

export async function POST(request) {
  try {
    await requireScannerAccess(request, fetch, { rateLimit: 30 });

    const body = await readAndValidateJsonBody(request);
    const { query, apiKey: clientApiKey } = body;
    const apiKey = resolveServerGeminiKey(clientApiKey);

    if (!query || typeof query !== 'string') {
      return jsonResponse({ hasPreference: false });
    }

    if (query.length > 2000) {
      throw new HttpError(400, 'Query exceeds maximum limit of 2,000 characters.');
    }

    if (!apiKey) {
      throw new HttpError(503, 'AI preference observation is not configured on the server. Please configure GEMINI_API_KEY.');
    }

    const payload = {
      contents: [{ role: 'user', parts: [{ text: `Analyze this builder input: "${query}"` }] }],
      systemInstruction: { parts: [{ text: OBSERVER_SYSTEM_INSTRUCTION }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 300
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${AI_CONFIG.primaryModel}:generateContent`;
    const res = await fetchWithExponentialBackoff(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(payload)
    }, AI_CONFIG.retry);

    if (!res.ok) {
      throw sanitizeUpstreamAiError(res.status);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return jsonResponse({ hasPreference: false });
    }

    return jsonResponse(parsed);
  } catch (err) {
    return errorResponse(err);
  }
}
