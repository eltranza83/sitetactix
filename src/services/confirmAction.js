/**
 * Ask a yes/no question in the app's own dialog (components/ConfirmDialog.jsx, shown by
 * <ConfirmHost /> in App). Cancel is the default answer. Resolves true only on the confirm button.
 *
 *   if (!(await confirmAction({ title: 'Delete this pin?', message: '...', confirmLabel: 'Delete' }))) return;
 */
let showDialog = null;

export function confirmAction({ title, message = '', confirmLabel = 'Continue' }) {
  // No dialog on screen yet (should not happen in the app): fall back to the browser question
  if (!showDialog) return Promise.resolve(window.confirm([title, message].filter(Boolean).join('\n\n')));
  return new Promise(resolve => showDialog({ title, message, confirmLabel, resolve }));
}

/** Shows a message in the app's own dialog with one OK button (instead of the browser's alert box). */
export function showMessage({ title, message = '' }) {
  if (!showDialog) {
    window.alert([title, message].filter(Boolean).join('\n\n'));
    return Promise.resolve();
  }
  return new Promise(resolve => showDialog({ title, message, confirmLabel: null, resolve }));
}

/** Used by ConfirmHost only. Returns a function that disconnects it. */
export function connectConfirmDialog(show) {
  showDialog = show;
  return () => { if (showDialog === show) showDialog = null; };
}
