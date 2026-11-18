const axios = require('axios');
const configModule = require('./config');
const usage = require('./usageTracker');
const { unavailable, unsupported, configuration, NileagiError } = require('./errors');

function status(env = process.env) {
  const config = configModule.fromEnv(env);
  const missing = [...config.missing];
  const invalid = [...config.invalid];
  let state = 'disabled';
  if (config.enabled && (missing.length || invalid.length)) state = 'blocked';
  else if (config.enabled && ['local-model', 'rafiki-api'].includes(config.adapter) && (config.sttEnabled || config.ttsEnabled || config.voiceEnabled)) state = 'configured';
  else if (config.enabled) state = 'unsupported';
  return {
    name: 'nileagi',
    configured: state === 'configured',
    enabled: config.enabled,
    adapter: config.adapter,
    status: state,
    missing,
    invalid,
    model: config.model || null,
    configuration: {
      apiKeyConfigured: Boolean(config.apiKey),
      baseUrlConfigured: Boolean(config.baseUrl),
      sttUrlConfigured: Boolean(config.sttUrl),
      ttsUrlConfigured: Boolean(config.ttsUrl),
    },
    capabilities: {
      stt: { enabled: config.sttEnabled, supported: ['local-model', 'rafiki-api'].includes(config.adapter), languages: ['sw'] },
      tts: { enabled: config.ttsEnabled, supported: ['local-model', 'rafiki-api'].includes(config.adapter), languages: ['sw'], output: 'wav' },
      voice: {
        enabled: config.voiceEnabled,
        supported: config.adapter === 'rafiki-api',
        transport: config.adapter === 'rafiki-api' ? config.voiceTransport : null,
        liveTelephony: config.adapter === 'rafiki-api' && config.voiceTransport === 'sip-media-gateway',
        requires: config.adapter === 'rafiki-api' ? 'SIP/PBX media gateway for bidirectional call audio' : null,
      },
      streaming: { supported: false },
      english: { supported: false },
    },
    docs: { hostedRafikiApi: config.adapter === 'rafiki-api', verified: config.adapter === 'rafiki-api' },
  };
}

function assertCapability(config, capability, operation) {
  if (!config.enabled) throw unavailable('NileAGI is disabled by configuration', operation);
  if (!['local-model', 'rafiki-api'].includes(config.adapter)) throw unsupported('The configured NileAGI adapter has no verified API contract', operation);
  if (!config[`${capability}Enabled`]) throw unavailable(`NileAGI ${capability.toUpperCase()} is disabled by configuration`, operation);
  if (!config[`${capability}Url`]) throw configuration(`NILEAGI_${capability.toUpperCase()}_URL is required`, operation);
  if (!config.valid) throw configuration(`NileAGI configuration is invalid: ${[...config.missing, ...config.invalid].join(', ')}`, operation);
}

function endpoint(config, path) {
  return `${config.baseUrl.replace(/\/$/, '')}/${String(path || '').replace(/^\//, '')}`;
}

function rafikiHeaders(config, accept, contentType = 'application/json') {
  const headers = { Accept: accept, 'Content-Type': contentType };
  if (config.adapter === 'rafiki-api') headers.Authorization = `Bearer ${config.apiKey}`;
  return headers;
}

function audioBuffer(audio) {
  if (Buffer.isBuffer(audio)) return audio;
  if (audio instanceof Uint8Array) return Buffer.from(audio);
  if (audio instanceof ArrayBuffer) return Buffer.from(audio);
  throw new NileagiError('Audio must be a Buffer or byte array', { code: 'NILEAGI_AUDIO_INVALID', statusCode: 400 });
}

function buildMultipart(audio, filename = 'call.wav', mimeType = 'audio/wav') {
  const boundary = `----nileagi-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const header = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${String(filename).replace(/[^A-Za-z0-9._-]/g, '_')}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([header, audio, footer]), contentType: `multipart/form-data; boundary=${boundary}` };
}

function parseTranscriptionResponse(data, headers = {}) {
  let parsed = data;
  if (Buffer.isBuffer(parsed)) parsed = parsed.toString('utf8');
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch { return { text: parsed.trim(), language: 'sw', final: true, partial: false }; }
  }
  if (!parsed || typeof parsed !== 'object') throw new NileagiError('NileAGI STT returned an invalid response', { code: 'NILEAGI_RESPONSE_INVALID', statusCode: 502 });
  const text = parsed.text || parsed.transcript || parsed.result?.text || parsed.result?.transcript;
  if (typeof text !== 'string') throw new NileagiError('NileAGI STT response did not contain text', { code: 'NILEAGI_RESPONSE_INVALID', statusCode: 502 });
  return { text: text.trim(), language: parsed.language || 'sw', final: parsed.final !== false, partial: parsed.partial === true, timestamps: parsed.timestamps || parsed.segments || null, contentType: headers['content-type'] || null };
}

async function requestWithRetry({ url, method, data, headers, responseType, timeoutMs, maxRetries, operation }) {
  let lastError;
  let retriesPerformed = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await axios({ method, url, data, headers, responseType, timeout: timeoutMs, validateStatus: (value) => value >= 200 && value < 300 });
      response.nileagiRetries = attempt;
      return response;
    } catch (error) {
      lastError = error;
      const statusCode = error.response?.status;
      const retryable = !statusCode || statusCode === 408 || statusCode === 429 || statusCode >= 500;
      if (!retryable || attempt >= maxRetries) break;
      retriesPerformed += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(250 * (2 ** attempt), 2_000)));
    }
  }
  if (lastError && typeof lastError === 'object') lastError.nileagiRetries = retriesPerformed;
  throw new NileagiError(`NileAGI ${operation} request failed`, { code: 'NILEAGI_REQUEST_FAILED', statusCode: lastError?.response?.status || 502, operation, cause: lastError });
}

async function transcribe(audio, options = {}) {
  const config = configModule.fromEnv();
  const operation = 'transcribe';
  assertCapability(config, 'stt', operation);
  const language = String(options.language || 'sw').toLowerCase();
  if (!language.startsWith('sw')) throw unsupported('The verified NileAGI STT model supports Swahili only', operation);
  const bytes = audioBuffer(audio);
  if (!bytes.length) throw new NileagiError('Audio cannot be empty', { code: 'NILEAGI_AUDIO_INVALID', statusCode: 400, operation });
  const multipart = buildMultipart(bytes, options.filename || 'call.wav', options.mimeType || 'audio/wav');
  const hosted = config.adapter === 'rafiki-api';
  const requestData = hosted ? JSON.stringify({ audio: bytes.toString('base64'), language }) : multipart.body;
  const requestHeaders = hosted
    ? rafikiHeaders(config, 'application/json')
    : rafikiHeaders(config, 'application/json, text/plain', multipart.contentType);
  const started = Date.now();
  try {
    const response = await requestWithRetry({ url: hosted ? endpoint(config, 'v1/speech/transcribe/') : config.sttUrl, method: 'post', data: requestData, headers: { ...requestHeaders, ...(hosted ? {} : { 'Content-Length': multipart.body.length }) }, responseType: 'text', timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, operation });
    const result = parseTranscriptionResponse(response.data, response.headers);
    usage.record({ tenantId: options.tenantId, businessId: options.businessId, callId: options.callId, provider: 'nileagi', operation, durationMs: Date.now() - started, inputBytes: bytes.length, inputAudioSeconds: options.audioSeconds, outputCharacters: result.text.length, success: true, retryCount: response.nileagiRetries || 0 });
    return result;
  } catch (error) {
    usage.record({ tenantId: options.tenantId, businessId: options.businessId, callId: options.callId, provider: 'nileagi', operation, durationMs: Date.now() - started, inputBytes: bytes.length, inputAudioSeconds: options.audioSeconds, success: false, errorCode: error.code || 'NILEAGI_REQUEST_FAILED', retryCount: error?.cause?.nileagiRetries || error?.nileagiRetries || 0 });
    throw error;
  }
}

async function synthesize(text, options = {}) {
  const config = configModule.fromEnv();
  const operation = 'synthesize';
  assertCapability(config, 'tts', operation);
  const input = String(text || '').trim();
  if (!input) throw new NileagiError('Text cannot be empty', { code: 'NILEAGI_TEXT_INVALID', statusCode: 400, operation });
  const language = String(options.language || 'sw').toLowerCase();
  if (!language.startsWith('sw')) throw unsupported('The verified NileAGI TTS model supports Swahili only', operation);
  const started = Date.now();
  try {
    const hosted = config.adapter === 'rafiki-api';
    const url = hosted ? `${endpoint(config, 'v1/speech/synthesize/')}?format=wav` : config.ttsUrl;
    const response = await requestWithRetry({ url, method: 'post', data: { text: input, language, ...(options.voice ? { voice: options.voice } : {}) }, headers: rafikiHeaders(config, 'audio/wav, application/json, application/octet-stream'), responseType: 'arraybuffer', timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, operation });
    let audio = Buffer.from(response.data || []);
    const responseType = String(response.headers['content-type'] || '').toLowerCase();
    if (responseType.includes('application/json')) {
      const payload = JSON.parse(audio.toString('utf8'));
      if (!payload.audio_url) throw new NileagiError('Rafiki TTS JSON response did not contain audio_url', { code: 'NILEAGI_RESPONSE_INVALID', statusCode: 502, operation });
      const audioResponse = await requestWithRetry({ url: payload.audio_url, method: 'get', headers: rafikiHeaders(config, 'audio/wav, application/octet-stream'), responseType: 'arraybuffer', timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, operation });
      audio = Buffer.from(audioResponse.data || []);
    }
    if (!audio.length) throw new NileagiError('NileAGI TTS returned empty audio', { code: 'NILEAGI_RESPONSE_INVALID', statusCode: 502, operation });
    usage.record({ tenantId: options.tenantId, businessId: options.businessId, callId: options.callId, provider: 'nileagi', operation, durationMs: Date.now() - started, inputCharacters: input.length, outputBytes: audio.length, success: true, retryCount: response.nileagiRetries || 0 });
    return { audio, mimeType: response.headers['content-type'] || 'audio/wav', sampleRateHz: 24_000, language: 'sw' };
  } catch (error) {
    usage.record({ tenantId: options.tenantId, businessId: options.businessId, callId: options.callId, provider: 'nileagi', operation, durationMs: Date.now() - started, inputCharacters: input.length, success: false, errorCode: error.code || 'NILEAGI_REQUEST_FAILED', retryCount: error?.cause?.nileagiRetries || error?.nileagiRetries || 0 });
    throw error;
  }
}

async function startVoiceSession(options = {}) {
  const config = configModule.fromEnv();
  if (!config.enabled) throw unavailable('NileAGI is disabled by configuration', 'voice-session');
  if (config.adapter !== 'rafiki-api') throw unsupported('Voice sessions require the documented Rafiki API adapter', 'voice-session');
  if (!config.voiceEnabled) throw unavailable('NileAGI voice is disabled by configuration', 'voice-session');
  if (!config.valid) throw configuration(`NileAGI configuration is invalid: ${[...config.missing, ...config.invalid].join(', ')}`, 'voice-session');
  return {
    provider: 'nileagi',
    transport: config.voiceTransport,
    sessionId: options.sessionId ? String(options.sessionId) : null,
    liveTelephony: config.voiceTransport === 'sip-media-gateway',
    note: 'Rafiki Talk turns are HTTP requests; the SIP/media gateway owns call audio transport.',
  };
}

async function health() {
  const config = configModule.fromEnv();
  const response = await requestWithRetry({ url: endpoint(config, 'v1/health/'), method: 'get', headers: { Accept: 'application/json' }, responseType: 'json', timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, operation: 'health' });
  return response.data;
}

async function listVoices(options = {}) {
  const config = configModule.fromEnv();
  if (!config.enabled) throw unavailable('NileAGI is disabled by configuration', 'voices');
  if (config.adapter !== 'rafiki-api') throw unsupported('Voice listing is only available through the documented Rafiki API adapter', 'voices');
  if (!config.apiKey) throw configuration('NILEAGI_API_KEY is required', 'voices');
  const response = await requestWithRetry({ url: endpoint(config, 'v1/voices/'), method: 'get', headers: rafikiHeaders(config, 'application/json'), responseType: 'json', timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, operation: 'voices' });
  return response.data;
}

async function talk(audio, options = {}) {
  const config = configModule.fromEnv();
  const operation = 'talk';
  if (!config.enabled) throw unavailable('NileAGI is disabled by configuration', operation);
  if (config.adapter !== 'rafiki-api') throw unsupported('Talk turns require the documented Rafiki API adapter', operation);
  if (!config.voiceEnabled) throw unavailable('NileAGI voice is disabled by configuration', operation);
  if (!config.valid) throw configuration(`NileAGI configuration is invalid: ${[...config.missing, ...config.invalid].join(', ')}`, operation);
  const bytes = audioBuffer(audio);
  if (!bytes.length) throw new NileagiError('Audio cannot be empty', { code: 'NILEAGI_AUDIO_INVALID', statusCode: 400, operation });
  const language = String(options.language || 'sw').toLowerCase();
  if (!language.startsWith('sw')) throw unsupported('The verified Rafiki integration is configured for Swahili only', operation);
  const started = Date.now();
  try {
    const payload = { audio: bytes.toString('base64'), language };
    if (options.sessionId) payload.session_id = String(options.sessionId);
    const response = await requestWithRetry({ url: `${endpoint(config, 'v1/talk/')}?format=json`, method: 'post', data: payload, headers: rafikiHeaders(config, 'application/json'), responseType: 'json', timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, operation });
    usage.record({ tenantId: options.tenantId, businessId: options.businessId, callId: options.callId, provider: 'nileagi', operation, durationMs: Date.now() - started, inputBytes: bytes.length, inputAudioSeconds: options.audioSeconds, outputCharacters: String(response.data?.reply || response.data?.text || '').length, success: true, retryCount: response.nileagiRetries || 0 });
    return response.data;
  } catch (error) {
    usage.record({ tenantId: options.tenantId, businessId: options.businessId, callId: options.callId, provider: 'nileagi', operation, durationMs: Date.now() - started, inputBytes: bytes.length, inputAudioSeconds: options.audioSeconds, success: false, errorCode: error.code || 'NILEAGI_REQUEST_FAILED', retryCount: error?.cause?.nileagiRetries || error?.nileagiRetries || 0 });
    throw error;
  }
}

module.exports = { status, health, listVoices, transcribe, synthesize, talk, startVoiceSession, parseTranscriptionResponse, buildMultipart };
