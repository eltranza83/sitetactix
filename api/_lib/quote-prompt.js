import { TRADE_CATEGORIES, ALL_CATEGORY_KEYS, ALL_PHASES } from '../../src/config/tradeCategories.js';

const CLASSIFICATION_RULES = TRADE_CATEGORIES
  .map(c => `- ${c.key}: ${c.phases.join('; ')}`)
  .join('\n');

export const QUOTE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    sub: { type: 'STRING' },
    company: { type: 'STRING' },
    date: { type: 'STRING' },
    items: {
      type: 'ARRAY',
      minItems: 1,
      items: {
        type: 'OBJECT',
        properties: {
          tradeCategory: {
            type: 'STRING',
            enum: ALL_CATEGORY_KEYS
          },
          tradePhase: {
            type: 'STRING',
            enum: ALL_PHASES
          },
          quoteAmount: { type: 'NUMBER' },
          scopeSummary: { type: 'STRING' }
        },
        required: ['tradeCategory', 'tradePhase', 'quoteAmount', 'scopeSummary']
      }
    }
  },
  required: ['sub', 'company', 'date', 'items']
};

export const QUOTE_EXTRACTION_PROMPT = `
You are an expert OCR and construction estimating assistant for a luxury residential home builder.
Analyze the attached subcontractor PDF quote, proposal, bid, contract, or photo of a written estimate and extract the structured contract quote details.

Classification Rules:
${CLASSIFICATION_RULES}

Rough-in vs fixtures (the owner's rules; apply them to every quote item):
- Electrical & Lighting = rough-in electrical work and supplies: wiring the house, boxes, breakers, panels, conduit, rough-in + trim-out labor contract.
- Electrical Hardware Fixtures = finished electrical fixtures priced separately: switches, ceiling fans, vanity lights, exterior lights, security lights, chandeliers and light fixtures.
- Plumbing Rough-In = rough-in plumbing contract and rough-in valves, shower valves, pipe, drains, top-out, and trim-out labor.
- Plumbing Hardware Fixtures = finished plumbing fixtures priced separately: faucets, shower kits, toilets, sinks, tubs, and the water heater.

Paperwork vs Project Overhead (the owner's rules; apply them to every quote item):
- Paperwork & Permits = strictly house/lot build paperwork: city or county building permits, architectural floor plans, structural or windstorm engineering, land surveys, closing/HUD/title fees, Builder's Risk insurance, and HOA review fees. Never put office supplies, subscriptions, phone plans, tools, food, or fuel here.
- Monthly Utility Bills = recurring temporary electric, water, or gas utility bills for the property during construction.
- Dumpsters & Cleaning = roll-off dumpsters, trash haul-off, portable restroom rentals, and construction/make-ready cleaning.
- Fuel & Gas = gasoline, diesel, DEF, and fuel purchases at the pump.
- Food & Crew = crew meals, lunches, tacos, drinks, Gatorade, bottled water cases, and ice.
- Office & Tech = printer ink or toner, paper, office gear, software/cloud/AI subscriptions, phone or SIM plans, and postage/shipping.
- Tools & Supplies = general jobsite tools and consumables not tied to a single trade: saw blades, drill bits, extension cords, brooms, trash bags, tarps, buckets, padlocks, and safety gear.
- Extra Costs & Misc = only miscellaneous overhead expenses that do not fit any phase above.

Quote Extraction Rules:
1. BUILDER / CLIENT SELF-IDENTITY RULE: The builder and client is ADEPEC / ADEPEC Group / ADEPEC Group LLC / ADEPEC Homes / Alejandro Cepeda. NEVER extract ADEPEC or Alejandro Cepeda as "sub" or "company" — the builder is ALWAYS the client/customer receiving the quote!
2. SUBCONTRACTOR IDENTITY:
   - "sub": Extract the subcontractor individual's / contact person's name in normal capitalization (e.g. "Enrique Vallejo"), or "" if only a business/company name is shown.
   - "company": Extract the subcontractor business/company name in normal capitalization (e.g. "Vallejo Electric LLC"), or "" if the quote is from an individual person with no business name.
3. DATE: Return the quote/proposal date printed on the document as YYYY-MM-DD (US dates print month first, so 02/01/2026 is 2026-02-01). If no date is readable, return "". Never guess or use today's date.
4. MULTI-PHASE VS LUMP-SUM ITEMS:
   - If the quote separates prices across multiple distinct construction phases from the classification list above (for example Plumbing Rough-In $8,500 and Plumbing Hardware Fixtures $3,500, or Stucco & Masonry $14,000 and Cantera Stone Detail $4,200), return a separate item per distinct construction phase.
   - If the quote is a single lump sum or covers a single construction phase (even if broken into internal steps like slab prep + pour, or rough-in + trim-out within the same phase), return 1 item with the full quote total for that phase.
   - Exclude optional unaccepted add-ons or alternates unless they are explicitly included in the grand total.
   - "scopeSummary": Write a concise 1-line summary of what is included in that phase's quote (e.g. "Turnkey electrical rough-in & trim labor for 2,600 sq ft plan").
`;
