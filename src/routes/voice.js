const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const at = require('../config/at');
const voiceLogStore = require('../utils/voiceLogStore');
const voiceIvrStore = require('../utils/voiceIvrStore');
const voiceBusinessStore = require('../utils/voiceBusinessStore');
const voiceCallHistory = require('../utils/voiceCallHistory');
const dashboardStore = require('../utils/dashboardStore');
const voiceRealtime = require('../services/voiceRealtime');
const voiceAgentRouting = require('../services/voiceAgentRouting');
const { isConfigured: mediaBridgeConfigured } = require('../services/mediaBridge');
const parallelRingDispatcher = require('../services/parallelRingDispatcher');

const router = express.Router();
const voice = at.VOICE;

function xml(...body) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n  ${body.join('\n  ')}\n</Response>`;
}

function say(text) {
  const safeText = String(text).replace(/[<>&"']/g, (char) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;',
  })[char]);
  return `<Say>${safeText}</Say>`;
}

function browserQueueName(tenantId, businessId) {
  const suffix = crypto.createHash('sha256').update(`${tenantId}:${businessId}`).digest('hex').slice(0, 20);
  return `browser-${suffix}`;
}

function parseEnvironmentBusinessRoutes() {
  const raw = process.env.AT_VOICE_BUSINESSES;
  if (!raw) return [];

  let businesses;
  try {
    businesses = JSON.parse(raw);
  } catch (error) {
    const friendlyError = new Error(`AT_VOICE_BUSINESSES must contain valid JSON: ${error.message}`);
    friendlyError.status = 500;
    throw friendlyError;
  }
  if (!Array.isArray(businesses)) {
    throw new Error('AT_VOICE_BUSINESSES must be a JSON array (wrap business objects in [ ... ])');
  }

  for (const [index, business] of businesses.entries()) {
    if (!business || typeof business !== 'object' || Array.isArray(business)) {
      throw new Error(`Business at index ${index} must be a JSON object`);
    }
    if (!Array.isArray(business.numbers) || business.numbers.length === 0) {
      throw new Error(`Business "${business.id || index}" must have at least one inbound number in "numbers"`);
    }
    if (business.agents !== undefined && !Array.isArray(business.agents)) {
      throw new Error(`Business "${business.id || index}" agents must be an array`);
    }
    if (business.routing && !['parallel', 'sequential'].includes(business.routing)) {
      throw new Error(`Business "${business.id || index}" routing must be "parallel" or "sequential"`);
    }
  }
  return businesses;
}

function parseBusinessRoutes() {
  const saved = voiceBusinessStore.read();
  return saved.length ? saved : parseEnvironmentBusinessRoutes().map((business) => ({ ...business, tenantId: business.tenantId || 'workspace' }));
}

function normalizePhone(value) {
  return String(value || '').replace(/[^\d+]/g, '');
}

function businessForNumber(number, businesses) {
  const normalized = normalizePhone(number);
  return businesses.find((business) =>
    Array.isArray(business.numbers) && business.numbers.some((candidate) => normalizePhone(candidate) === normalized)
  );
}

function dialAgents(business, inboundNumber) {
  const agents = Array.isArray(business.agents) ? business.agents : [];
  const destinations = agents
    // Africa's Talking's inbound <Dial phoneNumbers="..."> accepts PSTN
    // telephone numbers, not WebRTC client names. Web clients need a
    // provider-supported inbound SIP/media bridge before they can be dialed.
    .map((agent) => typeof agent === 'string' ? agent : (agent.type === 'web' ? null : agent.number))
    .filter(Boolean);
  if (destinations.length === 0) return null;

  const escaped = destinations.map((destination) => String(destination).replace(/[&<>"']/g, ''));
  const callerId = String(inboundNumber || business.numbers[0]).replace(/[&<>"']/g, '');
  const sequential = business.routing === 'sequential';
  const attrs = ` phoneNumbers="${escaped.join(',')}" callerId="${callerId}"${sequential ? ' sequential="true"' : ''}`;
  const welcome = business.name
    ? `Welcome to ${business.name}. Please hold while we connect your call.`
    : 'Welcome. Please hold while we connect your call.';
  return `${say(welcome)}\n  <Dial${attrs}/>`;
}

function renderBusinessIvr(flow, business, dtmfDigits, inboundNumber) {
  const selected = flow.options.find((option) => option.digit === String(dtmfDigits || ''));
  if (selected) {
    if (selected.action === 'dialAgents') {
      const action = dialAgents(business, inboundNumber);
      return action || say('No agents are available right now. Please call again later.');
    }
    if (selected.action === 'say') return say(selected.text);
    return `${say(selected.text || 'Goodbye.') }\n  <Hangup/>`;
  }

  const prompt = dtmfDigits ? `Invalid choice. ${flow.menuPrompt}` : flow.menuPrompt;
  const greeting = dtmfDigits ? '' : `${say(flow.greeting)}\n  `;
  return `${greeting}<GetDigits timeout="${flow.timeoutSeconds}" numDigits="1">\n    ${say(prompt)}\n  </GetDigits>`;
}

// Shared handler for the configured voice callback and explicit inbound alias.
function voiceActions(req, res) {
  res.set('Content-Type', 'application/xml');
  console.log('[Voice Actions]', req.body);

  const { isActive, dtmfDigits, to, destinationNumber, direction, sessionId, clientDialedNumber } = req.body || {};
  try {
    voiceCallHistory.recordInboundVoiceEvent(req.body);
  } catch (error) {
    console.error('[Voice History] could not persist callback event:', error.message);
  }

  // Africa's Talking calls this callback for the lifetime of an active call.
  // An inactive call should return an empty response and must not start a new menu.
  if (String(isActive) === '0') {
    return res.send(xml());
  }

  // A WebRTC browser call arrives at the voice callback as an inbound
  // session. Africa's Talking supplies the PSTN destination separately in
  // clientDialedNumber; return the Dial instruction that bridges the browser
  // client to that number. Without this branch the request falls through to
  // inbound business routing and returns 503, which the browser reports as
  // SIP 480 Temporarily Unavailable.
  const browserDestination = normalizePhone(clientDialedNumber);
  const browserCallerId = normalizePhone(destinationNumber || to);
  if (/^\+[1-9]\d{7,14}$/.test(browserDestination)) {
    const callerIdAttribute = /^\+[1-9]\d{7,14}$/.test(browserCallerId)
      ? ` callerId="${browserCallerId}"`
      : '';
    console.log('[Voice Actions] bridging browser outbound call', {
      sessionId,
      browserDestination,
      browserCallerId: browserCallerId || null,
    });
    return res.send(xml(
      say('Please wait while we connect your call.'),
      `<Dial phoneNumbers="${browserDestination}"${callerIdAttribute}/>`
    ));
  }

  // Outbound calls also hit the number's callback. They must not be matched
  // against the inbound business number or the handler will recursively dial
  // the same agent again (especially during /voice/call diagnostics).
  if (String(direction || '').toLowerCase() === 'outbound') {
    console.log('[Voice Actions] outbound call callback; skipping inbound routing', { sessionId });
    return res.send(xml(say('Your call is connected.')));
  }

  let businesses;
  try {
    businesses = parseBusinessRoutes();
  } catch (error) {
    console.error('[Voice Routing] configuration error:', error.message);
    return res.status(error.status || 500).send(xml(say('Call routing is temporarily unavailable. Please contact support.')));
  }

  const business = voiceBusinessStore.readByNumber(normalizePhone(to || destinationNumber)) || businessForNumber(to || destinationNumber, businesses);
  if (business) {
    const inboundNumber = to || destinationNumber;
    if (String(direction || '').toLowerCase() === 'inbound' && sessionId) {
      const tenantStore = dashboardStore.read(business.tenantId);
      const webAgents = voiceAgentRouting.eligibleAgents(business, business.tenantId, tenantStore.users || [], tenantStore.agents || []);
      if (webAgents.length) {
        const stableId = `at-inbound-${crypto.createHash('sha256').update(String(sessionId)).digest('hex').slice(0, 32)}`;
        // If Asterisk already created a session for the same trusted DID and
        // caller moments ago, reuse it instead of double-ringing the agents.
        const recent = dashboardStore.findRecentInboundVoiceSession(
          business.tenantId, business.id, normalizePhone(inboundNumber), normalizePhone(req.body?.callerNumber),
          Number(process.env.ASTERISK_CALL_DEDUPE_WINDOW_MS) || 30_000,
        );
        const createdSession = recent
          ? { session: recent, created: false }
          : dashboardStore.createInboundVoiceSession({
            id: stableId,
            tenantId: business.tenantId,
            businessId: business.id,
            providerSessionId: sessionId,
            calledNumber: normalizePhone(inboundNumber),
            callerNumber: normalizePhone(req.body?.callerNumber),
            eligibleAgents: webAgents,
          });
        const { session, created } = createdSession;
        if (created) {
          parallelRingDispatcher.dispatchInboundOffer({
            business, session, eligibleAgents: webAgents,
            timeoutMs: Number(process.env.INBOUND_BROWSER_RING_TIMEOUT_MS) || 25_000,
          });
          console.log('[Voice Routing] offered inbound call to online browser agents', {
            providerSessionId: sessionId, businessId: business.id, tenantId: business.tenantId,
            eligibleAgentCount: webAgents.length,
          });
        }
        // A provider callback alone has no Asterisk channel. With the Asterisk
        // adapter selected, fail closed instead of parking the caller in a
        // queue that has no media bridge behind it.
        const gatewayChannelAttached = Boolean(session?.gatewayChannelId) && session?.gateway === 'asterisk';
        if (!mediaBridgeConfigured() || (String(process.env.MEDIA_BRIDGE_PROVIDER || '').toLowerCase() === 'asterisk' && !gatewayChannelAttached)) {
          return res.send(xml(say('Browser agent calling is not connected yet. Please call again later.')));
        }
        const queue = browserQueueName(business.tenantId, business.id);
        return res.send(xml(
          say(`Please hold while we offer your call to ${webAgents.length === 1 ? 'an' : 'available'} agent${webAgents.length === 1 ? '' : 's'}.`),
          `<Enqueue name="${queue}"/>`
        ));
      }
    }
    let flow;
    try {
      flow = voiceIvrStore.get(business.id);
    } catch (error) {
      console.error('[Voice IVR] failed to load flow:', error.message);
      return res.status(500).send(xml(say('Call flow is temporarily unavailable.')));
    }
    if (flow) {
      return res.send(xml(renderBusinessIvr(flow, business, dtmfDigits, inboundNumber)));
    }
    const action = dialAgents(business, inboundNumber);
    if (!action) {
      console.error(`[Voice Routing] no agents configured for business ${business.id || business.name || '(unnamed)'}`);
      return res.send(xml(say('No agents are available right now. Please call again later.')));
    }
    console.log('[Voice Routing] dialing agents', {
      sessionId,
      businessId: business.id,
      inboundNumber,
      routing: business.routing || 'parallel',
      agentCount: (business.agents || []).filter((agent) => typeof agent === 'string' || agent.type !== 'web').length,
      instruction: action,
    });
    return res.send(xml(action));
  }

  console.error('[Voice Routing] no business is configured for the called number', { to: to || destinationNumber, sessionId });
  return res.status(503).send(xml(say('Voice routing is not configured for this number. Please contact support.')));
}

// Configure this public callback URL in the Africa's Talking Voice dashboard
// for the number that should receive inbound calls.
router.post(['/actions', '/inbound'], voiceActions);

// POST /voice/events — call status events
router.post('/events', (req, res) => {
  const event = req.body || {};
  console.log('[Voice Events]', event);
  try {
    voiceLogStore.append(event);
    const historyResult = voiceCallHistory.recordInboundVoiceEvent(event);
    const state = String(event.callSessionState || event.status || '').trim().toLowerCase().replace(/[\s_-]/g, '');
    if (historyResult?.tenantId && historyResult?.call?.businessId && ['completed', 'success', 'notanswered', 'aborted', 'failed', 'busy', 'cancelled', 'canceled', 'expired', 'rejected'].includes(state)) {
      const session = dashboardStore.getInboundVoiceSession(historyResult.tenantId, event.sessionId);
      if (session && !['ended', 'failed', 'missed'].includes(session.status)) {
        const ended = dashboardStore.updateInboundVoiceSession(historyResult.tenantId, session.id, {
          status: state === 'success' || state === 'completed' ? 'ended' : 'missed',
          endedAt: new Date().toISOString(),
          failureReason: event.errorMessage || null,
        });
        for (const agent of session.eligibleAgents || []) voiceRealtime.markBusy(historyResult.tenantId, agent.email, false);
        voiceRealtime.publish(historyResult.tenantId, session.businessId, { type: 'call_ended', callId: session.id, status: ended?.status || 'ended', reason: event.errorMessage || null });
      }
    }
    return res.status(200).send('OK');
  } catch (error) {
    console.error('[Voice Events] failed to persist event:', error.message);
    return res.status(500).send('Could not save voice event');
  }
});

router.get('/events', (req, res) => {
  console.log('[Voice Events][GET]', req.query);
  res.status(200).send('OK');
});

function requireDashboardKey(req, res, next) {
  const expected = process.env.VOICE_DASHBOARD_API_KEY;
  if (!expected) {
    return res.status(503).json({ error: 'VOICE_DASHBOARD_API_KEY is not configured' });
  }
  const supplied = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}

function managedBusinesses() {
  const saved = voiceBusinessStore.read();
  if (saved.length) return saved;
  return parseEnvironmentBusinessRoutes().map((business) => ({
    ...business,
    agents: (business.agents || []).map((agent, index) => ({
      id: agent.id || `agent-${index + 1}`,
      name: typeof agent === 'string' ? `Agent ${index + 1}` : agent.name || `Agent ${index + 1}`,
      ...(typeof agent === 'string' ? { type: 'phone', number: agent } : agent.type === 'web'
        ? { type: 'web', clientName: agent.clientName }
        : { type: 'phone', number: agent.number }),
    })),
  }));
}

function businessForApi(business) {
  return {
    ...business,
    agents: (business.agents || []).map((agent, index) => ({
      id: agent.id || `agent-${index + 1}`,
      name: typeof agent === 'string' ? `Agent ${index + 1}` : agent.name || `Agent ${index + 1}`,
      ...(typeof agent === 'string' ? { type: 'phone', number: agent } : agent.type === 'web'
        ? { type: 'web', clientName: agent.clientName }
        : { type: 'phone', number: agent.number }),
    })),
  };
}

function validatePhoneList(numbers, label, minimum = 1) {
  if (!Array.isArray(numbers) || numbers.length < minimum) {
    return `${label} must contain at least ${minimum} phone number${minimum === 1 ? '' : 's'}`;
  }
  if (numbers.some((number) => typeof number !== 'string' || !/^\+[1-9]\d{7,14}$/.test(number))) {
    return `${label} numbers must use international E.164 format, for example +255712345678`;
  }
  if (new Set(numbers).size !== numbers.length) return `${label} must not contain duplicate numbers`;
  return null;
}

function validateBusinessNumbers(numbers, currentId, tenantId) {
  const error = validatePhoneList(numbers, 'numbers');
  if (error) return error;
  const duplicateOwner = voiceBusinessStore.read().find((business) =>
    !(business.id === currentId && business.tenantId === tenantId) && business.numbers.some((number) => numbers.includes(number))
  );
  return duplicateOwner ? `Number is already assigned to business "${duplicateOwner.id}"` : null;
}

function businessIndex(businesses, businessId) {
  return businesses.findIndex((business) => business.id === businessId);
}

function requestedTenantId(req) {
  const tenantId = req.query.tenantId || req.body?.tenantId;
  if (typeof tenantId !== 'string' || !/^[A-Za-z0-9_-]{2,80}$/.test(tenantId)) return null;
  return tenantId;
}

function tenantBusiness(req) {
  const tenantId = requestedTenantId(req);
  if (!tenantId) return { error: 'tenantId is required' };
  const business = voiceBusinessStore.get(tenantId, req.params.businessId);
  return business ? { tenantId, business } : { tenantId, error: 'Business not found' };
}

function cleanAgentList(agents = []) {
  return agents.map((agent, index) => ({
    id: agent.id || `agent-${index + 1}`,
    name: typeof agent === 'string' ? `Agent ${index + 1}` : agent.name || `Agent ${index + 1}`,
    ...(typeof agent === 'string' ? { type: 'phone', number: agent } : agent.type === 'web'
      ? { type: 'web', clientName: agent.clientName }
      : { type: 'phone', number: agent.number }),
  }));
}

function validateAgentInput(agent) {
  if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return 'agent must be an object';
  if (typeof agent.name !== 'string' || !agent.name.trim()) return 'name is required';
  const type = agent.type || 'phone';
  if (type === 'phone') return validatePhoneList([agent.number], 'agent number');
  if (type === 'web') {
    if (typeof agent.clientName !== 'string' || !/^[A-Za-z0-9_-]{2,64}$/.test(agent.clientName)) {
      return 'clientName must be 2–64 letters, numbers, underscores, or hyphens';
    }
    return null;
  }
  return 'type must be phone or web';
}

function sameAgentDestination(a, b) {
  return (a.type || 'phone') === (b.type || 'phone') &&
    ((a.type || 'phone') === 'web' ? a.clientName === b.clientName : a.number === b.number);
}

async function requestWebCapabilityToken(agent, business) {
  const username = process.env.AT_USERNAME || 'sandbox';
  const apiKey = process.env.AT_API_KEY;
  if (!apiKey) throw new Error('AT_API_KEY is not configured');
  const response = await axios.post('https://webrtc.africastalking.com/capability-token/request', {
    username,
    clientName: agent.clientName,
    phoneNumber: business.numbers[0],
    incoming: true,
    outgoing: true,
    expire: '3600',
  }, { headers: { apiKey, 'Content-Type': 'application/json', Accept: 'application/json' } });
  return response.data;
}

// Business onboarding and agent management for the control center.
router.get('/businesses', requireDashboardKey, (req, res) => {
  try {
    const tenantId = requestedTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    if (!require('../utils/dashboardStore').getTenant(tenantId)) return res.status(404).json({ error: 'Tenant not found' });
    return res.json({ ok: true, businesses: voiceBusinessStore.read(tenantId).map(businessForApi) });
  } catch (error) {
    console.error('[Voice Businesses] failed to list businesses:', error.message);
    return res.status(500).json({ error: 'Failed to read businesses' });
  }
});

router.post('/businesses', requireDashboardKey, (req, res) => {
  const { id, tenantId, name, numbers, routing = 'parallel', agents = [] } = req.body || {};
  if (!tenantId || !require('../utils/dashboardStore').getTenant(tenantId)) return res.status(400).json({ error: 'A valid tenantId is required' });
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{2,64}$/.test(id)) {
    return res.status(400).json({ error: 'id must be 2–64 letters, numbers, underscores, or hyphens' });
  }
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const numberError = validateBusinessNumbers(numbers, id, tenantId);
  if (numberError) return res.status(400).json({ error: numberError });
  if (!['parallel', 'sequential'].includes(routing)) {
    return res.status(400).json({ error: 'routing must be parallel or sequential' });
  }
  if (!Array.isArray(agents)) return res.status(400).json({ error: 'agents must be an array' });
  const normalizedAgents = agents.map((agent, index) => typeof agent === 'string'
    ? { name: `Agent ${index + 1}`, number: agent }
    : agent);
  const agentError = normalizedAgents.map(validateAgentInput).find(Boolean);
  if (agentError) return res.status(400).json({ error: agentError });
  try {
    if (voiceBusinessStore.get(tenantId, id)) return res.status(409).json({ error: `Business "${id}" already exists for this tenant` });
    const business = { id, tenantId, name: name.trim(), numbers, routing, agents: normalizedAgents.map((agent, index) => ({
      id: agent.id || `agent-${index + 1}`, name: agent.name.trim(), type: agent.type || 'phone',
      ...((agent.type || 'phone') === 'web' ? { clientName: agent.clientName } : { number: agent.number }),
    })), createdAt: new Date().toISOString() };
    const saved = voiceBusinessStore.upsert(tenantId, business);
    return res.status(201).json({ ok: true, business: businessForApi(saved) });
  } catch (error) {
    console.error('[Voice Businesses] failed to onboard business:', error.message);
    return res.status(500).json({ error: 'Failed to onboard business' });
  }
});

router.get('/businesses/:businessId', requireDashboardKey, (req, res) => {
  try {
    const { business, error } = tenantBusiness(req);
    if (error) return res.status(error === 'tenantId is required' ? 400 : 404).json({ error });
    return res.json({ ok: true, business: businessForApi(business) });
  } catch (error) {
    console.error('[Voice Businesses] failed to read business:', error.message);
    return res.status(500).json({ error: 'Failed to read business' });
  }
});

router.put('/businesses/:businessId', requireDashboardKey, (req, res) => {
  const { name, numbers, routing } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'name is required' });
  const tenantId = requestedTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
  const numberError = validateBusinessNumbers(numbers, req.params.businessId, tenantId);
  if (numberError) return res.status(400).json({ error: numberError });
  if (!['parallel', 'sequential'].includes(routing)) return res.status(400).json({ error: 'routing must be parallel or sequential' });
  try {
    const current = voiceBusinessStore.get(tenantId, req.params.businessId);
    if (!current) return res.status(404).json({ error: 'Business not found' });
    const saved = voiceBusinessStore.upsert(tenantId, { ...current, name: name.trim(), numbers, routing, updatedAt: new Date().toISOString() });
    return res.json({ ok: true, business: businessForApi(saved) });
  } catch (error) {
    console.error('[Voice Businesses] failed to update business:', error.message);
    return res.status(500).json({ error: 'Failed to update business' });
  }
});

router.delete('/businesses/:businessId', requireDashboardKey, (req, res) => {
  try {
    const { tenantId, business, error } = tenantBusiness(req);
    if (error) return res.status(error === 'tenantId is required' ? 400 : 404).json({ error });
    voiceBusinessStore.remove(tenantId, req.params.businessId);
    voiceIvrStore.remove(req.params.businessId);
    return res.json({ ok: true, businessId: req.params.businessId, deleted: true });
  } catch (error) {
    console.error('[Voice Businesses] failed to delete business:', error.message);
    return res.status(500).json({ error: 'Failed to delete business' });
  }
});

router.post('/businesses/:businessId/agents', requireDashboardKey, (req, res) => {
  const input = req.body || {};
  const error = validateAgentInput(input);
  if (error) return res.status(400).json({ error });
  try {
    const { tenantId, business, error: scopeError } = tenantBusiness(req);
    if (scopeError) return res.status(scopeError === 'tenantId is required' ? 400 : 404).json({ error: scopeError });
    business.agents = cleanAgentList(business.agents || []);
    if (business.agents.some((agent) => sameAgentDestination(agent, input))) {
      return res.status(409).json({ error: 'Agent destination already belongs to this business' });
    }
    const agent = { id: crypto.randomUUID(), name: input.name.trim(), type: input.type || 'phone', ...(input.type === 'web' ? { clientName: input.clientName } : { number: input.number }) };
    business.agents.push(agent);
    voiceBusinessStore.upsert(tenantId, business);
    return res.status(201).json({ ok: true, agent });
  } catch (error) {
    console.error('[Voice Agents] failed to add agent:', error.message);
    return res.status(500).json({ error: 'Failed to add agent' });
  }
});

// Dashboard backend should call this endpoint and pass the short-lived token to the signed-in agent.
// Never expose VOICE_DASHBOARD_API_KEY or AT_API_KEY in browser code.
router.post('/businesses/:businessId/agents/:agentId/capability-token', requireDashboardKey, async (req, res) => {
  try {
    const { business, error } = tenantBusiness(req);
    if (error) return res.status(error === 'tenantId is required' ? 400 : 404).json({ error });
    const agent = (business.agents || []).find((item) => item.id === req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (agent.type !== 'web') return res.status(400).json({ error: 'Capability tokens are only for web agents' });
    const result = await requestWebCapabilityToken(agent, business);
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error('[Voice WebRTC] capability token request failed:', error.response?.data || error.message);
    return res.status(502).json({ error: 'Failed to request WebRTC capability token', details: error.response?.data || error.message });
  }
});

router.put('/businesses/:businessId/agents/:agentId', requireDashboardKey, (req, res) => {
  const input = req.body || {};
  const error = validateAgentInput(input);
  if (error) return res.status(400).json({ error });
  try {
    const { tenantId, business, error: scopeError } = tenantBusiness(req);
    if (scopeError) return res.status(scopeError === 'tenantId is required' ? 400 : 404).json({ error: scopeError });
    business.agents = cleanAgentList(business.agents || []);
    const agent = business.agents.find((item) => item.id === req.params.agentId);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    if (business.agents.some((item) => item.id !== agent.id && sameAgentDestination(item, input))) {
      return res.status(409).json({ error: 'Agent destination already belongs to this business' });
    }
    Object.assign(agent, { name: input.name.trim(), type: input.type || 'phone' });
    delete agent.number;
    delete agent.clientName;
    if ((input.type || 'phone') === 'web') agent.clientName = input.clientName;
    else agent.number = input.number;
    voiceBusinessStore.upsert(tenantId, business);
    return res.json({ ok: true, agent });
  } catch (error) {
    console.error('[Voice Agents] failed to update agent:', error.message);
    return res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.delete('/businesses/:businessId/agents/:agentId', requireDashboardKey, (req, res) => {
  try {
    const { tenantId, business, error } = tenantBusiness(req);
    if (error) return res.status(error === 'tenantId is required' ? 400 : 404).json({ error });
    business.agents = cleanAgentList(business.agents || []);
    const agentIndex = business.agents.findIndex((item) => item.id === req.params.agentId);
    if (agentIndex < 0) return res.status(404).json({ error: 'Agent not found' });
    const [removedAgent] = business.agents.splice(agentIndex, 1);
    voiceBusinessStore.upsert(tenantId, business);
    return res.json({ ok: true, agent: removedAgent, deleted: true });
  } catch (error) {
    console.error('[Voice Agents] failed to delete agent:', error.message);
    return res.status(500).json({ error: 'Failed to delete agent' });
  }
});

function validateIvrFlow(input, businessId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Request body must be a JSON object';
  }
  if (typeof input.greeting !== 'string' || !input.greeting.trim()) {
    return 'greeting must be a non-empty string';
  }
  if (typeof input.menuPrompt !== 'string' || !input.menuPrompt.trim()) {
    return 'menuPrompt must be a non-empty string';
  }
  const timeoutSeconds = Number(input.timeoutSeconds ?? 15);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 3 || timeoutSeconds > 60) {
    return 'timeoutSeconds must be an integer from 3 to 60';
  }
  if (!Array.isArray(input.options) || input.options.length === 0) {
    return 'options must contain at least one menu option';
  }
  const seenDigits = new Set();
  for (const option of input.options) {
    if (!option || !/^[0-9]$/.test(String(option.digit || ''))) {
      return 'Each option digit must be one numeric keypad digit (0-9)';
    }
    if (seenDigits.has(String(option.digit))) return `Digit ${option.digit} is configured more than once`;
    seenDigits.add(String(option.digit));
    if (!['dialAgents', 'say', 'hangup'].includes(option.action)) {
      return `Option ${option.digit} action must be dialAgents, say, or hangup`;
    }
    if (option.action === 'say' && (typeof option.text !== 'string' || !option.text.trim())) {
      return `Option ${option.digit} needs non-empty text for the say action`;
    }
  }

  try {
    const businesses = parseBusinessRoutes();
    if (!businesses.some((business) => business.id === businessId)) {
      return `No configured business has id "${businessId}"`;
    }
  } catch (error) {
    return error.message;
  }
  return null;
}

function cleanIvrFlow(input) {
  return {
    greeting: input.greeting.trim(),
    menuPrompt: input.menuPrompt.trim(),
    timeoutSeconds: Number(input.timeoutSeconds ?? 15),
    options: input.options.map((option) => ({
      digit: String(option.digit),
      label: String(option.label || '').trim(),
      action: option.action,
      ...(option.text ? { text: String(option.text).trim() } : {}),
    })),
    updatedAt: new Date().toISOString(),
  };
}

// Dashboard IVR flow CRUD. These routes require the dashboard bearer key.
router.get('/ivr/flows', requireDashboardKey, (req, res) => {
  try {
    return res.json({ ok: true, flows: voiceIvrStore.readAll() });
  } catch (error) {
    console.error('[Voice IVR] failed to list flows:', error.message);
    return res.status(500).json({ error: 'Failed to read IVR flows' });
  }
});

router.post('/ivr/flows', requireDashboardKey, (req, res) => {
  const { businessId } = req.body || {};
  if (typeof businessId !== 'string' || !businessId.trim()) {
    return res.status(400).json({ error: 'businessId is required' });
  }
  const validationError = validateIvrFlow(req.body, businessId);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const flow = voiceIvrStore.put(businessId, cleanIvrFlow(req.body));
    return res.status(201).json({ ok: true, businessId, flow });
  } catch (error) {
    console.error('[Voice IVR] failed to save flow:', error.message);
    return res.status(500).json({ error: 'Failed to save IVR flow' });
  }
});

router.get('/ivr/flows/:businessId', requireDashboardKey, (req, res) => {
  try {
    const flow = voiceIvrStore.get(req.params.businessId);
    if (!flow) return res.status(404).json({ error: 'IVR flow not found' });
    return res.json({ ok: true, businessId: req.params.businessId, flow });
  } catch (error) {
    console.error('[Voice IVR] failed to read flow:', error.message);
    return res.status(500).json({ error: 'Failed to read IVR flow' });
  }
});

router.put('/ivr/flows/:businessId', requireDashboardKey, (req, res) => {
  const validationError = validateIvrFlow(req.body, req.params.businessId);
  if (validationError) return res.status(400).json({ error: validationError });
  try {
    const flow = voiceIvrStore.put(req.params.businessId, cleanIvrFlow(req.body));
    return res.json({ ok: true, businessId: req.params.businessId, flow });
  } catch (error) {
    console.error('[Voice IVR] failed to update flow:', error.message);
    return res.status(500).json({ error: 'Failed to update IVR flow' });
  }
});

router.delete('/ivr/flows/:businessId', requireDashboardKey, (req, res) => {
  try {
    if (!voiceIvrStore.remove(req.params.businessId)) return res.status(404).json({ error: 'IVR flow not found' });
    return res.json({ ok: true, businessId: req.params.businessId, deleted: true });
  } catch (error) {
    console.error('[Voice IVR] failed to delete flow:', error.message);
    return res.status(500).json({ error: 'Failed to delete IVR flow' });
  }
});

// GET /voice/logs — protected dashboard API for persisted call events.
router.get('/logs', requireDashboardKey, (req, res) => {
  try {
    let records = voiceLogStore.readAll().sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
    const filters = ['sessionId', 'direction', 'status', 'callerNumber', 'destinationNumber'];
    for (const field of filters) {
      if (req.query[field]) {
        records = records.filter((record) => String(record[field] || '').toLowerCase() === String(req.query[field]).toLowerCase());
      }
    }

    const total = records.length;
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
    return res.json({ ok: true, total, limit, offset, records: records.slice(offset, offset + limit) });
  } catch (error) {
    console.error('[Voice Logs] failed to read logs:', error.message);
    return res.status(500).json({ error: 'Failed to read voice logs' });
  }
});

// GET /voice/logs/:sessionId — full event history for one call.
router.get('/logs/:sessionId', requireDashboardKey, (req, res) => {
  try {
    const events = voiceLogStore.readAll()
      .filter((event) => event.sessionId === req.params.sessionId)
      .sort((a, b) => new Date(a.receivedAt) - new Date(b.receivedAt));
    if (events.length === 0) return res.status(404).json({ error: 'Call session not found' });
    return res.json({ ok: true, sessionId: req.params.sessionId, eventCount: events.length, events });
  } catch (error) {
    console.error('[Voice Logs] failed to read session:', error.message);
    return res.status(500).json({ error: 'Failed to read voice session' });
  }
});

// POST /voice/call or /voice/outbound — outbound call.
router.post(['/call', '/outbound'], async (req, res) => {
  try {
    if (!process.env.AT_API_KEY) {
      return res.status(503).json({ error: 'AT_API_KEY is not configured' });
    }

    const { callFrom, callTo: requestedCallTo, clientRequestId } = req.body || {};
    if (!callFrom || !requestedCallTo) {
      return res.status(400).json({ error: 'callFrom and callTo are required' });
    }
    const callTo = Array.isArray(requestedCallTo)
      ? requestedCallTo
      : String(requestedCallTo).split(',').map((number) => number.trim()).filter(Boolean);
    if (callTo.length === 0) {
      return res.status(400).json({ error: 'callTo must contain at least one phone number' });
    }

    // africastalking@0.5.9's voice.call implementation references axios
    // without importing it. Call the same Voice API endpoint directly until
    // that SDK defect is fixed upstream.
    const username = process.env.AT_USERNAME || 'sandbox';
    const voiceApiUrl = 'https://voice.africastalking.com/call';
    const response = await axios.post(voiceApiUrl, {
      username,
      to: callTo,
      from: callFrom,
      clientRequestId,
    }, {
      headers: {
        apikey: process.env.AT_API_KEY,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    const result = response.data;
    return res.json({ ok: true, result });
  } catch (err) {
    const status = err.response?.status || 502;
    const details = err.response?.data || err.message || 'Africa\'s Talking Voice request failed';
    console.error('[Voice Call] error', details);
    return res.status(status).json({ error: 'Failed to initiate call', details });
  }
});

module.exports = router;
