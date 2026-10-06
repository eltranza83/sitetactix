/**
 * Per-project cache of the Google Drive folder tree, kept in localStorage so the
 * assistant can answer folder questions right away on a cold start.
 */
const treeKey = (projectId) => `jobscan_cached_drivetree_${projectId}`;

export function loadProjectDriveTree(projectId) {
  try {
    if (!projectId) return null;
    const raw = localStorage.getItem(treeKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveProjectDriveTree(projectId, tree) {
  if (!projectId || !tree) return;
  try {
    localStorage.setItem(treeKey(projectId), JSON.stringify(tree));
  } catch {}
}
