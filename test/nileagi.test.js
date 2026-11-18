const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.DASHBOARD_DB_FILE = path.join(os.tmpdir(), `nileagi-test-${crypto.randomUUID()}.sqlite`);
process.env.NILEAGI_ENABLED = 'false';

const config = require('../src/integrations/nileagi/config');
const client = require('../src/integrations/nileagi/client');
const dashboardStore = require('../src/utils/dashboardStore');

test('NileAGI is disabled and fail-closed by default', async () => {
  const parsed = config.fromEnv({});
  assert.equal(parsed.enabled, false);
  assert.equal(client.status({}).status, 'disabled');
  await assert.rejects(() => client.transcribe(Buffer.from('audio')), (error) => error.code === 'NILEAGI_UNAVAILABLE' && error.statusCode === 503);
});

test('configuration validates the documented local adapter without exposing secrets', () => {
  const parsed = config.fromEnv({
    NILEAGI_ENABLED: 'true',
    NILEAGI_ADAPTER: 'local-model',
    NILEAGI_STT_ENABLED: 'true',
    NILEAGI_TTS_ENABLED: 'true',
    NILEAGI_STT_URL: 'http://127.0.0.1:8094/v1/transcribe',
    NILEAGI_TTS_URL: 'http://127.0.0.1:8093/v1/speech',
    NILEAGI_API_KEY: 'secret-value',
  });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.sttUrl.endsWith('/v1/transcribe'), true);
  const publicStatus = client.status({
    NILEAGI_ENABLED: 'true',
    NILEAGI_ADAPTER: 'local-model',
    NILEAGI_STT_ENABLED: 'true',
    NILEAGI_STT_URL: 'http://127.0.0.1:8094/v1/transcribe',
  });
  assert.equal(publicStatus.apiKey, undefined);
  assert.equal(publicStatus.capabilities.stt.languages[0], 'sw');
});

test('STT response parsing accepts documented plain text and explicit JSON shapes', () => {
  assert.deepEqual(client.parseTranscriptionResponse('Habari za leo\n'), {
    text: 'Habari za leo', language: 'sw', final: true, partial: false,
  });
  assert.equal(client.parseTranscriptionResponse({ transcript: 'Karibu' }).text, 'Karibu');
  assert.equal(client.parseTranscriptionResponse({ result: { text: 'Asante' } }).text, 'Asante');
});

test('usage events remain isolated by tenant in SQLite', () => {
  dashboardStore.recordAiUsage({ tenantId: 'tenant-a', businessId: 'business-a', callId: 'call-a', provider: 'nileagi', operation: 'transcribe', inputAudioSeconds: 12, success: true });
  dashboardStore.recordAiUsage({ tenantId: 'tenant-b', businessId: 'business-b', callId: 'call-b', provider: 'nileagi', operation: 'synthesize', inputCharacters: 20, success: false, errorCode: 'NILEAGI_UNAVAILABLE' });
  const a = dashboardStore.listAiUsage('tenant-a');
  const b = dashboardStore.listAiUsage('tenant-b');
  assert.equal(a.length, 1);
  assert.equal(a[0].tenantId, 'tenant-a');
  assert.equal(a[0].callId, 'call-a');
  assert.equal(b.length, 1);
  assert.equal(b[0].tenantId, 'tenant-b');
  assert.equal(b[0].callId, 'call-b');
});
