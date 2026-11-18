const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const router = express.Router();

// NOTE:
// Africa's Talking WhatsApp requires a WhatsApp-enabled sender and product setup.
// The official Node SDK may not yet expose a dedicated WhatsApp helper.
// We use REST via axios with AT credentials. Configure the following env vars:
// - AT_USERNAME (already used elsewhere)
// - AT_API_KEY (already used elsewhere)
// - AT_WHATSAPP_API_URL (e.g., https://content.africastalking.com/whatsapp/<send-endpoint>)
// - AT_WHATSAPP_SENDER (your WhatsApp-enabled number or sender identifier)
// - AT_WHATSAPP_WEBHOOK_SECRET (optional: to verify webhook signatures if configured)

function getConfig() {
  return {
    username: process.env.AT_USERNAME,
    apiKey: process.env.AT_API_KEY,
    apiUrl: process.env.AT_WHATSAPP_API_URL,
    sender: process.env.AT_WHATSAPP_SENDER,
  };
}

// Simple request logger for troubleshooting
router.use((req, res, next) => {
  try {
    console.log('[WhatsApp Route][Request]', {
      method: req.method,
      path: req.path,
      query: req.query,
      headers: {
        host: req.get('host'),
        'content-type': req.get('content-type'),
        'user-agent': req.get('user-agent'),
      },
      bodyKeys: Object.keys(req.body || {}),
    });
  } catch (e) {}
  next();
});

// POST /whatsapp/send
// Body: { to: "+2547..." | ["+2547..."], message: "text", mediaUrl?: "https://...", template?: {...} }
router.post('/send', async (req, res) => {
  try {
    const { username, apiKey, apiUrl, sender } = getConfig();
    if (!username || !apiKey) {
      return res.status(500).json({ error: 'Missing AT credentials. Set AT_USERNAME and AT_API_KEY in your .env' });
    }
    if (!apiUrl) {
      return res.status(500).json({ error: 'Missing AT_WHATSAPP_API_URL. Ask support for the correct WhatsApp send endpoint or add it when available.' });
    }

    const { to, message, mediaUrl, template } = req.body || {};
    const toList = Array.isArray(to) ? to : String(to || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (toList.length === 0 || (!message && !template)) {
      return res.status(400).json({ error: 'to and (message or template) are required' });
    }

    const payload = {
      username,
      from: sender, // may be required depending on setup
      to: toList.length === 1 ? toList[0] : toList,
      message,
      mediaUrl,
      template, // if using template messages, pass the object provided by AT guidelines
    };

    // Remove undefined keys
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);

    // Many AT REST endpoints accept x-www-form-urlencoded; others accept JSON.
    // We try JSON first; adjust if your product requires form encoding.
    const response = await axios.post(apiUrl, payload, {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      timeout: 20000,
    });

    return res.json({ ok: true, response: response.data });
  } catch (err) {
    console.error('[WhatsApp][Send] error', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to send WhatsApp message', details: err.response?.data || err.message });
  }
});

// POST /whatsapp/webhook
// Configure this URL in the AT WhatsApp dashboard for inbound events/messages.
// AT will POST events such as inbound messages, delivery reports, etc.
router.post('/webhook', async (req, res) => {
  try {
    const secret = process.env.AT_WHATSAPP_WEBHOOK_SECRET;
    if (secret) {
      const supplied = String(req.get('x-signature') || '').replace(/^sha256=/i, '');
      const expected = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body || {})).digest('hex');
      const suppliedBuffer = Buffer.from(supplied, 'utf8');
      const expectedBuffer = Buffer.from(expected, 'utf8');
      if (!supplied || suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const event = req.body || {};
    console.log('[WhatsApp][Webhook] accepted', { requestId: req.requestId, eventKeys: Object.keys(event) });
    return res.status(202).json({ ok: true, accepted: true, requestId: req.requestId });
  } catch (err) {
    console.error('[WhatsApp][Webhook] error', err.message);
    return res.status(400).json({ error: 'Invalid webhook payload' });
  }
});

module.exports = router;
