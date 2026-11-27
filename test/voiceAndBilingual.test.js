import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  VOICE_EXPENSE_SCHEMA,
  TRANSLATE_PUNCH_SCHEMA,
  buildVoiceExpensePrompt,
  buildTranslatePunchPrompt
} from '../api/_lib/voice-prompt.js';
import { generateDocumentData } from '../api/extract-document.js';
import {
  buildVoiceExpenseMetadata,
  formatVoiceExpenseToast,
  getPacketLabels
} from '../src/services/voiceDrafts.js';

describe('voice prompts and schemas', () => {
  it('injects localDate, activeProjectName, and owner Fuel & Gas rules into voice expense prompt', () => {
    const prompt = buildVoiceExpensePrompt({
      localDate: '2026-11-27',
      activeProjectName: 'Lot 3 – SiteTactix',
      knownSubs: 'Ramiro Garza / RG Concrete'
    });
    assert.match(prompt, /2026-11-27/);
    assert.match(prompt, /Lot 3 – SiteTactix/);
    assert.match(prompt, /Fuel & Gas/);
    assert.match(prompt, /Stripes/);
    assert.ok(VOICE_EXPENSE_SCHEMA.properties.tradePhase.enum.includes('Fuel & Gas'));
  });

  it('builds Spanish punch packet translation prompt with required fields', () => {
    const translatePrompt = buildTranslatePunchPrompt({
      title: 'Kitchen island outlet crooked',
      description: 'Level the GFCI box on the west side of the island',
      categoryLabel: 'Mechanicals & Utilities',
      tradePhase: 'Electrical Hardware Fixtures'
    });
    assert.match(translatePrompt, /Kitchen island outlet crooked/);
    assert.match(translatePrompt, /construction Spanish/i);
    assert.deepEqual(TRANSLATE_PUNCH_SCHEMA.required, ['title', 'description', 'categoryLabel', 'tradePhase']);
  });

  it('supports text-only Gemini calls (no inlineData) for Spanish punch packet translation', async () => {
    let capturedBody = null;
    const mockFetch = async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  title: 'Contacto chueco en isla de cocina',
                  description: 'Nivelar la caja GFCI del lado oeste de la isla',
                  categoryLabel: 'Instalaciones y Servicios',
                  tradePhase: 'Accesorios Eléctricos'
                })
              }]
            }
          }]
        })
      };
    };

    const { data } = await generateDocumentData({
      apiKey: 'test-key',
      prompt: buildTranslatePunchPrompt({ title: 'Kitchen island outlet crooked' }),
      schema: TRANSLATE_PUNCH_SCHEMA,
      fetchImpl: mockFetch
    });

    assert.equal(capturedBody.contents[0].parts.length, 1);
    assert.equal(data.title, 'Contacto chueco en isla de cocina');
  });
});

describe('voiceDrafts normalization & bilingual labels', () => {
  it('builds a Stripes $50 no-receipt Fuel & Gas draft cleanly', () => {
    const fixedNow = new Date(2026, 10, 27, 11, 30, 0);
    const meta = buildVoiceExpenseMetadata(
      {
        transcript: 'I just pumped gas right now at Stripes, 50 bucks on the business credit card',
        vendor: 'Stripes',
        amount: 50,
        date: '2026-11-27',
        type: 'invoice',
        costCategory: 'material',
        checkNumber: 'Business Credit Card',
        tradeCategory: 'Project_Overhead_&_Bills',
        tradePhase: 'Fuel & Gas',
        description: 'Gas / fuel - business credit card',
        lotNumber: 'Lot 3 – SiteTactix'
      },
      { activeProjectName: 'Lot 3 – SiteTactix', now: fixedNow }
    );

    assert.equal(meta.documentType, 'manual_expense');
    assert.equal(meta.receiptStatus, 'no_receipt');
    assert.equal(meta.provenance, 'manual_user_entry');
    assert.equal(meta.vendor, 'Stripes');
    assert.equal(meta.amount, 50);
    assert.equal(meta.date, '2026-11-27');
    assert.equal(meta.tradeCategory, 'Project_Overhead_&_Bills');
    assert.equal(meta.tradePhase, 'Fuel & Gas');
    assert.equal(meta.checkNumber, 'Business Credit Card');
    assert.equal(formatVoiceExpenseToast(meta), 'Drafted: Stripes $50.00 → Fuel & Gas');
  });

  it('returns complete English and Spanish packet label sets', () => {
    const en = getPacketLabels('en');
    const es = getPacketLabels('es');
    assert.equal(en.headerTitle, 'PUNCH ISSUE PACKET');
    assert.equal(es.headerTitle, 'REPORTE DE PENDIENTE');
    assert.equal(es.priorities.high, 'ALTA');
    assert.equal(es.statuses.open, 'Abierto');
  });
});
