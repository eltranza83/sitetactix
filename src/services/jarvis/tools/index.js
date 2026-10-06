import { get_project_summary, get_contractor_balance, get_spending, search_payments } from './money.js';
import { stage_expense } from './expenses.js';
import { open_receipt } from './receipts.js';
import { list_folder_files, open_file } from './drive.js';

export const JARVIS_TOOL_REGISTRY = {
  get_project_summary,
  get_contractor_balance,
  get_spending,
  search_payments,
  open_receipt,
  list_folder_files,
  open_file,
  stage_expense
};

export const WRITE_TOOL_NAMES = new Set([
  'stage_expense'
]);

export function isWriteTool(toolName) {
  return WRITE_TOOL_NAMES.has(toolName);
}

export async function executeJarvisTool(toolName, args = {}, context = {}) {
  const fn = JARVIS_TOOL_REGISTRY[toolName];
  if (!fn) {
    return {
      ok: false,
      error: 'unknown_tool',
      message: `Tool "${toolName}" is not registered.`
    };
  }

  try {
    return await fn(args, context);
  } catch (err) {
    console.error(`[Jarvis Tool] Error executing ${toolName}:`, err);
    return {
      ok: false,
      error: 'execution_error',
      message: err.message
    };
  }
}
