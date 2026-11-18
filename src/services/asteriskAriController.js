const crypto = require('crypto');
const dashboardStore = require('../utils/dashboardStore');
const voiceBusinessStore = require('../utils/voiceBusinessStore');
const voiceAgentRouting = require('./voiceAgentRouting');
const voiceRealtime = require('./voiceRealtime');
const parallelRingDispatcher = require('./parallelRingDispatcher');
const sipIdentityStore = require('./sipIdentityStore');
const asteriskCli = require('./asteriskCli');
const { AriClient } = require('./ariClient');

const TERMINAL_STATUSES = new Set(['ended', 'failed', 'missed']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(value, length = 24) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function normalizeDid(value) {
  return String(value || '').trim().replace(/[^\d+]/g, '');
}

function envList(name, fallback) {
  return String(process.env[name] || fallback).split(',').map((item) => item.trim()).filter(Boolean);
}

function parseAliases() {
  const raw = String(process.env.ASTERISK_TEST_DID_ALIASES || '').trim();
  if (!raw) return {};
  const aliases = {};
  for (const entry of raw.split(/[;,]/)) {
    const [from, to] = entry.split(':').map((item) => item && item.trim());
    if (from && to) aliases[normalizeDid(from)] = normalizeDid(to);
  }
  return aliases;
}

function requestError(error) {
  return {
    status: error.response?.status || null,
    reason: error.response?.data?.message || error.response?.data?.error || error.message,
  };
}

class AsteriskAriController {
  constructor(options = {}) {
    this.appName = options.appName || process.env.ASTERISK_ARI_APP || 'call-center';
    this.ari = options.ariClient || new AriClient({ app: this.appName });
    this.dispatchInboundOffer = options.dispatchInboundOffer || parallelRingDispatcher.dispatchInboundOffer;
    this.identityStore = options.identityStore || sipIdentityStore;
    this.cli = options.cli || asteriskCli;
    this.ringTimeoutMs = Number(options.ringTimeoutMs || process.env.INBOUND_BROWSER_RING_TIMEOUT_MS || 25_000);
    this.registrationWaitMs = Number(options.registrationWaitMs || process.env.ASTERISK_AGENT_REGISTRATION_WAIT_MS || 6_000);
    this.originateTimeoutMs = Number(options.originateTimeoutMs || process.env.ASTERISK_AGENT_ORIGINATE_TIMEOUT_MS || 15_000);
    this.mediaReadyTimeoutMs = Number(options.mediaReadyTimeoutMs || process.env.ASTERISK_MEDIA_READY_TIMEOUT_MS || 20_000);
    this.dedupeWindowMs = Number(options.dedupeWindowMs || process.env.ASTERISK_CALL_DEDUPE_WINDOW_MS || 30_000);
    this.sessionTenants = new Map();
    this.inboundChannels = new Map();
    this.pendingAgentLegs = new Map();
    this.timers = new Map();
    this.seenEvents = new Map();
    this.started = false;
    this.unsubscribe = null;
    this.eventCount = 0;
    this.lastEventAt = null;
    this.startedAt = null;
  }

  async start() {
    if (this.started) return this.status();
    this.started = true;
    this.startedAt = new Date().toISOString();
    this.unsubscribe = this.ari.onEvent((event) => this.handleGatewayEvent(event));
    this.ari.start();
    return this.status();
  }

  async stop() {
    this.started = false;
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const pending of this.pendingAgentLegs.values()) {
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, reason: 'ARI controller stopped' });
    }
    this.pendingAgentLegs.clear();
    this.ari.stop();
    return { stopped: true };
  }

  status() {
    return {
      started: this.started,
      startedAt: this.startedAt,
      app: this.appName,
      eventCount: this.eventCount,
      lastEventAt: this.lastEventAt,
      activeSessions: this.inboundChannels.size,
      ari: this.ari.status ? this.ari.status() : { connected: false },
    };
  }

  tenantForSession(sessionId) {
    const cached = this.sessionTenants.get(String(sessionId));
    if (cached) return cached;
    const session = dashboardStore.findInboundVoiceSessionAnyTenant(sessionId);
    if (session?.tenantId) {
      this.sessionTenants.set(String(sessionId), session.tenantId);
      return session.tenantId;
    }
    return null;
  }

  rememberEvent(key) {
    if (!key) return true;
    const now = Date.now();
    if (this.seenEvents.size > 2_000) {
      for (const [item, at] of this.seenEvents) if (now - at > 120_000) this.seenEvents.delete(item);
    }
    if (this.seenEvents.has(key)) return false;
    this.seenEvents.set(key, now);
    return true;
  }

  eventKey(event) {
    const channelId = event.channel?.id || '';
    const bridgeId = event.bridge?.id || '';
    return [
      event.type,
      channelId,
      bridgeId,
      event.channel?.state || '',
      event.timestamp || event.asterisk_id || '',
      Array.isArray(event.args) ? event.args.join(',') : '',
    ].join('|');
  }

  async handleGatewayEvent(event = {}) {
    if (!event || typeof event !== 'object' || !event.type) return { handled: false };
    this.eventCount += 1;
    this.lastEventAt = new Date().toISOString();
    if (!this.rememberEvent(this.eventKey(event))) return { handled: true, duplicate: true };
    try {
      let outcome;
      switch (event.type) {
        case 'StasisStart':
          outcome = await this.onStasisStart(event);
          break;
        case 'ChannelDestroyed':
          outcome = await this.onChannelDestroyed(event);
          break;
        case 'BridgeDestroyed':
          outcome = await this.onBridgeDestroyed(event);
          break;
        case 'ChannelStateChange':
          if (event.channel?.state === 'Up') outcome = await this.onChannelUp(event);
          break;
        default:
          break;
      }
      return outcome || { handled: true };
    } catch (error) {
      console.error(`[ARI] failed to process ${event.type}:`, error.message);
      return { handled: false, error: error.message };
    }
  }

  trustedInboundContext(context) {
    const allowed = envList('ASTERISK_INBOUND_CONTEXTS', 'from-test-sip,from-at-trunk,from-sip');
    return Boolean(context && allowed.includes(String(context)));
  }

  resolveBusiness(calledNumber, context) {
    const normalized = normalizeDid(calledNumber);
    if (!normalized) return null;
    const direct = voiceBusinessStore.readByNumber(normalized);
    if (direct) return { business: direct, resolvedNumber: normalized, alias: false };
    const localTestContexts = envList('ASTERISK_LOCAL_TEST_CONTEXTS', 'from-test-sip');
    if (localTestContexts.includes(String(context))) {
      const aliases = parseAliases();
      const target = aliases[normalized];
      if (target) {
        const business = voiceBusinessStore.readByNumber(target);
        if (business) return { business, resolvedNumber: target, alias: true };
      }
    }
    return null;
  }

  async ariRequest(method, path, data) {
    try {
      return { ok: true, data: await this.ari.request(method, path, data) };
    } catch (error) {
      return { ok: false, ...requestError(error) };
    }
  }

  async answerChannel(channelId) {
    if (!channelId) return { ok: false, reason: 'Missing channel id' };
    return this.ariRequest('POST', `/ari/channels/${encodeURIComponent(channelId)}/answer`);
  }

  async startMoh(channelId) {
    if (!channelId) return { ok: false, reason: 'Missing channel id' };
    return this.ariRequest('POST', `/ari/channels/${encodeURIComponent(channelId)}/moh`, {
      mohClass: process.env.ASTERISK_HOLD_MOH_CLASS || 'default',
    });
  }

  async hangupChannel(channelId, reason = 'normal') {
    if (!channelId) return { ok: false, reason: 'Missing channel id' };
    return this.ariRequest('DELETE', `/ari/channels/${encodeURIComponent(channelId)}`);
  }

  async onStasisStart(event) {
    const args = Array.isArray(event.args) ? event.args : [];
    const kind = args[0];
    if (kind === 'inbound') return this.onInboundChannel(event, args);
    if (kind === 'agent') return this.onAgentLeg(event, args);
    // A channel that reaches the Stasis app without a known role must not be
    // given call-center capabilities.
    console.warn('[ARI] rejecting Stasis channel with unknown arguments', { args, channel: event.channel?.id });
    await this.hangupChannel(event.channel?.id, 'unknown-role');
    return { handled: true, rejected: true };
  }

  async onInboundChannel(event, args) {
    const channel = event.channel || {};
    const channelId = channel.id;
    const calledNumber = normalizeDid(args[1] || channel.dialplan?.exten);
    const callerNumber = normalizeDid(args[2] || channel.caller?.number);
    const context = args[3] || channel.dialplan?.context || '';
    if (!this.trustedInboundContext(context)) {
      console.warn('[ARI] rejecting inbound channel from untrusted context', { channelId, context });
      await this.hangupChannel(channelId, 'untrusted-context');
      return { handled: true, rejected: true, reason: 'Untrusted routing context' };
    }

    const resolution = this.resolveBusiness(calledNumber, context);
    if (!resolution) {
      console.warn('[ARI] no tenant DID route for inbound channel', { channelId, calledNumber, context });
      await this.hangupChannel(channelId, 'unknown-did');
      return { handled: true, rejected: true, reason: 'Unknown DID' };
    }

    const { business } = resolution;
    const tenantId = business.tenantId;
    this.sessionTenants.set(`ari:${channelId}`, tenantId);
    this.sessionTenants.set(`ari-${channelId}`, tenantId);

    const existingByChannel = dashboardStore.findInboundVoiceSessionByChannel(tenantId, channelId);
    if (existingByChannel) {
      await this.answerChannel(channelId);
      return { handled: true, duplicate: true, session: existingByChannel };
    }

    const tenantStore = dashboardStore.read(tenantId);
    const eligibleAgents = voiceAgentRouting.eligibleAgents(
      business, tenantId, tenantStore.users || [], tenantStore.agents || [],
    );

    if (!eligibleAgents.length) {
      const { session } = dashboardStore.createInboundVoiceSession({
        id: `ari-${channelId}`,
        tenantId,
        businessId: business.id,
        providerSessionId: `ari:${channelId}`,
        calledNumber: resolution.resolvedNumber,
        callerNumber,
        eligibleAgents: [],
      });
      const missed = dashboardStore.updateInboundVoiceSession(tenantId, session.id, {
        status: 'missed',
        endedAt: new Date().toISOString(),
        failureReason: 'No available browser agents',
      });
      dashboardStore.attachInboundVoiceGateway(tenantId, session.id, {
        gateway: 'asterisk', gatewayChannelId: channelId, mediaState: 'no-agents',
      });
      voiceRealtime.publish(tenantId, business.id, {
        type: 'call_ended', callId: session.id, status: 'missed', reason: 'No available browser agents',
      });
      await this.hangupChannel(channelId, 'no-agents');
      return { handled: true, session: missed, reason: 'No available browser agents' };
    }

    // Reuse a session created moments earlier by the provider webhook for the
    // same trusted DID/caller instead of creating a duplicate call.
    const recent = dashboardStore.findRecentInboundVoiceSession(
      tenantId, business.id, resolution.resolvedNumber, callerNumber, this.dedupeWindowMs,
    );
    let session;
    let created = false;
    if (recent) {
      session = dashboardStore.attachInboundVoiceGateway(tenantId, recent.id, {
        gateway: 'asterisk', gatewayChannelId: channelId, mediaState: 'waiting',
      });
    } else {
      const result = dashboardStore.createInboundVoiceSession({
        id: `ari-${channelId}`,
        tenantId,
        businessId: business.id,
        providerSessionId: `ari:${channelId}`,
        calledNumber: resolution.resolvedNumber,
        callerNumber,
        eligibleAgents,
      });
      session = result.session;
      created = result.created;
      dashboardStore.attachInboundVoiceGateway(tenantId, session.id, {
        gateway: 'asterisk', gatewayChannelId: channelId, mediaState: 'waiting',
      });
    }

    if (!session) {
      await this.hangupChannel(channelId, 'session-error');
      return { handled: false, reason: 'Could not create inbound session' };
    }
    this.sessionTenants.set(session.id, tenantId);
    this.inboundChannels.set(channelId, { tenantId, businessId: business.id, sessionId: session.id });
    this.answerChannel(channelId).catch(() => undefined);
    this.startMoh(channelId).catch(() => undefined);

    if (created) {
      const dispatched = this.dispatchInboundOffer({
        business,
        session: dashboardStore.getInboundVoiceSession(tenantId, session.id),
        eligibleAgents,
        timeoutMs: this.ringTimeoutMs,
        onTimeout: () => this.onRingTimeout(tenantId, session.id),
      });
      this.setTimer(`ring:${session.id}`, dispatched.timeout);
    }

    console.log('[ARI] inbound call routed', {
      channelId,
      tenantId,
      businessId: business.id,
      calledNumber: resolution.resolvedNumber,
      callerNumber,
      alias: resolution.alias,
      eligibleAgentCount: eligibleAgents.length,
      sessionId: session.id,
    });
    return { handled: true, created, session: dashboardStore.getInboundVoiceSession(tenantId, session.id) };
  }

  setTimer(key, timer) {
    if (!timer) return;
    this.timers.set(key, timer);
    timer.unref?.();
  }

  clearTimer(key) {
    const timer = this.timers.get(key);
    if (timer) clearTimeout(timer);
    this.timers.delete(key);
  }

  onRingTimeout(tenantId, sessionId) {
    const current = dashboardStore.getInboundVoiceSession(tenantId, sessionId);
    if (!current) return Promise.resolve(null);
    if (TERMINAL_STATUSES.has(current.status)) {
      // parallelRingDispatcher already persisted the missed state. Still tear
      // down the caller channel and any bridge so the gateway does not leak a
      // ringing channel after the offer expires.
      this.clearTimer(`ring:${current.id}`);
      return this.cleanupMedia(current).then(() => {
        this.inboundChannels.delete(current.gatewayChannelId);
        this.sessionTenants.delete(String(current.id));
        return current;
      });
    }
    return this.finalizeSession(sessionId, 'missed', 'No agent answered before the ring timeout', { tenantId });
  }

  async onAgentLeg(event, args) {
    const channel = event.channel || {};
    const channelId = channel.id;
    const sessionId = args[1];
    const agentId = args[2];
    const tenantId = args[3];
    const session = dashboardStore.getInboundVoiceSession(tenantId, sessionId);
    if (!session || String(session.winningAgentId) !== String(agentId) || TERMINAL_STATUSES.has(session.status)) {
      console.warn('[ARI] rejecting unauthorized agent leg', { channelId, sessionId, agentId });
      await this.hangupChannel(channelId, 'unauthorized-agent');
      return { handled: true, rejected: true };
    }
    this.sessionTenants.set(sessionId, tenantId);
    const bridgeId = session.gatewayBridgeId || this.bridgeIdFor(sessionId);
    const bridge = await this.ensureBridge(bridgeId, sessionId);
    if (!bridge.ok) {
      await this.hangupChannel(channelId, 'bridge-error');
      this.resolveAgentLeg(sessionId, { ok: false, reason: bridge.reason });
      return { handled: false, reason: bridge.reason };
    }
    const added = await this.addChannelToBridge(bridgeId, channelId);
    if (!added.ok) {
      await this.hangupChannel(channelId, 'bridge-add-error');
      this.resolveAgentLeg(sessionId, { ok: false, reason: added.reason });
      return { handled: false, reason: added.reason };
    }
    await this.answerChannel(channelId);
    const updated = dashboardStore.attachInboundVoiceGateway(tenantId, sessionId, {
      gatewayBridgeId: bridgeId,
      gatewayAgentChannelId: channelId,
      mediaState: 'bridged',
    });
    if (updated && !TERMINAL_STATUSES.has(updated.status)) {
      dashboardStore.updateInboundVoiceSession(tenantId, sessionId, {
        status: updated.status === 'connected' ? 'connected' : 'connecting',
      });
    }
    this.resolveAgentLeg(sessionId, { ok: true, channelId, bridgeId });
    return { handled: true, channelId, bridgeId };
  }

  bridgeIdFor(sessionId) {
    return `mpange-bridge-${hash(sessionId, 24)}`;
  }

  agentChannelIdFor(sessionId, agentId) {
    return `mpange-agent-${hash(`${sessionId}:${agentId}`, 24)}`;
  }

  async ensureBridge(bridgeId, sessionId) {
    const existing = await this.ariRequest('GET', `/ari/bridges/${encodeURIComponent(bridgeId)}`);
    if (existing.ok) return { ok: true, bridge: existing.data };
    const created = await this.ariRequest('POST', '/ari/bridges', {
      bridgeId,
      type: 'mixing',
      name: `MPANGE ${sessionId}`.slice(0, 100),
    });
    if (created.ok) return { ok: true, bridge: created.data };
    if (created.status === 409) {
      const retry = await this.ariRequest('GET', `/ari/bridges/${encodeURIComponent(bridgeId)}`);
      if (retry.ok) return { ok: true, bridge: retry.data };
    }
    return { ok: false, reason: created.reason || 'Could not create media bridge' };
  }

  async addChannelToBridge(bridgeId, channelId) {
    const added = await this.ariRequest(
      'POST',
      `/ari/bridges/${encodeURIComponent(bridgeId)}/addChannel?channel=${encodeURIComponent(channelId)}`,
    );
    if (added.ok) return added;
    // A retried event can find the channel already in the bridge.
    const bridge = await this.ariRequest('GET', `/ari/bridges/${encodeURIComponent(bridgeId)}`);
    if (bridge.ok && Array.isArray(bridge.data?.channels) && bridge.data.channels.includes(channelId)) {
      return { ok: true, alreadyJoined: true };
    }
    return added;
  }

  resolveAgentLeg(sessionId, result) {
    const pending = this.pendingAgentLegs.get(String(sessionId));
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingAgentLegs.delete(String(sessionId));
    pending.resolve(result);
  }

  waitForAgentLeg(sessionId, timeoutMs) {
    const key = String(sessionId);
    if (this.pendingAgentLegs.has(key)) this.resolveAgentLeg(key, { ok: false, reason: 'Superseded by a new media attempt' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingAgentLegs.delete(key);
        resolve({ ok: false, reason: 'The browser agent SIP channel did not answer in time' });
      }, Math.max(1, timeoutMs));
      timer.unref?.();
      this.pendingAgentLegs.set(key, { resolve, timer });
    });
  }

  async endpointState(username) {
    const result = await this.ariRequest('GET', `/ari/endpoints/PJSIP/${encodeURIComponent(username)}`);
    if (!result.ok) return { online: false, state: 'unknown', reason: result.reason };
    return { online: String(result.data?.state || '').toLowerCase() === 'online', state: result.data?.state || 'unknown' };
  }

  async waitForEndpointOnline(username, timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let last = { online: false, state: 'unknown' };
    while (Date.now() <= deadline) {
      last = await this.endpointState(username);
      if (last.online) return last;
      if (Date.now() >= deadline) break;
      await sleep(250);
    }
    return last;
  }

  async connectAgent(sessionId, agent = {}) {
    const tenantId = this.tenantForSession(sessionId);
    if (!tenantId) return { connected: false, reason: 'Inbound session tenant could not be resolved' };
    const session = dashboardStore.getInboundVoiceSession(tenantId, sessionId);
    if (!session) return { connected: false, reason: 'Inbound call session not found' };
    if (String(session.winningAgentId) !== String(agent.id)) {
      return { connected: false, reason: 'Agent is not the authorized winner for this call' };
    }
    if (session.status === 'connected' && session.mediaVerifiedAt) {
      return {
        connected: true, transportConnected: true, mediaVerified: true, idempotent: true,
        bridgeId: session.gatewayBridgeId, callerChannelId: session.gatewayChannelId,
        agentChannelId: session.gatewayAgentChannelId,
      };
    }
    if (!['accepted', 'connecting'].includes(session.status)) {
      return { connected: false, reason: `Call is not awaiting media (status: ${session.status})` };
    }

    const identity = this.identityStore.identityForAgent(tenantId, agent);
    if (!identity) {
      return { connected: false, reason: 'The winning agent has not provisioned a browser SIP identity' };
    }
    const registration = await this.waitForEndpointOnline(identity.username, this.registrationWaitMs);
    if (!registration.online) {
      return {
        connected: false,
        reason: 'The winning agent SIP endpoint is not registered over WSS',
        endpointState: registration.state,
        recovery: 'Call marked failed; the call is not re-offered to another agent.',
      };
    }

    const bridgeId = session.gatewayBridgeId || this.bridgeIdFor(sessionId);
    const bridge = await this.ensureBridge(bridgeId, sessionId);
    if (!bridge.ok) return { connected: false, reason: bridge.reason };
    dashboardStore.attachInboundVoiceGateway(tenantId, sessionId, {
      gateway: 'asterisk', gatewayBridgeId: bridgeId, gatewayAgentUsername: identity.username,
    });

    const callerChannelId = session.gatewayChannelId;
    if (!callerChannelId) return { connected: false, reason: 'Inbound caller channel is missing' };
    const callerAdded = await this.addChannelToBridge(bridgeId, callerChannelId);
    if (!callerAdded.ok) return { connected: false, reason: callerAdded.reason || 'Could not add caller to media bridge' };

    const channelId = session.gatewayAgentChannelId || this.agentChannelIdFor(sessionId, agent.id);
    const leg = this.waitForAgentLeg(sessionId, this.originateTimeoutMs);
    const originate = await this.ariRequest('POST', '/ari/channels', {
      channelId,
      endpoint: `PJSIP/${identity.username}`,
      app: this.appName,
      appArgs: `agent,${sessionId},${agent.id},${tenantId}`,
      callerId: session.callerNumber || 'Caller',
      timeout: Math.max(1, Math.ceil(this.originateTimeoutMs / 1000)),
      variables: {
        'PJSIP_HEADER(add,X-Mpange-Call-Id)': sessionId,
        'PJSIP_HEADER(add,X-Mpange-Business-Id)': session.businessId,
        'PJSIP_HEADER(add,X-Mpange-Tenant-Id)': tenantId,
      },
    });
    if (!originate.ok && originate.status !== 409) {
      this.resolveAgentLeg(sessionId, { ok: false, reason: originate.reason });
      return {
        connected: false,
        reason: originate.reason || 'Asterisk could not originate the browser agent channel',
        recovery: 'Call marked failed; the call is not re-offered to another agent.',
      };
    }
    const agentLeg = await leg;
    if (!agentLeg.ok) {
      await this.cleanupMedia({ ...session, gatewayBridgeId: bridgeId, gatewayAgentChannelId: channelId });
      return {
        connected: false,
        reason: agentLeg.reason || 'Browser agent media channel did not connect',
        recovery: 'Call marked failed; the call is not re-offered to another agent.',
      };
    }

    const joined = await this.waitForBridgeJoin(bridgeId, callerChannelId, agentLeg.channelId, 6_000);
    if (!joined.ok) {
      await this.cleanupMedia({ ...session, gatewayBridgeId: bridgeId, gatewayAgentChannelId: agentLeg.channelId });
      return { connected: false, reason: joined.reason || 'Caller and agent channels did not join the bridge' };
    }

    dashboardStore.attachInboundVoiceGateway(tenantId, sessionId, {
      gatewayBridgeId: bridgeId,
      gatewayAgentChannelId: agentLeg.channelId,
      gatewayAgentUsername: identity.username,
      mediaState: 'transport',
    });
    const current = dashboardStore.getInboundVoiceSession(tenantId, sessionId);
    if (current && !TERMINAL_STATUSES.has(current.status) && current.status !== 'connected') {
      dashboardStore.updateInboundVoiceSession(tenantId, sessionId, { status: 'connecting' });
    }
    this.scheduleMediaTimeout(tenantId, sessionId);

    const cliEvidence = await this.probeCliMedia(agentLeg.channelId, identity.username, {
      retries: 5,
      intervalMs: 400,
    });
    // One line per probe outcome: with no RTP at all this is the difference
    // between "channel missing", "leg idle" and "packets one way only".
    console.log('[ARI] agent media probe', {
      sessionId,
      channel: agentLeg.channelId,
      username: identity.username,
      cliEvidence,
    });
    if (cliEvidence?.bidirectional) {
      const verified = await this.markMediaReady(tenantId, sessionId, agent.id, cliEvidence, 'asterisk-cli');
      return {
        connected: Boolean(verified.verified),
        transportConnected: true,
        mediaVerified: Boolean(verified.verified),
        bridgeId,
        callerChannelId,
        agentChannelId: agentLeg.channelId,
        agentUsername: identity.username,
        mediaState: verified.verified ? 'verified' : 'transport',
        evidence: cliEvidence,
      };
    }

    return {
      connected: false,
      transportConnected: true,
      mediaVerified: false,
      awaitingMediaEvidence: true,
      bridgeId,
      callerChannelId,
      agentChannelId: agentLeg.channelId,
      agentUsername: identity.username,
      mediaState: 'transport',
    };
  }

  async waitForBridgeJoin(bridgeId, callerChannelId, agentChannelId, timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let last = { ok: false, reason: 'Bridge join was not confirmed' };
    while (Date.now() <= deadline) {
      const bridge = await this.ariRequest('GET', `/ari/bridges/${encodeURIComponent(bridgeId)}`);
      if (bridge.ok) {
        const channels = Array.isArray(bridge.data?.channels) ? bridge.data.channels : [];
        if (channels.includes(callerChannelId) && channels.includes(agentChannelId)) {
          const caller = await this.ariRequest('GET', `/ari/channels/${encodeURIComponent(callerChannelId)}`);
          const agent = await this.ariRequest('GET', `/ari/channels/${encodeURIComponent(agentChannelId)}`);
          if (caller.ok && agent.ok && caller.data?.state === 'Up' && agent.data?.state === 'Up') {
            return { ok: true, bridge: bridge.data, caller, agent };
          }
          last = { ok: false, reason: 'Both channels are bridged but not in the Up state' };
        } else {
          last = { ok: false, reason: 'Caller and agent channels are not both in the bridge' };
        }
      } else {
        last = { ok: false, reason: bridge.reason };
      }
      if (Date.now() >= deadline) break;
      await sleep(200);
    }
    return last;
  }

  scheduleMediaTimeout(tenantId, sessionId) {
    const key = `media:${sessionId}`;
    this.clearTimer(key);
    const timer = setTimeout(() => {
      const current = dashboardStore.getInboundVoiceSession(tenantId, sessionId);
      if (!current || current.status !== 'connecting') return;
      console.warn('[ARI] media readiness timeout', { sessionId, tenantId });
      this.finalizeSession(sessionId, 'failed', 'Two-way media was not confirmed in time', { tenantId });
    }, Math.max(5_000, this.mediaReadyTimeoutMs));
    timer.unref?.();
    this.timers.set(key, timer);
  }

  async probeCliMedia(agentChannelId, agentUsername, { retries = 0, intervalMs = 400 } = {}) {
    const needle = String(agentChannelId || '');
    const username = String(agentUsername || '');
    const attempt = async () => {
      const stats = await this.cli.showChannelStats();
      if (!stats.ok) return null;
      const channel = asteriskCli.findChannelRow(stats.channels, { channelId: needle, username });
      if (!channel) return null;
      return {
        source: 'asterisk-cli',
        inboundBytes: null,
        outboundBytes: null,
        rxPackets: channel.rxPackets,
        txPackets: channel.txPackets,
        codec: channel.codec || null,
        capturedAt: new Date().toISOString(),
      };
    };

    let evidence = await attempt();
    // RTP counters start at zero the moment the channels join the bridge, so a
    // probe taken at that instant sees an idle leg. Poll briefly until the
    // gateway reports packets in both directions; never invent a result when
    // the counters stay empty.
    for (let i = 0; i < Math.max(0, retries) && !(evidence && evidence.rxPackets > 0 && evidence.txPackets > 0); i += 1) {
      await sleep(intervalMs);
      evidence = await attempt();
    }
    if (!evidence) return null;
    return { ...evidence, bidirectional: evidence.rxPackets > 0 && evidence.txPackets > 0 };
  }

  async markMediaReady(tenantId, sessionId, agentId, evidence = {}, source = 'browser-webrtc') {
    const session = dashboardStore.getInboundVoiceSession(tenantId, sessionId);
    if (!session) return { verified: false, reason: 'Inbound call session not found' };
    if (agentId && String(session.winningAgentId) !== String(agentId)) {
      return { verified: false, reason: 'Only the winning agent can confirm this media session' };
    }
    if (TERMINAL_STATUSES.has(session.status)) {
      return { verified: false, reason: `Call is already ${session.status}` };
    }
    const bridgeId = session.gatewayBridgeId;
    const callerChannelId = session.gatewayChannelId;
    const agentChannelId = session.gatewayAgentChannelId;
    if (!bridgeId || !callerChannelId || !agentChannelId) {
      return { verified: false, reason: 'Gateway media resources have not been assigned yet' };
    }
    const joined = await this.waitForBridgeJoin(bridgeId, callerChannelId, agentChannelId, 5_000);
    if (!joined.ok) return { verified: false, reason: joined.reason };

    // Evidence from both observers is kept. A gateway CLI probe and the
    // browser's WebRTC report can land in either order, and neither may erase
    // byte counts the other one already proved.
    const previous = session.mediaEvidence || {};
    const inboundBytes = Number(evidence.inboundBytes || previous.inboundBytes || 0);
    const outboundBytes = Number(evidence.outboundBytes || previous.outboundBytes || 0);
    const cliBidirectional = evidence.bidirectional === true;
    if (!cliBidirectional && (inboundBytes <= 0 || outboundBytes <= 0)) {
      return {
        verified: false,
        reason: 'Both inbound and outbound RTP evidence are required before marking the call connected',
        inboundBytes,
        outboundBytes,
      };
    }

    const normalizedEvidence = {
      ...previous,
      source,
      inboundBytes,
      outboundBytes,
      inboundPackets: Number(evidence.inboundPackets || previous.inboundPackets || 0),
      outboundPackets: Number(evidence.outboundPackets || previous.outboundPackets || 0),
      rxPackets: Number(evidence.rxPackets || previous.rxPackets || 0),
      txPackets: Number(evidence.txPackets || previous.txPackets || 0),
      connectionState: evidence.connectionState || previous.connectionState || null,
      audioLevel: evidence.audioLevel === undefined
        ? (previous.audioLevel ?? null)
        : Number(evidence.audioLevel),
      capturedAt: new Date().toISOString(),
      transportEstablished: true,
      audibleAudioVerified: false,
    };
    const updated = dashboardStore.recordInboundMediaEvidence(tenantId, sessionId, normalizedEvidence, true);
    this.clearTimer(`media:${sessionId}`);
    voiceRealtime.publish(tenantId, session.businessId, {
      type: 'call_connected',
      callId: sessionId,
      media: normalizedEvidence,
      agent: { id: session.winningAgentId },
    });
    console.log('[ARI] media verified', {
      sessionId, tenantId, source, inboundBytes, outboundBytes,
      rxPackets: normalizedEvidence.rxPackets, txPackets: normalizedEvidence.txPackets,
    });
    return { verified: true, session: updated, media: normalizedEvidence };
  }

  async getSessionDetails(sessionId, { probe = false } = {}) {
    const tenantId = this.tenantForSession(sessionId);
    const session = tenantId
      ? dashboardStore.getInboundVoiceSession(tenantId, sessionId)
      : dashboardStore.findInboundVoiceSessionAnyTenant(sessionId);
    if (!session) return null;
    const result = {
      id: session.id,
      tenantId: session.tenantId,
      businessId: session.businessId,
      status: session.status,
      gateway: session.gateway,
      bridgeId: session.gatewayBridgeId,
      callerChannelId: session.gatewayChannelId,
      agentChannelId: session.gatewayAgentChannelId,
      agentUsername: session.gatewayAgentUsername,
      mediaState: session.mediaState,
      mediaVerifiedAt: session.mediaVerifiedAt,
      mediaEvidence: session.mediaEvidence,
      transportConnected: false,
      mediaVerified: Boolean(session.mediaVerifiedAt) && session.status === 'connected',
      callerChannelState: null,
      agentChannelState: null,
      bridgeChannels: [],
    };
    if (session.gatewayBridgeId) {
      const bridge = await this.ariRequest('GET', `/ari/bridges/${encodeURIComponent(session.gatewayBridgeId)}`);
      if (bridge.ok) {
        result.bridgeChannels = Array.isArray(bridge.data?.channels) ? bridge.data.channels : [];
        result.transportConnected = result.bridgeChannels.includes(session.gatewayChannelId)
          && result.bridgeChannels.includes(session.gatewayAgentChannelId);
      }
    }
    if (session.gatewayChannelId) {
      const caller = await this.ariRequest('GET', `/ari/channels/${encodeURIComponent(session.gatewayChannelId)}`);
      result.callerChannelState = caller.ok ? caller.data?.state : null;
    }
    if (session.gatewayAgentChannelId) {
      const agent = await this.ariRequest('GET', `/ari/channels/${encodeURIComponent(session.gatewayAgentChannelId)}`);
      result.agentChannelState = agent.ok ? agent.data?.state : null;
    }
    result.transportConnected = Boolean(result.transportConnected
      && result.callerChannelState === 'Up'
      && result.agentChannelState === 'Up');
    if (probe) {
      const cli = await this.probeCliMedia(session.gatewayAgentChannelId || '');
      if (cli) result.cliRtp = cli;
    }
    return result;
  }

  async getSessionStatus(sessionId) {
    const details = await this.getSessionDetails(sessionId);
    if (!details) return { status: 'not-found', connected: false, transportConnected: false, mediaVerified: false };
    return {
      ...details,
      connected: details.status === 'connected' && details.mediaVerified,
      available: true,
    };
  }

  async disconnectAgent(sessionId, agentId) {
    const tenantId = this.tenantForSession(sessionId);
    const session = tenantId
      ? dashboardStore.getInboundVoiceSession(tenantId, sessionId)
      : dashboardStore.findInboundVoiceSessionAnyTenant(sessionId);
    if (!session) return { disconnected: false, reason: 'Inbound call session not found' };
    if (agentId && String(session.winningAgentId) !== String(agentId)) {
      return { disconnected: false, reason: 'Agent is not assigned to this call' };
    }
    await this.hangupChannel(session.gatewayAgentChannelId, 'agent-disconnect');
    return { disconnected: true, sessionId: session.id };
  }

  async terminateSession(sessionId) {
    const session = dashboardStore.findInboundVoiceSessionAnyTenant(sessionId);
    if (!session) return { terminated: false, reason: 'Inbound call session not found' };
    await this.cleanupMedia(session);
    this.clearTimer(`media:${session.id}`);
    this.clearTimer(`ring:${session.id}`);
    this.inboundChannels.delete(session.gatewayChannelId);
    this.sessionTenants.delete(String(session.id));
    return { terminated: true, sessionId: session.id, bridgeId: session.gatewayBridgeId };
  }

  async cleanupMedia(session) {
    const cleanup = [];
    if (session.gatewayAgentChannelId) cleanup.push(this.hangupChannel(session.gatewayAgentChannelId, 'cleanup'));
    if (session.gatewayChannelId) cleanup.push(this.hangupChannel(session.gatewayChannelId, 'cleanup'));
    await Promise.allSettled(cleanup);
    if (session.gatewayBridgeId) {
      await this.ariRequest('DELETE', `/ari/bridges/${encodeURIComponent(session.gatewayBridgeId)}`);
    }
  }

  async finalizeSession(sessionId, status, reason, { tenantId } = {}) {
    const resolvedTenant = tenantId || this.tenantForSession(sessionId);
    const session = resolvedTenant
      ? dashboardStore.getInboundVoiceSession(resolvedTenant, sessionId)
      : dashboardStore.findInboundVoiceSessionAnyTenant(sessionId);
    if (!session) return null;
    if (TERMINAL_STATUSES.has(session.status) && session.endedAt) return session;
    this.clearTimer(`ring:${session.id}`);
    this.clearTimer(`media:${session.id}`);
    await this.cleanupMedia(session);
    const updated = dashboardStore.updateInboundVoiceSession(session.tenantId, session.id, {
      status,
      endedAt: new Date().toISOString(),
      failureReason: status === 'ended' ? (reason || null) : (reason || session.failureReason),
    });
    const winner = (session.eligibleAgents || []).find((agent) => String(agent.id) === String(session.winningAgentId));
    if (winner?.email) {
      voiceRealtime.markBusy(session.tenantId, winner.email, false);
      voiceRealtime.publish(session.tenantId, session.businessId, {
        type: 'agent_presence_updated', tenantId: session.tenantId, businessId: session.businessId,
        agent: { id: winner.id, name: winner.name, status: 'available' },
      });
    }
    voiceRealtime.publish(session.tenantId, session.businessId, {
      type: 'call_ended', callId: session.id, status, reason: reason || null,
    });
    this.inboundChannels.delete(session.gatewayChannelId);
    this.sessionTenants.delete(String(session.id));
    console.log('[ARI] session finalized', { sessionId: session.id, status, reason: reason || null });
    return updated;
  }

  async onChannelDestroyed(event) {
    const channelId = event.channel?.id;
    if (!channelId) return { handled: false };
    const callerSession = dashboardStore.findInboundVoiceSessionByChannelAnyTenant(channelId);
    if (callerSession) {
      const status = callerSession.status === 'ringing' ? 'missed' : 'ended';
      const reason = callerSession.status === 'ringing'
        ? 'Caller hung up before an agent answered'
        : 'Caller hung up';
      await this.finalizeSession(callerSession.id, status, reason, { tenantId: callerSession.tenantId });
      return { handled: true, role: 'caller', status };
    }
    const agentSession = dashboardStore.findInboundVoiceSessionByAgentChannelAnyTenant(channelId);
    if (agentSession) {
      const status = agentSession.status === 'connected' ? 'ended' : 'failed';
      const reason = agentSession.status === 'connected'
        ? 'Browser agent hung up'
        : 'Browser agent media channel closed before the call was connected';
      this.resolveAgentLeg(agentSession.id, { ok: false, reason });
      await this.finalizeSession(agentSession.id, status, reason, { tenantId: agentSession.tenantId });
      return { handled: true, role: 'agent', status };
    }
    return { handled: false };
  }

  async onBridgeDestroyed(event) {
    const bridgeId = event.bridge?.id;
    if (!bridgeId) return { handled: false };
    const session = dashboardStore.findInboundVoiceSessionByBridgeAnyTenant(bridgeId);
    if (!session || TERMINAL_STATUSES.has(session.status)) return { handled: false };
    await this.finalizeSession(session.id, 'failed', 'Media bridge was destroyed unexpectedly', { tenantId: session.tenantId });
    return { handled: true };
  }

  async onChannelUp(event) {
    // The agent leg is joined in onAgentLeg. A late ChannelStateChange only
    // synchronizes the stored media state; it must never invent a connection.
    const channelId = event.channel?.id;
    const session = dashboardStore.findInboundVoiceSessionByAgentChannelAnyTenant(channelId);
    if (!session) return { handled: false };
    dashboardStore.attachInboundVoiceGateway(session.tenantId, session.id, { mediaState: 'channel-up' });
    return { handled: true };
  }
}

module.exports = { AsteriskAriController, normalizeDid, parseAliases };
