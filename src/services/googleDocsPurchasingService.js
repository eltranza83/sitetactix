/**
 * Google Docs Master Purchasing List Service (V1 Final)
 * 
 * Storage-agnostic, production-grade domain architecture for:
 * 1. resourceType: "purchasing_master" (Company Master Purchasing Template in parent folder)
 * 2. resourceType: "project_purchasing" (Independent working purchasing records for project lots)
 * 
 * V1 Final Features:
 * - Automatic Master Versioning (v1.0 -> v1.1 -> v1.2) with changelog tracking.
 * - Project Provenance (records initialMasterVersion on clone).
 * - Dual Payload Previews (concise voiceSummary for audio, detailedPreview table for UI).
 * - Item Deprecation (marks status: deprecated in Master; excluded from new projects, preserved in active projects).
 * - Sync Idempotency (repeated runs produce 0 duplicate writes).
 * - Conflict Protection (custom project quantities & notes are strictly preserved).
 */

import { discoverAndBindProjectDocument } from './projectDocumentBindingService.js';

export const RESOURCE_TYPES = {
  PURCHASING_MASTER: 'purchasing_master',
  PROJECT_PURCHASING: 'project_purchasing'
};

export const MASTER_PROJECT_ID = 'master';

export function getPurchasingDocStorageKey(projectId = 'default') {
  const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return `sitetactix_purchasing_doc_${cleanId}`;
}

import { TRADE_SECTION_MAP, TRADE_CATEGORIES } from '../config/tradesConfig.js';

export { TRADE_SECTION_MAP, TRADE_CATEGORIES };


export const DEFAULT_MASTER_TEMPLATE_DOC = `# Master Fixtures & Hardware Purchasing Checklist (Company Master Template — v1.0)
<!-- version: 1.0 -->

<!-- section: quartz -->
## 1. Quartz Hardware

<!-- section: electrical -->
## 2. Electrical Hardware Fixtures

<!-- section: plumbing -->
## 3. Plumbing Hardware Fixtures
`;

export function getDefaultProjectDoc(projectId = 'default', masterVersion = 'v1.0') {
  return `# Master Fixtures & Hardware Purchasing Checklist - Project ${projectId} (Template: ${masterVersion})

<!-- section: quartz -->
## 1. Quartz Hardware

<!-- section: electrical -->
## 2. Electrical Hardware Fixtures

<!-- section: plumbing -->
## 3. Plumbing Hardware Fixtures
`;
}

/**
 * Extracts version string (e.g. 'v1.0') from doc text or comments
 */
export function parseMasterVersion(docText = '') {
  if (!docText) return 'v1.0';
  const tagMatch = docText.match(/<!--\s*version:\s*([0-9.]+)\s*-->/i);
  if (tagMatch) return `v${tagMatch[1]}`;
  const headerMatch = docText.match(/—\s*v([0-9.]+)/i);
  if (headerMatch) return `v${headerMatch[1]}`;
  return 'v1.0';
}

/**
 * Auto-increments version (e.g. v1.0 -> v1.1 -> v1.2)
 */
export function incrementMasterVersion(currentVer = 'v1.0') {
  const clean = String(currentVer || 'v1.0').replace(/^v/i, '').trim();
  const parts = clean.split('.');
  const major = parseInt(parts[0], 10) || 1;
  const minor = parseInt(parts[1], 10) || 0;
  return `v${major}.${minor + 1}`;
}

/**
 * Updates version tags in doc content
 */
export function updateMasterVersionInDoc(docText = '', newVersion = 'v1.1') {
  const cleanNum = newVersion.replace(/^v/i, '');
  let updated = docText;
  if (updated.match(/<!--\s*version:\s*[0-9.]+\s*-->/i)) {
    updated = updated.replace(/<!--\s*version:\s*[0-9.]+\s*-->/i, `<!-- version: ${cleanNum} -->`);
  } else {
    updated = `<!-- version: ${cleanNum} -->
` + updated;
  }

  if (updated.match(/^# Master Fixtures & Hardware Purchasing Checklist.*?$/m)) {
    updated = updated.replace(/^# Master Fixtures & Hardware Purchasing Checklist.*?$/m, `# Master Fixtures & Hardware Purchasing Checklist (Company Master Template — ${newVersion})`);
  }
  return updated;
}

/**
 * Normalizes purchasing document text to enforce clean, single-page formatting
 * and permanently prevent whitespace drift / repeated blank line accumulation.
 * 
 * Rules:
 * 1. CRLF normalization (\r\n and \r -> \n).
 * 2. Trailing whitespace on every line stripped.
 * 3. Exactly 1 blank line before section tags / section headings.
 * 4. 0 blank lines between checklist items.
 * 5. Collapses any 3+ consecutive newlines to standard spacing.
 * 6. Single trailing newline at EOF.
 */
export function normalizePurchasingDocumentSpacing(docText = '') {
  if (!docText || typeof docText !== 'string') return '';

  // 1. Standardize line endings
  const standardized = docText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rawLines = standardized.split('\n');
  const cleanedLines = [];

  for (let i = 0; i < rawLines.length; i++) {
    cleanedLines.push(rawLines[i].trimEnd());
  }

  // 2. Rebuild cleanly based on semantic document components
  const resultLines = [];

  for (let i = 0; i < cleanedLines.length; i++) {
    const line = cleanedLines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      // Skip raw blank lines; semantic rules below will inject appropriate single spacing
      continue;
    }

    const isDocTitle = trimmed.startsWith('# ') && !trimmed.startsWith('## ');
    const isSectionTag = trimmed.startsWith('<!--') && (trimmed.includes('section:') || trimmed.includes('version:'));
    const isSectionHeader = trimmed.startsWith('## ') || trimmed.startsWith('### ') || /^\d+[.)]\s+[A-Za-z\s&]+(?:Hardware|Fixtures|Supplies|Materials|Package|List|Notes|Gear|Wiring|Equipment|Trade|Category)/i.test(trimmed);
    const isItem = /^[-*•+o\u2610\u2611\u2612☐☑☒]/.test(trimmed) || /^\[[ xX]?\]/.test(trimmed) || /^\([ xX]?\)/.test(trimmed);

    if (resultLines.length > 0) {
      if (isSectionTag) {
        // Section tag gets exactly 1 blank line before it unless after doc title
        const lastInResult = resultLines[resultLines.length - 1];
        if (lastInResult !== '') {
          resultLines.push('');
        }
      } else if (isSectionHeader) {
        // Section header gets 1 blank line before it UNLESS preceded directly by its section tag
        const lastInResult = resultLines[resultLines.length - 1];
        if (lastInResult !== '' && !lastInResult.startsWith('<!--')) {
          resultLines.push('');
        }
      } else if (isItem) {
        // Items directly follow header or previous item with 0 blank lines
      } else if (!isDocTitle) {
        // General text / preamble lines get 1 blank line if preceding line is a header
        const lastInResult = resultLines[resultLines.length - 1];
        if (lastInResult !== '' && !lastInResult.startsWith('#')) {
          resultLines.push('');
        }
      }
    }

    resultLines.push(line);
  }

  return resultLines.join('\n') + '\n';
}

/**
 * Default LocalStorage Persistence Adapter
 */
export class LocalStoragePurchasingAdapter {
  constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    this.storage = storage;
    this.masterKey = 'sitetactix_purchasing_master_doc';
    this.auditKey = 'sitetactix_purchasing_audit_log';
  }

  getProjectKey(projectId, docType = 'purchasing_checklist') {
    const cleanId = String(projectId || 'default').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
    if (docType && docType !== 'purchasing_checklist' && docType !== 'project_purchasing') {
      return `sitetactix_${docType}_doc_${cleanId}`;
    }
    return `sitetactix_purchasing_doc_${cleanId}`;
  }

  getMasterKey(docType = 'purchasing_checklist') {
    if (docType && docType !== 'purchasing_checklist' && docType !== 'purchasing_master') {
      return `sitetactix_${docType}_master_doc`;
    }
    return this.masterKey;
  }

  getMasterDocument(defaultDoc = null, docType = 'purchasing_checklist') {
    const key = this.getMasterKey(docType);
    let stored = this.storage?.getItem ? this.storage.getItem(key) : null;
    if (!stored && this.storage?.getItem) {
      stored = this.storage.getItem('sitetactix_purchasing_doc_purchasing_master');
    }
    return stored || defaultDoc || (docType === 'purchasing_checklist' ? DEFAULT_MASTER_TEMPLATE_DOC : '');
  }

  saveMasterDocument(content, docType = 'purchasing_checklist') {
    const key = this.getMasterKey(docType);
    const normalized = normalizePurchasingDocumentSpacing(content);
    if (this.storage?.setItem) {
      this.storage.setItem(key, normalized);
    }
    return normalized;
  }

  getProjectDocument(projectId, defaultDoc = null, docType = 'purchasing_checklist') {
    const key = this.getProjectKey(projectId, docType);
    const stored = this.storage?.getItem ? this.storage.getItem(key) : null;
    return stored || defaultDoc || (docType === 'purchasing_checklist' ? getDefaultProjectDoc(projectId) : '');
  }

  saveProjectDocument(projectId, content, docType = 'purchasing_checklist') {
    const key = this.getProjectKey(projectId, docType);
    const normalized = normalizePurchasingDocumentSpacing(content);
    if (this.storage?.setItem) {
      this.storage.setItem(key, normalized);
      const docIdMatch = normalized ? String(normalized).match(/DocumentId:\s*([^\s\n]+)/i) : null;
      if (docIdMatch) {
        this.storage.setItem('sitetactix_doc_cache_' + docIdMatch[1].trim(), normalized);
      }
    }
    return normalized;
  }

  getAuditLogs(limit = 50) {
    try {
      const raw = this.storage?.getItem ? this.storage.getItem(this.auditKey) : null;
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.slice(0, limit) : [];
    } catch {
      return [];
    }
  }

  saveAuditLog(entry) {
    try {
      const current = this.getAuditLogs(100);
      current.unshift(entry);
      if (this.storage?.setItem) {
        this.storage.setItem(this.auditKey, JSON.stringify(current.slice(0, 100)));
      }
      return entry;
    } catch {
      return null;
    }
  }
}

/**
 * Resolves a storage adapter instance
 */
export function resolvePurchasingAdapter(storageOrAdapter) {
  if (storageOrAdapter && typeof storageOrAdapter.getMasterDocument === 'function' && typeof storageOrAdapter.getProjectDocument === 'function') {
    return storageOrAdapter;
  }
  return new LocalStoragePurchasingAdapter(storageOrAdapter);
}

/**
 * Helper to generate deterministic stable item_id
 */
export function generateItemId(rawName = '', categoryId = null, existingItem = null) {
  if (existingItem && existingItem.id) {
    return existingItem.id;
  }
  const clean = String(rawName || '').trim().toLowerCase()
    .replace(/<!--.*?-->/g, '')
    .replace(/[-—–:]\s*(?:qty|quantity|count):.*$/i, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (categoryId) {
    const cleanCat = String(categoryId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    return `item_${cleanCat}_${clean || 'generic'}`;
  }
  return `item_${clean || 'generic'}`;
}

export function toCanonicalProjectId(rawIdOrName = '') {
  if (!rawIdOrName || typeof rawIdOrName !== 'string') return 'default';
  const str = rawIdOrName.trim();
  if (str.toLowerCase() === 'master' || str.toLowerCase() === 'purchasing_master') return 'master';

  // Match lot pattern e.g. "Lot 55", "Lot-55", "lot 3", "Lot 3B"
  const lotMatch = str.match(/^lot[\s_-]*([0-9]+[a-zA-Z]?)$/i);
  if (lotMatch) {
    return `lot_${lotMatch[1].toLowerCase()}`;
  }

  // Slugify generic string
  return str.toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

/**
 * Resolves target resource type and project ID cleanly.
 */
export function resolvePurchasingTarget(args = {}, projectContext = {}) {
  const explicitProjectId = args.projectId || args.targetResource || args.project;
  const isMasterExplicit = explicitProjectId && (
    explicitProjectId.toLowerCase() === 'master' || 
    explicitProjectId.toLowerCase() === 'purchasing_master'
  );

  if (isMasterExplicit) {
    return {
      resourceType: RESOURCE_TYPES.PURCHASING_MASTER,
      projectId: null
    };
  }

  let projId = explicitProjectId;

  // Check if explicit is an internal ID like proj_123 that can be resolved from context or storage
  if (projId && projId.startsWith('proj_')) {
    if (projectContext?.activeProject?.id === projId && projectContext?.activeProject?.name) {
      projId = projectContext.activeProject.name;
    } else if (Array.isArray(projectContext?.projects)) {
      const match = projectContext.projects.find(p => p.id === projId);
      if (match?.name) projId = match.name;
    } else if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('jobscan_projects');
        if (stored) {
          const list = JSON.parse(stored);
          const match = list.find(p => p.id === projId);
          if (match?.name) projId = match.name;
        }
      } catch {}
    }
  }

  if (!projId && projectContext?.activeProjectName && typeof projectContext.activeProjectName === 'string') {
    projId = projectContext.activeProjectName.trim();
  }
  if (!projId && projectContext?.activeProject?.name && typeof projectContext.activeProject.name === 'string') {
    projId = projectContext.activeProject.name.trim();
  }
  if (!projId && projectContext?.projectId && typeof projectContext.projectId === 'string') {
    projId = projectContext.projectId.trim();
  }
  if (!projId && projectContext?.activeProject?.id && typeof projectContext.activeProject.id === 'string') {
    projId = projectContext.activeProject.id.trim();
  }
  if (!projId && projectContext?.id && typeof projectContext.id === 'string') {
    projId = projectContext.id.trim();
  }

  const canonicalId = toCanonicalProjectId(projId);

  return {
    resourceType: canonicalId === 'master' ? RESOURCE_TYPES.PURCHASING_MASTER : RESOURCE_TYPES.PROJECT_PURCHASING,
    projectId: canonicalId
  };
}

export function resolveTargetProjectId(explicitProjectId = null, projectContext = {}) {
  const target = resolvePurchasingTarget({ projectId: explicitProjectId }, projectContext);
  return target.resourceType === RESOURCE_TYPES.PURCHASING_MASTER ? 'master' : target.projectId;
}

export function loadMasterPurchasingDoc(storageOrAdapter, defaultDoc = null) {
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  return adapter.getMasterDocument(defaultDoc);
}

export function saveMasterPurchasingDoc(storageOrAdapter, content = '', autoIncrement = false) {
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  let finalContent = normalizePurchasingDocumentSpacing(content);
  if (autoIncrement) {
    const currentVer = parseMasterVersion(finalContent);
    const nextVer = incrementMasterVersion(currentVer);
    finalContent = updateMasterVersionInDoc(finalContent, nextVer);
    finalContent = normalizePurchasingDocumentSpacing(finalContent);
  }
  return adapter.saveMasterDocument(finalContent);
}

export function loadProjectPurchasingDoc(storageOrAdapter, projectId = 'default', defaultDoc = null) {
  if (projectId === 'master' || projectId === 'purchasing_master' || projectId === MASTER_PROJECT_ID) {
    return loadMasterPurchasingDoc(storageOrAdapter, defaultDoc);
  }
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  return adapter.getProjectDocument(projectId, defaultDoc);
}

export function saveProjectPurchasingDoc(storageOrAdapter, projectId = 'default', content = '') {
  if (projectId === 'master' || projectId === 'purchasing_master' || projectId === MASTER_PROJECT_ID) {
    return saveMasterPurchasingDoc(storageOrAdapter, content);
  }
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  const normalized = normalizePurchasingDocumentSpacing(content);
  return adapter.saveProjectDocument(projectId, normalized);
}

export function getPurchasingAuditLog(storageOrAdapter, limit = 50) {
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  return adapter.getAuditLogs(limit);
}

export function recordPurchasingAuditLog(storageOrAdapter, entry = {}) {
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  const newEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    timestamp: new Date().toISOString(),
    resourceType: entry.resourceType || RESOURCE_TYPES.PURCHASING_MASTER,
    source: entry.source || 'Master',
    masterVersion: entry.masterVersion || null,
    itemId: entry.itemId || null,
    itemName: entry.itemName || '',
    projectsAffected: Array.isArray(entry.projectsAffected) ? entry.projectsAffected : [],
    action: entry.action || 'sync',
    userCommand: entry.userCommand || null,
    details: entry.details || null
  };
  return adapter.saveAuditLog(newEntry);
}

export function classifyTradeCategory(itemText = '', explicitOverride = null) {
  const textLower = (itemText && typeof itemText === 'string') ? itemText.toLowerCase().trim() : '';
  const overrideLower = (explicitOverride && typeof explicitOverride === 'string') ? explicitOverride.toLowerCase().trim() : '';

  if (overrideLower) {
    if (TRADE_SECTION_MAP[overrideLower]) {
      return TRADE_SECTION_MAP[overrideLower];
    }
    for (const [, cat] of Object.entries(TRADE_SECTION_MAP)) {
      if (cat.id === overrideLower || cat.aliases.some(alias => overrideLower.includes(alias))) {
        return cat;
      }
    }
  }

  for (const [, cat] of Object.entries(TRADE_SECTION_MAP)) {
    if (cat.keywords && cat.keywords.length > 0) {
      for (const kw of cat.keywords) {
        if (textLower.includes(kw)) {
          return cat;
        }
      }
    }
  }

  return TRADE_SECTION_MAP.general;
}

export function parseQuantity(rawText = '') {
  let text = (rawText || '').trim();
  
  let embeddedId = null;
  const idMatch = text.match(/<!--\s*id:\s*([a-zA-Z0-9_-]+)\s*-->/i);
  if (idMatch) {
    embeddedId = idMatch[1];
    text = text.replace(idMatch[0], '').trim();
  }

  let status = 'active';
  const statusMatch = text.match(/<!--\s*status:\s*([a-zA-Z0-9_-]+)\s*-->/i);
  if (statusMatch) {
    status = statusMatch[1].toLowerCase();
    text = text.replace(statusMatch[0], '').trim();
  }

  const wordNumbers = {
    'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
    'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
    'eleven': 11, 'twelve': 12, 'dozen': 12, 'twenty': 20
  };

  const qtySuffixMatch = text.match(/^(?:[-*•]\s*)?(?:\[[ xX]\]\s*)?(.+?)(?:\s*[-—–:]\s*(?:Qty|Quantity|Count):\s*(\d+))(.*)$/i);
  if (qtySuffixMatch) {
    const rawItem = qtySuffixMatch[1].trim();
    const additionalNotes = qtySuffixMatch[3] ? qtySuffixMatch[3].trim() : '';
    return {
      itemId: embeddedId || generateItemId(rawItem),
      itemName: rawItem,
      quantity: parseInt(qtySuffixMatch[2], 10) || 1,
      hasExplicitQuantity: true,
      status: status,
      notes: additionalNotes
    };
  }

  const wordPrefixMatch = text.match(/^(?:add\s+|i need\s+|buy\s+)?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen)\s+(?:more\s+)?(.+)$/i);
  if (wordPrefixMatch && !text.toLowerCase().includes('inch') && !text.toLowerCase().includes('gallon')) {
    const qty = wordNumbers[wordPrefixMatch[1].toLowerCase()] || 1;
    const rawItem = wordPrefixMatch[2].trim();
    return {
      itemId: embeddedId || generateItemId(rawItem),
      itemName: rawItem,
      quantity: qty,
      hasExplicitQuantity: true,
      status: status,
      notes: ''
    };
  }

  const numPrefixMatch = text.match(/^(?:add\s+|i need\s+|buy\s+)?(\d+)\s+(?:more\s+)?(.+)$/i);
  if (numPrefixMatch && !text.toLowerCase().includes('inch') && !text.toLowerCase().includes('gallon')) {
    const rawItem = numPrefixMatch[2].trim();
    return {
      itemId: embeddedId || generateItemId(rawItem),
      itemName: rawItem,
      quantity: parseInt(numPrefixMatch[1], 10) || 1,
      hasExplicitQuantity: true,
      status: status,
      notes: ''
    };
  }

  const cleaned = text.replace(/^(?:add\s+|i need\s+|buy\s+)/i, '').trim();
  return {
    itemId: embeddedId || generateItemId(cleaned),
    itemName: cleaned,
    quantity: null,
    hasExplicitQuantity: false,
    status: status,
    notes: ''
  };
}

export function parseGoogleDocPurchasingStructure(docData) {
  let fullText = '';
  const sections = [];

  if (typeof docData === 'string') {
    fullText = docData;
  } else if (docData && Array.isArray(docData.body?.content)) {
    for (const elem of docData.body.content) {
      if (elem.paragraph?.elements) {
        for (const pe of elem.paragraph.elements) {
          if (pe.textRun?.content) {
            fullText += pe.textRun.content;
          }
        }
      }
    }
  } else if (docData && typeof docData.text === 'string') {
    fullText = docData.text;
  }

  fullText = (fullText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const masterVersion = parseMasterVersion(fullText);
  const lines = fullText.split('\n');
  let currentSection = null;
  let runningIndex = 0;
  let pendingTagId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineStartIndex = runningIndex;
    const lineEndIndex = runningIndex + line.length;
    runningIndex = lineEndIndex + 1;

    const trimmed = line.trim();
    if (!trimmed) continue;

    // Ignore document preamble / subtitles
    if (trimmed.toLowerCase().startsWith('applicable to all') || (trimmed.toLowerCase().startsWith('project:') && !trimmed.toLowerCase().includes('checklist'))) {
      continue;
    }

    const tagMatch = trimmed.match(/<!--\s*section:\s*([a-zA-Z0-9_-]+)\s*-->/i);
    if (tagMatch) {
      pendingTagId = tagMatch[1].toLowerCase();
      continue;
    }
    
    const isDocTitle = trimmed.startsWith('# ') && (trimmed.toLowerCase().includes('master') || trimmed.toLowerCase().includes('purchasing checklist') || trimmed.toLowerCase().includes('purchasing list'));
    
    // Comprehensive heading detection for Markdown, Numbered, and Native Google Docs headings
    const isHeading = !isDocTitle && (
      trimmed.startsWith('##') || 
      trimmed.match(/^\d+[.)]\s+[A-Za-z\s&]+(?:Hardware|Fixtures|Supplies|Materials|Package|List|Notes|Gear|Wiring|Equipment|Trade|Category)/i) ||
      (trimmed.endsWith(':') && (trimmed.toLowerCase().includes('hardware') || trimmed.toLowerCase().includes('fixtures') || trimmed.toLowerCase().includes('plumbing') || trimmed.toLowerCase().includes('electrical') || trimmed.toLowerCase().includes('quartz') || trimmed.toLowerCase().includes('hvac') || trimmed.toLowerCase().includes('paint'))) ||
      /^(?:Quartz(?:\s+Hardware)?|Electrical(?:\s+Hardware)?(?:\s+Fixtures)?|Plumbing(?:\s+Hardware)?(?:\s+Fixtures)?|HVAC(?:\s+Hardware)?(?:\s+Fixtures)?|Paint(?:\s+&\s+Drywall)?(?:\s+Supplies)?|General(?:\s+Hardware)?)$/i.test(trimmed)
    );

    if (isHeading || (pendingTagId && !currentSection)) {
      const sectionIdentifier = trimmed.replace(/^[#\d.)\s]+/, '').replace(/:$/, '').trim();
      const stableSectionId = pendingTagId || classifyTradeCategory('', sectionIdentifier).id;
      const category = TRADE_SECTION_MAP[stableSectionId] || classifyTradeCategory('', sectionIdentifier);

      currentSection = {
        categoryId: category.id,
        sectionId: category.id,
        title: sectionIdentifier || category.title,
        canonicalTitle: category.title,
        headingLine: line,
        startIndex: lineStartIndex,
        items: []
      };
      sections.push(currentSection);
      pendingTagId = null;
      continue;
    }

    if (currentSection) {
      // Check for purchased status in Unicode checkboxes (☐, ☑, ☒) and standard Markdown/ASCII brackets
      const isPurchased = /[\u2611\u2612☑☒]/.test(trimmed) || /\[[xX]\]/.test(trimmed) || /\([xX]\)/.test(trimmed);
      
      // Clean item name from all bullets and checkboxes: ☐, ☑, ☒, [ ], [], -, *, •, +, o
      const cleanedText = trimmed
        .replace(/^[\u2610\u2611\u2612\u25cb\u25cf\u25a2\u2751☐☑☒\-*•+o\s]+/, '')
        .replace(/^\[[ xX]?\]\s*/, '')
        .replace(/^\([ xX]?\)\s*/, '')
        .trim();

      if (cleanedText && !cleanedText.startsWith('#')) {
        const parsed = parseQuantity(cleanedText);

        currentSection.items.push({
          rawLine: line,
          itemId: parsed.itemId,
          itemName: parsed.itemName,
          normalizedName: parsed.itemName.toLowerCase().replace(/[^a-z0-9]/g, ''),
          quantity: parsed.quantity,
          hasExplicitQuantity: parsed.hasExplicitQuantity,
          status: parsed.status || 'active',
          notes: parsed.notes || '',
          isPurchased: isPurchased,
          startIndex: lineStartIndex,
          endIndex: lineEndIndex
        });
      }
    }
  }

  return {
    fullText,
    masterVersion,
    totalLength: fullText.length,
    sections
  };
}

export function calculateSectionInsertion(docStructure, itemInput, quantityOrCategory = 1, explicitCategory = null, itemIdOverride = null) {
  let quantity = 1;
  let categoryOverride = null;

  if (typeof quantityOrCategory === 'number') {
    quantity = quantityOrCategory;
    categoryOverride = explicitCategory;
  } else if (typeof quantityOrCategory === 'string') {
    categoryOverride = quantityOrCategory;
  }

  const parsedItem = parseQuantity(itemInput);
  const effectiveItemId = itemIdOverride || parsedItem.itemId;
  const finalQuantity = Math.max(quantity || 1, parsedItem.quantity || 1);
  const targetCategory = classifyTradeCategory(parsedItem.itemName, categoryOverride);
  let targetSection = docStructure.sections.find(s => (s.sectionId || s.categoryId) === targetCategory.id);

  const cleanItemName = parsedItem.itemName.trim();
  const normalizedItemName = cleanItemName.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (targetSection) {
    const existingItem = targetSection.items.find(item => 
      (item.itemId && effectiveItemId && item.itemId === effectiveItemId) ||
      item.normalizedName === normalizedItemName ||
      (item.normalizedName.length > 4 && normalizedItemName.includes(item.normalizedName)) ||
      (normalizedItemName.length > 4 && item.normalizedName.includes(normalizedItemName))
    );

    if (existingItem) {
      const existingQty = existingItem.quantity || 1;
      const updatedQty = existingQty + finalQuantity;
      const notesSuffix = existingItem.notes ? ` ${existingItem.notes}` : '';
      const updatedLine = `- [${existingItem.isPurchased ? 'x' : ' '}] ${existingItem.itemName} — Qty: ${updatedQty}${notesSuffix}`;

      return {
        action: 'UPDATE_QUANTITY',
        isDuplicate: true,
        category: targetCategory,
        itemId: existingItem.itemId || effectiveItemId,
        existingItem: existingItem,
        newQuantity: updatedQty,
        replaceRange: {
          startIndex: existingItem.startIndex,
          endIndex: existingItem.endIndex
        },
        replacementText: updatedLine,
        message: `Updated ${existingItem.itemName} from ${existingQty} to ${updatedQty} under ${targetCategory.title}.`
      };
    }
  }

  const qtyStr = finalQuantity > 1 ? ` — Qty: ${finalQuantity}` : '';
  const newLineText = `- [ ] ${cleanItemName}${qtyStr}
`;

  if (targetSection) {
    const sectionIndex = docStructure.sections.indexOf(targetSection);
    let insertionIndex = docStructure.totalLength;

    if (targetSection.items.length > 0) {
      const lastItem = targetSection.items[targetSection.items.length - 1];
      insertionIndex = lastItem.endIndex + 1;
    } else if (sectionIndex + 1 < docStructure.sections.length) {
      const nextSection = docStructure.sections[sectionIndex + 1];
      insertionIndex = nextSection.startIndex;
    }

    return {
      action: 'INSERT_ITEM',
      isDuplicate: false,
      category: targetCategory,
      itemId: effectiveItemId,
      insertionIndex: Math.min(insertionIndex, docStructure.totalLength),
      textToInsert: newLineText,
      message: `Added "${cleanItemName}"${qtyStr} to ${targetCategory.title}.`
    };
  }

  const newSectionText = `
<!-- section: ${targetCategory.id} -->
## ${targetCategory.title}
${newLineText}`;
  return {
    action: 'CREATE_SECTION_AND_INSERT',
    isDuplicate: false,
    category: targetCategory,
    itemId: effectiveItemId,
    insertionIndex: docStructure.totalLength,
    textToInsert: newSectionText,
    message: `Created new section "${targetCategory.title}" and added "${cleanItemName}"${qtyStr}.`
  };
}

export function calculateMarkPurchased(docStructure, itemNameOrId, isPurchased = true) {
  const searchNormalized = (itemNameOrId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!searchNormalized) {
    return { found: false, message: 'No item name provided.' };
  }

  for (const section of docStructure.sections) {
    for (const item of section.items) {
      if ((item.itemId && itemNameOrId && item.itemId === itemNameOrId) ||
          item.normalizedName === searchNormalized || 
          (item.normalizedName.length > 4 && searchNormalized.includes(item.normalizedName)) ||
          (searchNormalized.length > 4 && item.normalizedName.includes(searchNormalized))) {
        
        const checkMark = isPurchased ? 'x' : ' ';
        const qtyStr = item.quantity > 1 ? ` — Qty: ${item.quantity}` : '';
        const notesSuffix = item.notes ? ` ${item.notes}` : '';
        const updatedLine = `- [${checkMark}] ${item.itemName}${qtyStr}${notesSuffix}`;

        return {
          found: true,
          item: item,
          category: section,
          isPurchased: isPurchased,
          replaceRange: {
            startIndex: item.startIndex,
            endIndex: item.endIndex
          },
          replacementText: updatedLine,
          message: `Marked "${item.itemName}" as ${isPurchased ? 'purchased' : 'pending'} under ${section.canonicalTitle || section.title}.`
        };
      }
    }
  }

  return {
    found: false,
    message: `Could not find "${itemNameOrId}" in the purchasing checklist.`
  };
}

export function calculateRemoveItem(docStructure, itemNameOrId, categoryOverride = null) {
  const searchNormalized = (itemNameOrId || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!searchNormalized) {
    return { found: false, message: 'No item name provided for removal.' };
  }

  let targetSections = docStructure.sections;
  if (categoryOverride) {
    const cat = classifyTradeCategory('', categoryOverride);
    const matched = docStructure.sections.filter(s => (s.sectionId || s.categoryId) === cat.id);
    if (matched.length > 0) targetSections = matched;
  }

  const raw = docStructure.fullText || '';

  for (const section of targetSections) {
    for (const item of section.items) {
      if ((item.itemId && itemNameOrId && item.itemId === itemNameOrId) ||
          item.normalizedName === searchNormalized || 
          (item.normalizedName.length > 3 && searchNormalized.includes(item.normalizedName)) ||
          (searchNormalized.length > 3 && item.normalizedName.includes(searchNormalized))) {
        
        let removeStart = item.startIndex;
        let removeEnd = item.endIndex;

        // Clean up trailing newline
        if (raw[removeEnd] === '\n') {
          removeEnd += 1;
        } else if (raw[removeEnd] === '\r' && raw[removeEnd + 1] === '\n') {
          removeEnd += 2;
        } else if (removeStart > 0 && (raw[removeStart - 1] === '\n')) {
          removeStart -= 1;
          if (removeStart > 0 && raw[removeStart - 1] === '\r') {
            removeStart -= 1;
          }
        }

        return {
          found: true,
          action: 'REMOVE_ITEM',
          item: item,
          category: section,
          replaceRange: {
            startIndex: removeStart,
            endIndex: removeEnd
          },
          replacementText: '',
          message: `Removed "${item.itemName}" from ${section.canonicalTitle || section.title}.`
        };
      }
    }
  }

  return {
    found: false,
    message: `Could not find "${itemNameOrId}" to remove in the purchasing checklist.`
  };
}

export function calculateRemoveSection(docStructure, sectionNameOrId) {
  const searchClean = (sectionNameOrId || '').toLowerCase().trim();
  const searchNormalized = searchClean.replace(/[^a-z0-9]/g, '');
  if (!searchNormalized) {
    return { found: false, message: 'No section name provided for removal.' };
  }

  const raw = docStructure.fullText || '';
  const searchTokens = searchClean.split(/[^a-z0-9]+/).filter(t => t.length > 2 && !['and', 'the', 'for', 'with', 'section', 'under'].includes(t));

  let matchedIndex = -1;
  let highestScore = 0;

  docStructure.sections.forEach((s, idx) => {
    const canonicalNorm = (s.canonicalTitle || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const titleNorm = (s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const secId = (s.sectionId || s.categoryId || '').toLowerCase();

    if (secId === searchNormalized || canonicalNorm === searchNormalized || titleNorm === searchNormalized) {
      matchedIndex = idx;
      highestScore = 100;
      return;
    }

    if ((canonicalNorm && (searchNormalized.includes(canonicalNorm) || canonicalNorm.includes(searchNormalized))) ||
        (titleNorm && (searchNormalized.includes(titleNorm) || titleNorm.includes(searchNormalized)))) {
      if (highestScore < 50) {
        matchedIndex = idx;
        highestScore = 50;
      }
    }

    // Token overlap match (e.g., "general hardware and matt and materials" -> matches "General Hardware & Materials")
    const fullTitleTokens = `${s.canonicalTitle || ''} ${s.title || ''}`.toLowerCase().split(/[^a-z0-9]+/);
    let matchedTokenCount = 0;
    for (const st of searchTokens) {
      if (fullTitleTokens.some(ft => ft.length > 2 && (ft.includes(st) || st.includes(ft)))) {
        matchedTokenCount++;
      }
    }

    if (matchedTokenCount >= 2 && matchedTokenCount > highestScore) {
      matchedIndex = idx;
      highestScore = matchedTokenCount;
    }
  });

  if (matchedIndex === -1) {
    return {
      found: false,
      message: `Could not find section "${sectionNameOrId}" in the purchasing checklist.`
    };
  }

  const section = docStructure.sections[matchedIndex];
  let removeStart = section.startIndex;
  let removeEnd = docStructure.totalLength;

  if (matchedIndex + 1 < docStructure.sections.length) {
    removeEnd = docStructure.sections[matchedIndex + 1].startIndex;
  }

  if (removeEnd === docStructure.totalLength && removeStart > 0 && (raw[removeStart - 1] === '\n')) {
    removeStart -= 1;
    if (removeStart > 0 && raw[removeStart - 1] === '\r') removeStart -= 1;
  }

  return {
    found: true,
    action: 'REMOVE_SECTION',
    section: section,
    replaceRange: {
      startIndex: removeStart,
      endIndex: removeEnd
    },
    replacementText: '',
    message: `Removed "${section.canonicalTitle || section.title}" section from the purchasing checklist.`
  };
}

export function queryPurchasingList(docStructure, options = {}) {
  const {
    trade = null,
    unpurchasedOnly = true
  } = options;

  let matchedSections = docStructure.sections;
  if (trade) {
    const targetCat = classifyTradeCategory('', trade);
    matchedSections = docStructure.sections.filter(s => (s.sectionId || s.categoryId) === targetCat.id);
  }

  const results = [];
  for (const s of matchedSections) {
    const items = s.items.filter(item => !unpurchasedOnly || !item.isPurchased);
    if (items.length > 0) {
      results.push({
        category: s.canonicalTitle || s.title,
        categoryId: s.categoryId,
        sectionId: s.sectionId || s.categoryId,
        items: items.map(it => ({
          id: it.itemId,
          name: it.itemName,
          quantity: it.hasExplicitQuantity ? it.quantity : null,
          hasExplicitQuantity: Boolean(it.hasExplicitQuantity),
          status: it.status || 'active',
          notes: it.notes || '',
          isPurchased: it.isPurchased
        }))
      });
    }
  }

  return results;
}

/**
 * Deprecates an item in the Master Template (Never deletes it).
 * Sets <!-- status: deprecated --> and auto-increments Master version.
 */
export function deprecateMasterItem(storageOrAdapter, itemNameOrId) {
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  let masterDoc = adapter.getMasterDocument();
  const structure = parseGoogleDocPurchasingStructure(masterDoc);
  const searchNormalized = (itemNameOrId || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const section of structure.sections) {
    for (const item of section.items) {
      if ((item.itemId && itemNameOrId && item.itemId === itemNameOrId) ||
          item.normalizedName === searchNormalized) {
        
        const qtyStr = item.quantity > 1 ? ` — Qty: ${item.quantity}` : '';
        const notesSuffix = item.notes ? ` ${item.notes}` : '';
        const deprecatedLine = `- [ ] ${item.itemName} <!-- id: ${item.itemId} --> <!-- status: deprecated -->${qtyStr}${notesSuffix}`;

        const before = masterDoc.slice(0, item.startIndex);
        const after = masterDoc.slice(item.endIndex);
        masterDoc = before + deprecatedLine + after;

        const currentVer = parseMasterVersion(masterDoc);
        const nextVer = incrementMasterVersion(currentVer);
        masterDoc = updateMasterVersionInDoc(masterDoc, nextVer);

        adapter.saveMasterDocument(masterDoc);
        recordPurchasingAuditLog(adapter, {
          resourceType: RESOURCE_TYPES.PURCHASING_MASTER,
          source: 'Master',
          masterVersion: nextVer,
          itemId: item.itemId,
          itemName: item.itemName,
          projectsAffected: ['purchasing_master'],
          action: 'deprecated',
          details: { previousVersion: currentVer, newVersion: nextVer }
        });

        return {
          success: true,
          itemId: item.itemId,
          itemName: item.itemName,
          newVersion: nextVer,
          message: `Deprecated "${item.itemName}" in Master Template (${nextVer}). It will be excluded from future projects while active projects keep their historical record.`
        };
      }
    }
  }

  return {
    success: false,
    message: `Item "${itemNameOrId}" was not found in Master Purchasing Template.`
  };
}

/**
 * Storage-Agnostic Non-Destructive Synchronization Engine (V1 Final)
 * Provides dual-payload previews (concise voiceSummary, detailedPreview table).
 */
export function syncMasterPurchasingToProjects(storageOrAdapter, targetProjectIds = [], options = {}) {
  const adapter = resolvePurchasingAdapter(storageOrAdapter);
  const {
    dryRun = false,
    userCommand = null
  } = options;

  const masterDocContent = adapter.getMasterDocument();
  const masterStructure = parseGoogleDocPurchasingStructure(masterDocContent);
  const masterVersion = masterStructure.masterVersion || 'v1.0';

  const results = {
    resourceType: RESOURCE_TYPES.PURCHASING_MASTER,
    masterVersion: masterVersion,
    isDryRun: Boolean(dryRun),
    totalProjectsTargeted: targetProjectIds.length,
    projectsSynced: [],
    missingInProjects: {},
    itemsAddedSummary: {},
    detailedPreview: [],
    auditEntries: [],
    totalMissingItemsCount: 0,
    alreadyCurrentCount: 0,
    customItemsUntouchedCount: 0
  };

  for (const projId of targetProjectIds) {
    if (!projId || projId === 'master') continue;

    let projDoc = adapter.getProjectDocument(projId);
    let projStructure = parseGoogleDocPurchasingStructure(projDoc);
    const addedItemsForProject = [];
    const missingForDryRun = [];
    const customUntouched = [];

    // Filter out deprecated items from Master so they aren't added to projects
    const activeMasterSections = masterStructure.sections.map(sec => ({
      ...sec,
      items: sec.items.filter(it => it.status !== 'deprecated')
    }));

    for (const masterSection of activeMasterSections) {
      for (const masterItem of masterSection.items) {
        const targetProjSection = projStructure.sections.find(s => (s.sectionId || s.categoryId) === masterSection.categoryId);
        
        // Match on item_id first, then normalized name fallback
        const existingItem = targetProjSection?.items.find(it => 
          (it.itemId && masterItem.itemId && it.itemId === masterItem.itemId) ||
          it.normalizedName === masterItem.normalizedName ||
          (it.normalizedName.length > 4 && masterItem.normalizedName.includes(it.normalizedName)) ||
          (masterItem.normalizedName.length > 4 && it.normalizedName.includes(masterItem.normalizedName))
        );

        if (!existingItem) {
          missingForDryRun.push({
            itemId: masterItem.itemId,
            itemName: masterItem.itemName,
            quantity: masterItem.quantity,
            category: masterSection.canonicalTitle || masterSection.title,
            sectionId: masterSection.categoryId,
            proposedAction: 'add'
          });

          if (!dryRun) {
            const insertion = calculateSectionInsertion(projStructure, masterItem.itemName, masterItem.quantity, masterSection.categoryId, masterItem.itemId);
            if (insertion.action === 'INSERT_ITEM' || insertion.action === 'CREATE_SECTION_AND_INSERT') {
              const before = projDoc.slice(0, insertion.insertionIndex);
              const after = projDoc.slice(insertion.insertionIndex);
              projDoc = before + insertion.textToInsert + after;
              projStructure = parseGoogleDocPurchasingStructure(projDoc);
              addedItemsForProject.push({
                itemId: masterItem.itemId,
                name: masterItem.itemName,
                quantity: masterItem.quantity,
                category: masterSection.canonicalTitle || masterSection.title,
                sectionId: masterSection.categoryId
              });
            }
          }
        } else {
          // Check if item is customized or already current
          const hasCustomization = existingItem.isPurchased || existingItem.quantity !== masterItem.quantity || Boolean(existingItem.notes);
          if (hasCustomization) {
            customUntouched.push({
              itemId: existingItem.itemId,
              itemName: existingItem.itemName,
              projectQuantity: existingItem.quantity,
              masterQuantity: masterItem.quantity,
              isPurchased: existingItem.isPurchased,
              notes: existingItem.notes,
              action: 'leave_untouched'
            });
            results.customItemsUntouchedCount++;
          } else {
            results.alreadyCurrentCount++;
          }
        }
      }
    }

    results.totalMissingItemsCount += missingForDryRun.length;

    results.detailedPreview.push({
      projectId: projId,
      missingItems: missingForDryRun,
      missingCount: missingForDryRun.length,
      customUntouched: customUntouched,
      customUntouchedCount: customUntouched.length
    });

    if (dryRun) {
      results.missingInProjects[projId] = missingForDryRun;
      if (missingForDryRun.length > 0) {
        results.projectsSynced.push(projId);
      }
    } else {
      adapter.saveProjectDocument(projId, projDoc);
      results.projectsSynced.push(projId);
      results.itemsAddedSummary[projId] = addedItemsForProject;

      if (addedItemsForProject.length > 0) {
        for (const it of addedItemsForProject) {
          const auditEntry = recordPurchasingAuditLog(adapter, {
            resourceType: RESOURCE_TYPES.PURCHASING_MASTER,
            source: 'Master',
            masterVersion: masterVersion,
            itemId: it.itemId,
            itemName: it.name,
            projectsAffected: [projId],
            action: 'added',
            userCommand: userCommand,
            details: { projectId: projId, category: it.category }
          });
          if (auditEntry) results.auditEntries.push(auditEntry);
        }
      }
    }
  }

  const affectedProjectsCount = results.projectsSynced.length;
  if (dryRun) {
    results.voiceSummary = affectedProjectsCount > 0
      ? `I found ${affectedProjectsCount} project(s) missing ${results.totalMissingItemsCount} Master items. Want me to sync them?`
      : `All active projects are already up to date with Master ${masterVersion}.`;
    results.summaryPrompt = results.voiceSummary;
    results.message = results.voiceSummary;
  } else {
    const totalAdded = Object.values(results.itemsAddedSummary).reduce((sum, list) => sum + list.length, 0);
    results.voiceSummary = totalAdded > 0
      ? `Master ${masterVersion} synchronized to ${affectedProjectsCount} active project(s). Added ${totalAdded} item(s); custom project packages were left untouched.`
      : `All active projects were already current with Master ${masterVersion}. No changes needed.`;
    results.message = results.voiceSummary;
  }

  return results;
}

/**
 * Initializes a new project purchasing document by cloning the Master Purchasing Template.
 * Provenance tracking: records initialMasterVersion and excludes deprecated items.
 */
export function cloneMasterToNewProject(storageOrAdapter, newProjectId) {
  if (!newProjectId) return null;
  const adapter = resolvePurchasingAdapter(storageOrAdapter);

  const masterDocContent = adapter.getMasterDocument();
  const masterStructure = parseGoogleDocPurchasingStructure(masterDocContent);
  const masterVersion = masterStructure.masterVersion || 'v1.0';

  let projectLines = [];
  projectLines.push(`# Master Fixtures & Hardware Purchasing Checklist - Project ${newProjectId} (Template: ${masterVersion})`);
  projectLines.push(`<!-- initial_master_version: ${masterVersion} -->\n`);

  for (const section of masterStructure.sections) {
    projectLines.push(`<!-- section: ${section.sectionId || section.categoryId} -->`);
    projectLines.push(`## ${section.canonicalTitle || section.title}`);
    for (const item of section.items) {
      if (item.status !== 'deprecated') {
        const qtyStr = item.quantity > 1 ? ` — Qty: ${item.quantity}` : '';
        const idAnchor = item.itemId ? ` <!-- id: ${item.itemId} -->` : '';
        projectLines.push(`- [ ] ${item.itemName}${idAnchor}${qtyStr}`);
      }
    }
    projectLines.push('');
  }

  const freshLotDoc = projectLines.join('\n');
  adapter.saveProjectDocument(newProjectId, freshLotDoc);
  return freshLotDoc;
}

/**
 * Discovers and binds the authoritative Google Drive purchasing checklist document for a project.
 * Delegated to the generalized Second Brain Document Binding Engine.
 */
export function discoverAndBindProjectPurchasingDoc(storageOrAdapter, projectId = 'default', projectContext = {}, options = {}) {
  return discoverAndBindProjectDocument(storageOrAdapter, projectId, 'purchasing_checklist', projectContext, options);
}
