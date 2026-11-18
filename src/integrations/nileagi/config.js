const SUPPORTED_ADAPTERS = new Set(['none', 'local-model', 'rafiki-api']);
const RAFIKI_API_BASE_URL = 'https://api.rafiki.nileagi.com';

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function asPositiveInteger(value, fallback, maximum = 120_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

function clean(value) {
  return String(value || '').trim();
}

function validUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

function fromEnv(env = process.env) {
  const enabled = asBoolean(env.NILEAGI_ENABLED, false);
  const adapter = clean(env.NILEAGI_ADAPTER).toLowerCase() || 'none';
  const sttEnabled = enabled && asBoolean(env.NILEAGI_STT_ENABLED, false);
  const ttsEnabled = enabled && asBoolean(env.NILEAGI_TTS_ENABLED, false);
  const voiceEnabled = enabled && asBoolean(env.NILEAGI_VOICE_ENABLED, false);
  const baseUrl = clean(env.NILEAGI_BASE_URL) || (adapter === 'rafiki-api' ? RAFIKI_API_BASE_URL : '');
  const config = {
    enabled,
    adapter,
    testMode: asBoolean(env.NILEAGI_TEST_MODE, false),
    apiKey: clean(env.NILEAGI_API_KEY),
    baseUrl,
    model: clean(env.NILEAGI_MODEL),
    timeoutMs: asPositiveInteger(env.NILEAGI_TIMEOUT_MS, 30_000),
    maxRetries: Math.min(asPositiveInteger(env.NILEAGI_MAX_RETRIES, 3, 10), 5),
    logLevel: clean(env.NILEAGI_LOG_LEVEL).toLowerCase() || 'info',
    sttEnabled,
    ttsEnabled,
    voiceEnabled,
    voiceTransport: clean(env.NILEAGI_VOICE_TRANSPORT).toLowerCase() || 'http-turns',
    mediaGatewayKey: clean(env.NILEAGI_MEDIA_GATEWAY_KEY),
    sttUrl: clean(env.NILEAGI_STT_URL) || (adapter === 'rafiki-api' ? `${baseUrl}/v1/speech/transcribe/` : ''),
    ttsUrl: clean(env.NILEAGI_TTS_URL) || (adapter === 'rafiki-api' ? `${baseUrl}/v1/speech/synthesize/` : ''),
  };

  const missing = [];
  const invalid = [];
  if (!SUPPORTED_ADAPTERS.has(adapter)) invalid.push('NILEAGI_ADAPTER');
  if (enabled && adapter === 'local-model') {
    if (sttEnabled && !config.sttUrl) missing.push('NILEAGI_STT_URL');
    if (ttsEnabled && !config.ttsUrl) missing.push('NILEAGI_TTS_URL');
    if (config.sttUrl && !validUrl(config.sttUrl)) invalid.push('NILEAGI_STT_URL');
    if (config.ttsUrl && !validUrl(config.ttsUrl)) invalid.push('NILEAGI_TTS_URL');
  }
  if (enabled && adapter === 'rafiki-api') {
    if (!config.apiKey) missing.push('NILEAGI_API_KEY');
    if (!config.baseUrl) missing.push('NILEAGI_BASE_URL');
    if (config.baseUrl && !validUrl(config.baseUrl)) invalid.push('NILEAGI_BASE_URL');
    if (!['http-turns', 'sip-media-gateway'].includes(config.voiceTransport)) invalid.push('NILEAGI_VOICE_TRANSPORT');
    if (config.voiceEnabled && config.voiceTransport === 'sip-media-gateway' && !config.mediaGatewayKey) missing.push('NILEAGI_MEDIA_GATEWAY_KEY');
  }
  if (enabled && adapter === 'none' && (sttEnabled || ttsEnabled || voiceEnabled)) {
    invalid.push('NILEAGI_ADAPTER');
  }
  return { ...config, missing, invalid, valid: missing.length === 0 && invalid.length === 0 };
}

module.exports = { SUPPORTED_ADAPTERS, RAFIKI_API_BASE_URL, fromEnv, validUrl };
