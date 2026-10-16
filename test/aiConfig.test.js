import assert from 'node:assert/strict';
import { test, describe, before, after } from 'node:test';
import { AI_CONFIG as SERVER_AI_CONFIG } from '../api/_lib/ai-config.js';
import { fetchWithExponentialBackoff } from '../api/_lib/ai-retry.js';

describe('Centralized AI Configuration', () => {
  test('the single model default is Flash-Lite on the server', () => {
    assert.equal(SERVER_AI_CONFIG.primaryModel, 'gemini-3.1-flash-lite');
  });

  test('the old reasoning-model routing is gone', () => {
    assert.equal(SERVER_AI_CONFIG.reasoningModel, undefined);
  });

  test('retry settings exist for the server routes', () => {
    assert.ok(SERVER_AI_CONFIG.retry.maxRetries >= 1);
    assert.ok(SERVER_AI_CONFIG.retry.retryableStatusCodes.includes(429));
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

describe('backup model when Google says the main model is busy', () => {
  const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"vendor":"Home Depot"}' }] } }] }), { status: 200 });
  const busy = () => new Response('This model is currently experiencing high demand.', { status: 503 });
  const fastRetry = { maxRetries: 1, initialDelayMs: 1, backoffFactor: 1, jitter: false, retryableStatusCodes: [429, 500, 503] };

  test('a busy main model sends the same request to the backup model', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    const asked = [];
    const { response } = await fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl, { method: 'POST', body: 'same' }, fastRetry,
      async (url, options) => {
        asked.push([url.includes('main-model') ? 'main' : 'backup', options.body]);
        return url.includes('main-model') ? busy() : ok();
      });
    assert.equal(response.status, 200);
    assert.deepEqual(asked, [['main', 'same'], ['main', 'same'], ['backup', 'same']]);
  });

  test('out of quota (429) and Google errors (500) also use the backup', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    for (const status of [429, 500]) {
      const { response } = await fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl, {}, fastRetry,
        async (url) => (url.includes('main-model') ? new Response('x', { status }) : ok()));
      assert.equal(response.status, 200, `status ${status}`);
    }
  });

  test('a bad request is not sent to the backup (it would fail there too)', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    let calls = 0;
    const { response } = await fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl, {}, fastRetry,
      async () => { calls++; return new Response('bad', { status: 400 }); });
    assert.equal(response.status, 400);
    assert.equal(calls, 1);
  });

  test('no backup when too little time is left before the server limit', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    let backupAsked = false;
    const { response } = await fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl, { timeoutMs: 5000, deadlineMs: 5000 }, fastRetry,
      async (url) => { if (url.includes('backup-model')) backupAsked = true; return busy(); });
    assert.equal(response.status, 503);
    assert.equal(backupAsked, false);
  });

  test('the scan route uses the backup model and returns its result', async () => {
    const { generateDocumentData } = await import('../api/extract-document.js');
    const { AI_CONFIG } = await import('../api/_lib/ai-config.js');
    const models = [];
    const { data } = await generateDocumentData({
      bytes: new Uint8Array([1]),
      mimeType: 'image/jpeg',
      apiKey: 'test',
      fetchImpl: async (url) => {
        const model = decodeURIComponent(url.split('/models/')[1].split(':')[0]);
        models.push(model);
        return model === AI_CONFIG.primaryModel ? busy() : ok();
      }
    });
    assert.deepEqual(data, { vendor: 'Home Depot' });
    assert.equal(models.at(-1), AI_CONFIG.backupModel);
    assert.notEqual(AI_CONFIG.backupModel, AI_CONFIG.primaryModel);
  });
});

test('the backup model is the newer lite model (checked live on 2026-10-15 while the main one was busy)', () => {
  assert.equal(SERVER_AI_CONFIG.backupModel, 'gemini-3.5-flash-lite');
});

describe('backup model when the main model is stuck (v1.14.9)', () => {
  const ok = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"vendor":"Lowes"}' }] } }] }), { status: 200 });
  const fastRetry = { maxRetries: 2, initialDelayMs: 1, backoffFactor: 1, jitter: false, retryableStatusCodes: [429, 500, 502, 503, 504] };
  // Answers only when the request is cancelled (like a model that never responds). The timer keeps
  // Node running until then: AbortSignal.timeout alone does not, and Node 20 ends the test early.
  const hang = (_url, options) => new Promise((_resolve, reject) => {
    const keepAlive = setTimeout(() => {}, 10000);
    options.signal?.addEventListener('abort', () => {
      clearTimeout(keepAlive);
      reject(Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' }));
    }, { once: true });
  });

  test('a main model that does not answer goes straight to the backup (no retry of the stuck one)', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    let mainTries = 0;
    const { response, model } = await fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl,
      { timeoutMs: 150, deadlineMs: 20000 }, fastRetry,
      async (url, options) => {
        if (url.includes('main-model')) { mainTries++; return hang(url, options); }
        return ok();
      });
    assert.equal(response.status, 200);
    assert.equal(model, 'backup-model');
    assert.equal(mainTries, 1);
  });

  test('a dropped connection to the main model also goes to the backup', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    const { model } = await fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl, { timeoutMs: 20000 }, fastRetry,
      async (url) => { if (url.includes('main-model')) throw new TypeError('fetch failed'); return ok(); });
    assert.equal(model, 'backup-model');
  });

  test('Google 502 and 504 answers use the backup too', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    for (const status of [502, 504]) {
      const { model } = await fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl, {}, fastRetry,
        async (url) => (url.includes('main-model') ? new Response('x', { status }) : ok()));
      assert.equal(model, 'backup-model', `status ${status}`);
    }
  });

  test('when both models are stuck, the timeout error still reaches the app', async () => {
    const { fetchWithBackupModel, geminiUrl } = await import('../api/_lib/ai-retry.js');
    await assert.rejects(
      fetchWithBackupModel(['main-model', 'backup-model'], geminiUrl, { timeoutMs: 100, deadlineMs: 20000 }, fastRetry, hang),
      (err) => err.status === 504
    );
  });

  test('the scan route says when the backup read the receipt', async () => {
    const { generateDocumentData } = await import('../api/extract-document.js');
    const { AI_CONFIG } = await import('../api/_lib/ai-config.js');
    const normal = await generateDocumentData({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg', apiKey: 't', fetchImpl: async () => ok() });
    assert.equal(normal.model, AI_CONFIG.primaryModel);
    const viaBackup = await generateDocumentData({
      bytes: new Uint8Array([1]), mimeType: 'image/jpeg', apiKey: 't',
      fetchImpl: async (url) => (url.includes(encodeURIComponent(AI_CONFIG.primaryModel)) ? new Response('busy', { status: 503 }) : ok())
    });
    assert.equal(viaBackup.model, AI_CONFIG.backupModel);
    assert.deepEqual(viaBackup.data, { vendor: 'Lowes' });
  });
});
