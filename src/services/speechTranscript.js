/**
 * Builds one clean transcript from browser speech-recognition results.
 *
 * Some Android recognizers (continuous mode) resend the sentence as it grows:
 * "do", "do we", "do we have", ... and mark every update as final. Appending each
 * update produced "do do we do we have ...". Here a longer version of the current
 * phrase REPLACES it, and only genuinely new phrases are appended.
 */

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 'extends' = piece is the current phrase grown longer (or equal);
// 'shorter' = piece is an older/shorter version of the current phrase.
function relation(currentNorm, pieceNorm) {
  if (!currentNorm) return 'new';
  if (pieceNorm === currentNorm || pieceNorm.startsWith(currentNorm)) return 'extends';
  if (currentNorm.startsWith(pieceNorm)) return 'shorter';
  return 'new';
}

export function createTranscriptAccumulator() {
  let committed = '';
  let current = '';

  const join = (a, b) => [a, b].filter(Boolean).join(' ').trim();

  return {
    addFinal(piece) {
      const text = String(piece || '').trim();
      if (!text) return;
      const rel = relation(normalize(current), normalize(text));
      if (rel === 'extends') {
        current = text;
      } else if (rel === 'new') {
        committed = join(committed, current);
        current = text;
      }
      // 'shorter': an older version of what we already have, ignore it
    },

    getText() {
      return join(committed, current);
    },

    // Text including a not-yet-final (interim) piece, without changing the state.
    previewWith(interimPiece) {
      const text = String(interimPiece || '').trim();
      if (!text) return join(committed, current);
      const rel = relation(normalize(current), normalize(text));
      if (rel === 'extends') return join(committed, text);
      if (rel === 'shorter') return join(committed, current);
      return join(join(committed, current), text);
    },

    reset() {
      committed = '';
      current = '';
    }
  };
}
