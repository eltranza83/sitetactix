/**
 * Which Jarvis engine this device uses. The new Jarvis is the default; only a
 * device that explicitly chose "classic" in Settings stays on the old one.
 */
export const JARVIS_ENGINE_KEY = 'jarvis_engine_mode';

export function getJarvisEngineMode(storage) {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return store?.getItem(JARVIS_ENGINE_KEY) === 'classic' ? 'classic' : 'new';
  } catch {
    return 'new';
  }
}
