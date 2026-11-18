const crypto = require('crypto');
const client = require('./client');
const dashboardStore = require('../../utils/dashboardStore');

function normalizeLanguage(value) {
  const language = String(value || 'sw').trim().toLowerCase();
  if (!language.startsWith('sw')) {
    const error = new Error('Only Swahili is enabled for the verified NileAGI voice bridge');
    error.code = 'NILEAGI_LANGUAGE_UNSUPPORTED';
    error.statusCode = 400;
    throw error;
  }
  return 'sw';
}

async function create(options = {}) {
  const language = normalizeLanguage(options.language);
  const transport = await client.startVoiceSession({ language });
  return dashboardStore.createAiVoiceSession({
    id: options.id || `ai-voice-${crypto.randomUUID()}`,
    tenantId: options.tenantId,
    businessId: options.businessId,
    callId: options.callId,
    language,
    providerSessionId: transport.sessionId,
  });
}

async function turn(sessionId, audio, options = {}) {
  const session = dashboardStore.getAiVoiceSession(options.tenantId, sessionId);
  if (!session) {
    const error = new Error('AI voice session was not found for this tenant');
    error.code = 'NILEAGI_SESSION_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (session.status !== 'active') {
    const error = new Error('AI voice session is not active');
    error.code = 'NILEAGI_SESSION_ENDED';
    error.statusCode = 409;
    throw error;
  }
  const result = await client.talk(audio, {
    sessionId: session.providerSessionId,
    language: session.language,
    tenantId: session.tenantId,
    businessId: session.businessId,
    callId: session.callId,
    audioSeconds: options.audioSeconds,
  });
  const next = dashboardStore.updateAiVoiceSession(session.tenantId, session.id, {
    providerSessionId: result?.session_id || session.providerSessionId,
    turnCount: session.turnCount + 1,
  });
  return { session: next, result };
}

function end(sessionId, tenantId) {
  const session = dashboardStore.getAiVoiceSession(tenantId, sessionId);
  if (!session) return null;
  return dashboardStore.updateAiVoiceSession(tenantId, sessionId, {
    status: 'ended',
    endedAt: new Date().toISOString(),
  });
}

module.exports = { create, turn, end };
