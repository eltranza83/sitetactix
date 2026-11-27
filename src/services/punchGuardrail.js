import { canonicalPhaseName } from './sheetV2.js';

const CACHED_ISSUES_PREFIX = 'jobscan_cached_issues_';

export function getCachedIssuesKey(projectId) {
  return `${CACHED_ISSUES_PREFIX}_${projectId || 'default'}`;
}

export function loadCachedProjectIssues(storage, projectId) {
  if (!storage || !projectId) return [];
  try {
    const raw = storage.getItem(getCachedIssuesKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function persistCachedProjectIssues(storage, projectId, issues) {
  if (!storage || !projectId || !Array.isArray(issues)) return;
  try {
    storage.setItem(getCachedIssuesKey(projectId), JSON.stringify(issues));
  } catch {
    // Ignore storage quota errors
  }
}

function normalizeParty(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractPartyNames({ subName = '', companyName = '', payee = '', contracts = [] } = {}) {
  const raw = [subName, companyName, payee];
  if (payee) {
    const parenMatch = String(payee).match(/^([^(]+)\(([^)]+)\)$/);
    if (parenMatch) {
      raw.push(parenMatch[1], parenMatch[2]);
    }
  }
  (Array.isArray(contracts) ? contracts : []).forEach(c => {
    if (c?.sub) raw.push(c.sub);
    if (c?.company) raw.push(c.company);
  });
  return [...new Set(raw.map(normalizeParty).filter(n => n.length >= 3))];
}

function contractorMatches(issueContractor, candidateNames) {
  const issueNorm = normalizeParty(issueContractor);
  if (issueNorm.length < 3 || candidateNames.length === 0) return false;
  return candidateNames.some(cand => issueNorm === cand || issueNorm.includes(cand) || cand.includes(issueNorm));
}

function phaseMatches(issuePhase, targetPhase) {
  const a = canonicalPhaseName(issuePhase).toLowerCase().replace(/[^a-z0-9]/g, '');
  const b = canonicalPhaseName(targetPhase).toLowerCase().replace(/[^a-z0-9]/g, '');
  return Boolean(a && b && a === b);
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const STATUS_RANK = { open: 0, in_progress: 1 };

/**
 * Returns unresolved (open or fix-submitted) punch list issues that belong to a subcontractor or trade phase.
 */
export function findOpenPunchItemsForSub({
  issues = [],
  subName = '',
  companyName = '',
  payee = '',
  contracts = [],
  phase = ''
} = {}) {
  const list = Array.isArray(issues) ? issues : [];
  if (list.length === 0) return [];

  const candidateNames = extractPartyNames({ subName, companyName, payee, contracts });
  const hasPhase = Boolean(String(phase || '').trim());
  if (candidateNames.length === 0 && !hasPhase) return [];

  return list
    .filter(issue => {
      if (!issue || issue.deletedAt || issue.status === 'resolved') return false;
      const byContractor = contractorMatches(issue.contractorName, candidateNames);
      const byPhase = hasPhase && phaseMatches(issue.tradePhase, phase);
      return byContractor || byPhase;
    })
    .sort((a, b) => {
      const pDiff = (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1);
      if (pDiff !== 0) return pDiff;
      return (STATUS_RANK[a.status] ?? 0) - (STATUS_RANK[b.status] ?? 0);
    });
}
