const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-call-history-'));
process.env.DASHBOARD_DB_FILE = path.join(testDir, 'dashboard.sqlite');
process.env.VOICE_BUSINESSES_FILE = path.join(testDir, 'legacy-businesses.json');

const dashboardStore = require('../src/utils/dashboardStore');
const voiceBusinessStore = require('../src/utils/voiceBusinessStore');
const { recordInboundVoiceEvent } = require('../src/utils/voiceCallHistory');

const tenantId = 'tenant-voice-test';
const business = {
  id: 'business-voice-test',
  tenantId,
  name: 'Test Support',
  numbers: ['+255700000001'],
  routing: 'parallel',
  agents: [{ id: 'agent-one', name: 'Test Agent', type: 'phone', number: '+255700000002' }],
};

test('Africa’s Talking inbound lifecycle becomes one tenant-scoped history call', () => {
  dashboardStore.ensureTenant(tenantId, 'Test tenant');
  voiceBusinessStore.upsert(tenantId, business);

  const active = recordInboundVoiceEvent({
    direction: 'Inbound',
    callerCountryCode: '255',
    callerNumber: '+255700000003',
    destinationNumber: '+255700000001',
    sessionId: 'ATVId_voice_history_test_001',
    callSessionState: 'Active',
    callStartTime: '2026-11-08T10:00:00.000Z',
  });
  assert.equal(active.terminal, false);
  assert.equal(dashboardStore.read(tenantId).liveCalls.length, 1);
  assert.equal(dashboardStore.read(tenantId).history.length, 0);

  const ended = recordInboundVoiceEvent({
    direction: 'Inbound',
    callerNumber: '+255700000003',
    destinationNumber: '+255700000001',
    sessionId: 'ATVId_voice_history_test_001',
    callSessionState: 'Completed',
    status: 'Success',
    durationInSeconds: '37',
  });
  assert.equal(ended.terminal, true);
  const saved = dashboardStore.read(tenantId);
  assert.equal(saved.liveCalls.length, 0);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].phone, '+255700000003');
  assert.equal(saved.history[0].caller, 'Customer');
  assert.equal(saved.history[0].agent, 'Test Agent');
  assert.equal(saved.history[0].durationSec, 37);
  assert.equal(saved.history[0].outcome, 'resolved');

  recordInboundVoiceEvent({
    direction: 'Inbound',
    callerNumber: '+255700000003',
    destinationNumber: '+255700000001',
    sessionId: 'ATVId_voice_history_test_001',
    callSessionState: 'Completed',
    status: 'Success',
    durationInSeconds: '37',
  });
  assert.equal(dashboardStore.read(tenantId).history.length, 1, 'replayed provider events must not duplicate history calls');
  assert.equal(dashboardStore.read('workspace').history.length, 0, 'call data must remain isolated to the owning tenant');
});

test('non-customer WebRTC legs and unconfigured numbers are not added as inbound history', () => {
  assert.equal(recordInboundVoiceEvent({
    direction: 'Inbound',
    callerNumber: 'Kilindo.agent-client',
    destinationNumber: '+255700000001',
    sessionId: 'ATVId_webrtc_leg',
    callSessionState: 'Completed',
  }), null);
  assert.equal(recordInboundVoiceEvent({
    direction: 'Inbound',
    callerNumber: '+255700000003',
    destinationNumber: '+255700000099',
    sessionId: 'ATVId_unconfigured_number',
    callSessionState: 'Completed',
  }), null);
});

test('unanswered inbound calls are recorded as missed', () => {
  recordInboundVoiceEvent({
    direction: 'Inbound',
    callerNumber: '+255700000004',
    destinationNumber: '+255700000001',
    sessionId: 'ATVId_voice_history_missed',
    callSessionState: 'NotAnswered',
    status: 'NotAnswered',
    durationInSeconds: '0',
  });
  const missed = dashboardStore.read(tenantId).history.find((call) => call.providerSessionId === 'ATVId_voice_history_missed');
  assert.equal(missed.outcome, 'missed');
});

test.after(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
});
