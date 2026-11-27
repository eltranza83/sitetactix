import { TRADE_CATEGORIES, ALL_CATEGORY_KEYS, ALL_PHASES } from '../../src/config/tradeCategories.js';

const CLASSIFICATION_RULES = TRADE_CATEGORIES
  .map(c => `- ${c.key}: ${c.phases.join('; ')}`)
  .join('\n');

const SHARED_OWNER_RULES = `
Rough-in vs fixtures (the owner's rules):
- Electrical & Lighting = rough-in electrical work and supplies: wiring, boxes, breakers, panels, conduit, rough-in labor.
- Electrical Hardware Fixtures = finished electrical fixtures: switches, ceiling fans, vanity lights, exterior lights, chandeliers, light fixtures.
- Plumbing Rough-In = rough-in plumbing pipe, drains, shower/rough-in valves, top-out, and plumbing labor.
- Plumbing Hardware Fixtures = finished plumbing fixtures: faucets, shower kits, toilets, sinks, tubs, water heater.

Paperwork vs Project Overhead (the owner's rules):
- Paperwork & Permits = strictly house/lot build paperwork: building permits, plans, engineering, surveys, closing/title fees, Builder's Risk insurance, HOA fees.
- Monthly Utility Bills = temporary electric, water, or gas bills for the property.
- Dumpsters & Cleaning = dumpsters, trash haul-off, porta-potties, jobsite cleaning.
- Fuel & Gas = gasoline, diesel, DEF, fuel at the pump (Stripes, Valero, Shell, Exxon, Buc-ee's, Pilot, etc.).
- Food & Crew = crew meals, lunches, tacos, drinks, Gatorade, bottled water, ice.
- Office & Tech = printer ink, paper, software/cloud subscriptions, phone/SIM plans, postage.
- Tools & Supplies = general jobsite tools and consumables: saw blades, drill bits, cords, brooms, trash bags, tarps, buckets, padlocks, safety gear.
- Extra Costs & Misc = only miscellaneous overhead expenses that do not fit any phase above.
`;

export const VOICE_EXPENSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    transcript: { type: 'STRING' },
    vendor: { type: 'STRING' },
    amount: { type: 'NUMBER' },
    date: { type: 'STRING' },
    type: { type: 'STRING', enum: ['invoice', 'check'] },
    costCategory: { type: 'STRING', enum: ['material', 'labor'] },
    checkNumber: { type: 'STRING' },
    tradeCategory: { type: 'STRING', enum: ALL_CATEGORY_KEYS },
    tradePhase: { type: 'STRING', enum: ALL_PHASES },
    description: { type: 'STRING' },
    lotNumber: { type: 'STRING' }
  },
  required: [
    'transcript',
    'vendor',
    'amount',
    'date',
    'type',
    'costCategory',
    'checkNumber',
    'tradeCategory',
    'tradePhase',
    'description',
    'lotNumber'
  ]
};

export function buildVoiceExpensePrompt({ localDate = '', activeProjectName = '', knownSubs = '' } = {}) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(localDate || '').trim())
    ? String(localDate).trim()
    : new Date().toISOString().slice(0, 10);
  const safeProject = String(activeProjectName || '').trim().slice(0, 80);
  const safeSubs = String(knownSubs || '').trim().slice(0, 600);

  return `
You are a fast, accurate construction bookkeeping voice assistant for ADEPEC HOMES (a custom luxury home builder in Texas).
Listen to the attached audio recording (which may be in English, Spanish, or Spanglish) and extract a single NO-RECEIPT expense entry.

Context:
- Today's exact local date is: ${safeDate}
- Active project / Lot: ${safeProject || '(none specified)'}
${safeSubs ? `- Known subcontractors on this project: ${safeSubs}` : ''}

Allowed Categories and Phases (pick ONE exact category key and ONE exact phase from that category):
${CLASSIFICATION_RULES}
${SHARED_OWNER_RULES}

Extraction Rules:
1. "transcript": Short, clean verbatim transcript of what the speaker said.
2. "date": Resolve relative dates using today's local date (${safeDate}):
   - "right now", "today", "just now", "ahorita", "hoy", or omitted date -> "${safeDate}".
   - "yesterday" / "ayer" -> subtract 1 day from ${safeDate} (YYYY-MM-DD).
3. "vendor": Store, merchant, or subcontractor/worker paid, in normal capitalization (e.g. "Stripes", "Home Depot", "Ramiro Garza"). If a known subcontractor name closely matches what was spoken, use their exact known name. Never use ADEPEC or Alejandro Cepeda as vendor.
4. "amount": Dollar amount as a positive number (e.g. 50 or 68.5). If unclear, return 0.
5. "costCategory":
   - "labor" for paying a subcontractor, crew, worker, or trade service labor (e.g. "paid Ramiro $500 for cleanup", "paid framing crew").
   - "material" for fuel/gas, food/drinks, materials, supplies, utilities, permits, tools, dumpsters, or store purchases.
6. "type": Use "check" ONLY if the speaker explicitly mentions paying by check (or gives a check number); otherwise "invoice".
7. "checkNumber": If the speaker mentions a payment method or check number (e.g. "business credit card", "credit card", "debit", "cash", "Zelle", "Venmo", "check 1435"), extract a short clean value like "Business Credit Card", "Cash", "Zelle", or "1435". Otherwise "".
8. "description": Clear, concise English expense description (e.g. "Fuel / gas - business credit card" or "Crew lunch tacos - debit card").
9. "lotNumber": Use "${safeProject}" unless the speaker explicitly names a different lot (e.g. "for Lot 4" -> "Lot 4").
`;
}

export const TRANSLATE_PUNCH_SCHEMA = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    description: { type: 'STRING' },
    categoryLabel: { type: 'STRING' },
    tradePhase: { type: 'STRING' }
  },
  required: ['title', 'description', 'categoryLabel', 'tradePhase']
};

export function buildTranslatePunchPrompt(payload = {}) {
  const safeTitle = String(payload.title || '').trim().slice(0, 200);
  const safeDesc = String(payload.description || '').trim().slice(0, 1200);
  const safeCat = String(payload.categoryLabel || '').trim().slice(0, 120);
  const safePhase = String(payload.tradePhase || '').trim().slice(0, 120);

  return `
You are a bilingual residential construction superintendent in South Texas.
Translate the following punch list item into natural, clear, professional Mexican/Texas construction Spanish that field trade crews immediately understand.
Keep room names, measurements, model numbers, and proper nouns accurate. If an input field is empty, return "".

Input:
- Title: ${safeTitle}
- Description: ${safeDesc}
- Category: ${safeCat}
- Phase: ${safePhase}
`;
}
