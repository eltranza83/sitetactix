/**
 * J.A.R.V.I.S. True Plugin-Style Semantic Intent & Modality Registry Architecture
 * 
 * Core Architectural Pillars:
 * 1. Tool Output = Grounded Evidence.
 * 2. Intent Modality Plugins = Self-contained plugins defining contract validation, 
 *    semantic classification, cloud prompt guidelines, applicability guards, and local synthesis.
 * 3. Deterministic Conflict Resolution = Multi-match scoring based on confidence, specificity, and priority.
 * 4. Zero-Touch Extensibility = Adding a future modality requires registering a standalone plugin,
 *    never editing core synthesis/reasoning logic.
 */

import { purchasingService } from './purchasingService.js';

export const INTENT_MODALITIES = Object.freeze({
  // Core Default Modalities
  RETRIEVAL: 'retrieval',
  VERIFICATION_META: 'verification_meta',
  ANALYTICAL: 'analytical',

  // Standard Extended Modalities
  EXPLANATION_WHY: 'explanation_why',
  SUMMARIZATION: 'summarization',
  INSTRUCTION_HOWTO: 'instruction_howto',
  RECOMMENDATION: 'recommendation',
  PLANNING: 'planning',
  CONFIRMATION: 'confirmation',
  ACTION_COMMAND: 'action_command',
  CLARIFICATION: 'clarification'
});

/**
 * Validates the strict plugin contract to prevent malformed runtime registration.
 */
export function validatePluginContract(plugin) {
  if (!plugin || typeof plugin !== 'object') {
    throw new TypeError('Invalid Modality Plugin: Plugin definition must be a non-null object.');
  }

  if (!plugin.id || typeof plugin.id !== 'string' || plugin.id.trim() === '') {
    throw new TypeError('Invalid Modality Plugin: Plugin must have a valid non-empty "id" string.');
  }

  if (typeof plugin.priority !== 'number' || Number.isNaN(plugin.priority)) {
    throw new TypeError(`Invalid Modality Plugin [${plugin.id}]: "priority" must be a valid number.`);
  }

  if (typeof plugin.classifier !== 'function') {
    throw new TypeError(`Invalid Modality Plugin [${plugin.id}]: "classifier" must be an executable function.`);
  }

  if (plugin.isApplicable && typeof plugin.isApplicable !== 'function') {
    throw new TypeError(`Invalid Modality Plugin [${plugin.id}]: Optional "isApplicable" must be a function if provided.`);
  }

  if (plugin.synthesizeEvidence && typeof plugin.synthesizeEvidence !== 'function') {
    throw new TypeError(`Invalid Modality Plugin [${plugin.id}]: Optional "synthesizeEvidence" must be a function if provided.`);
  }

  return true;
}

/**
 * ----------------------------------------------------------------------------
 * STANDARD SELF-CONTAINED MODALITY PLUGINS
 * ----------------------------------------------------------------------------
 */

export const AnalyticalPlugin = {
  id: INTENT_MODALITIES.ANALYTICAL,
  name: 'Analytical & Comparative',
  priority: 10,
  description: 'Comparative, ranking, extremum (most/least/highest/lowest), and statistical calculation inquiries.',
  promptGuideline: 'ANALYTICAL & COMPARATIVE: Perform calculations, comparisons, or rankings over the evidence and state the specific analytical answer directly with supporting figures.',
  classifier: (cleanQuery) => {
    const matched = 
      /\b(which|who|what|why)\b.*\b(most|least|highest|lowest|greatest|smallest|biggest|largest|more than|less than|heaviest|cheapest|expensive|max|min)\b/i.test(cleanQuery) ||
      /\b(more\s+\w+\s+than|less\s+\w+\s+than|more\s+than|less\s+than|compared to)\b/i.test(cleanQuery) ||
      /\b(compare|comparison|difference between|how many total|rank|top|bottom)\b/i.test(cleanQuery) ||
      /\b(which one|which list|which trade|which contractor|which phase|which stage|who has more|who owes more|what has more|have more|has more)\b/i.test(cleanQuery);
    
    return matched ? { matched: true, confidence: 0.95, specificity: 1.2 } : false;
  },
  synthesizeEvidence: (evidenceList, query, projectContext) => {
    const activeProject = projectContext?.activeProjectName || projectContext?.projectId || 'Active Project';
    const responses = [];

    for (const t of evidenceList) {
      const res = t.result;
      const toolName = t.name || t.tool?.name;
      if (toolName === 'get_purchasing_list') {
        const sections = res.sections || [];
        if (sections.length > 0) {
          const sorted = [...sections].sort((a, b) => (b.items?.length || 0) - (a.items?.length || 0));
          const top = sorted[0];
          const count = top.items?.length || 0;
          responses.push(`${top.category || top.title} has the most items on the checklist with ${count} item${count === 1 ? '' : 's'} listed.`);
        } else {
          responses.push(`There are no purchasing items to compare on the ${activeProject} Purchasing Checklist.`);
        }
      } else if (toolName === 'get_subcontractor_balance' || toolName === 'get_vendor_history') {
        const records = res.results || [];
        if (records.length > 0) {
          const sorted = [...records].sort((a, b) => (b.remainingBalance || 0) - (a.remainingBalance || 0));
          const top = sorted[0];
          responses.push(`${top.phaseName || top.contractor} has the highest remaining balance owed at $${top.remainingBalance?.toLocaleString() || 0} (Quote: $${top.quote?.toLocaleString() || 0}, Paid: $${top.totalPaid?.toLocaleString() || 0}).`);
        }
      } else if (toolName === 'search_receipts') {
        const receipts = res.results || res.receipts || [];
        if (receipts.length > 0) {
          const sorted = [...receipts].sort((a, b) => (b.amount || 0) - (a.amount || 0));
          const top = sorted[0];
          responses.push(`The largest receipt is $${top.amount?.toLocaleString()} from ${top.vendor || 'Vendor'} on ${top.date || 'recorded date'}.`);
        }
      }
    }
    return responses.length > 0 ? responses.join('\n\n') : null;
  }
};

export const VerificationMetaPlugin = {
  id: INTENT_MODALITIES.VERIFICATION_META,
  name: 'Verification & Meta',
  priority: 20,
  description: 'Exhaustiveness, exclusivity, existence, presence/absence, and completeness inquiries.',
  promptGuideline: 'VERIFICATION & META: Answer the existential/completeness question directly (e.g. "Those N items are currently all that are recorded on [Source].") rather than dumping raw lists.',
  classifier: (cleanQuery) => {
    const matched = 
      /\b(any other|any more|anything else|anything more|anything further|anything additional|anyone else|any others|another|besides|except|other than)\b/i.test(cleanQuery) ||
      /\b(is that all|is this all|are those all|are these all|those are all|these are all|that is all|that's all|is that everything|is this everything|that is everything|that's everything|are they all)\b/i.test(cleanQuery) ||
      /\b(only one|only ones|the only|all we have|all that exists|all that are listed|all that is listed|all that we need|all we still need)\b/i.test(cleanQuery) ||
      /\b(do we have more|are there more|is there more|do we have other|are there other|is there another|do we have anything)\b/i.test(cleanQuery) ||
      /\b(does anything else exist|do any other exist|is anything missing|are any missing|did we miss|did we forget|miss anything|forget anything|nothing else is needed|nothing else needed|nothing else)\b/i.test(cleanQuery);
    
    return matched ? { matched: true, confidence: 0.95, specificity: 1.1 } : false;
  },
  synthesizeEvidence: (evidenceList, query, projectContext) => {
    const activeProject = projectContext?.activeProjectName || projectContext?.projectId || 'Active Project';
    const responses = [];

    for (const t of evidenceList) {
      const res = t.result;
      const toolName = t.name || t.tool?.name;
      if (toolName === 'get_purchasing_list') {
        const sections = res.sections || [];
        const totalItems = res.totalItems || sections.reduce((acc, s) => acc + (s.items?.length || 0), 0);
        const queryLower = (query || '').toLowerCase();
        
        let matchedSection = null;
        if (res.trade && res.trade !== 'all') {
          matchedSection = sections.find(s => s.sectionId === res.trade) || sections[0];
        } else {
          for (const s of sections) {
            const catLower = (s.category || s.title || '').toLowerCase();
            if (queryLower.includes(s.sectionId) || queryLower.includes(catLower) || (s.sectionId === 'electrical' && queryLower.includes('electric'))) {
              matchedSection = s;
              break;
            }
          }
        }

        if (queryLower.includes('categor') || (queryLower.includes('list') && !queryLower.includes('item'))) {
          const totalSections = sections.length;
          const names = sections.map(s => s.category || s.title || 'Category').join(', ');
          if (totalSections === 0) {
            responses.push(`There are currently no purchasing categories or items listed on the ${activeProject} Purchasing Checklist.`);
          } else {
            responses.push(`Those ${totalSections} categories (${names}) are currently all the categories listed on the ${activeProject} Purchasing Checklist.`);
          }
        } else if (matchedSection) {
          const itemCount = (matchedSection.items || []).length;
          responses.push(`Yes, according to the Firestore (${activeProject} Purchasing Checklist), those are all ${itemCount} unpurchased ${matchedSection.category || matchedSection.title} items currently listed.`);
        } else if (sections.length > 0) {
          const names = sections.map(s => `${(s.items || []).length} in ${s.category || s.title}`).join(', ');
          responses.push(`Yes, according to the Firestore (${activeProject} Purchasing Checklist), those are all ${totalItems} unpurchased items currently listed (${names}).`);
        } else {
          responses.push(`There are currently no unpurchased items listed on the Firestore (${activeProject} Purchasing Checklist).`);
        }
      } else if (toolName === 'get_subcontractor_balance' || toolName === 'get_vendor_history') {
        const records = res.results || [];
        if (records.length === 0) {
          responses.push(`There are no additional subcontractor balances recorded for ${activeProject} in the financial ledger.`);
        } else if (records.length === 1) {
          const item = records[0];
          responses.push(`For ${item.phaseName || item.contractor}, that is the only contract balance recorded in the financial ledger (Quote: $${item.quote?.toLocaleString() || 0}, Paid: $${item.totalPaid?.toLocaleString() || 0}, Balance: $${item.remainingBalance?.toLocaleString() || 0}).`);
        } else {
          responses.push(`Those ${records.length} trade contracts are currently all that are recorded in the ${activeProject} financial ledger.`);
        }
      } else if (toolName === 'search_receipts') {
        const receipts = res.results || res.receipts || [];
        responses.push(`Those ${receipts.length} receipt${receipts.length === 1 ? '' : 's'} are currently all that are recorded for that category in ${activeProject}.`);
      } else if (toolName === 'search_memories' || toolName === 'list_memories') {
        const memories = res.memories || [];
        responses.push(`Those ${memories.length} note${memories.length === 1 ? '' : 's'} are currently all the persistent memories I have saved for this topic.`);
      } else if (toolName === 'get_drive_files') {
        const files = res.files || [];
        if (res.isFolderEmpty && res.folderName) {
          responses.push(`The "${res.folderName}" directory exists in Google Drive for ${activeProject}, but it does not currently contain any files.`);
        } else if (files.length === 0) {
          responses.push(res.message || `No files found in Google Drive for ${activeProject}.`);
        } else {
          responses.push(`Those ${files.length} file${files.length === 1 ? '' : 's'} are currently all that exist in that folder.`);
        }
      }
    }
    return responses.length > 0 ? responses.join('\n\n') : null;
  }
};

export const ExplanationWhyPlugin = {
  id: INTENT_MODALITIES.EXPLANATION_WHY,
  name: 'Explanation & Why',
  priority: 30,
  description: 'Reasoning, root cause, rationale, and justification inquiries.',
  promptGuideline: 'EXPLANATION & WHY: Provide a clear, logical rationale and root cause grounded strictly in project records.',
  classifier: (cleanQuery) => {
    return /\b(why|reason|explain why|how come|what caused|why did|rationale)\b/i.test(cleanQuery);
  }
};

export const SummarizationPlugin = {
  id: INTENT_MODALITIES.SUMMARIZATION,
  name: 'Summarization',
  priority: 40,
  description: 'High-level executive briefing, summary, and snapshot inquiries.',
  promptGuideline: 'SUMMARIZATION: Provide a concise executive overview highlighting key totals, critical milestones, and pending items.',
  classifier: (cleanQuery) => {
    return /\b(summarize|summary|overview|briefing|executive summary|quick recap|recap|tldr)\b/i.test(cleanQuery);
  },
  synthesizeEvidence: (evidenceList, query, projectContext) => {
    const activeProject = projectContext?.activeProjectName || projectContext?.projectId || 'Active Project';
    const summaries = [];
    for (const t of evidenceList) {
      const res = t.result;
      const toolName = t.name || t.tool?.name;
      if (toolName === 'get_purchasing_list') {
        const sections = res.sections || [];
        const totalItems = res.totalItems || sections.reduce((acc, s) => acc + (s.items?.length || 0), 0);
        summaries.push(`${activeProject} Purchasing Summary: ${sections.length} active categories with ${totalItems} total pending items.`);
      }
    }
    return summaries.length > 0 ? summaries.join('\n') : null;
  }
};

export const InstructionHowToPlugin = {
  id: INTENT_MODALITIES.INSTRUCTION_HOWTO,
  name: 'Instruction / How-To',
  priority: 50,
  description: 'Procedural, sequential, and how-to guidance inquiries.',
  promptGuideline: 'INSTRUCTION & HOW-TO: Provide step-by-step procedural directions aligned with jobsite standards and municipal protocols.',
  classifier: (cleanQuery) => {
    return /\b(how do i|how to|what steps|procedure|step by step|how should we|guide me)\b/i.test(cleanQuery);
  }
};

export const RecommendationPlugin = {
  id: INTENT_MODALITIES.RECOMMENDATION,
  name: 'Recommendation',
  priority: 60,
  description: 'Best practice suggestions, material recommendations, and trade advisory.',
  promptGuideline: 'RECOMMENDATION: Provide grounded expert recommendations tailored to the specific lot constraints.',
  classifier: (cleanQuery) => {
    return /\b(recommend|suggest|what do you suggest|what should i buy|best option|advice|advise)\b/i.test(cleanQuery);
  }
};

export const PlanningPlugin = {
  id: INTENT_MODALITIES.PLANNING,
  name: 'Planning & Scheduling',
  priority: 70,
  description: 'Phase timeline, mobilization scheduling, and trade sequencing inquiries.',
  promptGuideline: 'PLANNING: Outline sequencing dependencies, trade prerequisites, and milestone roadmaps.',
  classifier: (cleanQuery) => {
    return /\b(plan|schedule|timeline|next phase|sequencing|when should we|roadmap)\b/i.test(cleanQuery) && !/\b(floor\s*plan|blueprint|pdf|file|doc)\b/i.test(cleanQuery);
  }
};

export const ConfirmationPlugin = {
  id: INTENT_MODALITIES.CONFIRMATION,
  name: 'Confirmation',
  priority: 80,
  description: 'Affirmations, approvals, and user consent for pending actions.',
  promptGuideline: 'CONFIRMATION: Execute the confirmed staged action and state completion clearly.',
  classifier: (cleanQuery) => {
    return /^(yes|yeah|yep|sure|go ahead|proceed|approved|do it|confirm|sounds good|please do)$/i.test(cleanQuery.trim());
  }
};

export const ActionCommandPlugin = {
  id: INTENT_MODALITIES.ACTION_COMMAND,
  name: 'Action / Command',
  priority: 15,
  description: 'Imperative modifications, document writes, client actions, reminders, and database updates.',
  promptGuideline: 'ACTION & COMMAND: Execute the requested mutation or client action tool accurately. Confirm success ONLY after verifying the client tool executed successfully. If the tool reports an error, missing file, or empty folder, state the failure reason faithfully without claiming it succeeded.',
  classifier: (cleanQuery) => {
    return /\b(add|create|update|mark|delete|remove|sync|save|remind me|schedule an?|open|launch|navigate|switch to)\b/i.test(cleanQuery) && !/\b(how do i|how to|what is the schedule|what's the schedule|schedule for)\b/i.test(cleanQuery);
  },
  synthesizeEvidence: (evidenceList, _query, _projectContext) => {
    const responses = [];
    for (const t of evidenceList) {
      const res = t.result;
      const toolName = t.name || t.tool?.name;
      if (!res) continue;

      if (toolName === 'open_drive_document') {
        if (res.success) {
          responses.push(`Opened "${res.fileName}" (${res.folderName || 'Google Drive'}).`);
        } else {
          responses.push(res.error || `I couldn't open that document.`);
        }
      } else if (toolName === 'open_drive_folder') {
        if (res.success) {
          responses.push(`Opened the "${res.folderName}" folder in Google Drive (${res.fileCount} files).`);
        } else {
          responses.push(res.error || `I couldn't open that folder.`);
        }
      } else if (toolName === 'navigate_app_tab') {
        responses.push(res.message || `Switched to the ${res.tab} tab.`);
      } else if (res.message) {
        responses.push(res.message);
      }
    }
    return responses.length > 0 ? responses.join('\n\n') : null;
  }
};

export const ClarificationPlugin = {
  id: INTENT_MODALITIES.CLARIFICATION,
  name: 'Clarification',
  priority: 100,
  description: 'Disambiguation and follow-up inquiry when details are ambiguous.',
  promptGuideline: 'CLARIFICATION: Ask a targeted follow-up question to resolve ambiguity before proceeding.',
  classifier: (cleanQuery) => {
    return /\b(what do you mean|clarify|elaborate|which one do you mean)\b/i.test(cleanQuery);
  }
};

export const RetrievalPlugin = {
  id: INTENT_MODALITIES.RETRIEVAL,
  name: 'Content Retrieval',
  priority: 999,
  description: 'Standard factual lookup and full content record retrieval.',
  promptGuideline: 'CONTENT RETRIEVAL: Present the retrieved data cleanly and faithfully. ' +
    'For purchasing queries: always quote the exact counts from the pre-aggregated `summary` object (summary.neededCount, summary.purchasedCount, summary.tradeBreakdown). These numbers are already calculated net of purchased items; never perform your own subtraction or recompute counts. ' +
    'For broad purchasing list questions (e.g. "what do we still need to purchase for Lot 3?"): give a concise summary with total count and breakdown by trade (e.g. "You still have 20 items to purchase for Lot 3: 2 Quartz, 10 Electrical, and 8 Plumbing. Nothing has been marked as purchased yet. If you want, I can give you the individual items for any trade."). If items have been purchased, state how many items are marked as purchased (e.g. "You have 1 item marked as purchased."). ' +
    'For specific trade questions (e.g. "what electrical items do we need?"): give the detailed list of items for that trade. ' +
    'For specific item status questions (e.g. "did we already buy the ceiling fans?", "have we purchased the faucets?"): answer directly with the status of that specific item (e.g. "No. The ceiling fans are still marked as needed on Lot 3." or "Yes. The faucets are marked as purchased on Lot 3."). Do not dump the whole trade list. ' +
    'For purchased-status questions ("what have we already purchased?"): if 0 items, state nothing has been marked as purchased yet; if 1-5 items, list the items; if 6+ items, summarize count and trade breakdown.',
  classifier: () => true, // default catch-all
  synthesizeEvidence: (evidenceList, query, projectContext) => {
    const activeProject = projectContext?.activeProjectName || projectContext?.projectId || 'Active Project';
    const responses = [];

    for (const t of evidenceList) {
      const res = t.result;
      const toolName = t.name || t.tool?.name;
      if (toolName === 'get_purchasing_list') {
        const sections = res.sections || [];
        const queryLower = (query || '').toLowerCase();

        // 1. Answer-Priority Hierarchy 1: Specific Item Lookup
        if (res.itemLookup?.canonicalAnswer) {
          responses.push(res.itemLookup.canonicalAnswer);
          continue;
        }

        // Dynamic fallback item lookup when tool was executed without query-specific itemLookup
        const collectionCountRegex = /\b(how many|how much|count of|quantity of|number of|total number of)\s+(?:total\s+)?(?:(?:[a-z\s]+)\s+)?(?:items|materials|fixtures|stuff|things|supplies|categories|sections)\b/i;
        const genericCountRegex = /\b(how many|how much)\s+(?:have we|did we|do we|are there)\s+(?:purchased|bought|got|to buy|needed|left|remaining)\b/i;
        const isCollectionCountInquiry = collectionCountRegex.test(queryLower) || genericCountRegex.test(queryLower);

        const isListInquiry = isCollectionCountInquiry || (
          (!/\b(how many|how much|count of|quantity of)\b/i.test(queryLower)) && (
            /\b(what|which)\s+(?:[a-z\s]+\s+)?(?:items|materials|fixtures|stuff|things|supplies|list|checklist)\b/i.test(queryLower) ||
            /\b(what|which)\s+(?:have we|did we|do we|is on|are on|are the)\b/i.test(queryLower) ||
            /\b(show|list|all items|everything)\b/i.test(queryLower)
          )
        );

        const isItemStatusQuery = !isListInquiry &&
                                  /\b(how many|how much|did we (already )?(buy|purchase|get)|have we (already )?(bought|purchased|got)|is (the )?.+ (bought|purchased|needed)|was (the )?.+ (bought|purchased)|did we get|do we have any|do we have|is there a|is there)\b/i.test(queryLower);

        if (isItemStatusQuery) {
          const allItems = res.allItems || (res.items || []).concat(res.purchasedItems || []);
          const isQtyQuery = /\b(how many|how much|count|quantity)\b/i.test(queryLower);
          const cleanSubject = queryLower
            .replace(/^(how many|how much|do we have any|do we have|is there a|is there an|is there|are there any|are there|what is the quantity of|what's the count of|what count of|did we|have we|was the|is the|did you|did they|have they|has the|can we check if we|check if we|check if|verify if|did we already|have we already|did we buy|have we bought)\s+/i, '')
            .replace(/^(already\s+|ever\s+)?(buy|bought|purchase|purchased|get|got|have|need)\s+/i, '')
            .replace(/^(the|those|these|that|a|an)\s+/i, '')
            .replace(/\s+(?:in|under|for|from)\s+(?:general\s+hardware(?:\s+&\s+materials)?|electrical(?:\s+hardware)?(?:\s+fixtures)?|plumbing(?:\s+hardware)?(?:\s+fixtures)?|quartz(?:\s+hardware)?|hvac|paint|drywall|paint\s+&\s+drywall|general).*$/i, '')
            .replace(/\s+(?:do we have|are there|are on|have we got|do we need|are needed|on the purchasing list|on the list|on the checklist|on our checklist|in the purchasing list|in the list|for lot\s*\d+|on lot\s*\d+|in lot\s*\d+|already|yet|so far|now|recently|been purchased|been bought|purchased|needed).*$/i, '')
            .replace(/[?.!]+$/, '')
            .trim();

          const matchResult = purchasingService.findMatchingItems(allItems, cleanSubject || queryLower);

          if (matchResult && (matchResult.type === 'EXACT' || matchResult.type === 'SINGLE_MATCH')) {
            const item = matchResult.item;
            const isPurchased = item.isPurchased || item.status === 'purchased';
            const statusLabel = isPurchased ? 'Purchased' : 'Needed';
            const name = item.name || item.itemName;
            const isPlural = /s$/i.test(name) && !/ss$/i.test(name);
            const verb = isPlural ? 'are' : 'is';
            const qtyNote = item.quantity && item.quantity > 1 ? ` Quantity: ${item.quantity}.` : '';

            if (isQtyQuery) {
              responses.push(`You have ${item.quantity || 1} ${name} (${statusLabel}) on the ${activeProject} purchasing checklist.`);
            } else {
              responses.push(isPurchased
                ? `Yes. The ${name} ${verb} marked as purchased on ${activeProject}.${qtyNote}`
                : `No. The ${name} ${verb} still marked as needed on ${activeProject}.${qtyNote}`);
            }
            continue;
          } else if (matchResult && matchResult.type === 'AMBIGUOUS') {
            const candidates = matchResult.matches.map(m => `• ${m.name || m.itemName} (${m.status === 'purchased' ? 'Purchased' : 'Needed'})`).join('\n');
            responses.push(`There are ${matchResult.matches.length} matching items on the ${activeProject} checklist:\n${candidates}\nWhich one were you asking about?`);
            continue;
          } else if (matchResult && matchResult.type === 'NONE') {
            responses.push(`"${cleanSubject}" is not currently listed on the ${activeProject} purchasing checklist.`);
            continue;
          }
        }

        // 2. Answer-Priority Hierarchy 2: Trade-Specific Filtered Item List
        if (res.trade && res.trade !== 'all') {
          if (res.summary?.canonicalAnswer) {
            responses.push(res.summary.canonicalAnswer);
          } else if (sections.length > 0) {
            const lines = [];
            for (const s of sections) {
              lines.push(`${s.category || s.title}:`);
              for (const item of (s.items || [])) {
                const qtyStr = item.quantity && (item.quantity > 1 || item.hasExplicitQuantity) ? ` (${item.quantity})` : '';
                const statusStr = item.isPurchased ? ' - Purchased' : '';
                lines.push(`• ${item.name || item.itemName}${qtyStr}${statusStr}`);
              }
              lines.push('');
            }
            responses.push(lines.join('\n').trim());
          } else {
            responses.push(res.message || `No items found under ${res.trade} for ${activeProject}.`);
          }
          continue;
        }

        // 3. Answer-Priority Hierarchy 3: Multi-Trade / Broad Project Queries
        const isComparisonQuery = /\b(versus|vs\.?|compared to|comparison|breakdown|purchased and needed|purchased vs needed|status overview|purchasing status|what have we purchased.*(?:versus|vs\.?|compared to|and what).*need|what do we need.*(?:versus|vs\.?|compared to|and what).*purchased)\b/i.test(queryLower);

        if (isComparisonQuery && res.summary?.canonicalAnswer) {
          responses.push(res.summary.canonicalAnswer);
          continue;
        }

        const isPurchasedQuery = res.status === 'purchased' ||
          /\b(purchased|already bought|already purchased|have we bought|have we purchased|what have we bought|what have we purchased|what did we buy|what did we purchase)\b/i.test(queryLower);
        const wantsDetailedItems = /\b(all items|everything|detail|item by item|read all|show all items)\b/i.test(queryLower) || (sections.length === 1 && !isPurchasedQuery);

        if (isPurchasedQuery) {
          if (res.summary?.canonicalAnswer && /\bPurchased items for\b/i.test(res.summary.canonicalAnswer)) {
            responses.push(res.summary.canonicalAnswer);
          } else {
            const purchasedItems = (res.purchasedItems && res.purchasedItems.length > 0)
              ? res.purchasedItems
              : (res.allItems
                  ? res.allItems.filter(i => i.status === 'purchased' || i.isPurchased)
                  : (res.status === 'purchased' ? (res.items || []) : (res.items || []).filter(i => i.status === 'purchased' || i.isPurchased)));
            const totalPurchased = typeof res.totalPurchased === 'number' ? res.totalPurchased : purchasedItems.length;

            if (totalPurchased === 0) {
              responses.push(`Nothing has been marked as purchased yet for ${activeProject}.`);
            } else {
              const itemNames = purchasedItems.map(i => i.name || i.itemName).join(', ');
              responses.push(`You've purchased ${totalPurchased} item${totalPurchased === 1 ? '' : 's'} for ${activeProject} so far: ${itemNames}.`);
            }
          }
          continue;
        } else if (sections.length > 0) {
          if (!wantsDetailedItems && sections.length > 1) {
            const totalRemaining = res.totalItems || sections.reduce((acc, s) => acc + (s.items?.length || 0), 0);
            const breakdown = sections.map((s, idx) => {
              const isLast = idx === sections.length - 1 && sections.length > 1;
              const count = (s.items || []).length;
              return `${isLast ? 'and ' : ''}${count} ${s.category || s.title}`;
            }).join(', ');
            const statusNote = (typeof res.totalPurchased === 'number' && res.totalPurchased > 0)
              ? `You have ${res.totalPurchased} item${res.totalPurchased === 1 ? '' : 's'} marked as purchased.`
              : 'Nothing has been marked as purchased yet.';
            
            responses.push(`You still have ${totalRemaining} items to purchase for ${activeProject}: ${breakdown}. ${statusNote} If you want, I can give you the individual items for any trade.`);
          } else {
            const lines = [];
            for (const s of sections) {
              lines.push(`${s.category || s.title}:`);
              for (const item of (s.items || [])) {
                const qtyStr = item.quantity && (item.quantity > 1 || item.hasExplicitQuantity) ? ` (${item.quantity})` : '';
                const statusStr = item.isPurchased ? ' - Purchased' : '';
                lines.push(`• ${item.name || item.itemName}${qtyStr}${statusStr}`);
              }
              lines.push('');
            }
            responses.push(lines.join('\n').trim());
          }
        } else {
          responses.push(res.message || `No items found on the ${activeProject} Purchasing Checklist.`);
        }
      } else if (toolName === 'get_subcontractor_balance' || toolName === 'get_vendor_history') {
        const records = res.results || [];
        if (records.length > 0) {
          const lines = records.map(item => `For ${item.phaseName || item.contractor}: Quote is $${item.quote?.toLocaleString()}, Total Paid is $${item.totalPaid?.toLocaleString()}, and Remaining Balance owed is $${item.remainingBalance?.toLocaleString()}.`);
          responses.push(lines.join('\n'));
        } else {
          responses.push(res.message || 'No balance records found.');
        }
      } else if (toolName === 'search_receipts') {
        const receipts = res.results || res.receipts || [];
        if (receipts.length > 0) {
          responses.push(`Found ${receipts.length} receipt(s) totaling $${receipts.reduce((sum, r) => sum + (r.amount || 0), 0).toLocaleString()}.`);
        } else {
          responses.push(res.message || 'No matching receipts found.');
        }
      } else if (toolName === 'search_memories' || toolName === 'list_memories') {
        const memories = res.memories || [];
        if (memories.length > 0) {
          const list = memories.map(m => `• ${m.text}`).join('\n');
          responses.push(list);
        } else {
          responses.push(`I don't have any saved notes or preferences matching that request for this project.`);
        }
      } else if (toolName === 'get_drive_files') {
        const files = res.files || [];
        const subfolders = res.subfolders || [];
        const folders = res.folders || [];
        const isFolderInquiry = /\b(folders|directories|folder list|what folders)\b/i.test(query);

        if (res.isFolderEmpty && res.folderName) {
          responses.push(`The "${res.folderName}" directory exists in Google Drive for ${activeProject}, but it does not currently contain any files.`);
        } else if (isFolderInquiry && folders.length > 0) {
          const folderLines = folders.map(f => `• ${f.name}${f.subfolders?.length ? ` (subfolders: ${f.subfolders.join(', ')})` : ''}`).join('\n');
          responses.push(`In Google Drive for ${activeProject}, we have the following folders:\n${folderLines}`);
        } else if (res.message && files.length === 0 && subfolders.length > 0) {
          responses.push(res.message);
        } else if (files.length > 0) {
          const list = files.map(f => `• ${f.name} (${f.folderPath || f.folderName || 'Google Drive'})`).join('\n');
          responses.push(list);
        } else if (folders.length > 0) {
          const folderLines = folders.map(f => `• ${f.name}${f.subfolders?.length ? ` (subfolders: ${f.subfolders.join(', ')})` : ''}`).join('\n');
          responses.push(`In Google Drive for ${activeProject}, we have the following folders:\n${folderLines}`);
        } else {
          responses.push(res.message || `No files found in Google Drive for ${activeProject}.`);
        }
      } else if (res.message) {
        responses.push(res.message);
      }
    }
    return responses.length > 0 ? responses.join('\n\n') : null;
  }
};

/**
 * ----------------------------------------------------------------------------
 * TRUE PLUGIN-BASED SEMANTIC INTENT REGISTRY
 * ----------------------------------------------------------------------------
 */
export class SemanticIntentRegistry {
  constructor() {
    this._plugins = new Map();
    this._initializeBuiltins();
  }

  _initializeBuiltins() {
    this.registerPlugin(AnalyticalPlugin);
    this.registerPlugin(VerificationMetaPlugin);
    this.registerPlugin(ExplanationWhyPlugin);
    this.registerPlugin(SummarizationPlugin);
    this.registerPlugin(InstructionHowToPlugin);
    this.registerPlugin(RecommendationPlugin);
    this.registerPlugin(PlanningPlugin);
    this.registerPlugin(ConfirmationPlugin);
    this.registerPlugin(ActionCommandPlugin);
    this.registerPlugin(ClarificationPlugin);
    this.registerPlugin(RetrievalPlugin);
  }

  /**
   * Registers a self-contained modality plugin with strict contract validation.
   */
  registerPlugin(plugin) {
    validatePluginContract(plugin);
    this._plugins.set(plugin.id, {
      ...plugin,
      priority: plugin.priority ?? 500
    });
    return true;
  }

  /**
   * Backward-compatible helper for object-based modality registration.
   */
  registerModality(id, handler = {}) {
    return this.registerPlugin({
      id,
      name: handler.name || id,
      priority: handler.priority ?? 500,
      description: handler.description || 'Custom Modality',
      promptGuideline: handler.promptGuideline || '',
      classifier: typeof handler.classifier === 'function' ? handler.classifier : () => false,
      isApplicable: handler.isApplicable,
      synthesizeEvidence: handler.synthesizeEvidence
    });
  }

  /**
   * Unregisters a modality plugin.
   */
  unregisterPlugin(id) {
    return this._plugins.delete(id);
  }

  unregisterModality(id) {
    return this.unregisterPlugin(id);
  }

  /**
   * Checks if a modality plugin is registered.
   */
  hasModality(id) {
    return this._plugins.has(id);
  }

  /**
   * Retrieves a registered plugin by ID.
   */
  getPlugin(id) {
    return this._plugins.get(id) || null;
  }

  /**
   * Returns all plugins sorted by priority.
   */
  getPlugins() {
    return Array.from(this._plugins.values()).sort((a, b) => a.priority - b.priority);
  }

  getModalities() {
    return this.getPlugins();
  }

  /**
   * Deterministic Semantic Intent Classifier with Multi-Match & Conflict Resolution
   */
  classify(query = '', conversationHistory = [], context = {}, evidenceList = []) {
    if (!query || typeof query !== 'string') {
      return {
        modality: INTENT_MODALITIES.RETRIEVAL,
        confidence: 1.0,
        score: 100,
        subIntent: 'direct_retrieval'
      };
    }

    const clean = query.trim().toLowerCase();
    const matches = [];

    for (const plugin of this.getPlugins()) {
      if (plugin.id === INTENT_MODALITIES.RETRIEVAL) continue; // evaluated as fallback

      // 1. Check optional applicability guard
      if (typeof plugin.isApplicable === 'function') {
        try {
          if (!plugin.isApplicable(context, evidenceList)) {
            continue;
          }
        } catch {
          continue;
        }
      }

      // 2. Evaluate classifier
      try {
        const result = plugin.classifier(clean, conversationHistory, context);
        if (result) {
          const confidence = typeof result === 'object' && result.confidence ? result.confidence : 0.90;
          const specificity = typeof result === 'object' && result.specificity ? result.specificity : 1.0;
          const subIntent = typeof result === 'object' && result.subIntent ? result.subIntent : plugin.description;

          // Deterministic multi-match score: higher confidence & specificity wins, priority breaks ties
          const score = (confidence * 100) + (specificity * 10) - (plugin.priority * 0.1);

          matches.push({
            modality: plugin.id,
            confidence,
            specificity,
            priority: plugin.priority,
            score,
            subIntent,
            plugin
          });
        }
      } catch {}
    }

    if (matches.length > 0) {
      // Deterministically pick highest scored match
      matches.sort((a, b) => b.score - a.score);
      const winner = matches[0];
      return {
        modality: winner.modality,
        confidence: winner.confidence,
        score: winner.score,
        subIntent: winner.subIntent
      };
    }

    // Default Fallback: Retrieval
    return {
      modality: INTENT_MODALITIES.RETRIEVAL,
      confidence: 0.90,
      score: 0,
      subIntent: 'default_retrieval'
    };
  }

  /**
   * Compiles dynamic grounding guidelines for Gemini Cloud AI prompt from all registered plugins.
   */
  compilePromptGuidelines() {
    const guidelines = [];
    for (const plugin of this.getPlugins()) {
      if (plugin.promptGuideline) {
        guidelines.push(`- ${plugin.promptGuideline}`);
      }
    }
    return guidelines.join('\n');
  }

  /**
   * Universal Intent-Aware Grounded Evidence Synthesizer
   */
  synthesize(toolTelemetryList = [], userQuery = '', projectContext = {}) {
    const successfulTools = (toolTelemetryList || []).filter(t => t.success && t.result);
    if (successfulTools.length === 0) {
      const errorTool = (toolTelemetryList || []).find(t => !t.success && (t.error || t.result?.error));
      return errorTool ? (errorTool.error || errorTool.result?.error || 'Action could not be completed.') : null;
    }

    const classification = this.classify(userQuery, [], projectContext, successfulTools);
    const plugin = this._plugins.get(classification.modality);

    if (plugin && typeof plugin.synthesizeEvidence === 'function') {
      const result = plugin.synthesizeEvidence(successfulTools, userQuery, projectContext);
      if (result) return result;
    }

    // Fallback to Retrieval Plugin
    const retrievalPlugin = this._plugins.get(INTENT_MODALITIES.RETRIEVAL);
    if (retrievalPlugin && typeof retrievalPlugin.synthesizeEvidence === 'function') {
      return retrievalPlugin.synthesizeEvidence(successfulTools, userQuery, projectContext);
    }

    return null;
  }
}

// Global Singleton Registry
export const intentRegistry = new SemanticIntentRegistry();

/**
 * Public Classification API
 */
export function classifySemanticIntent(query = '', conversationHistory = [], context = {}, evidenceList = []) {
  return intentRegistry.classify(query, conversationHistory, context, evidenceList);
}

/**
 * Public Grounded Synthesis API
 */
export function synthesizeGroundedEvidence(toolTelemetryList = [], userQuery = '', projectContext = {}) {
  return intentRegistry.synthesize(toolTelemetryList, userQuery, projectContext);
}

/**
 * Public Cloud AI Grounding Prompt Compiler
 */
export function getSemanticPromptGuidelines() {
  return intentRegistry.compilePromptGuidelines();
}
