/**
 * J.A.R.V.I.S. Speech Synthesis Voice Resolver
 * 
 * Provides robust platform-aware voice selection prioritizing authentic British Male
 * and English Male voices across Windows, macOS/iOS, and Android (including Samsung Galaxy S-series
 * and Google Speech Services), strictly avoiding accidental fallbacks to female defaults.
 */

export const FEMALE_VOICE_PATTERNS = [
  'female',
  'woman',
  'girl',
  'susan',
  'hazel',
  'victoria',
  'zira',
  'samantha',
  'karen',
  'serena',
  'kate',
  'stephanie',
  'martha',
  'ava',
  'allison',
  'zoe',
  'fiona',
  'tessa',
  'moira',
  'veena',
  'catherine',
  'lisa',
  'helena',
  'clara',
  'amy',
  'en-gb-x-gba',
  'en-gb-x-gbd',
  'en-gb-x-gbf',
  'en-us-x-sfg',
  'en-us-x-tpc',
  'en-us-x-tpd',
  'en-au-x-aub',
  'en-au-x-aud',
  'es-es-x-eea',
  'sabina',
  'dalia',
  'paulina',
  'laura',
  'monica',
  'marta',
  'lucia'
];

/**
 * Checks whether a voice is known or identified as female.
 */
export function isFemaleVoice(voice) {
  if (!voice) return false;
  const nameLower = (voice.name || '').toLowerCase();
  const uriLower = (voice.voiceURI || '').toLowerCase();

  // Samsung TTS convention: Default Samsung voices without "male" are female
  if (nameLower.startsWith('samsung') && !nameLower.includes('male') && !nameLower.includes('masculino') && !uriLower.includes('male')) {
    return true;
  }

  // Google TTS female variant codes
  if (uriLower.includes('-gba') || uriLower.includes('-gbd') || uriLower.includes('-gbf') || uriLower.includes('-sfg')) {
    return true;
  }

  return FEMALE_VOICE_PATTERNS.some(p => nameLower.includes(p) || uriLower.includes(p));
}

/**
 * Checks whether a voice has explicit male indicators.
 */
export function isExplicitMaleVoice(voice) {
  if (!voice || isFemaleVoice(voice)) return false;
  const nameLower = (voice.name || '').toLowerCase();
  const uriLower = (voice.voiceURI || '').toLowerCase();

  const maleKeywords = [
    'male',
    'masculino',
    'george',
    'daniel',
    'oliver',
    'arthur',
    'aaron',
    'david',
    'ryan',
    'guy',
    'rjs',
    'gbb',
    'gbc',
    'iol',
    'iom',
    'iog',
    'gordon',
    'malcolm',
    'mark'
  ];

  return maleKeywords.some(k => nameLower.includes(k) || uriLower.includes(k));
}

/**
 * Resolves the best British Male (J.A.R.V.I.S. persona) voice from the available system voices.
 * If no British male voice exists on the device, cleanly falls back to an English Male voice
 * (e.g. US/Global male) rather than reverting to a female British or female default voice.
 */
export function getBestBritishMaleVoice(voices) {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const enVoices = voices.filter(v => (v.lang || '').toLowerCase().startsWith('en'));
  if (enVoices.length === 0) return voices[0] || null;

  // Platform Tier 1: Windows Microsoft British Male (Microsoft George / Microsoft Ryan)
  const msGeorge = enVoices.find(v => {
    const l = (v.lang || '').toLowerCase().replace('_', '-');
    const n = (v.name || '').toLowerCase();
    return l.startsWith('en-gb') && (n.includes('george') || n.includes('ryan')) && !isFemaleVoice(v);
  });
  if (msGeorge) return msGeorge;

  // Platform Tier 2: Samsung Galaxy Android British Male
  // On Samsung S22/S24/S25/S26, Samsung TTS formats names like:
  // "Samsung English (United Kingdom, Male)", "en_GB_male", "en-gb-male"
  const samsungUkMale = enVoices.find(v => {
    const l = (v.lang || '').toLowerCase().replace('_', '-');
    const n = (v.name || '').toLowerCase();
    const u = (v.voiceURI || '').toLowerCase();
    const isUk = l.startsWith('en-gb') || n.includes('united kingdom') || u.includes('en_gb') || u.includes('en-gb');
    const isMale = n.includes('male') || u.includes('male');
    return isUk && isMale && !isFemaleVoice(v);
  });
  if (samsungUkMale) return samsungUkMale;

  // Platform Tier 3: Google Android Speech Services UK Male
  // Google TTS uses identifiers: "Google UK English Male", "en-gb-x-rjs", "en-gb-x-gbb", "en-gb-x-gbc"
  const googleUkMale = enVoices.find(v => {
    const l = (v.lang || '').toLowerCase().replace('_', '-');
    const n = (v.name || '').toLowerCase();
    const u = (v.voiceURI || '').toLowerCase();
    const isUk = l.startsWith('en-gb') || n.includes('united kingdom');
    const isGoogleMale = n.includes('uk english male') || u.includes('rjs') || u.includes('gbb') || u.includes('gbc') || n.includes('rjs') || n.includes('gbb');
    return isUk && isGoogleMale && !isFemaleVoice(v);
  });
  if (googleUkMale) return googleUkMale;

  // Platform Tier 4: Apple iOS / macOS British Male (Daniel, Oliver, Arthur, Aaron)
  const appleUkMale = enVoices.find(v => {
    const l = (v.lang || '').toLowerCase().replace('_', '-');
    const n = (v.name || '').toLowerCase();
    const isUk = l.startsWith('en-gb') || n.includes('united kingdom');
    const isAppleMale = n.includes('daniel') || n.includes('oliver') || n.includes('arthur') || n.includes('aaron') || n.includes('gordon');
    return isUk && isAppleMale && !isFemaleVoice(v);
  });
  if (appleUkMale) return appleUkMale;

  // Platform Tier 5: Any other UK English voice explicitly marked Male
  const anyUkMale = enVoices.find(v => {
    const l = (v.lang || '').toLowerCase().replace('_', '-');
    return l.startsWith('en-gb') && isExplicitMaleVoice(v);
  });
  if (anyUkMale) return anyUkMale;

  // Platform Tier 6: Any UK English voice that is confirmed NOT female
  // (Excludes default female voices that don't have 'female' in the name by checking against known female lists)
  const safeUkVoice = enVoices.find(v => {
    const l = (v.lang || '').toLowerCase().replace('_', '-');
    const n = (v.name || '').toLowerCase();
    const isBareDefault = n === 'english (united kingdom)' || n === 'english united kingdom';
    return l.startsWith('en-gb') && !isFemaleVoice(v) && !isBareDefault;
  });
  if (safeUkVoice) return safeUkVoice;

  // Platform Tier 7: English Male Fallback (US or other regions)
  // Essential for Android/Samsung if no UK Male voice is installed:
  // Prefer Samsung US Male ("Samsung English (United States, Male)"), Google US Male ("en-us-x-iol", "en-us-x-iom"), Microsoft David
  const anyEnglishMale = enVoices.find(v => isExplicitMaleVoice(v));
  if (anyEnglishMale) return anyEnglishMale;

  // Platform Tier 8: Any English voice that is not female
  const anyNonFemaleEnglish = enVoices.find(v => !isFemaleVoice(v));
  if (anyNonFemaleEnglish) return anyNonFemaleEnglish;

  // Platform Tier 9: Absolute fallback
  return enVoices[0] || voices[0];
}

/**
 * Resolves the best Spanish Male voice.
 */
export function getBestSpanishMaleVoice(voices) {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  const esVoices = voices.filter(v => (v.lang || '').toLowerCase().startsWith('es'));
  if (esVoices.length === 0) return voices[0] || null;

  const maleNames = ['jorge', 'raul', 'pablo', 'carlos', 'alvaro', 'enrique', 'male', 'rjs'];
  const maleEs = esVoices.find(v => {
    const n = (v.name || '').toLowerCase();
    return maleNames.some(m => n.includes(m)) && !isFemaleVoice(v);
  });
  if (maleEs) return maleEs;

  const safeEs = esVoices.find(v => !isFemaleVoice(v));
  if (safeEs) return safeEs;

  return esVoices[0] || null;
}

/**
 * Main voice resolver taking user configuration and language context into account.
 */
export function resolveVoice(voices, config, isSpanish = false) {
  if (!Array.isArray(voices) || voices.length === 0) return null;

  if (isSpanish) {
    if (config && (config.lang?.startsWith('es') || config.name?.toLowerCase().includes('spanish'))) {
      const match = voices.find(v => (config.uri && v.voiceURI === config.uri) || (config.name && v.name === config.name));
      if (match && !isFemaleVoice(match)) return match;
    }
    return getBestSpanishMaleVoice(voices);
  }

  if (config) {
    if (config.uri) {
      const matchUri = voices.find(v => v.voiceURI === config.uri);
      if (matchUri && !isFemaleVoice(matchUri)) return matchUri;
    }
    if (config.name) {
      const matchName = voices.find(v => v.name === config.name);
      if (matchName && !isFemaleVoice(matchName)) return matchName;
    }
    if (config.lang) {
      const matchLang = voices.find(v => v.lang.replace('_', '-').toLowerCase() === config.lang.replace('_', '-').toLowerCase());
      if (matchLang && !isFemaleVoice(matchLang) && isExplicitMaleVoice(matchLang)) return matchLang;
    }
  }

  return getBestBritishMaleVoice(voices);
}

/**
 * Splits spoken text into clean, digestible sentence chunks.
 * Prevents mobile TTS engine timeouts (15s Android limit), buffer overflows,
 * and unnatural speech clipping on Samsung Galaxy and other mobile devices.
 */
export function splitIntoSpokenChunks(str) {
  if (!str || typeof str !== 'string') return [];

  const text = str
    .replace(/\$(\d+(?:,\d{3})*)\.00\b/g, '$$$1')
    .replace(/\b(vs|dr|mr|mrs|ms|approx|dept|est|apt|inc|corp)\.\s+/gi, '$1 ')
    .trim();

  if (!text) return [];

  // Split on terminal sentence punctuation (. ! ?) followed by whitespace or end of string
  // Uses lookbehind for . ! ? or newline so delimiters are retained with their sentence
  let rawSegments = [];
  try {
    rawSegments = text.split(/(?<=[.!?\n])\s+/);
  } catch {
    rawSegments = text.match(/[^.!?\n]+[.!?\n]+|[^.!?\n]+$/g) || [text];
  }

  const chunks = [];

  for (const segment of rawSegments) {
    const trimmed = segment.trim();
    if (!trimmed) continue;

    // If an individual segment is still long (>160 chars), break by comma/semicolon clauses
    if (trimmed.length > 160) {
      let subParts = [];
      try {
        subParts = trimmed.split(/(?<=[,;])\s+/);
      } catch {
        subParts = trimmed.match(/[^,;]+[,;]+|[^,;]+$/g) || [trimmed];
      }

      let currentBuffer = '';
      for (const part of subParts) {
        const pt = part.trim();
        if (!pt) continue;
        if ((currentBuffer + ' ' + pt).length > 160) {
          if (currentBuffer) chunks.push(currentBuffer.trim());
          currentBuffer = pt;
        } else {
          currentBuffer = currentBuffer ? `${currentBuffer} ${pt}` : pt;
        }
      }
      if (currentBuffer.trim()) chunks.push(currentBuffer.trim());
    } else {
      chunks.push(trimmed);
    }
  }

  return chunks.length > 0 ? chunks : [text];
}
