const axios = require('axios');

const username = process.env.AT_USERNAME || 'sandbox';
const apiKey = process.env.AT_API_KEY || '';
const sandbox = username.toLowerCase() === 'sandbox';
const apiBase = sandbox ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
// Africa's Talking Voice is always a live provider integration for this
// application. The SMS/Airtime REST environment may still use the sandbox.
const voiceBase = 'https://voice.africastalking.com';

if (!process.env.AT_USERNAME || !process.env.AT_API_KEY) {
  console.warn('[WARN] AT_USERNAME or AT_API_KEY missing. Provider calls will fail closed until configured.');
}

const maskedApiKey = apiKey ? `${apiKey.slice(0, 4)}...${apiKey.slice(-2)}` : 'not-set';
console.log('[AT Config]', { username, environment: sandbox ? 'SANDBOX' : 'LIVE', voiceEnvironment: 'LIVE', apiKey: maskedApiKey });

function assertConfigured() {
  if (!apiKey) {
    const error = new Error('AT_API_KEY is not configured');
    error.status = 503;
    throw error;
  }
}

async function formPost(path, fields) {
  assertConfigured();
  const form = new URLSearchParams({ username, ...fields });
  const response = await axios.post(`${apiBase}${path}`, form.toString(), {
    headers: { apikey: apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20_000,
    maxContentLength: 2 * 1024 * 1024,
    maxBodyLength: 2 * 1024 * 1024,
  });
  return response.data;
}

async function voiceFormPost(path, fields) {
  assertConfigured();
  const form = new URLSearchParams({ username, ...fields });
  const response = await axios.post(`${voiceBase}${path}`, form.toString(), {
    headers: { apikey: apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 20_000,
    maxContentLength: 2 * 1024 * 1024,
    maxBodyLength: 2 * 1024 * 1024,
  });
  return response.data;
}

const SMS = {
  send: (options = {}) => formPost('/version1/messaging', {
    to: Array.isArray(options.to) ? options.to.join(',') : String(options.to || ''),
    message: String(options.message || ''),
    ...(options.from ? { from: String(options.from) } : {}),
    ...(options.linkId ? { linkId: String(options.linkId) } : {}),
  }),
};

const AIRTIME = {
  send: (options = {}) => formPost('/version1/airtime/send', {
    recipients: JSON.stringify(options.recipients || []),
    ...(options.maxNumRetry !== undefined ? { maxNumRetry: String(options.maxNumRetry) } : {}),
  }),
};

const VOICE = {
  // queueStatus is a provider-side, non-call check that accepts only an
  // Africa's Talking-issued virtual number for the authenticated account.
  verifyNumber: async (phoneNumber) => {
    const result = await voiceFormPost('/queueStatus', { phoneNumbers: String(phoneNumber || '') });
    if (String(result?.status || '').toLowerCase() !== 'success') {
      const error = new Error(String(result?.errorMessage || 'Provider rejected this number'));
      error.response = { status: 400, data: result };
      throw error;
    }
    return result;
  },
};

module.exports = { SMS, AIRTIME, VOICE, username, apiKey };
