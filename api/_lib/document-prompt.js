export const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: ['check', 'invoice', 'receipt'] },
    description: { type: 'STRING' },
    vendor: { type: 'STRING' },
    costCategory: { type: 'STRING', enum: ['material', 'labor'] },
    amount: { type: 'NUMBER' },
    date: { type: 'STRING' },
    checkNumber: { type: 'STRING', nullable: true },
    tradeCategory: {
      type: 'STRING',
      enum: [
        'Site_Prep_&_Structure',
        'Framing_&_Lumber',
        'Mechanicals_&_Utilities',
        'Interior_Finishes',
        'Paint_Tile',
        'House_Exterior_&_Yard',
        'Project_Overhead_&_Bills',
        'Paperwork_&_Permits',
        'Interior_Hardware'
      ]
    },
    tradePhase: {
      type: 'STRING',
      enum: [
        'Foundation & Flatwork',
        'Roofing',
        'Windows & Exterior Doors',
        'Framing Lumber & Truss',
        'Plumbing Rough-In',
        'Electrical & Lighting',
        'HVAC / AC Systems',
        'Insulation & Alarms',
        'Drywall & Sheetrock',
        'Cabinets & Trim Carpentry',
        'Quartz & Countertops',
        'Glass Work',
        'Tile & Flooring',
        'Paint & Finishes',
        'Stucco & Masonry',
        'Garage Doors',
        'Driveway & Sidewalks',
        'Cantera Stone Detail',
        'Fencing & Gates',
        'Landscaping & Irrigation',
        'Monthly Utility Bills',
        'Dumpsters & Cleaning',
        'Extra Costs & Misc',
        'Paperwork & Permits',
        'Plumbing Hardware Fixtures',
        'Electrical Hardware Fixtures'
      ]
    },
    lineItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          description: { type: 'STRING' },
          price: { type: 'NUMBER' },
          sku: { type: 'STRING', nullable: true },
          brand: { type: 'STRING', nullable: true },
          unit: { type: 'STRING', nullable: true },
          quantity: { type: 'NUMBER', nullable: true },
          unitPrice: { type: 'NUMBER', nullable: true }
        },
        required: ['description', 'price']
      }
    }
  },
  required: ['type', 'description', 'vendor', 'costCategory', 'amount', 'date', 'tradeCategory', 'tradePhase']
};

// Each line item also carries its own trade, so a mixed receipt can be split by category.
GEMINI_RESPONSE_SCHEMA.properties.lineItems.items.properties.tradeCategory = {
  type: 'STRING',
  nullable: true,
  enum: GEMINI_RESPONSE_SCHEMA.properties.tradeCategory.enum
};
GEMINI_RESPONSE_SCHEMA.properties.lineItems.items.properties.tradePhase = {
  type: 'STRING',
  nullable: true,
  enum: GEMINI_RESPONSE_SCHEMA.properties.tradePhase.enum
};

export const DOCUMENT_EXTRACTION_PROMPT = `
You are an expert OCR and financial data extraction assistant for a luxury residential construction company.
Analyze the attached image or PDF of a bank check, vendor invoice, or material receipt and extract the structured details.

Classification Rules:
- Site_Prep_&_Structure: Foundation & Flatwork; Roofing; Windows & Exterior Doors
- Framing_&_Lumber: Framing Lumber & Truss
- Mechanicals_&_Utilities: Plumbing Rough-In; Electrical & Lighting; HVAC / AC Systems; Insulation & Alarms
- Interior_Finishes: Drywall & Sheetrock; Cabinets & Trim Carpentry; Quartz & Countertops; Glass Work
- Paint_Tile: Tile & Flooring; Paint & Finishes
- House_Exterior_&_Yard: Stucco & Masonry; Garage Doors; Driveway & Sidewalks; Cantera Stone Detail; Fencing & Gates; Landscaping & Irrigation
- Project_Overhead_&_Bills: Monthly Utility Bills; Dumpsters & Cleaning; Extra Costs & Misc
- Paperwork_&_Permits: Paperwork & Permits
- Interior_Hardware: Plumbing Hardware Fixtures; Electrical Hardware Fixtures

High-Precision OCR Rules:
1. BANK CHECKS: Extract payee from the "Pay to the Order of" line. Extract total amount from the numerical dollar box and written legal amount line. Check number is located in top-right corner or bottom MICR routing line.
2. VENDOR RECEIPTS: Identify stores (Home Depot, Lowe's, Ferguson, Builders FirstSource). Extract the FINAL GRAND TOTAL (ignoring tax sub-totals).
3. HANDWRITTEN RECEIPTS: Pay close attention to handwritten dollar amounts and notes.
4. Descriptions must be concise and actionable for a construction project manager.
5. Select exact tradeCategory and tradePhase from the classification rules above.
6. BUILDER / PAYER SELF-IDENTITY RULE: The builder and client company is ADEPEC Group LLC / ADEPEC Homes. ADEPEC is NEVER the vendor. On handwritten generic receipt pads, if an individual appears in "SOLD TO" and ADEPEC appears in "SHIP TO", the individual (e.g. Irene Godoy) is the service provider / vendor, and ADEPEC is the customer. Never extract ADEPEC as the vendor.
7. If a receipt contains items for more than one phase, choose the phase with the largest dollar amount. Never combine phase names.
8. DATE: Return the transaction date printed on the document as YYYY-MM-DD (US receipts print month first, so 02/01/2026 is 2026-02-01). If no date is readable, return an empty string. Never guess or use today's date.
9. LINE ITEMS & REORDERS: Extract itemized line items if present. For each line item, extract optional sku, brand, unit (e.g. box, sq ft, each), quantity, and unitPrice ONLY when explicitly printed on the receipt. Never guess or fabricate these fields.
10. LINE ITEM TRADES: For every line item also return its own tradeCategory and tradePhase from the classification lists above, based on what that item is and what it is used for. A receipt with plumbing, electrical and tile items gives each item its own category and phase. If you are unsure about an item, use the receipt's own tradeCategory and tradePhase.
11. COST CLASSIFICATION (costCategory): use "labor" ONLY when the document pays a person or subcontractor for their work (a check to a sub, or a sub's invoice for installation or service). Everything else is "material": supplies, tools, fuel and gas, fees, permits, utilities, postage, rentals, food and drinks for the crew.
12. PAYMENT METHOD: for a check, put the check number in checkNumber. For any other receipt that shows how it was paid, put the method in checkNumber as "Credit Card", "Debit Card" or "Cash". If it does not say, return null.
13. VENDOR NAME: write the vendor in normal capitalization, the way a person would type it (Stripes, Home Depot, Floor and Decor), not in all capitals.
`;
