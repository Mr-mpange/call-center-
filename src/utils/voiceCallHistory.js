const crypto = require('crypto');
const dashboardStore = require('./dashboardStore');
const voiceBusinessStore = require('./voiceBusinessStore');

function normalizedNumber(value, countryCode) {
  let number = String(value || '').trim().replace(/[^\d+]/g, '');
  if (!number.startsWith('+') && countryCode && /^\d{1,4}$/.test(String(countryCode))) {
    number = `+${countryCode}${number.replace(/^0+/, '')}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(number) ? number : '';
}

function eventCallState(event) {
  return String(event.callSessionState || event.status || '').trim().toLowerCase().replace(/[\s_-]/g, '');
}

function isTerminal(state) {
  return ['completed', 'success', 'notanswered', 'aborted', 'failed', 'busy', 'cancelled', 'canceled', 'expired', 'rejected'].includes(state);
}

function finalOutcome(event, state, durationSec) {
  const status = String(event.status || '').toLowerCase();
  if (['notanswered', 'aborted', 'failed', 'busy', 'cancelled', 'canceled', 'expired', 'rejected'].includes(state) || status === 'notanswered') return 'missed';
  if (status === 'success' || state === 'success' || durationSec > 0) return 'resolved';
  return 'abandoned';
}

function callStartedAt(event) {
  if (event.callStartTime) {
    const parsed = new Date(event.callStartTime);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function writeWithRetry(tenantId, mutate) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const store = dashboardStore.read(tenantId);
    mutate(store);
    try {
      dashboardStore.write(store, tenantId);
      return;
    } catch (error) {
      lastError = error;
      if (!String(error.message || '').includes('Concurrent dashboard update detected')) throw error;
    }
  }
  throw lastError || new Error('Could not persist provider call event');
}

function recordInboundVoiceEvent(event = {}) {
  if (!event || typeof event !== 'object') return null;
  if (String(event.direction || '').toLowerCase() !== 'inbound') return null;

  // A WebRTC agent leg also appears as an inbound provider event. It has a
  // client identity instead of a caller phone number and must not be logged
  // as a customer call.
  const customerNumber = normalizedNumber(event.callerNumber, event.callerCountryCode);
  const destinationNumber = normalizedNumber(event.destinationNumber || event.to);
  const sessionId = String(event.sessionId || '').trim();
  if (!customerNumber || !destinationNumber || !sessionId) return null;

  const business = voiceBusinessStore.readByNumber(destinationNumber);
  if (!business) return null;

  const tenantId = business.tenantId;
  const callId = `at-${crypto.createHash('sha256').update(sessionId).digest('hex').slice(0, 32)}`;
  const state = eventCallState(event);
  const durationSec = Math.max(0, Math.floor(Number(event.durationInSeconds) || 0));
  const routedSession = dashboardStore.getInboundVoiceSession(tenantId, sessionId);
  const winningAgent = routedSession?.eligibleAgents?.find((agent) => agent.id === routedSession.winningAgentId);
  const assignedAgent = winningAgent?.name || (business.agents?.length === 1 ? business.agents[0].name : 'Inbound queue');
  const updatedAt = new Date().toISOString();
  let result = null;

  writeWithRetry(tenantId, (store) => {
    const liveIndex = store.liveCalls.findIndex((call) => call.providerSessionId === sessionId || call.id === callId);
    const historyIndex = store.history.findIndex((call) => call.providerSessionId === sessionId || call.id === callId);
    const current = liveIndex >= 0 ? store.liveCalls[liveIndex] : historyIndex >= 0 ? store.history[historyIndex] : null;
    const common = {
      ...(current || {}),
      id: callId,
      providerSessionId: sessionId,
      source: "Africa's Talking",
      tenantId,
      businessId: business.id,
      at: current?.at || callStartedAt(event),
      caller: 'Customer',
      phone: customerNumber,
      direction: 'inbound',
      queue: business.name || 'Inbound',
      agent: current?.agent || assignedAgent,
      durationSec: Math.max(current?.durationSec || 0, durationSec),
      providerState: String(event.callSessionState || event.status || state || 'active'),
      providerError: event.errorMessage ? String(event.errorMessage).slice(0, 300) : current?.providerError || '',
      updatedAt,
    };

    if (!isTerminal(state)) {
      const liveCall = { ...common, status: state || 'active', outcome: 'in-progress' };
      if (liveIndex >= 0) store.liveCalls[liveIndex] = liveCall;
      else store.liveCalls.unshift(liveCall);
      result = { tenantId, call: liveCall, terminal: false };
      return;
    }

    const finished = {
      ...common,
      status: 'ended',
      outcome: finalOutcome(event, state, durationSec),
      endedAt: updatedAt,
      summary: event.errorMessage ? `Provider: ${String(event.errorMessage).slice(0, 300)}` : '',
    };
    if (liveIndex >= 0) store.liveCalls.splice(liveIndex, 1);
    if (historyIndex >= 0) store.history[historyIndex] = finished;
    else store.history.unshift(finished);
    result = { tenantId, call: finished, terminal: true };
  });

  return result;
}

module.exports = { recordInboundVoiceEvent };
