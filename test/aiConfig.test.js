import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { determineTaskModel, AI_CONFIG } from '../src/config/aiConfig.js';
import { executeClientToolCall, runAllAiToolDiagnostics, evaluateSystemAndDataHealth } from '../src/services/aiTools.js';
import { fetchWithExponentialBackoff } from '../api/_lib/ai-retry.js';

describe('Centralized AI Configuration & Intent Routing', () => {
  test('primaryModel and reasoningModel defaults are set correctly', () => {
    assert.equal(AI_CONFIG.primaryModel, 'gemini-3.1-flash-lite');
    assert.equal(AI_CONFIG.reasoningModel, 'gemini-3.5-flash');
  });

  test('determineTaskModel routes standard lookups & materials to Flash-Lite (Fast Path)', () => {
    const fastQueries = [
      'How much have we paid the electrician?',
      'What do we still owe all subcontractors?',
      'Find all receipts from ABC Electric and summarize them.',
      'we need a good night lighting on the porch',
      "what's the weather like today",
      'is vanity light marked as purchased',
      'who is the plumber for Lot 3',
      'show me the framing permit in Google Drive',
      'add 6 GFCI outlets to the purchasing checklist'
    ];

    for (const q of fastQueries) {
      assert.equal(determineTaskModel(q), 'gemini-3.1-flash-lite', `Expected Fast Path for: "${q}"`);
    }
  });

  test('determineTaskModel routes complex audits, forecasting, and comparisons to Flash (Deep Path)', () => {
    const deepQueries = [
      'audit this project and tell me where we are going over budget',
      'compare our actual spending against original contractor quotes',
      'analyze the profitability and recommend a cost reduction strategy',
      'forecast completion cost and identify unusual financial risks',
      'compare these two proposals from the roofing subcontractors',
      'which is better financially between the two plumbing options'
    ];

    for (const q of deepQueries) {
      assert.equal(determineTaskModel(q), 'gemini-3.5-flash', `Expected Deep Path for: "${q}"`);
    }
  });

  test('determineTaskModel respects explicit forceDeepReasoning toggle', () => {
    const simpleQuery = 'What is the date today?';
    assert.equal(determineTaskModel(simpleQuery, false), 'gemini-3.1-flash-lite');
    assert.equal(determineTaskModel(simpleQuery, true), 'gemini-3.5-flash');

    const purchasingQuery = 'we need a good night lighting on the porch';
    assert.equal(determineTaskModel(purchasingQuery, false), 'gemini-3.1-flash-lite');
    assert.equal(determineTaskModel(purchasingQuery, true), 'gemini-3.5-flash');
  });
});

describe('Exponential Backoff Retry Engine', () => {
  test('retries on HTTP 429 / 503 errors and succeeds on recovery', async () => {
    let attempts = 0;
    const mockFetch = async () => {
      attempts++;
      if (attempts < 2) {
        return { ok: false, status: 503, text: async () => 'Service Unavailable' };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };

    const response = await fetchWithExponentialBackoff(
      'https://example.com/api',
      {},
      { maxRetries: 2, initialDelayMs: 10, backoffFactor: 2, jitter: false, retryableStatusCodes: [503] },
      mockFetch
    );

    assert.equal(attempts, 2);
    assert.equal(response.ok, true);
  });
});

describe('AI Tools & Two-Tier Diagnostic Health Suite', () => {
  let originalFetch;

  before(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (String(url).includes('open-meteo.com')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            current: {
              temperature_2m: 22,
              relative_humidity_2m: 45,
              precipitation: 0,
              weather_code: 0,
              wind_speed_10m: 10
            },
            daily: {
              time: ['2026-09-01'],
              weather_code: [0],
              temperature_2m_max: [30],
              temperature_2m_min: [18],
              precipitation_sum: [0]
            }
          })
        };
      }
      return originalFetch(url, options);
    };
  });

  after(() => {
    globalThis.fetch = originalFetch;
  });

  test('executeClientToolCall handles subcontractor balance query', async () => {
    const mockDashboardData = {
      phases: [
        {
          name: 'Electrical & Lighting',
          contractor: 'Kike Vallejo',
          contractAmount: 15000,
          payments: [{ amount: 5000, date: '2026-08-10', payee: 'Kike Vallejo' }]
        }
      ]
    };

    const result = await executeClientToolCall('get_subcontractor_balance', { tradeOrContractor: 'Kike Vallejo' }, { dashboardData: mockDashboardData });
    assert.equal(result.foundCount, 1);
    assert.equal(result.results[0].quote, 15000);
    assert.equal(result.results[0].totalPaid, 5000);
    assert.equal(result.results[0].remainingBalance, 10000);
    assert.ok(result._executionDurationMs !== undefined);
  });

  test('executeClientToolCall handles Open-Meteo weather lookup', async () => {
    const result = await executeClientToolCall('get_weather_for_jobsite', { locationName: 'Dallas Lot 3' });
    assert.equal(result.location, 'Dallas Lot 3');
    assert.ok(result.current || result.error);
    assert.ok(result._executionDurationMs !== undefined);
  });

  test('evaluateSystemAndDataHealth cleanly separates Tool Health from Data Health', () => {
    const emptyContext = {};
    const health = evaluateSystemAndDataHealth(emptyContext);
    
    assert.equal(health.overallToolOperational, true);
    assert.ok(health.toolHealth.length >= 4);
    assert.ok(health.dataHealth.length >= 5);
    assert.equal(health.dataWarningCount, 5); // 5 empty datasets when unconfigured
  });

  test('runAllAiToolDiagnostics returns test results and health payload', async () => {
    const data = await runAllAiToolDiagnostics({});
    assert.ok(data.testResults);
    assert.ok(data.testResults.length >= 5);
    assert.ok(data.health);
    data.testResults.forEach((r) => {
      assert.ok(r.tool);
      assert.ok(r.title);
      assert.equal(r.passed, true);
      assert.ok(r.durationMs >= 0);
    });
  });
});
