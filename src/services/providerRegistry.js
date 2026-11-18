const axios = require('axios');
const nileagi = require('../integrations/nileagi/client');

const definitions = {
  gemini: { required: ['GEMINI_API_KEY'] },
  recording: { required: ['RECORDING_BASE_URL', 'RECORDING_SIGNING_SECRET'] },
  transcription: { required: ['TRANSCRIPTION_PROVIDER_URL', 'TRANSCRIPTION_PROVIDER_KEY'] },
  summarization: { required: ['SUMMARY_PROVIDER_URL', 'SUMMARY_PROVIDER_KEY'] },
  billing: { required: ['BILLING_PROVIDER_URL', 'BILLING_PROVIDER_KEY'] },
  email: { required: ['EMAIL_PROVIDER_URL', 'EMAIL_PROVIDER_KEY'] },
  aiTraining: { required: ['AI_TRAINING_PROVIDER_URL', 'AI_TRAINING_PROVIDER_KEY'] },
  integrationHealth: { required: ['INTEGRATION_HEALTH_PROVIDER_URL', 'INTEGRATION_HEALTH_PROVIDER_KEY'] },
  // NileAGI is intentionally not represented by a generic URL/key pair:
  // its public Rafiki page does not publish a hosted API contract. The
  // dedicated adapter reports its verified local-model configuration instead.
  nileagi: { required: [] },
};

function status(name) {
  if (name === 'nileagi') return nileagi.status();
  const definition = definitions[name];
  if (!definition) return { name, configured: false, status: 'unknown', missing: [] };
  const missing = definition.required.filter((key) => !String(process.env[key] || '').trim());
  return { name, configured: missing.length === 0, status: missing.length === 0 ? 'configured' : 'unavailable', missing };
}

function allStatuses() {
  return Object.keys(definitions).map(status);
}

function providerConfig(name) {
  const current = status(name);
  if (!current.configured) {
    const error = new Error(`${name} provider is not configured`);
    error.statusCode = 503;
    error.provider = current;
    throw error;
  }
  const definition = definitions[name];
  const urlKey = definition.required.find((key) => key.endsWith('_URL'));
  const keyKey = definition.required.find((key) => key.endsWith('_KEY'));
  return { url: process.env[urlKey], key: process.env[keyKey] };
}

async function request(name, path, payload, method = 'post') {
  const config = providerConfig(name);
  const response = await axios({
    method,
    url: `${config.url.replace(/\/$/, '')}/${String(path || '').replace(/^\//, '')}`,
    data: payload,
    timeout: 20_000,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    validateStatus: (value) => value >= 200 && value < 300,
  });
  return response.data;
}

async function geminiGenerate(prompt) {
  return geminiGenerateParts([{ text: String(prompt || '').slice(0, 30_000) }]);
}

async function geminiGenerateParts(parts) {
  const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) {
    const error = new Error('Gemini provider is not configured');
    error.statusCode = 503;
    error.provider = status('gemini');
    throw error;
  }
  const model = String(process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  const response = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    { contents: [{ parts }] },
    { timeout: 30_000, headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, validateStatus: (value) => value >= 200 && value < 300 },
  );
  return response.data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('')?.trim() || '';
}

async function geminiTranscribe(audio, mimeType = 'audio/wav') {
  const data = Buffer.isBuffer(audio) ? audio.toString('base64') : Buffer.from(audio).toString('base64');
  return geminiGenerateParts([
    { inlineData: { mimeType: String(mimeType || 'audio/wav'), data } },
    { text: 'Transcribe this customer-service call. Return only the transcript as plain text. Put each speaker turn on a new line and prefix each line with CUSTOMER: or AGENT: when the speaker can be identified. Do not invent words.' },
  ]);
}

module.exports = { definitions, status, allStatuses, providerConfig, request, geminiGenerate, geminiTranscribe, nileagi };
