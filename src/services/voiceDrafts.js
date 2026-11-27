import { TRADE_CATEGORIES } from '../config/tradeCategories.js';
import { formatMoney, parseMoney } from './money.js';
import { canonicalPhaseName, categoryForPhase } from './sheetV2.js';

function getTodayIso(now = new Date()) {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function resolveCategoryAndPhase(rawCategory, rawPhase) {
  const cleanPhase = canonicalPhaseName(rawPhase);
  const byPhase = cleanPhase ? categoryForPhase(cleanPhase) : null;
  if (byPhase) {
    return { tradeCategory: byPhase.key, tradePhase: cleanPhase };
  }

  const byCat = TRADE_CATEGORIES.find(c => c.key === rawCategory || c.name === rawCategory);
  if (byCat) {
    return { tradeCategory: byCat.key, tradePhase: byCat.phases[0] };
  }

  return {
    tradeCategory: 'Project_Overhead_&_Bills',
    tradePhase: 'Extra Costs & Misc'
  };
}

/**
 * Normalizes Gemini's voice-expense JSON into a No-Receipt manual expense payload
 * compatible with `handleDataExtracted` and `EditForm`.
 */
export function buildVoiceExpenseMetadata(extracted = {}, { activeProjectName = '', now = new Date() } = {}) {
  const { tradeCategory, tradePhase } = resolveCategoryAndPhase(extracted.tradeCategory, extracted.tradePhase);
  const rawDate = String(extracted.date || '').trim();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : getTodayIso(now);
  const amount = Math.max(0, Math.round(parseMoney(extracted.amount) * 100) / 100);
  const costCategory = String(extracted.costCategory || '').toLowerCase() === 'labor' ? 'labor' : 'material';
  const type = String(extracted.type || '').toLowerCase() === 'check' ? 'check' : 'invoice';

  return {
    type,
    documentType: 'manual_expense',
    receiptStatus: 'no_receipt',
    provenance: 'manual_user_entry',
    vendor: String(extracted.vendor || '').trim() || 'Manual Expense',
    amount,
    date,
    costCategory,
    checkNumber: String(extracted.checkNumber || '').trim(),
    tradeCategory,
    tradePhase,
    description: String(extracted.description || extracted.transcript || '').trim() || 'Voice logged expense',
    lotNumber: String(extracted.lotNumber || activeProjectName || '').trim(),
    voiceTranscript: String(extracted.transcript || '').trim()
  };
}

export function formatVoiceExpenseToast(metadata = {}) {
  const vendor = metadata.vendor || 'Expense';
  const amountText = formatMoney(metadata.amount || 0);
  const phase = metadata.tradePhase || 'Drafts';
  return `Drafted: ${vendor} ${amountText} → ${phase}`;
}

export const PACKET_LABELS = {
  en: {
    headerTitle: 'PUNCH ISSUE PACKET',
    generatedPrefix: 'Generated',
    defaultTitle: 'Punch Issue',
    project: 'Project',
    status: 'Status',
    subdivision: 'Subdivision',
    lotNumber: 'Lot Number',
    fullAddress: 'Full Address',
    openInMaps: 'OPEN IN GOOGLE MAPS',
    category: 'Category',
    phase: 'Phase',
    assigned: 'Assigned',
    phone: 'Phone',
    created: 'Created',
    floorPlan: 'Floor Plan',
    pinAttached: 'Pin attached',
    noPinAttached: 'No pin attached',
    descriptionHeader: 'DESCRIPTION',
    noDescription: 'No description provided.',
    issuePhotoTitle: 'Issue Photo',
    noIssuePhoto: 'No issue photo was attached to this punch item.',
    floorPlanTitle: 'Floor Plan Location',
    noFloorPlan: 'No floor plan pin was attached to this punch item.',
    contractorNoteTitle: 'Contractor Note',
    contractorNoteBody: 'Please review the issue photo and marked floor plan location. Reply when complete with a completion photo or update.',
    priorities: {
      high: 'HIGH',
      medium: 'MEDIUM',
      low: 'LOW',
      open: 'OPEN'
    },
    statuses: {
      open: 'Open',
      in_progress: 'Fix submitted',
      resolved: 'Verified Closed'
    }
  },
  es: {
    headerTitle: 'REPORTE DE PENDIENTE',
    generatedPrefix: 'Generado',
    defaultTitle: 'Pendiente de Obra',
    project: 'Proyecto',
    status: 'Estado',
    subdivision: 'Fraccionamiento',
    lotNumber: 'Lote',
    fullAddress: 'Dirección',
    openInMaps: 'ABRIR EN GOOGLE MAPS',
    category: 'Categoría',
    phase: 'Fase',
    assigned: 'Contratista',
    phone: 'Teléfono',
    created: 'Fecha',
    floorPlan: 'Plano',
    pinAttached: 'Ubicación marcada',
    noPinAttached: 'Sin ubicación en plano',
    descriptionHeader: 'DESCRIPCIÓN DEL TRABAJO',
    noDescription: 'Sin descripción adicional.',
    issuePhotoTitle: 'Foto del Problema',
    noIssuePhoto: 'No se adjuntó foto del problema.',
    floorPlanTitle: 'Ubicación en el Plano',
    noFloorPlan: 'No se marcó ubicación en el plano.',
    contractorNoteTitle: 'Nota para el Contratista',
    contractorNoteBody: 'Por favor revise la foto del problema y la ubicación marcada en el plano. Al terminar, envíe una foto del trabajo corregido.',
    priorities: {
      high: 'ALTA',
      medium: 'MEDIA',
      low: 'BAJA',
      open: 'ABIERTA'
    },
    statuses: {
      open: 'Abierto',
      in_progress: 'Arreglo enviado',
      resolved: 'Verificado y Cerrado'
    }
  }
};

export function getPacketLabels(language = 'en') {
  return String(language || 'en').toLowerCase() === 'es' ? PACKET_LABELS.es : PACKET_LABELS.en;
}
