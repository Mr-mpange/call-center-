const crypto = require('crypto');
const voiceRealtime = require('./voiceRealtime');
const dashboardStore = require('../utils/dashboardStore');

function clientNameFor(tenantId, email) {
  return `mpange-${tenantId}-${crypto.createHash('sha1').update(String(email || 'agent')).digest('hex').slice(0, 12)}`
    .replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
}

function agentBelongsToUser(agent, user, tenantId) {
  const email = String(user.email || '').toLowerCase();
  // Legacy business records used the agent's `id` field for the dashboard
  // user's id, while newer records store it explicitly as `userId`. Accept
  // both representations so existing browser-agent memberships continue to
  // authorize SIP credentials and the realtime stream.
  return String(agent.userId || agent.id || '') === String(user.id || '') ||
    String(agent.email || '').toLowerCase() === email ||
    String(agent.clientName || '') === clientNameFor(tenantId, email);
}

function membershipsForUser(user, tenantId, businesses) {
  return businesses.filter((business) => (business.agents || []).some((agent) =>
    agent.type === 'web' && agentBelongsToUser(agent, user, tenantId)
  )).map((business) => String(business.id));
}

function eligibleAgents(business, tenantId, users, agentRecords = []) {
  const output = [];
  for (const configured of business.agents || []) {
    if (configured.type !== 'web') continue;
    const user = users.find((candidate) => agentBelongsToUser(configured, candidate, tenantId));
    if (!user || user.status === 'inactive' || !['Agent', 'Supervisor', 'Org Admin'].includes(user.role)) continue;
    const agentRecord = agentRecords.find((candidate) =>
      String(candidate.userId || candidate.user_id || candidate.email || candidate.id || '').toLowerCase() === String(user.id || user.email || '').toLowerCase() ||
      String(candidate.email || '').toLowerCase() === String(user.email || '').toLowerCase()
    );
    if (agentRecord && !['available', 'online', 'active', 'ready'].includes(String(agentRecord.status || 'available').toLowerCase())) continue;
    if (!voiceRealtime.onlinePresence(tenantId, user.email) || voiceRealtime.isBusy(tenantId, user.email) || dashboardStore.isInboundAgentBusy(tenantId, configured.id || user.id)) continue;
    if (output.some((agent) => agent.id === String(configured.id || user.id))) continue;
    output.push({
      id: String(configured.id || user.id),
      userId: String(user.id),
      email: String(user.email).toLowerCase(),
      name: String(configured.name || user.name || 'Agent'),
      clientName: configured.clientName || clientNameFor(tenantId, user.email),
    });
  }
  return output;
}

module.exports = { clientNameFor, membershipsForUser, eligibleAgents };
