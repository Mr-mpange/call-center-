const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const dotenv = require('dotenv');
const errorHandler = require('./middleware/errorHandler');
const { requestId, securityHeaders, rateLimit, originAndCsrf, serviceAuth, mediaGatewayAuth, allowedOrigins } = require('./middleware/security');
const mediaGateway = require('./services/mediaGateway');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const corsOrigins = allowedOrigins();

app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.disable('x-powered-by');
app.use(requestId);
app.use(morgan('dev'));
app.use(cors({
  origin: (origin, callback) => callback(null, !origin || corsOrigins.includes(origin)),
}));
app.use(securityHeaders);
app.use(originAndCsrf);
app.use(rateLimit({ name: 'global', max: 300 }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
const authAttemptRateLimit = rateLimit({ name: 'auth-attempt', windowMs: 15 * 60_000, max: 20 });
app.use('/api/auth', (req, res, next) => {
  // Session validation and logout are safe, frequent reads. Only credential
  // attempts consume the stricter authentication rate-limit bucket.
  if (req.method === 'POST' && ['/login', '/register'].includes(req.path)) {
    return authAttemptRateLimit(req, res, next);
  }
  return next();
});

app.get('/health', (req, res) => {
  const environment = String(process.env.AT_USERNAME || '').toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
  res.json({
    ok: true,
    service: "Africa's Talking Voice Suite",
    environment,
    voiceEnvironment: 'live',
    mediaGateway: mediaGateway.status(),
    time: new Date().toISOString(),
  });
});

app.get('/api', (req, res) => {
  res.json({
    ok: true,
    solutions: {
      sms: { send: 'POST /sms/send', bulk: 'POST /sms/bulk', inbound: 'POST /sms/inbound' },
      ussd: { callback: 'POST /ussd' },
      voice: {
        outbound: 'POST /voice/outbound (alias: /voice/call)',
        inbound: 'POST /voice/inbound (alias: /voice/actions)',
        events: 'POST /voice/events',
        logs: 'GET /voice/logs (Bearer VOICE_DASHBOARD_API_KEY)',
        callLog: 'GET /voice/logs/:sessionId (Bearer VOICE_DASHBOARD_API_KEY)',
        ivrFlows: 'GET/POST /voice/ivr/flows; GET/PUT/DELETE /voice/ivr/flows/:businessId (Bearer VOICE_DASHBOARD_API_KEY)',
        businesses: 'GET /voice/businesses?tenantId=...; POST /voice/businesses with tenantId; GET/PUT/DELETE /voice/businesses/:businessId?tenantId=... (Bearer VOICE_DASHBOARD_API_KEY)',
        agents: 'POST /voice/businesses/:businessId/agents?tenantId=...; PUT/DELETE /voice/businesses/:businessId/agents/:agentId?tenantId=... (Bearer VOICE_DASHBOARD_API_KEY)',
        webAgentToken: 'POST /voice/businesses/:businessId/agents/:agentId/capability-token?tenantId=... (Bearer VOICE_DASHBOARD_API_KEY; trusted server only)',
        aiBridge: 'GET/POST /voice/ai/{status,sessions}; POST /voice/ai/sessions/:sessionId/{turn,end} (Bearer NILEAGI_MEDIA_GATEWAY_KEY)',
      },
      airtime: { send: 'POST /airtime/send' },
      whatsapp: { send: 'POST /whatsapp/send', webhook: 'POST /whatsapp/webhook' },
    },
    dashboard: {
      overview: 'GET /api/overview',
      analytics: 'GET /api/analytics',
      collections: 'GET/POST/PATCH/DELETE /api/:collection',
      calls: 'GET /api/calls, GET /api/calls/live, POST /api/calls/outbound, POST /api/voice/capability-token',
      artifacts: 'GET/POST/PATCH /api/calls/:callId/{recording-url,transcription-jobs,summary-jobs,transcript/:segmentId,tasks}',
      ai: 'GET /api/ai/providers/nileagi; GET /api/ai/usage (tenant-scoped, supervisor/admin)',
      auth: 'POST /api/auth/{login,register,logout}; GET /api/auth/me',
      tenants: 'GET /api/tenants; POST /api/tenants/:tenantId/switch (Platform Admin)',
      platform: 'GET/POST/PATCH/DELETE /api/platform/:collection',
    },
  });
});

app.use('/api', require('./routes/dashboard'));
app.use('/sms/send', serviceAuth);
app.use('/sms/bulk', serviceAuth);
app.use('/airtime/send', serviceAuth);
app.use('/whatsapp/send', serviceAuth);
app.use('/voice/call', serviceAuth);
app.use('/voice/outbound', serviceAuth);
app.use('/voice/ai', mediaGatewayAuth, require('./routes/nileagiVoice'));
app.use('/sms', require('./routes/sms'));
app.use('/ussd', require('./routes/ussd'));
app.use('/voice', require('./routes/voice'));
app.use('/airtime', require('./routes/airtime'));
app.use('/whatsapp', require('./routes/whatsapp'));

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

app.use(errorHandler);

if (require.main === module) {
  const server = app.listen(PORT, async () => {
    console.log('Server running on http://localhost:' + PORT);
    const gateway = await mediaGateway.start();
    if (gateway.started) {
      console.log(`[Media Gateway] provider=${gateway.provider} ARI app=${gateway.controller?.app}`);
    } else {
      // Fail closed: the media bridge remains unconfigured and no call is
      // reported connected without gateway evidence.
      console.log(`[Media Gateway] not started: ${gateway.reason}`);
    }
  });

  const shutdown = async (signal) => {
    console.log(`[Server] ${signal} received; shutting down`);
    await mediaGateway.stop().catch((error) => console.error('[Media Gateway] shutdown failed:', error.message));
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

module.exports = app;
