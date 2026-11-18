const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.DASHBOARD_DB_FILE = path.join(os.tmpdir(), `nileagi-voice-test-${crypto.randomUUID()}.sqlite`);
process.env.NILEAGI_ENABLED = 'true';
process.env.NILEAGI_ADAPTER = 'rafiki-api';
process.env.NILEAGI_API_KEY = 'rk_test_voice_session_key';
process.env.NILEAGI_BASE_URL = 'https://api.rafiki.nileagi.com';
process.env.NILEAGI_VOICE_ENABLED = 'true';
process.env.NILEAGI_VOICE_TRANSPORT = 'http-turns';

const voiceSession = require('../src/integrations/nileagi/voiceSession');
const dashboardStore = require('../src/utils/dashboardStore');

test('voice sessions are tenant-scoped and can be ended without a provider call', async () => {
  const session = await voiceSession.create({ tenantId: 'tenant-a', businessId: 'business-a', callId: 'call-a', language: 'sw' });
  assert.equal(session.status, 'active');
  assert.equal(session.tenantId, 'tenant-a');
  assert.equal(dashboardStore.getAiVoiceSession('tenant-b', session.id), null);
  const ended = voiceSession.end(session.id, 'tenant-a');
  assert.equal(ended.status, 'ended');
  assert.ok(ended.endedAt);
});

test('voice session creation rejects unsupported language before any provider request', async () => {
  await assert.rejects(
    () => voiceSession.create({ tenantId: 'tenant-a', language: 'en' }),
    (error) => error.code === 'NILEAGI_LANGUAGE_UNSUPPORTED' && error.statusCode === 400,
  );
});
