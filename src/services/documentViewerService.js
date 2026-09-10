/**
 * Provider-Agnostic, Capability-Driven Document Viewer Service (v1.0)
 * 
 * Provides unified rendering strategy resolution, automatic fallbacks,
 * provider health monitoring / circuit-breaking, and structured field telemetry.
 */

import { fetchDriveFileAsObjectUrl } from './googleDrive.js';

export const DOCUMENT_VIEWER_SPEC_VERSION = '1.0';

const STRATEGY_CACHE_KEY_PREFIX = 'sitetactix_viewer_strategy_pref_';
const TELEMETRY_STORAGE_KEY = 'sitetactix_viewer_telemetry_logs';

export const FILE_CATEGORIES = {
  PDF: 'pdf',
  IMAGE: 'image',
  TEXT: 'text',
  SPREADSHEET: 'spreadsheet',
  GENERIC: 'generic'
};

export const RENDER_MODES = {
  IFRAME_EMBED: 'iframe_embed',
  IMAGE_DIRECT: 'image_direct',
  BLOB_EMBED: 'blob_embed',
  DOWNLOAD_FALLBACK: 'download_fallback',
  EXTERNAL_LINK: 'external_link'
};

export const PROVIDER_HEALTH_STATUS = {
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNAVAILABLE: 'UNAVAILABLE'
};

/**
 * In-memory telemetry log buffer (max 50 recent events)
 */
const inMemoryTelemetry = [];

/**
 * Provider health circuit breaker registry
 */
const providerHealthRegistry = new Map();

/**
 * Detect client browser & device capabilities
 */
export function detectBrowserCapabilities() {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isAndroid: false,
      isIOS: false,
      pdfViewerEnabled: false,
      supportsTouch: false
    };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isAndroid || isIOS || /Mobile|Silk|Kindle/i.test(ua);
  const pdfViewerEnabled = Boolean(navigator.pdfViewerEnabled);
  const supportsTouch = 'ontouchstart' in window || (navigator.maxTouchPoints > 0);

  return {
    isMobile,
    isAndroid,
    isIOS,
    pdfViewerEnabled,
    supportsTouch
  };
}

/**
 * Infer file category from name or MIME type
 */
export function inferFileCategory(fileName = '', mimeType = '') {
  const cleanName = String(fileName).toLowerCase();
  const cleanMime = String(mimeType).toLowerCase();

  if (cleanName.endsWith('.pdf') || cleanMime.includes('pdf')) {
    return FILE_CATEGORIES.PDF;
  }
  if (
    cleanName.match(/\.(jpe?g|png|webp|gif|svg|bmp|heic)$/) ||
    cleanMime.startsWith('image/')
  ) {
    return FILE_CATEGORIES.IMAGE;
  }
  if (
    cleanName.match(/\.(txt|csv|md|json|log)$/) ||
    cleanMime.startsWith('text/')
  ) {
    return FILE_CATEGORIES.TEXT;
  }
  if (
    cleanName.match(/\.(xlsx?|ods|numbers)$/) ||
    cleanMime.includes('spreadsheet') ||
    cleanMime.includes('excel')
  ) {
    return FILE_CATEGORIES.SPREADSHEET;
  }

  return FILE_CATEGORIES.GENERIC;
}

// ---------------------------------------------------------------------------
// Provider Health & Circuit Breaker
// ---------------------------------------------------------------------------

export function recordProviderHealth(provider, isSuccess, errorDetail = null) {
  const provKey = String(provider || 'google_drive').toLowerCase();
  const current = providerHealthRegistry.get(provKey) || {
    status: PROVIDER_HEALTH_STATUS.HEALTHY,
    consecutiveFailures: 0,
    lastSuccess: Date.now(),
    lastFailure: null,
    lastError: null
  };

  if (isSuccess) {
    current.status = PROVIDER_HEALTH_STATUS.HEALTHY;
    current.consecutiveFailures = 0;
    current.lastSuccess = Date.now();
  } else {
    current.consecutiveFailures += 1;
    current.lastFailure = Date.now();
    current.lastError = errorDetail;
    if (current.consecutiveFailures >= 3) {
      current.status = PROVIDER_HEALTH_STATUS.UNAVAILABLE;
    } else {
      current.status = PROVIDER_HEALTH_STATUS.DEGRADED;
    }
  }

  providerHealthRegistry.set(provKey, current);
}

export function isProviderHealthy(provider) {
  const provKey = String(provider || 'google_drive').toLowerCase();
  const health = providerHealthRegistry.get(provKey);
  if (!health) return true;
  return health.status !== PROVIDER_HEALTH_STATUS.UNAVAILABLE;
}

export function getProviderHealthStatus(provider) {
  const provKey = String(provider || 'google_drive').toLowerCase();
  return providerHealthRegistry.get(provKey)?.status || PROVIDER_HEALTH_STATUS.HEALTHY;
}

// ---------------------------------------------------------------------------
// Versioned Strategy Implementations (v1.0)
// ---------------------------------------------------------------------------

/**
 * Strategy: Google Drive Official Preview Embed
 */
export const GoogleDrivePreviewStrategy = {
  id: 'drive_preview_embed',
  name: 'Google Drive Embedded Preview',
  version: DOCUMENT_VIEWER_SPEC_VERSION,
  provider: 'google_drive',
  renderMode: RENDER_MODES.IFRAME_EMBED,
  isSupported(capabilities, fileMeta) {
    return Boolean(
      isProviderHealthy(fileMeta.provider || 'google_drive') &&
      fileMeta.fileId &&
      (fileMeta.provider === 'google_drive' || !fileMeta.provider)
    );
  },
  resolveUrl(fileMeta) {
    return `https://drive.google.com/file/d/${encodeURIComponent(fileMeta.fileId)}/preview`;
  }
};

/**
 * Strategy: Microsoft OneDrive / SharePoint Embedded Preview
 */
export const OneDrivePreviewStrategy = {
  id: 'onedrive_preview_embed',
  name: 'OneDrive / SharePoint Embedded Viewer',
  version: DOCUMENT_VIEWER_SPEC_VERSION,
  provider: 'onedrive',
  renderMode: RENDER_MODES.IFRAME_EMBED,
  isSupported(capabilities, fileMeta) {
    return Boolean(
      isProviderHealthy('onedrive') &&
      (fileMeta.provider === 'onedrive' || fileMeta.provider === 'sharepoint') &&
      (fileMeta.embedUrl || fileMeta.directUrl)
    );
  },
  resolveUrl(fileMeta) {
    return fileMeta.embedUrl || fileMeta.directUrl || '';
  }
};

/**
 * Strategy: Dropbox Embed Strategy
 */
export const DropboxPreviewStrategy = {
  id: 'dropbox_preview_embed',
  name: 'Dropbox Document Viewer',
  version: DOCUMENT_VIEWER_SPEC_VERSION,
  provider: 'dropbox',
  renderMode: RENDER_MODES.IFRAME_EMBED,
  isSupported(capabilities, fileMeta) {
    return Boolean(
      isProviderHealthy('dropbox') &&
      fileMeta.provider === 'dropbox' &&
      fileMeta.directUrl
    );
  },
  resolveUrl(fileMeta) {
    const raw = String(fileMeta.directUrl || '');
    return raw.includes('?') ? `${raw}&raw=1` : `${raw}?raw=1`;
  }
};

/**
 * Strategy: Direct Image Render
 */
export const DirectImageStrategy = {
  id: 'image_direct',
  name: 'Direct Image Viewer',
  version: DOCUMENT_VIEWER_SPEC_VERSION,
  provider: 'generic',
  renderMode: RENDER_MODES.IMAGE_DIRECT,
  isSupported(capabilities, fileMeta) {
    const cat = inferFileCategory(fileMeta.fileName, fileMeta.mimeType);
    return cat === FILE_CATEGORIES.IMAGE;
  },
  async resolveUrl(fileMeta, token) {
    if (fileMeta.directUrl) return fileMeta.directUrl;
    if (token && fileMeta.fileId) {
      return await fetchDriveFileAsObjectUrl(token, fileMeta.fileId);
    }
    return '';
  }
};

/**
 * Strategy: In-Memory Blob Embed (Desktop Only for PDFs)
 */
export const BlobEmbedStrategy = {
  id: 'blob_embed',
  name: 'In-Memory Blob Embed',
  version: DOCUMENT_VIEWER_SPEC_VERSION,
  provider: 'local_blob',
  renderMode: RENDER_MODES.BLOB_EMBED,
  isSupported(capabilities, fileMeta) {
    const cat = inferFileCategory(fileMeta.fileName, fileMeta.mimeType);
    return !capabilities.isMobile && capabilities.pdfViewerEnabled && cat === FILE_CATEGORIES.PDF;
  },
  async resolveUrl(fileMeta, token) {
    if (token && fileMeta.fileId) {
      return await fetchDriveFileAsObjectUrl(token, fileMeta.fileId);
    }
    return '';
  }
};

/**
 * Strategy: External Provider App View
 */
export const ExternalProviderStrategy = {
  id: 'external_provider',
  name: 'External Storage App View',
  version: DOCUMENT_VIEWER_SPEC_VERSION,
  provider: 'external',
  renderMode: RENDER_MODES.EXTERNAL_LINK,
  isSupported() {
    return true; // Universal fallback
  },
  resolveUrl(fileMeta) {
    if (fileMeta.externalUrl) return fileMeta.externalUrl;
    if (fileMeta.fileId) {
      return `https://drive.google.com/file/d/${encodeURIComponent(fileMeta.fileId)}/view`;
    }
    return '';
  }
};

/**
 * Strategy: Download File Fallback
 */
export const DownloadFallbackStrategy = {
  id: 'download_fallback',
  name: 'Download Document',
  version: DOCUMENT_VIEWER_SPEC_VERSION,
  provider: 'download',
  renderMode: RENDER_MODES.DOWNLOAD_FALLBACK,
  isSupported() {
    return true;
  },
  resolveUrl(fileMeta) {
    if (fileMeta.downloadUrl) return fileMeta.downloadUrl;
    if (fileMeta.fileId) {
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileMeta.fileId)}`;
    }
    return '';
  }
};

/**
 * Dynamic Strategy Registry
 */
const customStrategies = [];

export function registerViewerStrategy(strategy) {
  if (!strategy || !strategy.id || typeof strategy.resolveUrl !== 'function') {
    throw new Error('Invalid strategy interface: must implement id, renderMode, isSupported, resolveUrl');
  }
  customStrategies.push(strategy);
}

export function getRegisteredStrategies() {
  return [
    DirectImageStrategy,
    GoogleDrivePreviewStrategy,
    OneDrivePreviewStrategy,
    DropboxPreviewStrategy,
    BlobEmbedStrategy,
    ...customStrategies,
    ExternalProviderStrategy,
    DownloadFallbackStrategy
  ];
}

/**
 * Resolves the ordered fallback strategy chain for a file on the current device
 */
export function getStrategyChainForFile(fileMeta, capabilities = detectBrowserCapabilities()) {
  const category = inferFileCategory(fileMeta?.fileName, fileMeta?.mimeType);
  const isImage = category === FILE_CATEGORIES.IMAGE;
  const isPdf = category === FILE_CATEGORIES.PDF;
  const provider = fileMeta?.provider || 'google_drive';

  const chain = [];

  if (isImage) {
    chain.push(DirectImageStrategy);
    if (provider === 'onedrive' || provider === 'sharepoint') {
      chain.push(OneDrivePreviewStrategy);
    } else if (provider === 'dropbox') {
      chain.push(DropboxPreviewStrategy);
    } else {
      chain.push(GoogleDrivePreviewStrategy);
    }
  } else if (isPdf) {
    if (provider === 'onedrive' || provider === 'sharepoint') {
      chain.push(OneDrivePreviewStrategy);
    } else if (provider === 'dropbox') {
      chain.push(DropboxPreviewStrategy);
    } else {
      chain.push(GoogleDrivePreviewStrategy);
      if (!capabilities.isMobile && capabilities.pdfViewerEnabled) {
        chain.push(BlobEmbedStrategy);
      }
    }
  } else {
    // Other file types (spreadsheets, docs, CAD, generic)
    if (provider === 'onedrive' || provider === 'sharepoint') {
      chain.push(OneDrivePreviewStrategy);
    } else if (provider === 'dropbox') {
      chain.push(DropboxPreviewStrategy);
    } else {
      chain.push(GoogleDrivePreviewStrategy);
    }
  }

  // Include any custom dynamically registered strategies
  for (const custom of customStrategies) {
    if (!chain.some(s => s.id === custom.id)) {
      chain.push(custom);
    }
  }

  // Always provide universal fallbacks at the end
  chain.push(ExternalProviderStrategy);
  chain.push(DownloadFallbackStrategy);

  // Filter only strategies that declare support for this specific fileMeta
  return chain.filter(s => s.isSupported(capabilities, fileMeta || {}));
}


/**
 * Strategy Preference Cache
 */
export function getCachedStrategyId(platformKey, category) {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(`${STRATEGY_CACHE_KEY_PREFIX}${platformKey}_${category}`);
  } catch {
    return null;
  }
}

export function cacheSuccessfulStrategy(platformKey, category, strategyId) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(`${STRATEGY_CACHE_KEY_PREFIX}${platformKey}_${category}`, strategyId);
  } catch {}
}

// ---------------------------------------------------------------------------
// Field Telemetry & Logging
// ---------------------------------------------------------------------------

export function logViewerTelemetry(event) {
  const payload = {
    timestamp: new Date().toISOString(),
    specVersion: DOCUMENT_VIEWER_SPEC_VERSION,
    ...event
  };

  inMemoryTelemetry.unshift(payload);
  if (inMemoryTelemetry.length > 50) {
    inMemoryTelemetry.pop();
  }

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(inMemoryTelemetry.slice(0, 20)));
    }
  } catch {}

  return payload;
}

export function getViewerTelemetryHistory() {
  return [...inMemoryTelemetry];
}

export function clearViewerTelemetry() {
  inMemoryTelemetry.length = 0;
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TELEMETRY_STORAGE_KEY);
    }
  } catch {}
}

/**
 * Resolves optimal strategy and prepares viewing metadata with full telemetry tracking
 */
export async function resolveDocumentViewPlan(fileMeta, token, capabilities = detectBrowserCapabilities()) {
  const startTime = Date.now();
  const category = inferFileCategory(fileMeta?.fileName, fileMeta?.mimeType);
  const platformKey = capabilities.isMobile ? (capabilities.isAndroid ? 'android' : capabilities.isIOS ? 'ios' : 'mobile') : 'desktop';
  const chain = getStrategyChainForFile(fileMeta, capabilities);

  const fallbackLogs = [];

  for (const strategy of chain) {
    try {
      const srcUrl = await strategy.resolveUrl(fileMeta, token);
      if (srcUrl) {
        const durationMs = Date.now() - startTime;
        cacheSuccessfulStrategy(platformKey, category, strategy.id);
        recordProviderHealth(fileMeta?.provider || 'google_drive', true);

        logViewerTelemetry({
          fileId: fileMeta?.fileId || 'N/A',
          fileName: fileMeta?.fileName || 'Document',
          provider: fileMeta?.provider || 'google_drive',
          strategyId: strategy.id,
          strategyName: strategy.name,
          renderMode: strategy.renderMode,
          platform: platformKey,
          durationMs,
          success: true,
          fallbackLogs
        });

        return {
          success: true,
          specVersion: DOCUMENT_VIEWER_SPEC_VERSION,
          strategyId: strategy.id,
          strategyName: strategy.name,
          renderMode: strategy.renderMode,
          srcUrl,
          downloadUrl: DownloadFallbackStrategy.resolveUrl(fileMeta),
          externalUrl: ExternalProviderStrategy.resolveUrl(fileMeta),
          category,
          platformKey,
          durationMs,
          fallbackLogs
        };
      } else {
        fallbackLogs.push({ strategyId: strategy.id, reason: 'Empty URL returned' });
      }
    } catch (err) {
      fallbackLogs.push({ strategyId: strategy.id, reason: err.message || 'Resolution error' });
      recordProviderHealth(fileMeta?.provider || 'google_drive', false, err.message);
    }
  }

  // If all primary strategies fail, return the download fallback
  const durationMs = Date.now() - startTime;
  logViewerTelemetry({
    fileId: fileMeta?.fileId || 'N/A',
    fileName: fileMeta?.fileName || 'Document',
    provider: fileMeta?.provider || 'google_drive',
    strategyId: DownloadFallbackStrategy.id,
    strategyName: DownloadFallbackStrategy.name,
    renderMode: RENDER_MODES.DOWNLOAD_FALLBACK,
    platform: platformKey,
    durationMs,
    success: false,
    fallbackLogs
  });

  return {
    success: false,
    specVersion: DOCUMENT_VIEWER_SPEC_VERSION,
    strategyId: DownloadFallbackStrategy.id,
    strategyName: DownloadFallbackStrategy.name,
    renderMode: RENDER_MODES.DOWNLOAD_FALLBACK,
    srcUrl: DownloadFallbackStrategy.resolveUrl(fileMeta),
    downloadUrl: DownloadFallbackStrategy.resolveUrl(fileMeta),
    externalUrl: ExternalProviderStrategy.resolveUrl(fileMeta),
    category,
    platformKey,
    durationMs,
    fallbackLogs
  };
}
