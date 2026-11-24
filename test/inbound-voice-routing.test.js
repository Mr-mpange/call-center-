const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inbound-routing-'));
process.env.DASHBOARD_DB_FILE = path.join(testDir, 'dashboard.sqlite');
process.env.VOICE_BUSINESSES_FILE = path.join(testDir, 'legacy-businesses.json');

const store = require('../src/utils/dashboardStore');
const realtime = require('../src/services/voiceRealtime');
const routing = require('../src/services/voiceAgentRouting');

function onlineUser(tenantId, index, businessId) {
  const user = { id: `user-${tenantId}-${index}`, name: `Agent ${index}`, email: `agent${index}@${tenantId}.test`, role: 'Agent', status: 'active' };
  const response = { writableEnded: false, events: [], write(frame) { this.events.push(frame); } };
  const dispose = realtime.subscribe({ tenantId, email: user.email, userId: user.id, userName: user.name, memberships: [businessId], response });
  return { user, dispose, response };
}

test('parallel fan-out returns every connected eligible agent for 1, 3, and 10 agents', () => {
  const tenantId = 'routing-tenant';
  store.ensureTenant(tenantId);
  for (const count of [1, 3, 10]) {
    const businessId = `business-${count}`;
    const online = Array.from({ length: count }, (_, i) => onlineUser(tenantId, `${count}-${i}`, businessId));
    const business = { id: businessId, agents: online.map(({ user }) => ({ id: user.id, userId: user.id, email: user.email, name: user.name, type: 'web' })) };
    const eligible = routing.eligibleAgents(business, tenantId, online.map(({ user }) => user));
    assert.equal(eligible.length, count);
    realtime.publish(tenantId, businessId, { type: 'incoming_call', callId: `call-${count}` });
    for (const { response } of online) assert.ok(response.events.some((frame) => frame.includes('event: incoming_call') && frame.includes(`call-${count}`)));
    online.forEach(({ dispose }) => dispose());
  }
});

test('presence excludes offline, inactive, busy, and other-tenant agents', () => {
  const tenantA = 'routing-a';
  const tenantB = 'routing-b';
  store.ensureTenant(tenantA);
  store.ensureTenant(tenantB);
  const active = onlineUser(tenantA, 'active', 'business-a');
  const inactive = onlineUser(tenantA, 'inactive', 'business-a');
  realtime.markBusy(tenantA, active.user.email, true);
  const business = { id: 'business-a', agents: [active, inactive].map(({ user }) => ({ id: user.id, userId: user.id, email: user.email, type: 'web' })) };
  const eligible = routing.eligibleAgents(business, tenantA, [
    { ...active.user }, { ...inactive.user, status: 'inactive' },
    { id: 'foreign', email: 'foreign@other.test', role: 'Agent', status: 'active' },
  ]);
  assert.equal(eligible.length, 0);
  realtime.markBusy(tenantA, active.user.email, false);
  active.dispose();
  assert.equal(routing.eligibleAgents(business, tenantA, [active.user]).length, 0, 'disconnected agents are immediately unavailable');
  inactive.dispose();
});

test('legacy business agent ids authorize the matching browser user', () => {
  const tenantId = 'legacy-membership-tenant';
  const user = { id: 'legacy-user', email: 'legacy@test.invalid', role: 'Agent', status: 'active' };
  const business = { id: 'legacy-business', agents: [{ id: user.id, type: 'web' }] };
  assert.deepEqual(routing.membershipsForUser(user, tenantId, [business]), [business.id]);
});

test('no available agents yields an empty fan-out and an inbound offer can be rejected', () => {
  const tenantId = 'no-agents-tenant';
  store.ensureTenant(tenantId);
  const offlineUser = { id: 'offline', email: 'offline@test.invalid', role: 'Agent', status: 'active' };
  const business = { id: 'biz-no-agents', agents: [{ id: 'offline', userId: 'offline', email: offlineUser.email, type: 'web' }] };
  assert.deepEqual(routing.eligibleAgents(business, tenantId, [offlineUser]), []);
  const { session } = store.createInboundVoiceSession({ tenantId, businessId: business.id, providerSessionId: 'ATVId-reject-all', calledNumber: '+255700000001', eligibleAgents: [{ id: 'agent', email: 'agent@test.invalid' }] });
  const result = store.rejectInboundVoiceSession(tenantId, session.id, 'agent');
  assert.equal(result.rejected, true);
  assert.equal(result.session.status, 'missed');
  assert.equal(store.claimInboundVoiceSession(tenantId, session.id, 'agent').claimed, false);
});

test('duplicate provider webhooks create one session and simultaneous acceptance has one winner', async () => {
  const tenantId = 'atomic-tenant';
  store.ensureTenant(tenantId);
  const eligibleAgents = [
    { id: 'agent-a', email: 'a@test.invalid', name: 'A' },
    { id: 'agent-b', email: 'b@test.invalid', name: 'B' },
    { id: 'agent-c', email: 'c@test.invalid', name: 'C' },
  ];
  const values = { tenantId, businessId: 'biz', providerSessionId: 'ATVId-idempotent', calledNumber: '+255700000001', callerNumber: '+255700000002', eligibleAgents };
  const first = store.createInboundVoiceSession(values);
  const replay = store.createInboundVoiceSession(values);
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(first.session.id, replay.session.id);

  const claims = await Promise.all(eligibleAgents.map((agent) => Promise.resolve().then(() => store.claimInboundVoiceSession(tenantId, first.session.id, agent.id))));
  assert.equal(claims.filter((claim) => claim.claimed).length, 1);
  const winner = store.getInboundVoiceSession(tenantId, first.session.id).winningAgentId;
  assert.ok(eligibleAgents.some((agent) => agent.id === winner));
  assert.equal(store.getInboundVoiceSession('another-tenant', first.session.id), null);
  assert.equal(store.claimInboundVoiceSession('another-tenant', first.session.id, 'agent-a').claimed, false);
});

test('atomic claim rejects an agent outside the persisted eligible list', () => {
  const tenantId = 'eligible-only-tenant';
  store.ensureTenant(tenantId);
  const { session } = store.createInboundVoiceSession({
    tenantId, businessId: 'biz', providerSessionId: 'ATVId-eligible-only', calledNumber: '+255700000001',
    eligibleAgents: [{ id: 'allowed', email: 'allowed@test.invalid' }],
  });
  assert.equal(store.claimInboundVoiceSession(tenantId, session.id, 'not-allowed').claimed, false);
});

test('one agent cannot atomically claim two concurrent active calls', () => {
  const tenantId = 'one-call-per-agent';
  store.ensureTenant(tenantId);
  const eligibleAgents = [{ id: 'agent-one', email: 'one@test.invalid' }];
  const first = store.createInboundVoiceSession({ tenantId, businessId: 'biz', providerSessionId: 'ATVId-call-one', calledNumber: '+255700000001', eligibleAgents }).session;
  const second = store.createInboundVoiceSession({ tenantId, businessId: 'biz', providerSessionId: 'ATVId-call-two', calledNumber: '+255700000001', eligibleAgents }).session;
  assert.equal(store.claimInboundVoiceSession(tenantId, first.id, 'agent-one').claimed, true);
  assert.equal(store.isInboundAgentBusy(tenantId, 'agent-one'), true);
  assert.equal(store.claimInboundVoiceSession(tenantId, second.id, 'agent-one').claimed, false);
  store.updateInboundVoiceSession(tenantId, first.id, { status: 'ended', endedAt: new Date().toISOString() });
  assert.equal(store.isInboundAgentBusy(tenantId, 'agent-one'), false);
});

test('customer termination and ring timeout prevent later acceptance', () => {
  const tenantId = 'terminal-state-tenant';
  store.ensureTenant(tenantId);
  for (const [providerSessionId, status] of [['ATVId-customer-ended', 'ended'], ['ATVId-timeout', 'missed']]) {
    const { session } = store.createInboundVoiceSession({
      tenantId, businessId: 'biz', providerSessionId, calledNumber: '+255700000001',
      eligibleAgents: [{ id: 'agent', email: 'agent@test.invalid' }],
    });
    store.updateInboundVoiceSession(tenantId, session.id, { status, endedAt: new Date().toISOString() });
    assert.equal(store.claimInboundVoiceSession(tenantId, session.id, 'agent').claimed, false);
  }
});

test.after(() => fs.rmSync(testDir, { recursive: true, force: true }));
