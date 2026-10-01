import { getFirebaseAuthInstance } from './firebase.js';
import { AI_CONFIG } from '../config/aiConfig.js';

export const MAX_SECURE_DOCUMENT_BYTES = 4 * 1024 * 1024;

const DOCUMENT_EXTRACTION_PROMPT = `
You are an OCR and data extraction assistant for a construction company.
Analyze the attached image or PDF of a check, receipt, or invoice and extract the details in JSON format.

Response JSON Schema:
{
  "type": "check" | "invoice" | "receipt",
  "description": "Short description of items purchased, memo of check, or job description.",
  "vendor": "Name of the store or subcontractor payee.",
  "costCategory": "material" | "labor",
  "amount": 0.00,
  "date": "YYYY-MM-DD or empty string",
  "checkNumber": "Check number for checks, otherwise null",
  "tradeCategory": "Site_Prep_&_Structure" | "Framing_&_Lumber" | "Mechanicals_&_Utilities" | "Interior_Finishes" | "Paint_Tile" | "House_Exterior_&_Yard" | "Project_Overhead_&_Bills" | "Paperwork_&_Permits" | "Interior_Hardware",
  "tradePhase": "The exact phase block matching the category",
  "lineItems": [
    {
      "description": "Clean item description",
      "price": 0.00,
      "sku": "Optional product SKU or null",
      "brand": "Optional brand or null",
      "unit": "Optional unit (box, sq ft, each) or null",
      "quantity": 1,
      "unitPrice": 0.00
    }
  ]
}

Classification rules:
- Site_Prep_&_Structure: Foundation & Flatwork; Roofing; Windows & Exterior Doors
- Framing_&_Lumber: Framing Lumber & Truss
- Mechanicals_&_Utilities: Plumbing Rough-In; Electrical & Lighting; HVAC / AC Systems; Insulation & Alarms
- Interior_Finishes: Drywall & Sheetrock; Cabinets & Trim Carpentry; Quartz & Countertops; Glass Work
- Paint_Tile: Tile & Flooring; Paint & Finishes
- House_Exterior_&_Yard: Stucco & Masonry; Garage Doors; Driveway & Sidewalks; Cantera Stone Detail; Fencing & Gates; Landscaping & Irrigation
- Project_Overhead_&_Bills: Monthly Utility Bills; Dumpsters & Cleaning; Extra Costs & Misc
- Paperwork_&_Permits: Paperwork & Permits
- Interior_Hardware: Plumbing Hardware Fixtures; Electrical Hardware Fixtures

Instructions:
1. Identify whether the document is a check, invoice, or receipt.
2. Extract payee/vendor, total, date, check number when applicable, and material/labor classification.
3. Make the description concise and useful to a construction manager.
4. Extract individual line items for invoices and receipts, capturing optional sku, brand, unit, quantity, and unitPrice only when explicitly printed.
5. Choose only category and phase values from the lists above.
6. Output only valid JSON without markdown fences.
7. If a receipt contains items for more than one phase, choose the phase with the largest dollar amount. Never combine phase names.
`;

function getExtractionError(status, payload) {
  if (payload?.error) return payload.error;
  if (status === 401) return 'Your sign-in session expired. Please sign in again.';
  if (status === 403) return 'Your account is not authorized to use the scanner.';
  if (status === 413) return 'This document is too large. Please use a file smaller than 4 MB.';
  return 'AI extraction failed. Please try again.';
}

export function getClientGeminiApiKey() {
  return localStorage.getItem('jobscan_gemini_api_key') || import.meta.env?.VITE_GEMINI_API_KEY || '';
}

async function extractDocumentDataDirectly(fileOrBlob, apiKey, fetchImpl = fetch) {
  if (!apiKey) {
    throw new Error('Gemini API key is not configured. Please set your Gemini API key in Settings.');
  }

  const arrayBuffer = await fileOrBlob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64Data = btoa(binary);
  const mimeType = fileOrBlob.type || 'image/jpeg';
  const GEMINI_RESPONSE_SCHEMA = {
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

  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(AI_CONFIG.primaryModel)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: DOCUMENT_EXTRACTION_PROMPT },
            {
              inlineData: {
                data: base64Data,
                mimeType
              }
            }
          ]
        }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          temperature: 0
        }
      })
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    console.error('Direct Gemini API request failed:', res.status, errText);
    throw new Error(`Direct Gemini API failed (${res.status}). Please verify your Gemini API key in Settings.`);
  }

  const payload = await res.json();
  const text = payload.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim();
  if (!text) {
    throw new Error('Gemini returned an empty response. Please try scanning again.');
  }

  const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

export async function extractDocumentData(fileOrBlob, fetchImpl = fetch) {
  if (!fileOrBlob || fileOrBlob.size === 0) {
    throw new Error('The selected document is empty.');
  }
  if (fileOrBlob.size > MAX_SECURE_DOCUMENT_BYTES) {
    throw new Error('This document is too large. Please use a file smaller than 4 MB.');
  }

  const clientApiKey = getClientGeminiApiKey();

  // Try Vercel Serverless Function first if auth is present
  const auth = getFirebaseAuthInstance();
  const user = auth?.currentUser;

  if (user) {
    try {
      const idToken = await user.getIdToken();
      const response = await fetchImpl('/api/extract-document', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${idToken}`,
          'content-type': 'application/octet-stream',
          'x-document-mime': fileOrBlob.type || 'image/jpeg',
          'x-gemini-api-key': clientApiKey || ''
        },
        body: fileOrBlob
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // Platform returned non-JSON (e.g. 404 HTML on localhost)
      }

      if (response.ok && payload?.data) {
        return payload.data;
      }

      // If status is 404 (local dev server) or 503 (server key missing), try direct client fallback
      if ((response.status === 404 || response.status === 503) && clientApiKey) {
        console.warn(`Server API extraction returned ${response.status}. Falling back to direct client Gemini extraction.`);
        return await extractDocumentDataDirectly(fileOrBlob, clientApiKey, fetchImpl);
      }

      throw new Error(getExtractionError(response.status, payload));
    } catch (err) {
      // Fallback if network or server endpoint is unreachable (e.g. 404 on localhost)
      if (clientApiKey && (err.message.includes('404') || err.message.includes('Failed to fetch') || err.message.includes('not found') || err.message.includes('AI extraction failed'))) {
        console.warn('Server API failed. Attempting direct client Gemini extraction fallback...', err);
        return await extractDocumentDataDirectly(fileOrBlob, clientApiKey, fetchImpl);
      }
      throw err;
    }
  }

  // If user has a client API key, fallback directly
  if (clientApiKey) {
    return await extractDocumentDataDirectly(fileOrBlob, clientApiKey, fetchImpl);
  }

  throw new Error('Please sign in with Google or enter your Gemini API key in Settings to scan documents.');
}

