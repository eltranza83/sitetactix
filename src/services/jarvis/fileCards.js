/**
 * File cards for the New Jarvis engine.
 * Cards come ONLY from open tools Jarvis actually ran (open_file / open_receipt),
 * never from guessing at the user's words or the answer text.
 */

const OPEN_TOOL_NAMES = new Set(['open_file', 'open_receipt']);

export function buildJarvisFileCards(executedTools = []) {
  const cards = [];
  const seen = new Set();

  for (const tool of Array.isArray(executedTools) ? executedTools : []) {
    if (!tool || !OPEN_TOOL_NAMES.has(tool.name) || tool.ok !== true) continue;

    const result = tool.result || {};
    const id = result.fileId || result.driveFileId || null;
    if (!id || seen.has(id)) continue;
    seen.add(id);

    cards.push({
      id,
      name: result.fileName || 'Document.pdf',
      folderName: result.folderName || result.vendor || 'Google Drive',
      webViewLink: `https://drive.google.com/file/d/${id}/view`
    });
  }

  return cards;
}
