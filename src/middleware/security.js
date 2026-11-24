const crypto = require('crypto');

const buckets = new Map();

function requestId(req, res, next) {
  const id = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 100);
  res.setHeader('X-Request-Id', id);
  req.requestId = id;
  next();
}

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  // Browser agents need microphone capture for the softphone. Keep camera and
  // geolocation disabled while allowing same-origin getUserMedia(audio).
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

function rateLimit({ windowMs = 60_000, max = 120, name = 'default', key = (req) => req.ip || req.socket.remoteAddress || 'unknown' } = {}) {
  return (req, res, next) => {
    const now = Date.now();
    const bucketKey = `${name}:${key(req)}`;
    const current = buckets.get(bucketKey);
    const bucket = !current || now >= current.resetAt ? { count: 0, resetAt: now + windowMs } : current;
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
    if (buckets.size > 10_000) {
      for (const [entryKey, entry] of buckets) if (entry.resetAt <= now) buckets.delete(entryKey);
    }
    res.setHeader('RateLimit-Limit', max);
    res.setHeader('RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('RateLimit-Reset', Math.ceil(bucket.resetAt / 1000));
    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', retryAfterSeconds);
      return res.status(429).json({ error: 'Too many requests', retryAfterSeconds });
    }
    return next();
  };
}

function allowedOrigins() {
  const configured = String(process.env.CORS_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
  if (configured.length || process.env.NODE_ENV === 'production') return configured;
  return ['http://localhost:5173', 'http://127.0.0.1:5173'];
}

function originAndCsrf(req, res, next) {
  const stateChanging = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (!stateChanging) return next();
  const path = req.path || '';
  if (path.startsWith('/sms/inbound') || path.startsWith('/ussd') || path.startsWith('/voice') || path.startsWith('/whatsapp/webhook')) return next();
  if (path === '/api/auth/login' || path === '/api/auth/register') return next();
  const origin = req.get('origin');
  const origins = allowedOrigins();
  if (origin && (!origins.length || !origins.includes(origin))) return res.status(403).json({ error: 'Origin is not allowed' });
  if (path.startsWith('/api/') && !req.get('authorization')) return res.status(403).json({ error: 'Bearer authentication is required for state-changing API requests' });
  return next();
}

function serviceAuth(req, res, next) {
  const expected = String(process.env.SERVICE_API_KEY || '');
  const supplied = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || expected.length < 32) return res.status(503).json({ error: 'SERVICE_API_KEY is not configured' });
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

function mediaGatewayAuth(req, res, next) {
  const expected = String(process.env.NILEAGI_MEDIA_GATEWAY_KEY || '');
  const supplied = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || expected.length < 32) return res.status(503).json({ error: 'NILEAGI_MEDIA_GATEWAY_KEY is not configured' });
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)) return res.status(401).json({ error: 'Unauthorized' });
  return next();
}

function resetForTests() {
  buckets.clear();
}

module.exports = { requestId, securityHeaders, rateLimit, originAndCsrf, serviceAuth, mediaGatewayAuth, resetForTests, allowedOrigins };
