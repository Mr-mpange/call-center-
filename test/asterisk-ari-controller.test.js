const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterisk-ari-controller-'));
process.env.DASHBOARD_DB_FILE = path.join(testDir, 'dashboard.sqlite');
process.env.VOICE_BUSINESSES_FILE = path.join(testDir, 'legacy-businesses.json');
process.env.AUTH_SECRET = 'test-only-auth-secret-with-at-least-32-characters';
process.env.SIP_CREDENTIAL_SECRET = 'test-only-sip-secret-with-at-least-32-characters';
process.env.ASTERISK_TEST_DID_ALIASES = '5551001:+255700000101';
process.env.ASTERISK_LOCAL_TEST_CONTEXTS = 'from-test-sip';
process.env.ASTERISK_INBOUND_CONTEXTS = 'from-test-sip,from-at-trunk,from-sip';
process.env.API_AUTH_REQUIRED = 'true';

const dashboardStore = require('../src/utils/dashboardStore');
const voiceBusinessStore = require('../src/utils/voiceBusinessStore');
const voiceAgentRouting = require('../src/services/voiceAgentRouting');
const voiceRealtime = require('../src/services/voiceRealtime');
const { AsteriskAriController } = require('../src/services/asteriskAriController');

const onlineClients = [];
const fakeResponse = {
  writableEnded: false,
  write() { return true; },
};

class MockAri {
  constructor() {
    this.listeners = new Set();
    this.calls = [];
    this.bridges = new Map();
    this.channels = new Map();
    this.endpointOnline = true;
    this.started = false;
    this.onOriginate = null;
  }

  status() { return { configured: true, connected: true, app: 'call-center' }; }
  start() { this.started = true; }
  stop() { this.started = false; }
  onEvent(handler) { this.listeners.add(handler); return () => this.listeners.delete(handler); }

  async request(method, requestPath, data) {
    this.calls.push({ method, path: requestPath, data });
    const pathname = requestPath.split('?')[0];
    const query = new URLSearchParams(requestPath.split('?')[1] || '');
    if (pathname.startsWith('/ari/endpoints/')) {
      return { state: this.endpointOnline ? 'online' : 'offline' };
    }
    if (method === 'GET' && pathname.startsWith('/ari/bridges/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      if (!this.bridges.has(id)) throw Object.assign(new Error('Bridge not found'), { response: { status: 404, data: { message: 'Bridge not found' } } });
      return { id, channels: [...this.bridges.get(id)] };
    }
    if (method === 'POST' && pathname === '/ari/bridges') {
      this.bridges.set(data.bridgeId, new Set());
      return { id: data.bridgeId, channels: [] };
    }
    if (method === 'POST' && pathname.endsWith('/addChannel')) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const channel = query.get('channel');
      if (!this.bridges.has(id)) throw Object.assign(new Error('Bridge not found'), { response: { status: 404, data: {} } });
      this.bridges.get(id).add(channel);
      return {};
    }
    if (method === 'DELETE' && pathname.startsWith('/ari/bridges/')) {
      this.bridges.delete(decodeURIComponent(pathname.split('/').pop()));
      return {};
    }
    if (method === 'POST' && pathname === '/ari/channels') {
      this.channels.set(data.channelId, 'Up');
      const args = String(data.appArgs || '').split(',');
      setImmediate(() => {
        this.onOriginate?.({ args, channelId: data.channelId });
      });
      return { id: data.channelId, state: 'Down' };
    }
    if (method === 'GET' && pathname.startsWith('/ari/channels/')) {
      const id = decodeURIComponent(pathname.split('/').pop());
      return { id, state: this.channels.get(id) || 'Up' };
    }
    return {};
  }

  requests(method, fragment) {
    return this.calls.filter((call) => (!method || call.method === method) && call.path.includes(fragment));
  }
}

const TENANT = 'ari-tenant';
const BUSINESS = 'ari-business';
const DID = '+255700000101';
const CALLER = '+255700000102';
const AGENT_A = { id: 'agent-a', userId: 'user-a', email: 'agent-a@example.test', name: 'Agent A' };
const AGENT_B = { id: 'agent-b', userId: 'user-b', email: 'agent-b@example.test', name: 'Agent B' };

function seedTenant(tenantId = TENANT, businessId = BUSINESS, numbers = [DID], agents = [AGENT_A, AGENT_B]) {
  dashboardStore.ensureTenant(tenantId, `Tenant ${tenantId}`);
  // Retire any active calls left by an earlier test so the atomic claim check
  // does not treat the same agent as already busy.
  for (const business of dashboardStore.listVoiceBusinesses(tenantId)) {
    for (const session of dashboardStore.listInboundVoiceSessions(
      tenantId, [business.id], ['accepted', 'connecting', 'connected'],
    )) {
      dashboardStore.updateInboundVoiceSession(tenantId, session.id, {
        status: 'ended', endedAt: new Date().toISOString(),
      });
    }
  }
  for (const agent of agents) voiceRealtime.markBusy(tenantId, agent.email, false);
  const store = dashboardStore.read(tenantId);
  store.users = agents.map((agent) => ({
    id: agent.userId, name: agent.name, email: agent.email, role: 'Agent', status: 'active',
    tenantId,
  }));
  dashboardStore.write(store, tenantId);
  voiceBusinessStore.upsert(tenantId, {
    id: businessId, tenantId, name: `Business ${businessId}`, numbers, routing: 'parallel',
    agents: agents.map((agent) => ({
      id: agent.id, name: agent.name, type: 'web',
      clientName: voiceAgentRouting.clientNameFor(tenantId, agent.email),
    })),
  });
  for (const agent of agents) {
    const dispose = voiceRealtime.subscribe({
      tenantId,
      email: agent.email,
      userId: agent.userId,
      userName: agent.name,
      memberships: [businessId],
      response: fakeResponse,
    });
    onlineClients.push(dispose);
  }
}

function makeController(options = {}) {
  const ari = new MockAri();
  const dispatched = [];
  const cli = { showChannelStats: async () => ({ ok: false, reason: 'CLI disabled in unit test' }) };
  const identityStore = {
    identityForAgent: (_tenantId, agent) => ({ username: `sip-${agent.id}` }),
  };
  const controller = new AsteriskAriController({
    ariClient: ari,
    identityStore,
    cli,
    dispatchInboundOffer: (offer) => {
      dispatched.push(offer);
      return { offer, timeout: null };
    },
    ringTimeoutMs: 25_000,
    registrationWaitMs: 100,
    originateTimeoutMs: 2_000,
    mediaReadyTimeoutMs: 5_000,
    ...options,
  });
  return { controller, ari, dispatched, cli, identityStore };
}

function inboundEvent(channelId, overrides = {}) {
  return {
    type: 'StasisStart',
    timestamp: overrides.timestamp || `ts-${channelId}`,
    channel: {
      id: channelId,
      dialplan: { exten: '5551001', context: 'from-test-sip' },
      caller: { number: CALLER },
    },
    args: ['inbound', overrides.calledNumber || '5551001', CALLER, overrides.context || 'from-test-sip'],
  };
}

function claim(sessionId, agentId) {
  return dashboardStore.claimInboundVoiceSession(TENANT, sessionId, agentId);
}

async function ringCall(controller, channelId = 'caller-1') {
  const result = await controller.handleGatewayEvent(inboundEvent(channelId));
  assert.equal(result.handled, true);
  const session = dashboardStore.findInboundVoiceSessionByChannel(TENANT, channelId);
  assert.ok(session, 'expected an inbound session for the caller channel');
  return session;
}

test('trusted local DID alias rings every eligible browser agent', async () => {
  seedTenant();
  const { controller, ari, dispatched } = makeController();
  await controller.start();
  const session = await ringCall(controller, 'caller-ring');

  assert.equal(session.calledNumber, DID);
  assert.equal(session.status, 'ringing');
  assert.equal(session.eligibleAgents.length, 2);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].session.id, session.id);
  assert.equal(ari.requests('POST', '/answer').length, 1);
  assert.equal(ari.requests('POST', '/moh').length, 1);
  await controller.stop();
});

test('untrusted Stasis context is rejected and never becomes a call', async () => {
  seedTenant();
  const { controller, ari } = makeController();
  await controller.start();
  const result = await controller.handleGatewayEvent(inboundEvent('caller-untrusted', { context: 'from-webrtc' }));
  assert.equal(result.rejected, true);
  assert.equal(dashboardStore.findInboundVoiceSessionByChannel(TENANT, 'caller-untrusted'), null);
  assert.equal(ari.requests('DELETE', '/channels/caller-untrusted').length, 1);
  await controller.stop();
});

test('unknown DID is rejected instead of being routed to a tenant', async () => {
  seedTenant();
  const { controller, ari } = makeController();
  await controller.start();
  const result = await controller.handleGatewayEvent(
    inboundEvent('caller-unknown', { calledNumber: '5559999', context: 'from-at-trunk' }),
  );
  assert.equal(result.rejected, true);
  assert.match(result.reason, /Unknown DID/);
  assert.equal(ari.requests('DELETE', '/channels/caller-unknown').length, 1);
  await controller.stop();
});

test('duplicate StasisStart events are deduplicated', async () => {
  seedTenant();
  const { controller, dispatched } = makeController();
  await controller.start();
  const event = inboundEvent('caller-duplicate');
  const first = await controller.handleGatewayEvent(event);
  const second = await controller.handleGatewayEvent(event);
  assert.equal(first.handled, true);
  assert.equal(second.duplicate, true);
  assert.equal(dispatched.length, 1);
  await controller.stop();
});

test('first-answer-wins claim is atomic and second agent cannot claim', async () => {
  seedTenant();
  const { controller } = makeController();
  await controller.start();
  const session = await ringCall(controller, 'caller-claim');

  const first = claim(session.id, AGENT_A.id);
  const second = claim(session.id, AGENT_B.id);
  assert.equal(first.claimed, true);
  assert.equal(second.claimed, false);
  assert.equal(second.session.winningAgentId, AGENT_A.id);
  await controller.stop();
});

test('no available agents marks the call missed and hangs up the caller', async () => {
  seedTenant(TENANT, BUSINESS, [DID], []);
  const { controller, ari, dispatched } = makeController();
  try {
    await controller.start();
    const result = await controller.handleGatewayEvent(inboundEvent('caller-noagents'));
    assert.equal(result.handled, true);
    assert.match(result.reason, /No available browser agents/);
    assert.equal(dispatched.length, 0);
    const session = dashboardStore.findInboundVoiceSessionByChannel(TENANT, 'caller-noagents');
    assert.equal(session.status, 'missed');
    assert.equal(session.failureReason, 'No available browser agents');
    assert.equal(ari.requests('DELETE', '/channels/caller-noagents').length, 1);
    await controller.stop();
  } finally {
    seedTenant();
  }
});

test('winning agent is bridged, then media stays unverified until two-way RTP evidence', async () => {
  seedTenant();
  const { controller, ari } = makeController();
  ari.onOriginate = ({ args, channelId }) => controller.handleGatewayEvent({
    type: 'StasisStart',
    timestamp: `agent-${channelId}`,
    channel: { id: channelId, state: 'Up' },
    args,
  });
  await controller.start();
  const session = await ringCall(controller, 'caller-bridge');
  assert.equal(claim(session.id, AGENT_A.id).claimed, true);

  const connected = await controller.connectAgent(session.id, AGENT_A);
  assert.equal(connected.transportConnected, true);
  assert.equal(connected.mediaVerified, false);
  assert.equal(connected.awaitingMediaEvidence, true);
  assert.ok(connected.agentChannelId);
  assert.equal(ari.calls.filter((call) => call.method === 'POST' && call.path === '/ari/channels').length, 1);

  const transportSession = dashboardStore.getInboundVoiceSession(TENANT, session.id);
  assert.equal(transportSession.status, 'connecting');

  const oneWay = await controller.markMediaReady(TENANT, session.id, AGENT_A.id, {
    inboundBytes: 1200, outboundBytes: 0,
  });
  assert.equal(oneWay.verified, false);

  const verified = await controller.markMediaReady(TENANT, session.id, AGENT_A.id, {
    inboundBytes: 1200, outboundBytes: 900, inboundPackets: 12, outboundPackets: 9,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.session.status, 'connected');
  assert.ok(verified.session.mediaVerifiedAt);
  assert.equal(verified.media.transportEstablished, true);
  assert.equal(verified.media.audibleAudioVerified, false);
  await controller.stop();
});

test('a later gateway CLI probe never erases browser byte evidence', async () => {
  seedTenant();
  const { controller, ari } = makeController();
  ari.onOriginate = ({ args, channelId }) => controller.handleGatewayEvent({
    type: 'StasisStart',
    timestamp: `agent-${channelId}`,
    channel: { id: channelId, state: 'Up' },
    args,
  });
  await controller.start();
  const session = await ringCall(controller, 'caller-evidence-merge');
  assert.equal(claim(session.id, AGENT_A.id).claimed, true);

  const connected = await controller.connectAgent(session.id, AGENT_A);
  assert.equal(connected.awaitingMediaEvidence, true);

  const browser = await controller.markMediaReady(TENANT, session.id, AGENT_A.id, {
    inboundBytes: 1200, outboundBytes: 900, inboundPackets: 12, outboundPackets: 9,
  });
  assert.equal(browser.verified, true);

  // The CLI reports packet counters but no byte counts. Recording it after the
  // browser must not zero out the evidence the browser already proved, and the
  // gateway counters must be kept alongside it.
  const cli = await controller.markMediaReady(
    TENANT, session.id, AGENT_A.id,
    { bidirectional: true, rxPackets: 42, txPackets: 43 },
    'asterisk-cli',
  );
  assert.equal(cli.verified, true);
  assert.equal(cli.session.mediaEvidence.inboundBytes, 1200);
  assert.equal(cli.session.mediaEvidence.outboundBytes, 900);
  assert.equal(cli.session.mediaEvidence.rxPackets, 42);
  assert.equal(cli.session.mediaEvidence.txPackets, 43);
  assert.equal(cli.session.status, 'connected');
  await controller.stop();
});

test('an unregistered winning agent fails media setup without bridging or re-offering', async () => {
  seedTenant();
  const { controller, ari } = makeController();
  ari.endpointOnline = false;
  await controller.start();
  const session = await ringCall(controller, 'caller-offline');
  assert.equal(claim(session.id, AGENT_A.id).claimed, true);

  const result = await controller.connectAgent(session.id, AGENT_A);
  assert.equal(result.connected, false);
  assert.match(result.reason, /not registered/);
  assert.equal(ari.calls.filter((call) => call.method === 'POST' && call.path === '/ari/channels').length, 0);
  assert.equal(dashboardStore.getInboundVoiceSession(TENANT, session.id).winningAgentId, AGENT_A.id);
  await controller.stop();
});

test('media negotiation failure tears down the call without re-offering it', async () => {
  seedTenant();
  const { controller, ari, dispatched } = makeController();
  // The originate itself succeeds, but the browser leg never enters Stasis
  // (the agent never answers, or SDP/ICE negotiation never starts), so no
  // StasisStart agent event ever resolves the pending leg.
  await controller.start();
  const session = await ringCall(controller, 'caller-media-fail');
  assert.equal(claim(session.id, AGENT_A.id).claimed, true);

  // The originate timer inside waitForAgentLeg is unref()'d, so the test
  // process would otherwise exit while connectAgent is still awaiting the
  // agent-leg timeout. Hold the event loop open until it settles.
  const keepAlive = setInterval(() => {}, 50);
  let result;
  try {
    result = await controller.connectAgent(session.id, AGENT_A);
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(result.connected, false);
  assert.match(result.reason, /did not answer in time/);
  assert.match(result.recovery, /not re-offered/);

  // Exactly one originate attempt and one ring offer: a failed media attempt
  // must never silently re-dispatch the call to other agents.
  assert.equal(
    ari.calls.filter((call) => call.method === 'POST' && call.path === '/ari/channels').length,
    1,
  );
  assert.equal(dispatched.length, 1);

  // Cleanup hangs up the caller channel, the agent leg and the bridge, so no
  // gateway resources are left holding a dead call.
  const deletedChannels = ari.requests('DELETE', '/ari/channels/')
    .map((call) => decodeURIComponent(call.path.split('/').pop()));
  assert.ok(deletedChannels.includes(session.gatewayChannelId), `caller ${session.gatewayChannelId} not hung up: ${deletedChannels.join(',')}`);
  const originatePost = ari.calls.find((call) => call.method === 'POST' && call.path === '/ari/channels');
  const agentChannelId = originatePost?.data?.channelId;
  assert.ok(agentChannelId && deletedChannels.includes(agentChannelId), `agent ${agentChannelId} not hung up: ${deletedChannels.join(',')}`);
  assert.equal(ari.requests('DELETE', '/ari/bridges/').length >= 1, true, 'bridge destroyed');

  await controller.stop();
});

test('caller hangup during ringing finalizes the call as missed', async () => {
  seedTenant();
  const { controller } = makeController();
  await controller.start();
  const session = await ringCall(controller, 'caller-hangup-ring');
  await controller.handleGatewayEvent({
    type: 'ChannelDestroyed',
    timestamp: 'destroy-ring',
    channel: { id: session.gatewayChannelId },
  });
  const updated = dashboardStore.getInboundVoiceSession(TENANT, session.id);
  assert.equal(updated.status, 'missed');
  assert.equal(updated.failureReason, 'Caller hung up before an agent answered');
  await controller.stop();
});

test('agent hangup after connection finalizes the call as ended', async () => {
  seedTenant();
  const { controller, ari } = makeController();
  ari.onOriginate = ({ args, channelId }) => controller.handleGatewayEvent({
    type: 'StasisStart',
    timestamp: `agent-hangup-${channelId}`,
    channel: { id: channelId, state: 'Up' },
    args,
  });
  await controller.start();
  const session = await ringCall(controller, 'caller-agent-hangup');
  assert.equal(claim(session.id, AGENT_A.id).claimed, true);
  const connected = await controller.connectAgent(session.id, AGENT_A);
  await controller.markMediaReady(TENANT, session.id, AGENT_A.id, { inboundBytes: 500, outboundBytes: 500 });

  await controller.handleGatewayEvent({
    type: 'ChannelDestroyed',
    timestamp: 'destroy-agent',
    channel: { id: connected.agentChannelId },
  });
  const updated = dashboardStore.getInboundVoiceSession(TENANT, session.id);
  assert.equal(updated.status, 'ended');
  assert.equal(updated.failureReason, 'Browser agent hung up');
  await controller.stop();
});

test('concurrent calls in separate tenants remain isolated', async () => {
  seedTenant('tenant-one', 'business-one', ['+255711000001'], [AGENT_A]);
  seedTenant('tenant-two', 'business-two', ['+255722000002'], [AGENT_B]);
  const { controller } = makeController();
  await controller.start();
  await controller.handleGatewayEvent(inboundEvent('caller-one', { calledNumber: '+255711000001', context: 'from-at-trunk' }));
  await controller.handleGatewayEvent(inboundEvent('caller-two', { calledNumber: '+255722000002', context: 'from-at-trunk' }));
  const one = dashboardStore.findInboundVoiceSessionByChannel('tenant-one', 'caller-one');
  const two = dashboardStore.findInboundVoiceSessionByChannel('tenant-two', 'caller-two');
  assert.equal(one.tenantId, 'tenant-one');
  assert.equal(two.tenantId, 'tenant-two');
  assert.notEqual(one.id, two.id);
  await controller.stop();
});

test.after(() => {
  for (const dispose of onlineClients.splice(0)) {
    try { dispose(); } catch { /* already disposed */ }
  }
  fs.rmSync(testDir, { recursive: true, force: true });
});
