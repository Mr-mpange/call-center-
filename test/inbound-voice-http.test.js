const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-voice-http-'));
process.env.DASHBOARD_DB_FILE = path.join(testDir, 'dashboard.sqlite');
process.env.VOICE_BUSINESSES_FILE = path.join(testDir, 'legacy-businesses.json');
process.env.AUTH_SECRET = 'test-only-auth-secret-with-at-least-32-characters';
process.env.API_AUTH_REQUIRED = 'true';

const app = require('../src/server');
const store = require('../src/utils/dashboardStore');
const businesses = require('../src/utils/voiceBusinessStore');
const { clientNameFor } = require('../src/services/voiceAgentRouting');

function tokenFor(email, tenantId, role) {
  const payload = Buffer.from(JSON.stringify({ sub: email, tid: tenantId, role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const signature = crypto.createHmac('sha256', process.env.AUTH_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

async function readUntil(reader, text, timeout = 3000) {
  const decoder = new TextDecoder();
  let buffer = '';
  const stopAt = Date.now() + timeout;
  while (Date.now() < stopAt) {
    let timeoutId;
    const result = await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new Error(`Timed out waiting for ${text}`)), Math.max(1, stopAt - Date.now())); }),
    ]).finally(() => clearTimeout(timeoutId));
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    if (buffer.includes(text)) return buffer;
  }
  throw new Error(`Timed out waiting for ${text}`);
}

test('authenticated browser receives tenant DID offer and first accept claims without faking audio', async () => {
  const tenantId = 'http-routing-tenant';
  const businessId = 'http-routing-business';
  const email = 'agent@http-routing.test';
  const user = { id: 'http-agent', email, name: 'Browser Agent', role: 'Agent', status: 'active' };
  store.ensureTenant(tenantId, 'HTTP test tenant');
  const tenantStore = store.read(tenantId);
  tenantStore.users = [user];
  store.write(tenantStore, tenantId);
  businesses.upsert(tenantId, {
    id: businessId, tenantId, name: 'HTTP Test Business', numbers: ['+255700000101'], routing: 'parallel',
    agents: [{ id: user.id, userId: user.id, email, name: user.name, type: 'web', clientName: clientNameFor(tenantId, email) }],
  });

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const auth = `Bearer ${tokenFor(email, tenantId, user.role)}`;
  const abort = new AbortController();
  let reader;
  try {
    const stream = await fetch(`${origin}/api/voice/stream`, { headers: { Authorization: auth }, signal: abort.signal });
    assert.equal(stream.status, 200);
    reader = stream.body.getReader();
    await readUntil(reader, 'event: ready');

    const form = new URLSearchParams({
      direction: 'Inbound', isActive: '1', to: '+255700000101',
      callerNumber: '+255700000102', callerCountryCode: '255', sessionId: 'ATVId-http-inbound-1',
      callSessionState: 'Active',
    });
    const webhook = await fetch(`${origin}/voice/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
    });
    assert.equal(webhook.status, 200);
    const xml = await webhook.text();
    assert.match(xml, /<Response>/);
    assert.match(xml, /Browser agent calling is not connected yet/);
    assert.doesNotMatch(xml, /<Dial[^>]+clientName|phoneNumbers="client:/);

    const event = await readUntil(reader, 'event: incoming_call');
    assert.match(event, /\+255700000102/);
    assert.match(event, /HTTP Test Business/);
    const snapshotResponse = await fetch(`${origin}/api/voice/inbound-calls`, { headers: { Authorization: auth } });
    const snapshot = await snapshotResponse.json();
    assert.equal(snapshot.calls.length, 1);

    const accepted = await fetch(`${origin}/api/voice/inbound-calls/${encodeURIComponent(snapshot.calls[0].callId)}/accept`, {
      method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: '{}',
    });
    const acceptance = await accepted.json();
    assert.equal(accepted.status, 200);
    assert.equal(acceptance.claimed, true);
    assert.equal(acceptance.mediaConnected, false);
    assert.equal(acceptance.session.status, 'failed');
    assert.match(acceptance.bridge.reason, /No verified SIP\/WebRTC media bridge/);
  } finally {
    abort.abort();
    if (reader) await reader.cancel().catch(() => undefined);
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test.after(() => fs.rmSync(testDir, { recursive: true, force: true }));
