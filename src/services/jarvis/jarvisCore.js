import { getFirebaseAuthInstance } from '../firebase.js';
import { LedgerSource } from './sources/ledgerSource.js';
import { executeJarvisTool, isWriteTool } from './tools/index.js';
import {
  isPurchasingItemGrounded,
  isExpenseGrounded,
  verifyActionExecutionClaims
} from './verify.js';
import {
  checkAndHandlePending,
  stripModelConfirmedArg,
  getActivePending
} from './pending.js';
import {
  getSessionDriveListing,
  clearSessionDriveListing
} from './tools/drive.js';

const MAX_TOOL_ROUNDS = 3;
let currentSessionProjectId = null;

/**
 * Format conversation turns for the Gemini model.
 * Keeps the last 10 turns and ensures strictly alternating user/model roles.
 * Retains recent Drive folder listing as data context so the model can resolve file IDs.
 */
function buildConversationContents(messages = [], userQuery = '') {
  const turns = [];

  // Take recent messages
  const recent = Array.isArray(messages) ? messages.slice(-10) : [];
  for (const m of recent) {
    if (!m || !m.text) continue;
    const role = (m.sender === 'user' || m.role === 'user') ? 'user' : 'model';
    turns.push({
      role,
      parts: [{ text: String(m.text) }]
    });
  }

  // Ensure alternating roles
  const consolidated = [];
  for (const turn of turns) {
    if (consolidated.length > 0 && consolidated[consolidated.length - 1].role === turn.role) {
      consolidated[consolidated.length - 1].parts.push(...turn.parts);
    } else {
      consolidated.push(turn);
    }
  }

  // Inject recent drive listing data if available
  const activeListing = getSessionDriveListing();
  let queryWithData = userQuery;
  if (activeListing && Array.isArray(activeListing.files) && activeListing.files.length > 0) {
    const listingData = [
      `[RECENT DRIVE LISTING (DATA)]`,
      `Folder: "${activeListing.folderName}"`,
      ...activeListing.files.map(f => `${f.index}. "${f.name}" (fileId: "${f.id}", purchased: "${f.purchaseDate || 'unknown'}")`)
    ].join('\n');
    queryWithData = `${listingData}\n\nUser request: ${userQuery}`;
  }

  // Ensure last turn is user turn with the new query
  if (consolidated.length === 0 || consolidated[consolidated.length - 1].role !== 'user') {
    consolidated.push({ role: 'user', parts: [{ text: queryWithData }] });
  } else {
    consolidated[consolidated.length - 1] = { role: 'user', parts: [{ text: queryWithData }] };
  }

  return consolidated;
}

/**
 * Main entry point for the new lean Jarvis core.
 */
export async function askNewJarvis(query, options = {}) {
  const {
    projectId = '',
    projectName = 'Active Project',
    googleToken = null,
    currentDashboard = null,
    spreadsheetId = null,
    driveTree = null,
    projectFolderId = null,
    messages = [],
    apiKey = null,
    onOpenDocument = null,
    uid = null,
    fetchImpl = fetch,
    ledgerSource: customLedgerSource = null
  } = options;

  if (!projectId) {
    return {
      text: 'No active project selected. Please select a project first.',
      executedTools: []
    };
  }

  // Clear folder listing if project switched
  if (currentSessionProjectId && currentSessionProjectId !== projectId) {
    clearSessionDriveListing();
  }
  currentSessionProjectId = projectId;

  // 1. Pending confirmation check (e.g. user answering "yes" or "no" to stage_expense)
  const pendingCheck = await checkAndHandlePending(query, projectId);
  if (pendingCheck.handled) {
    return {
      text: pendingCheck.message,
      pendingHandled: true,
      pendingAction: null,
      executedTools: pendingCheck.confirmed ? [{ name: pendingCheck.type, ok: !pendingCheck.error, isWrite: true }] : []
    };
  }

  // 2. Initialize LedgerSource
  const ledgerSource = customLedgerSource || await LedgerSource.create({
    googleToken,
    spreadsheetId,
    currentDashboard
  });

  const toolContext = {
    projectId,
    projectName,
    projectFolderId,
    googleToken,
    spreadsheetId,
    driveTree,
    ledgerSource,
    onOpenDocument,
    uid,
    fetchImpl
  };

  // 3. Prepare conversation turns and metadata
  const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Chicago';
  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });

  // If there is an active pending action with additional user content ("yes, but make it $60"), inject preview context
  const activePending = getActivePending();
  let queryWithPending = query;
  if (activePending && activePending.preview) {
    const prevStr = JSON.stringify(activePending.preview);
    queryWithPending = `[CONTEXT: Pending confirmation for ${activePending.type}: ${prevStr}]\nUser request: ${query}`;
  }

  const contents = buildConversationContents(messages, queryWithPending);

  // 4. Resolve auth headers for /api/jarvis
  const headers = { 'Content-Type': 'application/json' };
  const auth = getFirebaseAuthInstance();
  if (auth?.currentUser) {
    try {
      const idToken = await auth.currentUser.getIdToken();
      if (idToken) headers.Authorization = `Bearer ${idToken}`;
    } catch {}
  }

  const executedTools = [];
  let finalText = '';

  // 5. Multi-round tool execution loop (max 3 rounds)
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const reqBody = {
      contents,
      projectName,
      projectId,
      today: todayFormatted,
      timeZone: userTimeZone,
      apiKey
    };

    let apiRes = null;
    try {
      apiRes = await fetchImpl('/api/jarvis', {
        method: 'POST',
        headers,
        body: JSON.stringify(reqBody)
      });
    } catch (err) {
      console.error('[askNewJarvis] Network error connecting to /api/jarvis:', err);
      return {
        text: "I couldn't reach the Jarvis service right now. Please check your connection.",
        error: err.message
      };
    }

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error(`[askNewJarvis] Server returned ${apiRes.status}:`, errText);
      return {
        text: `Jarvis service error (${apiRes.status}). Please try again.`,
        error: errText
      };
    }

    const data = await apiRes.json();
    const toolCalls = data.toolCalls || [];

    // If no tool calls, the model gave its final answer
    if (toolCalls.length === 0) {
      finalText = data.text || '';
      break;
    }

    // Process each tool call with write grounding and past-tense guards
    const modelParts = data.parts || toolCalls.map(tc => ({ functionCall: tc }));
    contents.push({ role: 'model', parts: modelParts });

    const toolResponses = [];

    for (const call of toolCalls) {
      const toolName = call.name;
      const rawArgs = call.args || {};
      const safeArgs = stripModelConfirmedArg(rawArgs);
      const isWrite = isWriteTool(toolName);

      let toolResult = null;

      // Grounding & safety verification for writes
      if (toolName === 'add_purchasing_item' || toolName === 'set_purchasing_status' || toolName === 'remove_purchasing_item') {
        const item = safeArgs.item || '';
        if (!isPurchasingItemGrounded(item, query)) {
          toolResult = {
            ok: false,
            ungrounded: true,
            message: `I didn't complete that — which item did you mean?`
          };
        }
      } else if (toolName === 'stage_expense') {
        if (!isExpenseGrounded(safeArgs.vendor, safeArgs.amount, query)) {
          toolResult = {
            ok: false,
            ungrounded: true,
            message: 'Expense vendor or amount was not clearly specified in your request.'
          };
        }
      }

      // Execute tool if not blocked
      if (!toolResult) {
        toolResult = await executeJarvisTool(toolName, safeArgs, toolContext);
      }

      executedTools.push({
        name: toolName,
        args: safeArgs,
        ok: toolResult?.ok !== false && !toolResult?.error && !toolResult?.blocked && !toolResult?.ungrounded,
        isWrite,
        result: toolResult
      });

      toolResponses.push({
        functionResponse: {
          name: toolName,
          response: toolResult
        }
      });
    }

    // Append tool responses as user turn for the next model round
    contents.push({ role: 'user', parts: toolResponses });
  }

  // Fallback text if model produced no final text after tool execution
  if (!finalText && executedTools.length > 0) {
    const lastTool = executedTools[executedTools.length - 1];
    if (lastTool?.result?.message) {
      finalText = lastTool.result.message;
    }
  }

  // 6. Verify final claims
  const verifiedText = verifyActionExecutionClaims(finalText, query, executedTools);

  return {
    text: verifiedText,
    executedTools,
    pendingAction: getActivePending()
  };
}
