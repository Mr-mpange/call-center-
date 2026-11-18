const dashboardStore = require('../utils/dashboardStore');
const voiceRealtime = require('./voiceRealtime');

function dispatchInboundOffer({ business, session, eligibleAgents, timeoutMs = 25_000, onTimeout }) {
  const offer = {
    callId: session.id,
    sessionId: session.id,
    businessId: business.id,
    businessName: business.name,
    callerNumber: session.callerNumber,
    calledNumber: session.calledNumber,
    ringStartedAt: session.ringStartedAt,
    eligibleAgents: eligibleAgents.map(({ id, name }) => ({ id, name })),
  };
  voiceRealtime.publish(business.tenantId, business.id, {
    type: 'incoming_call', tenantId: business.tenantId, ...offer,
  });
  voiceRealtime.publish(business.tenantId, business.id, {
    type: 'call_ringing', tenantId: business.tenantId, ...offer,
  });

  const timer = setTimeout(() => {
    const current = dashboardStore.getInboundVoiceSession(business.tenantId, session.id);
    if (current?.status !== 'ringing') return;
    const missed = dashboardStore.updateInboundVoiceSession(business.tenantId, session.id, {
      status: 'missed', endedAt: new Date().toISOString(), failureReason: 'Browser agent ring timed out',
    });
    voiceRealtime.publish(business.tenantId, business.id, {
      type: 'call_ended', callId: session.id, status: missed?.status || 'missed', reason: 'No agent accepted before timeout',
    });
    if (typeof onTimeout === 'function') {
      Promise.resolve()
        .then(() => onTimeout(missed))
        .catch((error) => console.error('[Parallel Ring] timeout cleanup failed:', error.message));
    }
  }, Math.max(5_000, Number(timeoutMs) || 25_000));
  timer.unref?.();
  return { offer, timeout: timer };
}

module.exports = { dispatchInboundOffer };
