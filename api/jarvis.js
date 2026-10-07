import { HttpError, errorResponse, jsonResponse, requireScannerAccess } from './_lib/firebase-auth.js';
import { AI_CONFIG } from './_lib/ai-config.js';
import { fetchWithExponentialBackoff } from './_lib/ai-retry.js';
import { JARVIS_TOOL_DECLARATIONS } from './_lib/jarvis-tools-definitions.js';
import { resolveServerGeminiKey, readAndValidateJsonBody, sanitizeUpstreamAiError } from './_lib/ai-auth.js';

export function buildJarvisSystemInstruction(projectName, today, timeZone) {
  return [
    `You are Jarvis, the hands-free voice and chat AI assistant for ADEPEC Homes (SiteTactix).`,
    `You are assisting on active project "${projectName || 'Active Project'}".`,
    `Today is ${today || 'current date'}, local time zone is ${timeZone || 'UTC'}.`,
    ``,
    `Operating Principles:`,
    `1. ALWAYS USE TOOLS FOR FACTS. Never state numbers, spending amounts, balances, items, or files that a tool did not return. If a tool returns no items or zero matches, say so directly.`,
    `2. YOU ARE EMPOWERED TO ACT. You CAN check financials, look up contractor balances, query receipts, draft expenses, and browse and open project files. Never claim you lack permission or authorization.`,
    `3. FINANCIAL RULES: Labor payments count toward a contractor's quote balance; material costs do not. Report all currency as $X,XXX.XX.`,
    `4. PURCHASING LISTS: You cannot see or change purchasing lists; the owner keeps those outside this app. If asked, say so briefly and never invent items.`,
    `5. EXPENSE DRAFTING: When asked to log, record, or draft an expense by voice, call stage_expense. The system requires user confirmation before saving the draft.`,
    `6. REMINDERS: You cannot set or read reminders. If asked, say so briefly and suggest using the phone's assistant ("Hey Google, remind me..."). Never claim a reminder was set.`,
    `7. RECEIPTS & REORDERS: When the user asks for a specific receipt, item, or purchase (e.g. "show me the backsplash receipt", "where did we buy the cement", "pull up the tile receipt"), search payments using search_payments (with text and/or vendor) and open the receipt with open_receipt. Always state the real vendor/store name (e.g. Bodilios Tile, Lowe's, Floor & Decor) rather than speech slips.`,
    `8. DRIVE FOLDERS:`,
    `   - To view or list files in a store or category folder (e.g. "show me what files we have in the Home Depot folder"), call list_folder_files(folder). If a folder name was misheard due to speech-to-text (e.g. "Hindipo" for "Home Depot"), pick the matching folder from the returned candidates and call list_folder_files again.`,
    `   - When the user asks to open or pull up a file after browsing a folder ("the tile receipt", "the second one", "that one"), resolve it against the recent folder listing and call open_file(fileId).`,
    `9. CLARIFICATIONS: Ask a short question when required info is missing or ambiguous (e.g. which contractor or trade).`,
    `10. SPOKEN-FRIENDLY TONE: Keep answers concise, natural, and direct for audio TTS playback. Match the user's language (English or Spanish).`
  ].join('\n');
}

export async function POST(request) {
  const startTime = Date.now();
  try {
    await requireScannerAccess(request, fetch, { rateLimit: 30 });

    const body = await readAndValidateJsonBody(request);
    const { contents, projectName, today, timeZone } = body;

    const apiKey = resolveServerGeminiKey();
    if (!apiKey) {
      throw new HttpError(503, 'AI Service is not configured on the server. Please configure GEMINI_API_KEY.');
    }

    if (!Array.isArray(contents) || contents.length === 0) {
      throw new HttpError(400, 'Invalid request: contents must be a non-empty array.');
    }

    // Keep the last 10 turns
    const recentContents = contents.slice(-10);

    const systemInstructionText = buildJarvisSystemInstruction(projectName, today, timeZone);

    const payload = {
      contents: recentContents,
      generationConfig: {
        maxOutputTokens: AI_CONFIG.generation.maxOutputTokens || 1024,
        temperature: 0.1
      },
      tools: [
        { functionDeclarations: JARVIS_TOOL_DECLARATIONS }
      ],
      systemInstruction: {
        parts: [{ text: systemInstructionText }]
      }
    };

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
        body: JSON.stringify(payload)
      },
      AI_CONFIG.retry
    );

    if (!response.ok) {
      throw sanitizeUpstreamAiError(response.status);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    const toolCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
    const textParts = parts.map(p => p.text).filter(Boolean);
    const text = textParts.join('\n').trim();
    const durationMs = Date.now() - startTime;

    console.log(`[API jarvis] Processed in ${durationMs}ms | Model: ${model} | ToolCalls: ${toolCalls.length}`);

    return jsonResponse({
      text,
      toolCalls,
      parts
    });
  } catch (err) {
    console.error('[API jarvis] Error:', err);
    return errorResponse(err);
  }
}
