const crypto = require('crypto');

// Process-local SSE transport. Presence is intentionally tied to an open
// authenticated browser stream and expires when that stream closes.
const clients = new Map();
const presence = new Map();
const busyAgents = new Set();

function roomKey(tenantId, businessId) { return `${tenantId}:${businessId}`; }
function presenceKey(tenantId, email) { return `${tenantId}:${String(email).toLowerCase()}`; }

function subscribe({ tenantId, email, userId, userName, memberships, response }) {
  const id = crypto.randomUUID();
  const entry = { id, tenantId, email, userId, userName, memberships: new Set(memberships), response };
  clients.set(id, entry);
  presence.set(presenceKey(tenantId, email), { ...entry, lastSeen: Date.now() });
  for (const businessId of memberships) publish(tenantId, businessId, {
    type: 'agent_presence_updated', tenantId, businessId,
    agent: { id: userId, name: userName, status: 'available' },
  });
  return () => {
    clients.delete(id);
    const key = presenceKey(tenantId, email);
    const other = [...clients.values()].find((client) => client.tenantId === tenantId && client.email.toLowerCase() === String(email).toLowerCase() && !client.response.writableEnded);
    if (other) {
      presence.set(key, { ...other, lastSeen: Date.now() });
    } else {
      presence.delete(key);
      for (const businessId of memberships) publish(tenantId, businessId, {
        type: 'agent_presence_updated', tenantId, businessId,
        agent: { id: userId, name: userName, status: 'offline' },
      });
    }
  };
}

function isOnline(tenantId, email) {
  const item = presence.get(presenceKey(tenantId, email));
  return Boolean(item && Date.now() - item.lastSeen < 45_000 && !item.response.writableEnded);
}

function publish(tenantId, businessId, event) {
  const key = roomKey(tenantId, businessId);
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients.values()) {
    if (client.tenantId === tenantId && client.memberships.has(String(businessId)) && !client.response.writableEnded) {
      client.response.write(payload);
    }
  }
}

function publishToAgent(tenantId, email, event) {
  const target = String(email || '').toLowerCase();
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  let delivered = false;
  for (const client of clients.values()) {
    if (client.tenantId === tenantId && client.email.toLowerCase() === target && !client.response.writableEnded) {
      client.response.write(payload);
      delivered = true;
    }
  }
  return delivered;
}

function publishToOthers(tenantId, businessId, excludedEmail, event) {
  const excluded = String(excludedEmail || '').toLowerCase();
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of clients.values()) {
    if (client.tenantId === tenantId && client.email.toLowerCase() !== excluded && client.memberships.has(String(businessId)) && !client.response.writableEnded) {
      client.response.write(payload);
    }
  }
}

function onlinePresence(tenantId, email) { return isOnline(tenantId, email); }
function isBusy(tenantId, email) { return busyAgents.has(presenceKey(tenantId, email)); }
function markBusy(tenantId, email, busy) {
  const key = presenceKey(tenantId, email);
  if (busy) busyAgents.add(key);
  else busyAgents.delete(key);
}

function touch(tenantId, email) {
  const key = presenceKey(tenantId, email);
  const current = presence.get(key);
  if (current) presence.set(key, { ...current, lastSeen: Date.now() });
  return Boolean(current);
}

module.exports = { subscribe, publish, publishToAgent, publishToOthers, onlinePresence, isBusy, markBusy, touch };
