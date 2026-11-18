const express = require('express');
const config = require('../integrations/nileagi/config');
const client = require('../integrations/nileagi/client');
const sessions = require('../integrations/nileagi/voiceSession');

const router = express.Router();

router.get('/status', (req, res) => {
  const parsed = config.fromEnv();
  return res.json({
    ok: true,
    provider: client.status(),
    mediaGateway: {
      configured: Boolean(parsed.mediaGatewayKey),
      transport: parsed.voiceTransport,
      liveTelephonyReady: parsed.enabled && parsed.valid && parsed.voiceEnabled && parsed.voiceTransport === 'sip-media-gateway' && Boolean(parsed.mediaGatewayKey),
      requirement: 'Africa\'s Talking SIP trunk -> PBX/media gateway -> this authenticated endpoint',
    },
  });
});

router.post('/sessions', async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const session = await sessions.create({
      tenantId: body.tenantId,
      businessId: body.businessId,
      callId: body.callId,
      language: body.language,
    });
    return res.status(201).json({ ok: true, session, liveTelephony: client.status().capabilities.voice.liveTelephony });
  } catch (error) {
    return res.status(error.statusCode || 503).json({ error: error.message, code: error.code || 'NILEAGI_SESSION_CREATE_FAILED' });
  }
});

router.post('/sessions/:sessionId/turn', express.raw({ type: ['audio/*', 'application/octet-stream'], limit: '10mb' }), async (req, res) => {
  try {
    const tenantId = String(req.get('x-tenant-id') || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'X-Tenant-Id is required' });
    const audio = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!audio.length) return res.status(400).json({ error: 'A non-empty audio request body is required' });
    const audioSeconds = Number(req.get('x-audio-seconds'));
    const result = await sessions.turn(req.params.sessionId, audio, {
      tenantId,
      audioSeconds: Number.isFinite(audioSeconds) && audioSeconds >= 0 ? audioSeconds : undefined,
    });
    return res.json({
      ok: true,
      session: result.session,
      transcript: result.result?.transcript || null,
      reply: result.result?.reply || null,
      audioUrl: result.result?.audio_url || null,
      mimeType: result.result?.mime_type || 'audio/wav',
      providerTurnId: result.result?.turn_id || null,
    });
  } catch (error) {
    return res.status(error.statusCode || 502).json({ error: error.message, code: error.code || 'NILEAGI_TURN_FAILED' });
  }
});

router.post('/sessions/:sessionId/end', (req, res) => {
  const tenantId = String(req.get('x-tenant-id') || '').trim();
  if (!tenantId) return res.status(400).json({ error: 'X-Tenant-Id is required' });
  const session = sessions.end(req.params.sessionId, tenantId);
  if (!session) return res.status(404).json({ error: 'AI voice session was not found for this tenant' });
  return res.json({ ok: true, session });
});

module.exports = router;
