import { HttpError, errorResponse, jsonResponse, requireScannerAccess } from './_lib/firebase-auth.js';
import { determineTaskModel, AI_CONFIG } from './_lib/ai-config.js';
import { fetchWithExponentialBackoff } from './_lib/ai-retry.js';
import { AI_TOOL_DECLARATIONS, selectRelevantToolDeclarations } from './_lib/ai-tools-definitions.js';
import { resolveServerGeminiKey, readAndValidateJsonBody, sanitizeUpstreamAiError } from './_lib/ai-auth.js';

export async function POST(request) {
  const startTime = Date.now();
  try {
    await requireScannerAccess(request, fetch, { rateLimit: 30 });

    const body = await readAndValidateJsonBody(request);
    const { contents, systemInstruction, prompt, query, forceDeepReasoning, forceNoTools, apiKey: clientApiKey } = body;

    // Lightweight shape validation (reject clearly malformed payloads while allowing future multimodal extensions)
    if (contents !== undefined && contents !== null && !Array.isArray(contents)) {
      throw new HttpError(400, 'Invalid request: contents must be an array.');
    }
    if (prompt !== undefined && prompt !== null && typeof prompt !== 'string') {
      throw new HttpError(400, 'Invalid request: prompt must be a string.');
    }
    if (query !== undefined && query !== null && typeof query !== 'string') {
      throw new HttpError(400, 'Invalid request: query must be a string.');
    }
    if (Array.isArray(contents)) {
      for (let i = 0; i < contents.length; i++) {
        const turn = contents[i];
        if (!turn || typeof turn !== 'object') {
          throw new HttpError(400, `Invalid request: turn at index ${i} must be an object.`);
        }
      }
    }

    // System instruction character cap: max 80,000 characters
    if (systemInstruction) {
      const sysLen = typeof systemInstruction === 'string'
        ? systemInstruction.length
        : (systemInstruction.parts ? systemInstruction.parts.reduce((s, p) => s + String(p?.text || '').length, 0) : JSON.stringify(systemInstruction).length);
      if (sysLen > 80000) {
        throw new HttpError(400, 'System instruction exceeds maximum allowed limit of 80,000 characters.');
      }
    }

    // Conversation turns cap: max 30 turns
    if (Array.isArray(contents) && contents.length > 30) {
      throw new HttpError(400, 'Conversation exceeds maximum length (30 turns). Please start a fresh chat topic.');
    }

    // Total character cap across all conversation turns: max 50,000 characters
    if (Array.isArray(contents) && contents.length > 0) {
      let totalChars = 0;
      for (const turn of contents) {
        if (Array.isArray(turn.parts)) {
          for (const p of turn.parts) {
            totalChars += String(p?.text || '').length;
          }
        } else if (turn.text || turn.content) {
          totalChars += String(turn.text || turn.content || '').length;
        }
      }
      if (totalChars > 50000) {
        throw new HttpError(400, 'Conversation content exceeds maximum limit of 50,000 characters. Please start a fresh chat topic.');
      }
    }

    const apiKey = resolveServerGeminiKey(clientApiKey);

    if (!apiKey) {
      throw new HttpError(503, 'AI Service is not configured on the server. Please configure GEMINI_API_KEY.');
    }

    let userQuery = String(prompt || query || '');

    let formattedContents = [];
    if (Array.isArray(contents) && contents.length > 0) {
      const raw = contents.map((c) => ({
        role: c.role === 'assistant' || c.role === 'ai' || c.role === 'model' ? 'model' : 'user',
        parts: Array.isArray(c.parts) ? c.parts : [{ text: String(c.text || c.content || '') }]
      }));

      while (raw.length > 0 && raw[0].role !== 'user') {
        raw.shift();
      }

      for (const turn of raw) {
        if (formattedContents.length > 0 && formattedContents[formattedContents.length - 1].role === turn.role) {
          formattedContents[formattedContents.length - 1].parts.push(...turn.parts);
        } else {
          formattedContents.push(turn);
        }
      }

      const lastUserTurn = formattedContents.slice().reverse().find(c => c.role === 'user');
      if (lastUserTurn && lastUserTurn.parts.length > 0) {
        userQuery = lastUserTurn.parts.map(p => p.text).filter(Boolean).join(' ');
      }
    } else if (prompt || query) {
      formattedContents = [{ role: 'user', parts: [{ text: userQuery }] }];
    }

    if (formattedContents.length === 0) {
      formattedContents = [{ role: 'user', parts: [{ text: userQuery || 'Hello' }] }];
    }

    // Single selected model driven by intent classification
    const model = determineTaskModel(userQuery, forceDeepReasoning);
    const intent = forceDeepReasoning ? 'Forced Deep Reasoning' : (model === AI_CONFIG.reasoningModel ? 'Complex Analytical Audit' : 'Standard Lookup');

    const payload = {
      contents: formattedContents,
      generationConfig: {
        maxOutputTokens: AI_CONFIG.generation.maxOutputTokens,
        temperature: AI_CONFIG.generation.temperature
      }
    };

    let activeTools = AI_TOOL_DECLARATIONS;
    if (!forceNoTools) {
      activeTools = selectRelevantToolDeclarations(userQuery, formattedContents);
      payload.tools = [
        { functionDeclarations: activeTools }
      ];
    }


    if (systemInstruction) {
      payload.systemInstruction = typeof systemInstruction === 'string'
        ? { parts: [{ text: systemInstruction }] }
        : systemInstruction;
    }

    const targetUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    
    // Fetch using Exponential Backoff Retries on the single chosen model
    let response = await fetchWithExponentialBackoff(
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

    // If tools schema is rejected by target model, retry without tools
    if (!response.ok && !forceNoTools) {
      const fallbackPayload = { ...payload };
      delete fallbackPayload.tools;
      response = await fetchWithExponentialBackoff(
        targetUrl,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey
          },
          body: JSON.stringify(fallbackPayload)
        },
        AI_CONFIG.retry
      );
    }

    if (!response.ok) {
      throw sanitizeUpstreamAiError(response.status);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    // Check if model returned function calls (tool requests)
    const toolCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
    const textParts = parts.map((p) => p.text).filter(Boolean);
    const text = textParts.join('\n').trim();
    const durationMs = Date.now() - startTime;

    console.log('[API ask-brain] Request processed. Query length:', userQuery.length, '| Model:', model, '| Intent:', intent, '| Duration:', `${durationMs}ms`);
    if (toolCalls.length > 0) {
      console.log('[API ask-brain] Tools invoked count:', toolCalls.length, '| Tools:', toolCalls.map(t => t.name).join(', '));
    }

    const usageMetadata = data.usageMetadata || null;
    const tokensUsed = typeof usageMetadata?.totalTokenCount === 'number' ? usageMetadata.totalTokenCount : null;
    const promptTokens = typeof usageMetadata?.promptTokenCount === 'number' ? usageMetadata.promptTokenCount : null;
    const outputTokens = typeof usageMetadata?.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : null;

    return jsonResponse({
      text,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      telemetry: {
        modelUsed: model,
        intent,
        durationMs,
        toolCalls: toolCalls.map(tc => ({ name: tc.name, args: tc.args || {} })),
        toolsActiveCount: activeTools.length,
        totalToolsCount: AI_TOOL_DECLARATIONS.length,
        tokensUsed,
        promptTokens,
        outputTokens,
        usageMetadata,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export function GET() {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

export const maxDuration = 60;
