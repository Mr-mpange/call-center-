const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const dashboardStore = require('../utils/dashboardStore');
const providers = require('../services/providerRegistry');
const at = require('../config/at');
const voiceRealtime = require('../services/voiceRealtime');
const voiceAgentRouting = require('../services/voiceAgentRouting');
const voiceBusinessStore = require('../utils/voiceBusinessStore');
const mediaBridge = require('../services/mediaBridge').mediaBridge;
const { getMediaBridgeAdapter } = require('../services/mediaBridge');
const mediaGateway = require('../services/mediaGateway');
const sipIdentityStore = require('../services/sipIdentityStore');

const router = express.Router();

const aliases = {
  calls: 'history',
  'call-history': 'history',
  'live-calls': 'liveCalls',
  'phone-numbers': 'phoneNumbers',
  'audit-log': 'auditLog',
  'help-articles': 'helpArticles',
  'role-permissions': 'rolePermissions',
};

const collectionNames = new Set([
  'agents', 'history', 'calls', 'call-history', 'live-calls', 'contacts', 'queues', 'callbacks',
  'voicemails', 'tickets', 'feedback', 'campaigns', 'integrations', 'phone-numbers', 'invoices',
  'audit-log', 'users', 'help-articles', 'faqs', 'intents', 'role-permissions', 'settings', 'support',
]);

function collectionKey(name) {
  return aliases[name] || name;
}

function listResponse(res, key, rows, page, total, limit = rows.length || 1, fallbackAgent) {
  const plural = key === 'history' ? 'calls' : key;
  const safeRows = rows.map((row) => publicRecord(key === 'history' ? normalizedCallRecord(row, fallbackAgent) : row));
  return res.json({
    ok: true,
    data: safeRows,
    [plural]: safeRows,
    pagination: { page, limit, total, pageCount: total ? Math.ceil(total / limit) : 0 },
  });
}

function publicRecord(record) {
  if (!record || typeof record !== 'object') return record;
  const { passwordHash: _passwordHash, ...safe } = record;
  return safe;
}

function normalizedCallRecord(call, fallbackAgent) {
  if (!call || typeof call !== 'object') return call;
  return {
    ...call,
    caller: call.caller && !/^unknown caller$/i.test(String(call.caller)) ? call.caller : 'Customer',
    queue: call.queue || 'General',
    agent: call.agent || call.agentId || (call.direction === 'outbound' ? fallbackAgent : '') || 'Unassigned',
  };
}

function fallbackAgentForStore(req, store) {
  const user = currentUser(req, store);
  if (user?.role === 'Agent' && user.name) return user.name;
  const activeUsers = (store.users || []).filter((item) => item.role === 'Agent' && item.status !== 'disabled' && item.name);
  if (activeUsers.length === 1) return activeUsers[0].name;
  const configuredAgents = (store.agents || []).filter((item) => item.name && item.status !== 'offline');
  if (configuredAgents.length === 1) return configuredAgents[0].name;
  return user?.name || '';
}

function parsePagination(query) {
  const limit = Math.max(1, Math.min(1000, Number(query.limit || query.perPage || 50)));
  const page = Math.max(1, Number(query.page || 1));
  const offset = query.offset === undefined ? (page - 1) * limit : Math.max(0, Number(query.offset));
  return { limit, page, offset };
}

function matchesQuery(row, query) {
  const q = String(query.q || query.search || '').trim().toLowerCase();
  if (q && !JSON.stringify(row).toLowerCase().includes(q)) return false;
  for (const field of ['status', 'queue', 'team', 'role', 'direction', 'priority', 'category', 'channel', 'outcome', 'type']) {
    if (query[field] && String(row[field]).toLowerCase() !== String(query[field]).toLowerCase()) return false;
  }
  return true;
}

function getRows(store, name) {
  const key = collectionKey(name);
  const rows = store[key];
  if (!Array.isArray(rows)) return null;
  return { key, rows };
}

function getItem(store, name, itemId) {
  const result = getRows(store, name);
  return result ? result.rows.find((item) => String(item.id) === String(itemId)) : undefined;
}

function now() {
  return new Date().toISOString();
}

function parseGeminiSummary(text) {
  const empty = { reason: 'Not established.', discussion: [], resolution: 'Not established.', unresolved: [], nextSteps: [], suggestions: [] };
  const candidate = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(candidate);
    return {
      reason: String(parsed.reason || empty.reason),
      discussion: Array.isArray(parsed.discussion) ? parsed.discussion.map(String) : [],
      resolution: String(parsed.resolution || empty.resolution),
      unresolved: Array.isArray(parsed.unresolved) ? parsed.unresolved.map(String) : [],
      nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps.map(String) : [],
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.map(String) : [],
    };
  } catch {
    return { ...empty, reason: candidate || empty.reason };
  }
}

function normalizeVoiceNumber(value) {
  const normalized = String(value || '').replace(/[^\d+]/g, '');
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : '';
}

function configuredTenantVoiceNumbers(tenantId) {
  const numbers = [];
  const add = (value) => {
    const normalized = normalizeVoiceNumber(value);
    if (normalized && !numbers.includes(normalized)) numbers.push(normalized);
  };

  const tenantStore = dashboardStore.read(tenantId);
  const platformStores = [tenantStore];
  // Older platform-admin writes may have been saved in the shared workspace
  // state. Read those as a compatibility fallback, but keep the tenant filter
  // so one organization's number cannot be used by another organization.
  if (String(tenantId) !== 'workspace') platformStores.push(dashboardStore.read('workspace'));

  for (const platformStore of platformStores) {
    const telephony = platformStore.platform?.collections?.telephony;
    if (Array.isArray(telephony)) {
      telephony
        .filter((record) => String(record.kind || '').toLowerCase() === 'number' && String(record.tenantId || '') === String(tenantId))
        .forEach((record) => add(record.name || record.number));
    }

    const business = platformStore.platform?.collections?.businesses?.find((record) => String(record.tenantId || record.businessId || '') === String(tenantId));
    if (business) {
      const businessNumbers = Array.isArray(business.phoneNumbers) ? business.phoneNumbers : String(business.phoneNumbers || '').split(',');
      businessNumbers.forEach(add);
    }
  }

  if (Array.isArray(tenantStore.phoneNumbers)) {
    tenantStore.phoneNumbers.forEach((record) => add(record.number || record.name || record.phone));
  }
  add(tenantStore.settings?.company?.phone);
  return numbers;
}

function callArtifactsFor(store, call, tenantId = 'workspace') {
  const saved = store.callArtifacts[call.id] || {};
  const recordingSource = dashboardStore.getRecordingSource(tenantId, call.id);
  const sourceProviderReady = recordingSource?.sourceUrl || (recordingSource?.storageKey && providers.status('recording').configured);
  const geminiReady = providers.status('gemini').configured;
  const recording = { status: sourceProviderReady ? recordingSource.status : 'unavailable', source: recordingSource ? 'backend' : 'not-configured', url: recordingSource?.sourceUrl || null, sourceUrl: recordingSource?.sourceUrl || null, storageKey: recordingSource?.storageKey || null, mimeType: recordingSource?.mimeType || null, message: recordingSource && !sourceProviderReady ? 'A recording source exists, but its protected media URL is not available.' : recordingSource ? '' : 'No recording source is attached to this call.', durationSec: recordingSource?.durationSec ?? (Number(call.durationSec) || 0), updatedAt: now(), ...(saved.recording || {}) };
  const transcription = { status: 'unavailable', source: geminiReady ? 'gemini' : 'not-configured', language: 'Not established', segments: [], message: geminiReady ? (recordingSource?.sourceUrl ? 'Gemini transcription is ready to process this recording.' : 'Attach a recording source URL before starting Gemini transcription.') : 'Transcription service is not configured for this organization.', updatedAt: now(), ...(saved.transcription || {}) };
  const summarization = { status: 'unavailable', source: geminiReady ? 'gemini' : 'not-configured', summary: { reason: 'Not established.', discussion: [], resolution: 'Not established.', unresolved: [], nextSteps: [], suggestions: [] }, message: geminiReady ? 'Gemini summary has not been generated yet.' : 'No summarization provider is configured.', updatedAt: now(), ...(saved.summarization || {}) };
  // Artifacts saved before Gemini was configured must not permanently hide the
  // now-available Gemini actions behind the old not-configured state.
  if (geminiReady && transcription.status === 'unavailable') Object.assign(transcription, { source: 'gemini', message: recordingSource?.sourceUrl ? 'Gemini transcription is ready to process this recording.' : 'Attach a recording source URL before starting Gemini transcription.' });
  if (geminiReady && summarization.source === 'not-configured' && summarization.status === 'unavailable') Object.assign(summarization, { source: 'gemini', message: 'Gemini summary has not been generated yet.' });
  if (sourceProviderReady && recording.source === 'not-configured' && recording.status === 'unavailable') Object.assign(recording, { status: recordingSource.status, source: 'backend', url: recordingSource.sourceUrl || null, message: '' });
  return {
    tenantId: saved.tenantId || tenantId,
    callId: call.id,
    recording,
    transcription,
    summarization,
    notes: Array.isArray(saved.notes) ? saved.notes : [],
    tasks: Array.isArray(saved.tasks) ? saved.tasks : [],
    corrections: Array.isArray(saved.corrections) ? saved.corrections : [],
    confirmedOutcome: saved.confirmedOutcome || call.outcome || 'Not established',
  };
}

function historyForRange(history, range, fromDate, toDate) {
  if (range === 'custom') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate || '')) return [];
    const start = Date.parse(`${fromDate}T00:00:00.000`);
    const endDate = /^\d{4}-\d{2}-\d{2}$/.test(toDate || '') ? toDate : fromDate;
    const end = Date.parse(`${endDate}T23:59:59.999`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
    return history.filter((item) => {
      const timestamp = Date.parse(item.at || item.createdAt || '');
      return Number.isFinite(timestamp) && timestamp >= start && timestamp <= end;
    });
  }
  const end = Date.now();
  const duration = range === 'today' ? 24 * 60 * 60_000 : range === '7d' ? 7 * 24 * 60 * 60_000 : range === '14d' ? 14 * 24 * 60 * 60_000 : range === '30d' ? 30 * 24 * 60 * 60_000 : range === 'month' ? Date.now() - new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() : null;
  if (!duration) return history;
  return history.filter((item) => {
    const timestamp = Date.parse(item.at || item.createdAt || '');
    return Number.isFinite(timestamp) && timestamp >= end - duration && timestamp <= end;
  });
}

function volumeByHour(history) {
  const buckets = new Map();
  for (const call of history) {
    const date = new Date(call.at || call.createdAt || '');
    if (!Number.isFinite(date.getTime())) continue;
    const hour = `${String(date.getHours()).padStart(2, '0')}:00`;
    const bucket = buckets.get(hour) || { hour, inbound: 0, outbound: 0, missed: 0 };
    if (call.direction === 'outbound') bucket.outbound += 1;
    else bucket.inbound += 1;
    if (['missed', 'abandoned'].includes(call.outcome)) bucket.missed += 1;
    buckets.set(hour, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.hour.localeCompare(b.hour));
}

function audit(store, action, target, recordId) {
  if (!Array.isArray(store.auditLog)) store.auditLog = [];
  store.auditLog.unshift({
    id: dashboardStore.id('audit'),
    at: now(),
    user: 'API user',
    action,
    target: `${target} · ${recordId}`,
    ip: 'api',
    severity: 'normal',
  });
  store.auditLog = store.auditLog.slice(0, 500);
}

function validateId(idValue) {
  return typeof idValue === 'string' && /^[A-Za-z0-9_-]{2,80}$/.test(idValue);
}

function sanitizeRecord(body) {
  const record = { ...(body || {}) };
  delete record.id;
  delete record.createdAt;
  delete record.updatedAt;
  delete record.passwordHash;
  return record;
}

function normalizePlatformSetting(values, rows, existingId = null) {
  const setting = String(values.setting || '').trim();
  if (!setting) return { error: 'Setting name is required' };
  const duplicate = rows.find((row) => String(row.setting || '').trim().toLowerCase() === setting.toLowerCase() && String(row.id) !== String(existingId || ''));
  if (duplicate) return { error: 'A platform setting with this name already exists' };
  const status = String(values.status || 'active').trim().toLowerCase();
  if (!['active', 'inactive', 'draft'].includes(status)) return { error: 'Setting status must be active, inactive, or draft' };
  return {
    values: {
      ...values,
      setting,
      category: String(values.category || 'general').trim() || 'general',
      value: values.value === undefined || values.value === null ? '' : String(values.value),
      status,
      updated: now(),
    },
  };
}

function resourceName(key) {
  if (key === 'history') return 'call';
  if (key === 'feedback') return 'feedback';
  if (key === 'phoneNumbers') return 'phoneNumber';
  if (key.endsWith('ies')) return `${key.slice(0, -3)}y`;
  return key.endsWith('s') ? key.slice(0, -1) : key;
}

function authToken(email, tenantId, role) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET must be configured with at least 32 characters');
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: email, tid: tenantId, role, iat: nowSeconds, exp: nowSeconds + 8 * 60 * 60 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isConfiguredPlatformAdmin(email) {
  const configured = String(process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return configured.includes(String(email || '').toLowerCase());
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function passwordMatches(password, stored) {
  if (typeof stored !== 'string' || !stored.includes(':')) return false;
  const [salt, expectedHex] = stored.split(':');
  try {
    const actual = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return expected.length === actual.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function bearerAuth(req) {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token.includes('.')) return null;
  try {
    const [payload, signature] = token.split('.');
    const secret = process.env.AUTH_SECRET;
    if (!secret || secret.length < 32) return null;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!decoded.sub || !decoded.tid || !Number.isFinite(decoded.exp) || decoded.exp <= Math.floor(Date.now() / 1000)) return null;
    return { email: decoded.sub, tenantId: decoded.tid, role: decoded.role || null };
  } catch {
    return null;
  }
}

function authRequired() {
  return String(process.env.API_AUTH_REQUIRED ?? 'true').toLowerCase() !== 'false' || process.env.NODE_ENV === 'production';
}

function maybeRequireAuth(req, res, next) {
  const auth = bearerAuth(req);
  if (authRequired() && !auth) return res.status(401).json({ error: 'Authentication required' });
  req.auth = auth;
  req.userEmail = auth?.email || null;
  req.tenantId = auth?.tenantId || 'workspace';
  return dashboardStore.runWithTenant(req.tenantId, next);
}

function currentRole(req, store) {
  if (!req.userEmail) return null;
  if (req.auth?.role === 'Platform Admin' || isConfiguredPlatformAdmin(req.userEmail)) return 'Platform Admin';
  return store.users.find((item) => item.email === req.userEmail)?.role || null;
}

function currentUser(req, store) {
  if (!req.userEmail || !Array.isArray(store.users)) return null;
  return store.users.find((item) => item.email === req.userEmail) || null;
}

function requireRoles(req, res, store, roles) {
  if (!roles.includes(currentRole(req, store))) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

const rolePermissionKeys = { 'Org Admin': 'admin', Supervisor: 'supervisor', Agent: 'agent' };

function hasRolePermission(req, store, permission) {
  const role = currentRole(req, store);
  if (role === 'Platform Admin') return true;
  const key = rolePermissionKeys[role];
  const configured = Array.isArray(store.rolePermissions) ? store.rolePermissions.find((entry) => entry.perm === permission) : null;
  return Boolean(key && configured?.[key] === true);
}

function requirePermission(req, res, store, permission) {
  if (!hasRolePermission(req, store, permission)) {
    res.status(403).json({ error: 'This role does not have the required permission' });
    return false;
  }
  return true;
}

const adminOnlyCollections = new Set(['users', 'settings', 'invoices', 'integrations', 'phone-numbers', 'audit-log']);
const supervisorCollections = new Set(['agents', 'queues', 'campaigns']);
const tenantRoles = new Set(['Org Admin', 'Supervisor', 'Agent']);
const rolePermissionNames = new Set([
  'Take & make calls',
  'Listen / whisper / barge',
  'Edit queues & IVR',
  'View analytics',
  'Export call recordings',
  'Manage users & billing',
]);

function requireCollectionRead(req, res, store, collection) {
  if (collection === 'rolePermissions') return requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Agent', 'Platform Admin']);
  if (adminOnlyCollections.has(collection)) return requireRoles(req, res, store, ['Org Admin', 'Platform Admin']) && requirePermission(req, res, store, 'Manage users & billing');
  if (supervisorCollections.has(collection)) return requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']);
  return true;
}

function requireCollectionWrite(req, res, store, collection) {
  if (collection === 'contacts' && currentRole(req, store) === 'Agent') {
    res.status(403).json({ error: 'Customer records are matched from reached caller numbers and cannot be created by agents' });
    return false;
  }
  if (adminOnlyCollections.has(collection)) return requireRoles(req, res, store, ['Org Admin', 'Platform Admin']) && requirePermission(req, res, store, 'Manage users & billing');
  if (supervisorCollections.has(collection)) return requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']);
  return true;
}

function requirePlatformAdmin(req, res, store) {
  return requireRoles(req, res, store, ['Platform Admin']);
}

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(String(email || '')) || String(password || '').length < 8) {
    return res.status(400).json({ error: 'A valid email and a password of at least 8 characters are required' });
  }
  const match = dashboardStore.findUserByEmail(email);
  const user = match?.user;
  if (!user || !passwordMatches(password, user.passwordHash)) return res.status(401).json({ error: 'Invalid email or password' });
  if (user.status === 'disabled') return res.status(403).json({ error: 'User is disabled' });
  const store = dashboardStore.read(match.tenantId);
  const persistedUser = store.users.find((item) => item.id === user.id || String(item.email || '').toLowerCase() === String(email).toLowerCase()) || user;
  persistedUser.lastLogin = now();
  dashboardStore.write(store, match.tenantId);
  const { passwordHash: _passwordHash, ...safeUser } = persistedUser;
  const role = isConfiguredPlatformAdmin(persistedUser.email) ? 'Platform Admin' : persistedUser.role;
  return res.json({ ok: true, token: authToken(persistedUser.email, match.tenantId, role), user: { ...safeUser, role, tenantId: match.tenantId } });
});

router.post('/auth/register', (req, res) => {
  const { name, email, password, team = 'General' } = req.body || {};
  if (!String(name || '').trim() || !/^\S+@\S+\.\S+$/.test(String(email || '')) || String(password || '').length < 8) {
    return res.status(400).json({ error: 'name, valid email, and a password of at least 8 characters are required' });
  }
  const platformConfiguration = dashboardStore.read('workspace').platform.configuration;
  if (platformConfiguration?.operations?.allowRegistration === false) return res.status(403).json({ error: 'New account registration is currently disabled' });
  if (dashboardStore.findUserByEmail(email)) return res.status(409).json({ error: 'Email is already registered' });
  const tenantId = dashboardStore.createTenant(`${name.trim()}'s workspace`);
  const store = dashboardStore.read(tenantId);
  const createdAt = now();
  const user = { id: dashboardStore.id('user'), name: name.trim(), email: email.toLowerCase(), tenantId, role: 'Org Admin', team, status: 'active', lastLogin: createdAt, createdAt, updatedAt: createdAt, mfa: false, passwordHash: passwordHash(String(password)) };
  store.users.unshift(user);
  audit(store, 'Registered user', 'users', user.id);
  dashboardStore.write(store, tenantId);
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return res.status(201).json({ ok: true, token: authToken(user.email, tenantId, user.role), user: safeUser });
});

router.get('/auth/me', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  const email = req.userEmail;
  const user = email ? store.users.find((item) => item.email === email) : null;
  if (email && !user && req.auth?.role !== 'Platform Admin') return res.status(401).json({ error: 'Authenticated user no longer exists' });
  if (!user && req.auth?.role === 'Platform Admin') {
    const tenant = dashboardStore.getTenant(req.tenantId);
    return res.json({
      ok: true,
      user: {
        id: `platform-${email}`,
        name: email,
        email,
        role: 'Platform Admin',
        team: 'Platform',
        status: 'active',
        tenantId: req.tenantId,
        tenantName: tenant?.name || req.tenantId,
        actingAsTenant: true,
      },
      authenticated: true,
    });
  }
  if (!user) return res.json({ ok: true, user: null, authenticated: false });
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return res.json({
    ok: true,
    user: {
      ...safeUser,
      ...(req.auth?.role === 'Platform Admin' ? { role: 'Platform Admin', tenantId: req.tenantId, tenantName: dashboardStore.getTenant(req.tenantId)?.name || req.tenantId, actingAsTenant: true } : { tenantId: req.tenantId }),
    },
    authenticated: true,
  });
});

function authenticatedVoiceUser(req, res) {
  if (!req.userEmail) {
    res.status(401).json({ error: 'Authenticated browser session required' });
    return null;
  }
  const store = dashboardStore.read(req.tenantId);
  const user = store.users.find((item) => String(item.email).toLowerCase() === String(req.userEmail).toLowerCase());
  if (!user || user.status === 'inactive') {
    res.status(401).json({ error: 'Active tenant user required' });
    return null;
  }
  return { user, store };
}

router.get('/voice/stream', maybeRequireAuth, (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const businesses = voiceBusinessStore.read(req.tenantId);
  const memberships = voiceAgentRouting.membershipsForUser(auth.user, req.tenantId, businesses);
  if (!memberships.length) return res.status(403).json({ error: 'No browser-agent business membership is configured for this user' });
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ tenantId: req.tenantId, businessIds: memberships })}\n\n`);
  const dispose = voiceRealtime.subscribe({ tenantId: req.tenantId, email: auth.user.email, userId: auth.user.id, userName: auth.user.name, memberships, response: res });
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    voiceRealtime.touch(req.tenantId, auth.user.email);
    res.write(': keep-alive\n\n');
  }, 15_000);
  res.on('close', () => { clearInterval(heartbeat); dispose(); });
});

router.post('/voice/presence', maybeRequireAuth, (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const online = voiceRealtime.touch(req.tenantId, auth.user.email);
  return res.json({ ok: true, online, status: online ? 'available' : 'offline' });
});

// Per-agent browser SIP identity. The response is scoped to the authenticated
// user and never includes another agent's credentials or any trunk/ARI secret.
router.get('/voice/sip-credentials', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  try {
    const businesses = voiceBusinessStore.read(req.tenantId);
    const result = await sipIdentityStore.ensureIdentity({
      tenantId: req.tenantId,
      user: auth.user,
      businesses,
      rotate: String(req.query.rotate || '').toLowerCase() === 'true',
    });
    return res.json({
      ok: true,
      provider: 'asterisk',
      identity: sipIdentityStore.browserCredentials(result),
      rotated: result.rotated,
    });
  } catch (error) {
    console.error('[Voice SIP] credential provisioning failed:', error.message);
    return res.status(error.status || 500).json({ error: error.message || 'Could not provision a browser SIP identity' });
  }
});

router.post('/voice/sip-credentials/revoke', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  try {
    const revoked = await sipIdentityStore.revokeIdentity(req.tenantId, auth.user.id);
    return res.json({ ok: true, revoked });
  } catch (error) {
    console.error('[Voice SIP] credential revocation failed:', error.message);
    return res.status(500).json({ error: 'Could not revoke the browser SIP identity' });
  }
});

router.post('/voice/sip-credentials/rotate', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  try {
    const result = await sipIdentityStore.rotateIdentity(req.tenantId, auth.user.id);
    if (!result) return res.status(404).json({ error: 'No SIP identity is provisioned for this user' });
    return res.json({ ok: true, identity: sipIdentityStore.browserCredentials(result), rotated: true });
  } catch (error) {
    console.error('[Voice SIP] credential rotation failed:', error.message);
    return res.status(500).json({ error: 'Could not rotate the browser SIP identity' });
  }
});

// Sanitized gateway health for supervisors. ARI credentials, SIP passwords and
// trunk details are never returned.
router.get('/voice/gateway/status', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin', 'Supervisor'])) return;
  return res.json({ ok: true, gateway: mediaGateway.status(), checkedAt: now() });
});

router.get('/voice/inbound-calls', maybeRequireAuth, (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const businesses = voiceBusinessStore.read(req.tenantId);
  const memberships = voiceAgentRouting.membershipsForUser(auth.user, req.tenantId, businesses);
  const email = String(auth.user.email).toLowerCase();
  const calls = dashboardStore.listInboundVoiceSessions(req.tenantId, memberships, ['ringing'])
    .filter((session) => session.eligibleAgents.some((agent) => String(agent.email).toLowerCase() === email))
    .map((session) => ({
      callId: session.id, businessId: session.businessId,
      businessName: businesses.find((business) => String(business.id) === String(session.businessId))?.name || 'Business',
      callerNumber: session.callerNumber, calledNumber: session.calledNumber,
      status: session.status, winningAgentId: session.winningAgentId,
      ringStartedAt: session.ringStartedAt,
    }));
  return res.json({ ok: true, calls });
});

router.post('/voice/inbound-calls/:callId/accept', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const session = dashboardStore.getInboundVoiceSession(req.tenantId, req.params.callId);
  if (!session) return res.status(404).json({ error: 'Inbound call not found' });
  const businesses = voiceBusinessStore.read(req.tenantId);
  const business = businesses.find((item) => String(item.id) === String(session.businessId));
  const memberships = voiceAgentRouting.membershipsForUser(auth.user, req.tenantId, businesses);
  if (!business || !memberships.includes(String(business.id))) return res.status(403).json({ error: 'This call is outside your business membership' });
  const assigned = (session.eligibleAgents || []).find((agent) => String(agent.email).toLowerCase() === String(auth.user.email).toLowerCase());
  if (!assigned) return res.status(403).json({ error: 'You were not eligible for this call offer' });
  if (!voiceRealtime.onlinePresence(req.tenantId, auth.user.email)) return res.status(409).json({ error: 'Your browser voice session is offline; reconnect before accepting' });
  const claim = dashboardStore.claimInboundVoiceSession(req.tenantId, session.id, assigned.id);
  if (!claim.claimed) {
    voiceRealtime.publishToAgent(req.tenantId, auth.user.email, { type: 'call_claim_failed', callId: session.id, status: claim.session?.status || 'ended' });
    return res.status(409).json({ error: 'This call was already answered or is no longer ringing', session: claim.session });
  }
  voiceRealtime.markBusy(req.tenantId, auth.user.email, true);
  voiceRealtime.publish(req.tenantId, business.id, { type: 'agent_presence_updated', tenantId: req.tenantId, businessId: business.id, agent: { id: auth.user.id, name: auth.user.name, status: 'busy' } });
  voiceRealtime.publishToAgent(req.tenantId, auth.user.email, { type: 'call_accepted', callId: session.id, businessId: business.id, agent: { id: assigned.id, name: assigned.name } });
  voiceRealtime.publishToOthers(req.tenantId, business.id, auth.user.email, { type: 'call_answered_elsewhere', callId: session.id, winningAgentId: assigned.id, agent: { id: assigned.id, name: assigned.name } });
  dashboardStore.updateInboundVoiceSession(req.tenantId, session.id, { status: 'connecting' });
  voiceRealtime.publish(req.tenantId, business.id, { type: 'call_connecting', callId: session.id, agent: { id: assigned.id, name: assigned.name } });
  let bridge;
  try {
    const bridgeSession = await mediaBridge.createSession(claim.session);
    bridge = bridgeSession?.available === false ? bridgeSession : await mediaBridge.connectAgent(bridgeSession.id, assigned);
  } catch (error) {
    bridge = { connected: false, reason: error.message };
  }
  const transportConnected = bridge?.transportConnected === true;
  const mediaVerified = bridge?.mediaVerified === true
    || (bridge?.connected === true && bridge?.mediaVerified !== false && !transportConnected);
  if (mediaVerified) {
    const connected = dashboardStore.getInboundVoiceSession(req.tenantId, session.id)?.status === 'connected'
      ? dashboardStore.getInboundVoiceSession(req.tenantId, session.id)
      : dashboardStore.updateInboundVoiceSession(req.tenantId, session.id, { status: 'connected', connectedAt: new Date().toISOString() });
    voiceRealtime.publish(req.tenantId, business.id, { type: 'call_connected', callId: session.id, agent: { id: assigned.id, name: assigned.name } });
    return res.json({ ok: true, claimed: true, mediaConnected: true, transportConnected: true, mediaVerified: true, bridge, session: connected });
  }
  if (transportConnected) {
    // Transport (both channels joined and Up) is not the same as audible
    // media. The winning browser must confirm bidirectional RTP before the
    // call becomes CONNECTED.
    const connecting = dashboardStore.updateInboundVoiceSession(req.tenantId, session.id, { status: 'connecting' });
    return res.json({
      ok: true,
      claimed: true,
      mediaConnected: false,
      transportConnected: true,
      mediaVerified: false,
      awaitingMediaEvidence: true,
      bridge,
      session: connecting,
    });
  }
  const failureReason = String(bridge?.reason || 'Media bridge unavailable');
  try { await mediaBridge.terminateSession(session.id); } catch { /* already cleaned up */ }
  const failed = dashboardStore.updateInboundVoiceSession(req.tenantId, session.id, {
    status: 'failed', failureReason, endedAt: new Date().toISOString(),
  });
  voiceRealtime.markBusy(req.tenantId, auth.user.email, false);
  voiceRealtime.publish(req.tenantId, business.id, { type: 'call_ended', callId: session.id, status: 'failed', reason: failureReason });
  voiceRealtime.publish(req.tenantId, business.id, { type: 'agent_presence_updated', tenantId: req.tenantId, businessId: business.id, agent: { id: auth.user.id, name: auth.user.name, status: 'available' } });
  return res.json({ ok: true, claimed: true, mediaConnected: false, bridge: bridge || { reason: failureReason }, session: failed });
});

router.post('/voice/inbound-calls/:callId/reject', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const session = dashboardStore.getInboundVoiceSession(req.tenantId, req.params.callId);
  if (!session) return res.status(404).json({ error: 'Inbound call not found' });
  const assigned = (session.eligibleAgents || []).find((agent) => String(agent.email).toLowerCase() === String(auth.user.email).toLowerCase());
  if (!assigned) return res.status(403).json({ error: 'This call is outside your offer list' });
  const result = dashboardStore.rejectInboundVoiceSession(req.tenantId, session.id, assigned.id);
  voiceRealtime.publishToAgent(req.tenantId, auth.user.email, { type: 'call_rejected', callId: session.id });
  if (result.session?.status === 'missed') {
    try { await mediaBridge.terminateSession(session.id); } catch { /* gateway already gone */ }
    voiceRealtime.publish(req.tenantId, session.businessId, { type: 'call_ended', callId: session.id, status: 'missed', reason: 'All offered agents rejected the call' });
  }
  return res.json({ ok: true, rejected: result.rejected, session: result.session });
});

router.post('/voice/inbound-calls/:callId/end', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const session = dashboardStore.getInboundVoiceSession(req.tenantId, req.params.callId);
  if (!session) return res.status(404).json({ error: 'Inbound call not found' });
  const winner = (session.eligibleAgents || []).find((agent) => String(agent.email).toLowerCase() === String(auth.user.email).toLowerCase());
  if (!winner || winner.id !== session.winningAgentId) return res.status(403).json({ error: 'Only the assigned agent can end this call' });
  let bridgeResult = { terminated: false, reason: 'No media bridge is configured' };
  try { bridgeResult = await mediaBridge.terminateSession(session.id); } catch (error) { bridgeResult = { terminated: false, reason: error.message }; }
  const ended = dashboardStore.updateInboundVoiceSession(req.tenantId, session.id, { status: 'ended', endedAt: new Date().toISOString() });
  voiceRealtime.markBusy(req.tenantId, auth.user.email, false);
  voiceRealtime.publish(req.tenantId, session.businessId, { type: 'call_ended', callId: session.id, status: 'ended' });
  voiceRealtime.publish(req.tenantId, session.businessId, { type: 'agent_presence_updated', tenantId: req.tenantId, businessId: session.businessId, agent: { id: auth.user.id, name: auth.user.name, status: 'available' } });
  return res.json({ ok: true, session: ended, bridge: bridgeResult });
});

router.get('/voice/inbound-calls/:callId/status', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const session = dashboardStore.getInboundVoiceSession(req.tenantId, req.params.callId);
  if (!session) return res.status(404).json({ error: 'Inbound call not found' });
  const businesses = voiceBusinessStore.read(req.tenantId);
  const memberships = voiceAgentRouting.membershipsForUser(auth.user, req.tenantId, businesses);
  const store = dashboardStore.read(req.tenantId);
  const elevated = ['Org Admin', 'Platform Admin', 'Supervisor'].includes(currentRole(req, store));
  if (!elevated && !memberships.includes(String(session.businessId))) {
    return res.status(403).json({ error: 'This call is outside your business membership' });
  }
  let gateway = null;
  try { gateway = await getMediaBridgeAdapter().getSessionStatus(session.id); } catch { gateway = null; }
  return res.json({
    ok: true,
    session: {
      id: session.id,
      businessId: session.businessId,
      status: session.status,
      winningAgentId: session.winningAgentId,
      mediaState: session.mediaState,
      mediaVerifiedAt: session.mediaVerifiedAt,
      mediaEvidence: session.mediaEvidence,
      gateway: session.gateway,
      bridgeId: session.gatewayBridgeId,
      callerChannelId: session.gatewayChannelId,
      agentChannelId: session.gatewayAgentChannelId,
      answeredAt: session.answeredAt,
      connectedAt: session.connectedAt,
      endedAt: session.endedAt,
      failureReason: session.failureReason,
    },
    gateway,
  });
});

router.post('/voice/inbound-calls/:callId/media-ready', maybeRequireAuth, async (req, res) => {
  const auth = authenticatedVoiceUser(req, res);
  if (!auth) return;
  const session = dashboardStore.getInboundVoiceSession(req.tenantId, req.params.callId);
  if (!session) return res.status(404).json({ error: 'Inbound call not found' });
  const assigned = (session.eligibleAgents || []).find((agent) => String(agent.email).toLowerCase() === String(auth.user.email).toLowerCase());
  if (!assigned || String(assigned.id) !== String(session.winningAgentId)) {
    return res.status(403).json({ error: 'Only the winning agent can confirm this call media session' });
  }
  const evidence = req.body?.stats || req.body || {};
  if (session.status === 'connected') {
    const freshInbound = Number(evidence.inboundBytes || 0);
    const freshOutbound = Number(evidence.outboundBytes || 0);
    if (freshInbound > 0 && freshOutbound > 0) {
      // The gateway CLI can prove RTP a beat before the browser reports its
      // WebRTC counters. The bridge has already been verified for this
      // session, so keep the browser's measurements instead of dropping the
      // late report: mediaEvidence must hold both observers' evidence.
      dashboardStore.recordInboundMediaEvidence(req.tenantId, session.id, {
        ...(session.mediaEvidence || {}),
        source: 'browser-webrtc',
        inboundBytes: freshInbound,
        outboundBytes: freshOutbound,
        inboundPackets: Number(evidence.inboundPackets || 0),
        outboundPackets: Number(evidence.outboundPackets || 0),
        connectionState: evidence.connectionState || null,
        audioLevel: evidence.audioLevel === undefined ? null : Number(evidence.audioLevel),
        capturedAt: new Date().toISOString(),
        transportEstablished: true,
        audibleAudioVerified: false,
      }, true);
      return res.json({
        ok: true,
        verified: true,
        session: dashboardStore.getInboundVoiceSession(req.tenantId, session.id),
      });
    }
    return res.json({ ok: true, verified: true, session });
  }
  const adapter = getMediaBridgeAdapter();
  if (typeof adapter.markMediaReady !== 'function') {
    return res.status(409).json({ error: 'The configured media bridge cannot verify browser media evidence' });
  }
  try {
    const result = await adapter.markMediaReady(session.id, assigned.id, evidence);
    if (!result?.verified) {
      return res.status(409).json({ error: result?.reason || 'Media evidence was not sufficient to mark the call connected', evidence });
    }
    return res.json({ ok: true, verified: true, session: result.session, media: result.media });
  } catch (error) {
    console.error('[Voice Media] evidence verification failed:', error.message);
    return res.status(500).json({ error: 'Could not verify call media evidence' });
  }
});

router.post('/auth/logout', maybeRequireAuth, async (req, res) => {
  try {
    if (req.userEmail && req.tenantId) {
      const auth = authenticatedVoiceUser(req, res);
      if (auth) await sipIdentityStore.revokeIdentity(req.tenantId, auth.user.id);
    }
  } catch (error) {
    console.error('[Auth Logout] SIP identity revocation failed:', error.message);
  }
  return res.json({ ok: true });
});

router.get('/tenants', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requirePlatformAdmin(req, res, store)) return;
  const tenants = dashboardStore.listTenants();
  return res.json({ ok: true, data: tenants, tenants });
});

router.post('/tenants/:tenantId/switch', maybeRequireAuth, (req, res) => {
  const sourceStore = dashboardStore.read(req.tenantId);
  if (!requirePlatformAdmin(req, res, sourceStore)) return;
  if (!validateId(req.params.tenantId)) return res.status(400).json({ error: 'Invalid tenant identifier' });
  const target = dashboardStore.getTenant(req.params.tenantId);
  if (!target) return res.status(404).json({ error: 'Tenant not found' });

  const token = authToken(req.userEmail, target.id, 'Platform Admin');
  audit(sourceStore, 'Switched tenant workspace', 'tenants', target.id);
  dashboardStore.write(sourceStore, req.tenantId);
  return res.json({
    ok: true,
    token,
    user: {
      id: `platform-${req.userEmail}`,
      name: req.userEmail,
      email: req.userEmail,
      role: 'Platform Admin',
      team: 'Platform',
      status: 'active',
      tenantId: target.id,
      tenantName: target.name,
      actingAsTenant: true,
    },
    tenant: target,
  });
});

router.get('/', (_req, res) => res.json({
  ok: true,
  service: 'Mpange Call Center API',
  version: '1.0.0',
  resources: [...collectionNames].sort(),
  docs: '/api/openapi.json',
}));

router.get('/overview', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const history = historyForRange(store.history, String(req.query.range || 'today'), req.query.from, req.query.to);
  const missed = history.filter((item) => item.outcome === 'missed' || item.outcome === 'abandoned').length;
  return res.json({ ok: true, data: {
    range: req.query.range || 'today',
    metrics: {
      callsToday: history.length,
      activeCalls: store.liveCalls.length,
      answered: history.length - missed,
      missed,
      answerRate: history.length ? Math.round(((history.length - missed) / history.length) * 100) : 0,
      agentsAvailable: store.agents.filter((agent) => agent.status === 'available').length,
      queueWaiting: store.queues.reduce((sum, queue) => sum + queue.waiting, 0),
    },
    liveCalls: store.liveCalls,
    recentCalls: history.slice(0, 10),
    agents: store.agents,
    queues: store.queues,
    volume: volumeByHour(history),
  } });
});

router.get('/analytics', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const history = historyForRange(store.history, String(req.query.range || '30d'), req.query.from, req.query.to);
  const total = history.length || 1;
  const byQueue = store.queues.map((queue) => {
    const rows = history.filter((call) => call.queue === queue.name);
    return { queue: queue.name, calls: rows.length, resolved: rows.filter((call) => call.outcome === 'resolved').length, missed: rows.filter((call) => ['missed', 'abandoned'].includes(call.outcome)).length };
  });
  const missed = history.filter((call) => ['missed', 'abandoned'].includes(call.outcome)).length;
  return res.json({ ok: true, data: {
    totals: { calls: history.length, resolved: history.filter((call) => call.outcome === 'resolved').length, missed: history.filter((call) => call.outcome === 'missed').length, abandoned: history.filter((call) => call.outcome === 'abandoned').length },
    answerRate: Math.round(((total - missed) / total) * 100),
    byQueue,
    agentPerformance: store.agents.map((agent) => {
      const calls = history.filter((call) => call.agent === agent.name);
      const durations = calls.map((call) => Number(call.durationSec)).filter(Number.isFinite);
      return { ...agent, callsToday: calls.length, avgHandle: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0, csat: Number(agent.csat) || 0, fcr: Number(agent.fcr) || 0, occupancy: Number(agent.occupancy) || 0 };
    }),
    volume: volumeByHour(history),
  } });
});

router.get('/health/providers', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin', 'Supervisor'])) return;
  return res.json({ ok: true, providers: providers.allStatuses(), checkedAt: now() });
});

// Backend-only NileAGI inspection endpoints. They expose configuration state
// and tenant-scoped usage, never credentials or provider secrets.
router.get('/ai/providers/nileagi', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin', 'Supervisor'])) return;
  return res.json({ ok: true, provider: providers.nileagi.status(), checkedAt: now() });
});

router.get('/ai/usage', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin', 'Supervisor'])) return;
  return res.json({ ok: true, data: dashboardStore.listAiUsage(req.tenantId, {
    provider: req.query.provider,
    operation: req.query.operation,
    callId: req.query.callId,
    limit: req.query.limit,
  }) });
});

router.get('/billing', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin'])) return;
  const current = store.invoices[0];
  return res.json({ ok: true, data: { invoices: store.invoices, current, usageByMonth: store.invoices.slice(0, 6).reverse().map((item) => ({ month: item.period.slice(0, 3), minutes: item.minutes, sms: item.sms })) } });
});

router.post('/billing/checkout', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin'])) return;
  const invoice = store.invoices.find((item) => item.id === req.body?.invoiceId);
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  return providers.request('billing', '/checkout', { invoiceId: invoice.id, amount: invoice.amount, currency: invoice.currency || 'TZS', tenantId: req.tenantId, requestedBy: req.userEmail })
    .then((result) => res.status(202).json({ ok: true, status: 'pending', checkout: result }))
    .catch((error) => res.status(error.statusCode || error.response?.status || 502).json({ error: error.statusCode === 503 ? error.message : 'Billing provider request failed' }));
});

router.get('/settings', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin']) || !requirePermission(req, res, store, 'Manage users & billing')) return;
  const tenant = dashboardStore.getTenant(req.tenantId);
  const owner = currentUser(req, store);
  const platformStore = dashboardStore.read('workspace');
  const business = platformStore.platform?.collections?.businesses?.find((item) => String(item.tenantId || item.businessId) === String(req.tenantId));
  const hydrated = {
    ...store.settings,
    company: {
      ...store.settings.company,
      name: store.settings.company?.name || tenant?.name || '',
      email: store.settings.company?.email || owner?.email || '',
      phone: store.settings.company?.phone || business?.phoneNumbers || business?.phone || '',
      city: store.settings.company?.city || business?.city || '',
    },
  };
  return res.json({ ok: true, data: hydrated });
});
router.put('/settings', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin']) || !requirePermission(req, res, store, 'Manage users & billing')) return;
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.rolePermissions !== undefined) {
    if (!Array.isArray(body.rolePermissions)) return res.status(400).json({ error: 'rolePermissions must be an array' });
    const valid = body.rolePermissions.every((entry) => entry && rolePermissionNames.has(String(entry.perm)) && ['admin', 'supervisor', 'agent'].every((key) => typeof entry[key] === 'boolean'));
    if (!valid) return res.status(400).json({ error: 'Each role permission must include a supported permission and boolean role values' });
    store.rolePermissions = body.rolePermissions.map((entry) => ({ perm: String(entry.perm), admin: entry.admin, supervisor: entry.supervisor, agent: entry.agent }));
  }
  const { rolePermissions: _rolePermissions, ...settingsPatch } = body;
  if (settingsPatch.company && typeof settingsPatch.company === 'object') {
    const ownerEmail = String(store.settings.company?.email || currentUser(req, store)?.email || '').trim().toLowerCase();
    const requestedEmail = String(settingsPatch.company.email || '').trim().toLowerCase();
    if (ownerEmail && requestedEmail && requestedEmail !== ownerEmail) return res.status(400).json({ error: 'Operations email is managed by the organization owner account' });
    settingsPatch.company = { ...settingsPatch.company, ...(ownerEmail ? { email: ownerEmail } : {}) };
  }
  store.settings = { ...store.settings, ...settingsPatch };
  audit(store, 'Updated settings', 'settings', 'global');
  dashboardStore.write(store);
  return res.json({ ok: true, settings: store.settings, data: store.settings });
});

router.get('/help', maybeRequireAuth, (_req, res) => {
  const store = dashboardStore.read();
  return res.json({ ok: true, articles: store.helpArticles, faqs: store.faqs, data: { articles: store.helpArticles, faqs: store.faqs } });
});

router.get('/calls/live', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const rows = store.liveCalls.filter((row) => matchesQuery(row, req.query));
  return listResponse(res, 'liveCalls', rows, 1, rows.length, rows.length || 1);
});

router.post('/calls', maybeRequireAuth, (req, res) => {
  const body = req.body || {};
  if (!String(body.phone || '').trim() || !String(body.direction || '').trim()) return res.status(400).json({ error: 'phone and direction are required' });
  const store = dashboardStore.read();
  const user = currentUser(req, store);
  const call = { id: validateId(body.id) ? body.id : dashboardStore.id('call'), tenantId: req.tenantId, businessId: String(body.businessId || req.tenantId), at: body.at || now(), caller: body.caller || 'Customer', phone: body.phone, direction: body.direction === 'outbound' ? 'outbound' : 'inbound', agent: body.agent || user?.name || 'Unassigned', queue: body.queue || 'General', durationSec: Math.max(0, Number(body.durationSec) || 0), outcome: ['resolved', 'missed', 'abandoned', 'escalated', 'voicemail'].includes(body.outcome) ? body.outcome : 'missed', summary: body.summary || '' };
  store.history.unshift(call);
  audit(store, 'Created call record', 'history', call.id);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, call, data: call });
});

router.post('/calls/outbound', maybeRequireAuth, async (req, res) => {
  const { callFrom, callTo, from, to, clientRequestId } = req.body || {};
  const requestedTo = callTo || to;
  if (!requestedTo) return res.status(400).json({ error: 'callTo or to is required' });
  if (!process.env.AT_API_KEY) return res.status(503).json({ error: 'AT_API_KEY is not configured' });
  const configuredNumbers = configuredTenantVoiceNumbers(req.tenantId);
  const requestedFrom = callFrom || from;
  const normalizedRequestedFrom = requestedFrom ? normalizeVoiceNumber(requestedFrom) : '';
  if (requestedFrom && !normalizedRequestedFrom) return res.status(400).json({ error: 'callFrom must use international E.164 format' });
  const outboundNumber = normalizedRequestedFrom || configuredNumbers[0];
  if (!outboundNumber) return res.status(503).json({ error: 'No voice number is configured for this organization' });
  if (normalizedRequestedFrom && !configuredNumbers.includes(normalizedRequestedFrom)) return res.status(403).json({ error: 'The requested caller ID is not assigned to this organization' });
  const numbers = Array.isArray(requestedTo) ? requestedTo : String(requestedTo).split(',').map((item) => item.trim()).filter(Boolean);
  try {
    const username = process.env.AT_USERNAME || 'sandbox';
    const url = 'https://voice.africastalking.com/call';
    const response = await axios.post(url, { username, to: numbers, from: outboundNumber, clientRequestId }, { headers: { apikey: process.env.AT_API_KEY, Accept: 'application/json' } });
    return res.json({ ok: true, result: response.data });
  } catch (error) {
    return res.status(error.response?.status || 502).json({ error: 'Failed to initiate call', details: error.response?.data || error.message });
  }
});

// Mint a short-lived Africa's Talking WebRTC token for the signed-in tenant.
// The API key stays on the server; the browser receives only the capability
// token and uses it with the Africa's Talking client SDK.
router.post('/voice/capability-token', maybeRequireAuth, async (req, res) => {
  const configuredNumbers = configuredTenantVoiceNumbers(req.tenantId);
  const requestedNumber = normalizeVoiceNumber(req.body?.phoneNumber);
  const phoneNumber = requestedNumber || configuredNumbers[0];
  if (!phoneNumber) return res.status(503).json({ error: 'No voice number is configured for this organization' });
  if (requestedNumber && !configuredNumbers.includes(requestedNumber)) return res.status(403).json({ error: 'The requested voice number is not assigned to this organization' });
  if (!process.env.AT_API_KEY) return res.status(503).json({ error: 'AT_API_KEY is not configured' });

  const clientName = `mpange-${req.tenantId}-${crypto.createHash('sha1').update(String(req.userEmail || 'agent')).digest('hex').slice(0, 12)}`
    .replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 64);
  try {
    const response = await axios.post('https://webrtc.africastalking.com/capability-token/request', {
      username: process.env.AT_USERNAME || 'sandbox',
      clientName,
      phoneNumber,
      incoming: true,
      outgoing: true,
      expire: '3600s',
    }, {
      headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 20_000,
    });
    return res.json({ ok: true, phoneNumber, ...response.data });
  } catch (error) {
    console.error('[Voice WebRTC] dashboard capability token failed:', error.response?.data || error.message);
    return res.status(error.response?.status || 502).json({ error: 'Failed to prepare browser voice', details: error.response?.data || error.message });
  }
});

router.get('/calls/:callId', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const call = store.history.find((item) => item.id === req.params.callId) || store.liveCalls.find((item) => item.id === req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  // Legacy call rows predate tenantId persistence. The authenticated tenant
  // is the safe scope for those rows because the lookup already ran against
  // that tenant's store.
  const tenant = dashboardStore.getTenant(req.tenantId);
  const scopedCall = {
    ...call,
    ...(call.tenantId ? {} : { tenantId: req.tenantId }),
    ...(call.businessId ? {} : { businessId: req.tenantId }),
    caller: call.caller && !/^unknown caller$/i.test(String(call.caller)) ? call.caller : 'Customer',
    agent: call.agent || call.agentId || (call.direction === 'outbound' ? fallbackAgentForStore(req, store) : '') || 'Unassigned',
    queue: call.queue || 'General',
    tenantName: call.tenantName || tenant?.name || req.tenantId,
  };
  return res.json({ ok: true, call: scopedCall, data: { call: scopedCall, artifacts: callArtifactsFor(store, scopedCall, req.tenantId) } });
});

router.post('/calls/:callId/actions', maybeRequireAuth, (req, res) => {
  const { action, value } = req.body || {};
  const allowed = ['hold', 'resume', 'end', 'transfer', 'whisper', 'barge'];
  if (!allowed.includes(action)) return res.status(400).json({ error: `action must be one of ${allowed.join(', ')}` });
  const store = dashboardStore.read();
  const call = store.liveCalls.find((item) => item.id === req.params.callId);
  if (!call) return res.status(404).json({ error: 'Live call not found' });
  const user = currentUser(req, store);
  const isElevated = ['Org Admin', 'Platform Admin', 'Supervisor'].includes(user?.role);
  const isAssignedAgent = user && (String(call.agentId || '') === String(user.id) || String(call.agent || '') === String(user.name));
  if (!isElevated && !isAssignedAgent) return res.status(403).json({ error: 'You are not assigned to this live call' });
  if (['transfer', 'whisper', 'barge'].includes(action) && !isElevated) return res.status(403).json({ error: 'Supervisor permission is required for this call action' });
  if (action === 'hold') call.status = 'on-hold';
  if (action === 'resume') call.status = 'in-progress';
  if (action === 'end') {
    store.liveCalls = store.liveCalls.filter((item) => item.id !== call.id);
    store.history.unshift({ id: call.id, tenantId: req.tenantId, businessId: call.businessId || req.tenantId, at: now(), caller: call.caller || 'Customer', phone: call.phone, direction: call.direction, agent: call.agent || call.agentId || user?.name || 'Unassigned', queue: call.queue || 'General', durationSec: call.durationSec, outcome: 'resolved', summary: 'Call ended from the operator console.' });
  }
  if (action === 'transfer' && value) call.queue = String(value);
  audit(store, `Call ${action}`, 'calls', call.id);
  dashboardStore.write(store);
  return res.json({ ok: true, action, call, liveCalls: store.liveCalls });
});

router.get('/calls/:callId/recording-url', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!store.history.some((item) => item.id === req.params.callId) && !store.liveCalls.some((item) => item.id === req.params.callId)) return res.status(404).json({ error: 'Call not found' });
  const source = dashboardStore.getRecordingSource(req.tenantId, req.params.callId);
  if (source?.sourceUrl) return res.json({ ok: true, available: true, url: source.sourceUrl, source: 'backend', sourceId: source.id, expiresAt: null });
  const recording = providers.status('recording');
  const baseUrl = process.env.RECORDING_BASE_URL;
  if (!recording.configured) return res.status(503).json({ error: 'Recording provider is not configured', provider: recording });
  const expires = Math.floor(Date.now() / 1000) + 300;
  const secret = process.env.RECORDING_SIGNING_SECRET;
  const signature = crypto.createHmac('sha256', secret).update(`${req.params.callId}:${expires}`).digest('hex');
  const objectKey = source?.storageKey || `${req.params.callId}.wav`;
  const objectSignature = crypto.createHmac('sha256', secret).update(`${objectKey}:${expires}`).digest('hex');
  return res.json({ ok: true, available: true, url: `${baseUrl.replace(/\/$/, '')}/${objectKey.split('/').map(encodeURIComponent).join('/')}?expires=${expires}&signature=${objectSignature}`, expiresAt: new Date(expires * 1000).toISOString() });
});

router.get('/calls/:callId/recording-source', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const call = store.history.find((item) => item.id === req.params.callId) || store.liveCalls.find((item) => item.id === req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  return res.json({ ok: true, source: dashboardStore.getRecordingSource(req.tenantId, req.params.callId) });
});

router.put('/calls/:callId/recording-source', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const call = store.history.find((item) => item.id === req.params.callId) || store.liveCalls.find((item) => item.id === req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  try {
    const source = dashboardStore.upsertRecordingSource(req.tenantId, { ...req.body, callId: req.params.callId, businessId: req.body?.businessId || call.businessId || req.tenantId });
    return res.json({ ok: true, source });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.get('/recording-sources', maybeRequireAuth, (req, res) => {
  return res.json({ ok: true, data: dashboardStore.listRecordingSources(req.tenantId, req.query.businessId || req.tenantId) });
});

router.post('/calls/:callId/transcription-jobs', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const call = store.history.find((item) => item.id === req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  const recordingSource = dashboardStore.getRecordingSource(req.tenantId, call.id);
  if (providers.status('gemini').configured) {
    if (!recordingSource?.sourceUrl) return res.status(503).json({ error: 'Gemini transcription requires a recording source URL for this call' });
    return axios.get(recordingSource.sourceUrl, { responseType: 'arraybuffer', timeout: 30_000 })
      .then((audio) => providers.geminiTranscribe(audio.data, recordingSource.mimeType || audio.headers['content-type'] || 'audio/wav'))
      .then((text) => {
        const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        const segments = (lines.length ? lines : ['']).map((line, index) => {
          const labeled = line.match(/^(CUSTOMER|AGENT)\s*:\s*(.*)$/i);
          return { id: `${call.id}-segment-${index + 1}`, speaker: labeled?.[1]?.toLowerCase() === 'agent' ? 'agent' : 'customer', atSec: 0, text: labeled?.[2] || line, language: 'English', confidence: null };
        }).filter((segment) => segment.text);
        const next = dashboardStore.read(req.tenantId);
        next.callArtifacts[call.id] = { ...(next.callArtifacts[call.id] || {}), transcription: { status: 'ready', source: 'gemini', provider: 'Gemini', language: 'English', segments, updatedAt: now() } };
        dashboardStore.write(next, req.tenantId);
        return res.json({ ok: true, status: 'ready', provider: 'gemini', segments });
      })
      .catch((error) => res.status(error.response?.status || error.statusCode || 502).json({ error: 'Gemini transcription request failed' }));
  }
  return providers.request('transcription', '/jobs', { callId: call.id, tenantId: req.tenantId, requestedBy: req.userEmail || null })
    .then((result) => {
      const next = dashboardStore.read(req.tenantId);
      next.callArtifacts[call.id] = { ...(next.callArtifacts[call.id] || {}), transcription: { status: 'queued', source: 'provider', job: result, updatedAt: now() } };
      dashboardStore.write(next, req.tenantId);
      return res.status(202).json({ ok: true, status: 'queued', provider: result });
    })
    .catch((error) => res.status(error.statusCode || error.response?.status || 502).json({ error: error.statusCode === 503 ? error.message : 'Transcription provider request failed' }));
});

router.post('/calls/:callId/summary-jobs', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const call = store.history.find((item) => item.id === req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  if (providers.status('gemini').configured) {
    const transcript = store.callArtifacts?.[call.id]?.transcription?.segments || [];
    const prompt = `You summarize a customer-service call. Return only valid JSON with exactly these keys: reason (string), discussion (array of strings), resolution (string), unresolved (array of strings), nextSteps (array of strings), suggestions (array of strings). Do not invent facts; use "Not established." when unavailable.\n\nCall metadata: ${JSON.stringify({ caller: call.caller, phone: call.phone, direction: call.direction, queue: call.queue, agent: call.agent, outcome: call.outcome, summary: call.summary })}\nTranscript: ${JSON.stringify(transcript)}`;
    return providers.geminiGenerate(prompt)
      .then((text) => {
        const next = dashboardStore.read(req.tenantId);
        const summary = parseGeminiSummary(text);
        const existingArtifact = next.callArtifacts[call.id] || {};
        const existingTasks = Array.isArray(existingArtifact.tasks) ? existingArtifact.tasks : [];
        const suggestedTasks = summary.suggestions.map((title, index) => ({
          id: `${call.id}-suggestion-${index + 1}`,
          suggestionId: `${call.id}-suggestion-${index + 1}`,
          title,
          assignee: null,
          dueDate: null,
          reviewStatus: 'suggested',
          source: 'suggested',
          createdAt: now(),
        })).filter((candidate) => !existingTasks.some((task) => task.suggestionId === candidate.suggestionId || task.title === candidate.title));
        next.callArtifacts[call.id] = { ...existingArtifact, tasks: [...existingTasks, ...suggestedTasks], summarization: { status: 'ready', source: 'gemini', provider: 'Gemini', summary, updatedAt: now() } };
        dashboardStore.write(next, req.tenantId);
        return res.json({ ok: true, status: 'ready', provider: 'gemini', summary });
      })
      .catch((error) => res.status(error.response?.status || error.statusCode || 502).json({ error: 'Gemini summarization request failed' }));
  }
  return providers.request('summarization', '/jobs', { callId: call.id, tenantId: req.tenantId, requestedBy: req.userEmail || null })
    .then((result) => {
      const next = dashboardStore.read(req.tenantId);
      next.callArtifacts[call.id] = { ...(next.callArtifacts[call.id] || {}), summarization: { status: 'queued', source: 'provider', job: result, updatedAt: now() } };
      dashboardStore.write(next, req.tenantId);
      return res.status(202).json({ ok: true, status: 'queued', provider: result });
    })
    .catch((error) => res.status(error.statusCode || error.response?.status || 502).json({ error: error.statusCode === 503 ? error.message : 'Summary provider request failed' }));
});

router.patch('/calls/:callId/transcript/:segmentId', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const artifact = store.callArtifacts[req.params.callId];
  const segment = artifact?.transcription?.segments?.find((item) => item.id === req.params.segmentId);
  if (!segment) return res.status(404).json({ error: 'Transcript segment not found' });
  if (!String(req.body?.text || '').trim()) return res.status(400).json({ error: 'text is required' });
  artifact.transcriptEdits = artifact.transcriptEdits || [];
  artifact.transcriptEdits.push({ id: dashboardStore.id('edit'), segmentId: segment.id, originalText: segment.text, text: String(req.body.text).trim(), editedAt: now(), editor: req.userEmail || 'API user' });
  segment.text = String(req.body.text).trim();
  audit(store, 'Corrected transcript', 'calls', req.params.callId);
  dashboardStore.write(store);
  return res.json({ ok: true, segment, edit: artifact.transcriptEdits.at(-1) });
});

router.post('/calls/:callId/tasks', maybeRequireAuth, (req, res) => {
  const { suggestionId, title, reviewed, reviewedAt } = req.body || {};
  if (!suggestionId || !String(title || '').trim()) return res.status(400).json({ error: 'suggestionId and title are required' });
  if (reviewed !== true && !reviewedAt) return res.status(400).json({ error: 'A task suggestion must be reviewed before creation' });
  const store = dashboardStore.read();
  if (!store.history.some((item) => item.id === req.params.callId)) return res.status(404).json({ error: 'Call not found' });
  const artifact = store.callArtifacts[req.params.callId] || { callId: req.params.callId, notes: [], tasks: [] };
  artifact.tasks = artifact.tasks || [];
  if (artifact.tasks.some((item) => item.suggestionId === suggestionId)) return res.status(409).json({ error: 'Task already created for this suggestion' });
  const task = { id: dashboardStore.id('task'), suggestionId, title: String(title).trim(), assignee: req.body.assignee || null, dueDate: req.body.dueDate || null, customerId: req.body.customerId || null, caseId: req.body.caseId || null, source: 'confirmed', reviewStatus: 'created', createdAt: now() };
  artifact.tasks.push(task);
  store.callArtifacts[req.params.callId] = artifact;
  audit(store, 'Created reviewed follow-up task', 'calls', req.params.callId);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, task });
});

router.post('/calls/:callId/notes', maybeRequireAuth, (req, res) => {
  const body = String(req.body?.body || '').trim();
  const store = dashboardStore.read();
  if (!store.history.some((item) => item.id === req.params.callId)) return res.status(404).json({ error: 'Call not found' });
  if (!body) return res.status(400).json({ error: 'body is required' });
  const artifact = store.callArtifacts[req.params.callId] || { callId: req.params.callId, notes: [], tasks: [] };
  const note = { id: dashboardStore.id('note'), body, author: req.userEmail || 'API user', createdAt: now() };
  artifact.notes = [note, ...(artifact.notes || [])];
  store.callArtifacts[req.params.callId] = artifact;
  audit(store, 'Added call note', 'calls', req.params.callId);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, note, data: note });
});

router.patch('/calls/:callId/outcome', maybeRequireAuth, (req, res) => {
  const outcome = String(req.body?.outcome || '');
  if (!['resolved', 'missed', 'abandoned', 'escalated', 'voicemail'].includes(outcome)) return res.status(400).json({ error: 'Invalid outcome' });
  const store = dashboardStore.read();
  const call = store.history.find((item) => item.id === req.params.callId);
  if (!call) return res.status(404).json({ error: 'Call not found' });
  call.outcome = outcome;
  audit(store, 'Confirmed call outcome', 'calls', call.id);
  dashboardStore.write(store);
  return res.json({ ok: true, call, data: call });
});

// Generic collection reads cover all list screens in the frontend.
router.get('/:collection', maybeRequireAuth, (req, res, next) => {
  if (!collectionNames.has(req.params.collection)) return next();
  const store = dashboardStore.read();
  if (!requireCollectionRead(req, res, store, collectionKey(req.params.collection))) return;
  const result = getRows(store, req.params.collection);
  if (!result) return res.status(404).json({ error: 'Collection not found' });
  const filtered = result.rows.filter((row) => matchesQuery(row, req.query));
  const { limit, page, offset } = parsePagination(req.query);
  return listResponse(res, result.key, filtered.slice(offset, offset + limit), page, filtered.length, limit, fallbackAgentForStore(req, store));
});

router.post('/:collection', maybeRequireAuth, (req, res, next) => {
  if (!collectionNames.has(req.params.collection) || ['history', 'calls', 'live-calls', 'audit-log', 'role-permissions'].includes(req.params.collection)) return next();
  const store = dashboardStore.read();
  if (!requireCollectionWrite(req, res, store, collectionKey(req.params.collection))) return;
  if (req.params.collection === 'users') {
    const requestedRole = String(req.body?.role || 'Agent');
    if (!tenantRoles.has(requestedRole) && !(requestedRole === 'Platform Admin' && currentRole(req, store) === 'Platform Admin')) return res.status(403).json({ error: 'Invalid or unauthorized user role' });
  }
  const result = getRows(store, req.params.collection);
  if (!result) return next();
  const record = { ...sanitizeRecord(req.body), id: validateId(req.body?.id) ? req.body.id : dashboardStore.id(result.key.slice(0, -1)), createdAt: now(), updatedAt: now() };
  if (result.rows.some((item) => item.id === record.id)) return res.status(409).json({ error: 'Record already exists' });
  result.rows.unshift(record);
  audit(store, 'Created record', result.key, record.id);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, data: publicRecord(record), [resourceName(result.key)]: publicRecord(record) });
});

router.patch('/:collection/:itemId', maybeRequireAuth, (req, res, next) => mutateCollection(req, res, next, false));
router.put('/:collection/:itemId', maybeRequireAuth, (req, res, next) => mutateCollection(req, res, next, false));
router.delete('/:collection/:itemId', maybeRequireAuth, (req, res, next) => mutateCollection(req, res, next, true));

function mutateCollection(req, res, next, remove) {
  if (!collectionNames.has(req.params.collection) || ['history', 'calls', 'live-calls', 'audit-log', 'role-permissions'].includes(req.params.collection)) return next();
  const store = dashboardStore.read();
  if (!requireCollectionWrite(req, res, store, collectionKey(req.params.collection))) return;
  const result = getRows(store, req.params.collection);
  if (!result) return next();
  const index = result.rows.findIndex((item) => String(item.id) === String(req.params.itemId));
  if (index < 0) return res.status(404).json({ error: 'Record not found' });
  const old = result.rows[index];
  if (remove) {
    result.rows.splice(index, 1);
    audit(store, 'Deleted record', result.key, req.params.itemId);
    dashboardStore.write(store);
    return res.json({ ok: true, deleted: true, id: req.params.itemId });
  }
  if (result.key === 'users' && req.body?.role !== undefined) {
    const requestedRole = String(req.body.role);
    if (!tenantRoles.has(requestedRole) && !(requestedRole === 'Platform Admin' && currentRole(req, store) === 'Platform Admin')) return res.status(403).json({ error: 'Invalid or unauthorized user role' });
  }
  result.rows[index] = { ...old, ...sanitizeRecord(req.body), id: old.id, createdAt: old.createdAt || now(), updatedAt: now() };
  audit(store, 'Updated record', result.key, old.id);
  dashboardStore.write(store);
  return res.json({ ok: true, data: publicRecord(result.rows[index]), record: publicRecord(result.rows[index]) });
}

router.post('/agents/:agentId/status', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const agent = store.agents.find((item) => item.id === req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  const user = currentUser(req, store);
  if (!user || (!["Org Admin", "Platform Admin", "Supervisor"].includes(user.role) && String(user.id) !== String(agent.id))) {
    return res.status(403).json({ error: 'You may only update your own agent status' });
  }
  if (!['available', 'on-call', 'break', 'offline'].includes(req.body?.status)) return res.status(400).json({ error: 'Invalid agent status' });
  agent.status = req.body.status;
  audit(store, 'Updated agent status', 'agents', agent.id);
  dashboardStore.write(store);
  return res.json({ ok: true, agent });
});

router.post('/callbacks/:callbackId/complete', maybeRequireAuth, (req, res) => updateStatus(req, 'callbacks', req.params.callbackId, 'completed', res, ['Org Admin', 'Supervisor', 'Agent', 'Platform Admin']));
router.post('/voicemails/:voicemailId/read', maybeRequireAuth, (req, res) => updateBoolean('voicemails', req.params.voicemailId, 'heard', true, res));
router.post('/campaigns/:campaignId/pause', maybeRequireAuth, (req, res) => updateStatus(req, 'campaigns', req.params.campaignId, 'paused', res, ['Org Admin', 'Supervisor', 'Platform Admin']));
router.post('/campaigns/:campaignId/resume', maybeRequireAuth, (req, res) => updateStatus(req, 'campaigns', req.params.campaignId, 'running', res, ['Org Admin', 'Supervisor', 'Platform Admin']));
router.post('/integrations/:integrationId/reconnect', maybeRequireAuth, (req, res) => updateIntegration(req, res));

function updateStatus(req, collection, itemId, status, res, roles = ['Org Admin', 'Supervisor', 'Platform Admin']) {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, roles)) return;
  const item = store[collection].find((row) => row.id === itemId);
  if (!item) return res.status(404).json({ error: 'Record not found' });
  item.status = status;
  audit(store, `Set status to ${status}`, collection, itemId);
  dashboardStore.write(store);
  return res.json({ ok: true, data: item, [collection.slice(0, -1)]: item });
}

function updateBoolean(collection, itemId, field, value, res) {
  const store = dashboardStore.read();
  const item = store[collection].find((row) => row.id === itemId);
  if (!item) return res.status(404).json({ error: 'Record not found' });
  item[field] = value;
  audit(store, `Updated ${field}`, collection, itemId);
  dashboardStore.write(store);
  return res.json({ ok: true, data: item, [collection.slice(0, -1)]: item });
}

function updateIntegration(req, res) {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin'])) return;
  const item = store.integrations.find((row) => row.id === req.params.integrationId);
  if (!item) return res.status(404).json({ error: 'Integration not found' });
  return providers.request('integrationHealth', '/check', { integrationId: item.id, tenantId: req.tenantId, provider: item.provider || item.name })
    .then((result) => {
      item.status = 'connected';
      item.lastHealthCheck = now();
      item.health = result;
      audit(store, 'Checked integration health', 'integrations', item.id);
      dashboardStore.write(store, req.tenantId);
      return res.json({ ok: true, integration: item });
    })
    .catch((error) => res.status(error.statusCode || error.response?.status || 502).json({ error: error.statusCode === 503 ? error.message : 'Integration health check failed' }));
}

router.post('/users/:userId/invite', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin'])) return;
  const user = store.users.find((item) => item.id === req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  return providers.request('email', '/send', { to: user.email, template: 'workspace-invitation', name: user.name, tenantId: req.tenantId, requestedBy: req.userEmail })
    .then((result) => {
      user.status = 'invited';
      user.invitationSentAt = now();
      audit(store, 'Sent workspace invitation', 'users', user.id);
      dashboardStore.write(store, req.tenantId);
      return res.status(202).json({ ok: true, status: 'queued', provider: result, user: publicRecord(user) });
    })
    .catch((error) => res.status(error.statusCode || error.response?.status || 502).json({ error: error.statusCode === 503 ? error.message : 'Email provider request failed' }));
});

router.post('/feedback', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  const entry = { ...req.body, id: dashboardStore.id('feedback'), at: now() };
  store.feedback.unshift(entry);
  audit(store, 'Received feedback', 'feedback', entry.id);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, feedback: entry, data: entry });
});

router.post('/support/contact-platform', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin'])) return;
  const subject = String(req.body?.subject || '').trim();
  const body = String(req.body?.body || '').trim();
  if (!subject || subject.length > 160) return res.status(400).json({ error: 'Subject is required and must be 160 characters or fewer' });
  if (!body || body.length > 10_000) return res.status(400).json({ error: 'Message is required and must be 10,000 characters or fewer' });
  const owner = currentUser(req, store);
  const tenant = dashboardStore.getTenant(req.tenantId);
  const ticket = {
    id: dashboardStore.id('support'),
    subject,
    body,
    status: 'open',
    opened: now(),
    openedAt: now(),
    requesterEmail: req.userEmail || owner?.email || '',
    requesterName: owner?.name || req.userEmail || 'Organization administrator',
    tenantId: req.tenantId,
    tenantName: tenant?.name || req.tenantId,
    deliveryStatus: 'pending',
  };
  store.support.unshift(ticket);
  audit(store, 'Created platform support request', 'support', ticket.id);
  const persistedStore = dashboardStore.write(store, req.tenantId);
  const recipient = String(process.env.PLATFORM_ADMIN_EMAILS || '').split(',').map((value) => value.trim()).find((value) => /^\S+@\S+\.\S+$/.test(value));
  if (!recipient) {
    ticket.deliveryStatus = 'unavailable';
    ticket.deliveryError = 'PLATFORM_ADMIN_EMAILS is not configured';
    dashboardStore.write(persistedStore, req.tenantId);
    return res.status(503).json({ error: 'Support request was saved, but the platform support email is not configured', ticket, data: ticket });
  }
  return providers.request('email', '/send', {
    to: recipient,
    template: 'platform-support-request',
    subject,
    message: body,
    requesterEmail: ticket.requesterEmail,
    requesterName: ticket.requesterName,
    tenantId: req.tenantId,
    tenantName: ticket.tenantName,
    ticketId: ticket.id,
  }).then((providerResult) => {
    ticket.deliveryStatus = 'queued';
    ticket.deliveryRecipient = recipient;
    ticket.deliveryQueuedAt = now();
    ticket.deliveryProvider = providerResult;
    dashboardStore.write(persistedStore, req.tenantId);
    return res.status(202).json({ ok: true, status: 'queued', ticket, data: ticket });
  }).catch((error) => {
    ticket.deliveryStatus = 'failed';
    ticket.deliveryError = error.statusCode === 503 ? 'Email provider is not configured' : 'Email provider request failed';
    dashboardStore.write(persistedStore, req.tenantId);
    return res.status(error.statusCode || error.response?.status || 502).json({ error: `Support request was saved, but email delivery failed: ${ticket.deliveryError}`, ticket, data: ticket });
  });
});

router.post('/ai/ask', maybeRequireAuth, async (req, res) => {
  const question = String(req.body?.question || '').trim();
  if (!question) return res.status(400).json({ error: 'question is required' });
  const store = dashboardStore.read();
  if (providers.status('gemini').configured) {
    try {
      const answer = await providers.geminiGenerate(`You are the MPANGE AI call-center assistant. Answer the user's question using only the workspace facts below. If the facts do not answer it, say that clearly. Keep the answer concise and operational.\n\nWorkspace facts: ${JSON.stringify({ calls: store.history.slice(0, 20), liveCalls: store.liveCalls.length, agents: store.agents.length, queues: store.queues })}\n\nUser question: ${question}`);
      if (answer) return res.json({ ok: true, answer, data: { answer, question, provider: 'gemini' } });
    } catch (error) {
      return res.status(error.response?.status || error.statusCode || 502).json({ error: 'Gemini assistant request failed' });
    }
  }
  const answer = question.toLowerCase().includes('miss')
    ? `${store.history.filter((item) => ['missed', 'abandoned'].includes(item.outcome)).length} calls were missed or abandoned in the current workspace.`
    : `I found ${store.history.length} call records, ${store.liveCalls.length} live calls, and ${store.agents.length} agents in the current workspace.`;
  return res.json({ ok: true, answer, data: { answer, question } });
});

router.post('/ai/train', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read(req.tenantId);
  if (!requireRoles(req, res, store, ['Org Admin', 'Platform Admin', 'Supervisor'])) return;
  return providers.request('aiTraining', '/jobs', { tenantId: req.tenantId, requestedBy: req.userEmail || null, ...req.body })
  .then((result) => res.status(202).json({ ok: true, status: 'queued', job: result }))
  .catch((error) => res.status(error.statusCode || error.response?.status || 502).json({ error: error.statusCode === 503 ? error.message : 'AI training worker request failed' }));
});

router.get('/ai-assistant', maybeRequireAuth, (_req, res) => {
  const store = dashboardStore.read();
  return res.json({ ok: true, data: { intents: store.intents, calls: store.history.slice(0, 20), summaries: Object.fromEntries(Object.entries(store.callArtifacts).filter(([, value]) => value.summary).map(([key, value]) => [key, value.summary])) } });
});

router.get('/usage', maybeRequireAuth, (_req, res) => {
  const store = dashboardStore.read();
  return res.json({ ok: true, data: { minutes: store.invoices[0]?.minutes || 0, sms: store.invoices[0]?.sms || 0, seats: store.invoices[0]?.seats || store.agents.length, byMonth: store.invoices.slice(0, 6).reverse() } });
});

router.get('/webhooks', maybeRequireAuth, (_req, res) => res.json({ ok: true, data: [], events: [] }));

function validateIvrFlow(flow) {
  if (!flow || typeof flow !== 'object' || Array.isArray(flow)) return 'flow must be an object';
  if (!String(flow.name || '').trim()) return 'name is required';
  if (!String(flow.startId || '').trim() || !flow.nodes || typeof flow.nodes !== 'object') return 'startId and nodes are required';
  if (!flow.nodes[flow.startId]) return 'startId must reference a node';
  return null;
}

router.get('/ivr/flows', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']) || !requirePermission(req, res, store, 'Edit queues & IVR')) return;
  const flows = store.ivrFlows;
  return res.json({ ok: true, data: flows, flows });
});

router.post('/ivr/flows', maybeRequireAuth, (req, res) => {
  const error = validateIvrFlow(req.body);
  if (error) return res.status(400).json({ error });
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']) || !requirePermission(req, res, store, 'Edit queues & IVR')) return;
  if (store.ivrFlows.some((flow) => flow.id === req.body.id)) return res.status(409).json({ error: 'Flow already exists' });
  const flow = { ...req.body, id: validateId(req.body.id) ? req.body.id : dashboardStore.id('flow'), published: Boolean(req.body.published), createdAt: now(), updatedAt: now() };
  store.ivrFlows.unshift(flow);
  audit(store, 'Created IVR flow', 'ivrFlows', flow.id);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, flow, data: flow });
});

router.get('/ivr/flows/:flowId', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']) || !requirePermission(req, res, store, 'Edit queues & IVR')) return;
  const flow = store.ivrFlows.find((item) => item.id === req.params.flowId);
  if (!flow) return res.status(404).json({ error: 'IVR flow not found' });
  return res.json({ ok: true, flow, data: flow });
});

router.put('/ivr/flows/:flowId', maybeRequireAuth, (req, res) => {
  const error = validateIvrFlow(req.body);
  if (error) return res.status(400).json({ error });
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']) || !requirePermission(req, res, store, 'Edit queues & IVR')) return;
  const index = store.ivrFlows.findIndex((item) => item.id === req.params.flowId);
  if (index < 0) return res.status(404).json({ error: 'IVR flow not found' });
  store.ivrFlows[index] = { ...req.body, id: req.params.flowId, published: Boolean(req.body.published), createdAt: store.ivrFlows[index].createdAt || now(), updatedAt: now() };
  audit(store, 'Updated IVR flow', 'ivrFlows', req.params.flowId);
  dashboardStore.write(store);
  return res.json({ ok: true, flow: store.ivrFlows[index], data: store.ivrFlows[index] });
});

router.post('/ivr/flows/:flowId/publish', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']) || !requirePermission(req, res, store, 'Edit queues & IVR')) return;
  const flow = store.ivrFlows.find((item) => item.id === req.params.flowId);
  if (!flow) return res.status(404).json({ error: 'IVR flow not found' });
  const error = validateIvrFlow(flow);
  if (error) return res.status(422).json({ error, published: false });
  flow.published = true;
  flow.publishedAt = now();
  flow.updatedAt = now();
  audit(store, 'Published IVR flow', 'ivrFlows', flow.id);
  dashboardStore.write(store);
  return res.json({ ok: true, flow, data: flow });
});

router.delete('/ivr/flows/:flowId', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin']) || !requirePermission(req, res, store, 'Edit queues & IVR')) return;
  const index = store.ivrFlows.findIndex((item) => item.id === req.params.flowId);
  if (index < 0) return res.status(404).json({ error: 'IVR flow not found' });
  store.ivrFlows.splice(index, 1);
  audit(store, 'Deleted IVR flow', 'ivrFlows', req.params.flowId);
  dashboardStore.write(store);
  return res.json({ ok: true, deleted: true, id: req.params.flowId });
});

router.post('/ivr/flows/:flowId/simulate', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin'])) return;
  const flow = store.ivrFlows.find((item) => item.id === req.params.flowId);
  if (!flow) return res.status(404).json({ error: 'IVR flow not found' });
  const input = String(req.body?.digit || req.body?.input || '');
  const start = flow.nodes[flow.startId];
  const trace = start ? [{ nodeId: start.id, label: start.label, status: 'completed', output: start.text || start.target || null }] : [];
  let next = start?.next;
  if (start?.kind === 'menu') next = start.options?.find((option) => option.key === input)?.next || null;
  if (next && flow.nodes[next]) trace.push({ nodeId: next, label: flow.nodes[next].label, status: 'completed', output: flow.nodes[next].text || flow.nodes[next].target || null });
  return res.json({ ok: true, simulation: { id: dashboardStore.id('simulation'), status: next || start?.kind === 'menu' ? 'completed' : 'waiting', input, trace, externalActions: false } });
});

router.get('/ivr/forwarding-groups', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin'])) return;
  const groups = store.forwardingGroups;
  return res.json({ ok: true, groups, data: groups });
});

router.post('/ivr/forwarding-groups', maybeRequireAuth, (req, res) => {
  const { name, ownNumber, members = [], strategy = 'sequential', fallback = 'voicemail' } = req.body || {};
  if (!String(name || '').trim() || !String(ownNumber || '').trim() || !Array.isArray(members)) return res.status(400).json({ error: 'name, ownNumber, and members are required' });
  const store = dashboardStore.read();
  if (!requireRoles(req, res, store, ['Org Admin', 'Supervisor', 'Platform Admin'])) return;
  const group = { id: dashboardStore.id('group'), name: name.trim(), ownNumber, members, strategy, fallback, verified: false, lastAnsweredId: null, createdAt: now(), updatedAt: now() };
  store.forwardingGroups.unshift(group);
  audit(store, 'Created forwarding group', 'forwardingGroups', group.id);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, group, data: group });
});

router.get('/:collection/:itemId', maybeRequireAuth, (req, res, next) => {
  if (!collectionNames.has(req.params.collection)) return next();
  const store = dashboardStore.read();
  if (!requireCollectionRead(req, res, store, collectionKey(req.params.collection))) return;
  const item = getItem(store, req.params.collection, req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Record not found' });
  return res.json({ ok: true, data: publicRecord(item), record: publicRecord(item) });
});

// Platform/super-admin screens use the same CRUD contract but a separate namespace.
router.get('/platform', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  return res.json({ ok: true, data: { collections: Object.keys(store.platform.collections), activity: store.platform.activity, metrics: Object.fromEntries(Object.entries(store.platform.collections).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])) } });
});

router.get('/platform/dashboard', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  const collections = store.platform.collections;
  return res.json({ ok: true, data: { metrics: Object.fromEntries(Object.entries(collections).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])), activity: store.platform.activity } });
});

function platformConfigurationSnapshot(configuration) {
  return {
    configuration,
    provider: {
      name: "Africa's Talking",
      configured: Boolean(String(process.env.AT_USERNAME || '').trim() && String(process.env.AT_API_KEY || '').trim()),
      environment: String(process.env.AT_USERNAME || '').toLowerCase() === 'sandbox' ? 'sandbox' : 'live',
      voiceEnvironment: 'live',
      credentialsManagedBy: 'server environment',
    },
  };
}

function normalizePlatformConfiguration(current, section, values) {
  const next = JSON.parse(JSON.stringify(current));
  if (!['general', 'operations', 'locale'].includes(section)) return { error: 'Unsupported platform settings section' };
  const input = values && typeof values === 'object' ? values : {};
  if (section === 'general') {
    const platformName = String(input.platformName ?? next.general.platformName).trim();
    const supportEmail = String(input.supportEmail ?? next.general.supportEmail).trim();
    if (!platformName) return { error: 'Platform name is required' };
    if (supportEmail && !/^\S+@\S+\.\S+$/.test(supportEmail)) return { error: 'Support email must be valid' };
    next.general = { platformName, supportEmail };
  }
  if (section === 'operations') {
    if (input.allowRegistration !== undefined && typeof input.allowRegistration !== 'boolean') return { error: 'Allow registration must be a boolean' };
    next.operations = { allowRegistration: input.allowRegistration === undefined ? next.operations.allowRegistration !== false : input.allowRegistration };
  }
  if (section === 'locale') {
    const defaultCountry = String(input.defaultCountry ?? next.locale.defaultCountry).trim();
    const defaultTimezone = String(input.defaultTimezone ?? next.locale.defaultTimezone).trim();
    if (!defaultCountry) return { error: 'Default country is required' };
    if (!defaultTimezone || !/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(defaultTimezone)) return { error: 'Default timezone must use an IANA timezone such as Africa/Dar_es_Salaam' };
    next.locale = { defaultCountry, defaultTimezone };
  }
  return { values: next };
}

router.get('/platform/settings', maybeRequireAuth, (req, res) => {
  const currentStore = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, currentStore)) return;
  const platformStore = dashboardStore.read('workspace');
  return res.json({ ok: true, data: platformConfigurationSnapshot(platformStore.platform.configuration) });
});

router.put('/platform/settings', maybeRequireAuth, (req, res) => {
  const currentStore = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, currentStore)) return;
  const platformStore = dashboardStore.read('workspace');
  const section = String(req.body?.section || '').trim();
  const normalized = normalizePlatformConfiguration(platformStore.platform.configuration, section, req.body?.values);
  if (normalized.error) return res.status(400).json({ error: normalized.error });
  platformStore.platform.configuration = normalized.values;
  audit(platformStore, 'Updated platform configuration', 'platform-settings', section);
  dashboardStore.write(platformStore, 'workspace');
  return res.json({ ok: true, data: platformConfigurationSnapshot(platformStore.platform.configuration) });
});

router.get('/platform/data', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  const collections = {
    ...store.platform.collections,
    users: dashboardStore.listUsers().map((user) => publicRecord(user)),
    finance: dashboardStore.listInvoices(),
    support: dashboardStore.listTenantRecords('support'),
    feedback: dashboardStore.listTenantRecords('feedback'),
  };
  return res.json({ ok: true, data: { collections, activity: store.platform.activity } });
});

router.get('/platform/telephony/config', maybeRequireAuth, (req, res) => {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  const publicBase = telephonyPublicBase(req);
  const tenant = dashboardStore.getTenant(req.tenantId) || { id: req.tenantId, name: req.tenantId };
  const missing = [];
  if (!String(process.env.AT_USERNAME || '').trim()) missing.push('AT_USERNAME');
  if (!String(process.env.AT_API_KEY || '').trim()) missing.push('AT_API_KEY');
  return res.json({
    ok: true,
    data: {
      provider: {
        name: "Africa's Talking",
        configured: missing.length === 0,
        missing,
        environment: 'live',
        voiceEnvironment: 'live',
      },
      webhooks: {
        callbackUrl: `${publicBase}/voice/actions`,
        eventsUrl: `${publicBase}/voice/events`,
        publicBase,
      },
      tenant,
    },
  });
});

router.post('/platform/telephony/:itemId/verify', maybeRequireAuth, async (req, res) => {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  const rows = store.platform.collections.telephony;
  const record = Array.isArray(rows) ? rows.find((item) => String(item.id) === String(req.params.itemId)) : null;
  if (!record) return res.status(404).json({ error: 'Telephony record not found' });
  if (String(record.kind || '').toLowerCase() !== 'number') return res.status(400).json({ error: 'Only voice phone numbers can be verified' });

  function persistVerification(status, checkedAt, addActivity = false) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentStore = dashboardStore.read();
      const currentRows = currentStore.platform.collections.telephony;
      const currentRecord = Array.isArray(currentRows)
        ? currentRows.find((item) => String(item.id) === String(req.params.itemId))
        : null;
      if (!currentRecord) throw new Error('Telephony record not found while saving verification result');
      currentRecord.status = status;
      currentRecord.providerVerification = { status, checkedAt, provider: "Africa's Talking" };
      if (addActivity) {
        currentStore.platform.activity.unshift({
          id: dashboardStore.id('activity'),
          action: 'verified',
          collection: 'telephony',
          recordId: currentRecord.id,
          label: String(currentRecord.name),
          at: checkedAt,
        });
      }
      try {
        dashboardStore.write(currentStore);
        return currentRecord;
      } catch (error) {
        lastError = error;
        if (!String(error.message || '').includes('Concurrent dashboard update detected')) throw error;
      }
    }
    throw lastError || new Error('Could not save provider verification result');
  }

  try {
    await at.VOICE.verifyNumber(record.name);
    const checkedAt = now();
    const savedRecord = persistVerification('verified', checkedAt, true);
    return res.json({ ok: true, verified: true, data: publicRecord(savedRecord) });
  } catch (error) {
    try {
      persistVerification('unconfigured', now());
    } catch (persistError) {
      console.error('[Telephony Verification] could not persist failed verification:', persistError.message);
    }
    console.error('[Telephony Verification] provider rejected or could not verify number:', error.response?.status || error.message);
    return res.status(error.response?.status === 401 || error.response?.status === 403 ? 502 : 503).json({ error: "Africa's Talking could not verify this number" });
  }
});

router.get('/platform/:collection', maybeRequireAuth, (req, res, next) => {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  const rows = store.platform.collections[req.params.collection];
  if (!Array.isArray(rows)) return next();
  const filtered = rows.filter((row) => matchesQuery(row, req.query));
  const { limit, page, offset } = parsePagination(req.query);
  return listResponse(res, req.params.collection, filtered.slice(offset, offset + limit), page, filtered.length, limit);
});

router.post('/platform/:collection', maybeRequireAuth, (req, res, next) => {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  const rows = store.platform.collections[req.params.collection];
  if (!Array.isArray(rows)) return next();
  if (req.params.collection === 'telephony' && findUnsafeTelephonyField(req.body)) {
    return res.status(400).json({ error: 'Provider credentials must remain in server environment configuration and cannot be saved here' });
  }
  let values = req.params.collection === 'telephony' ? sanitizeTelephonyRecord(req.body) : sanitizeRecord(req.body);
  if (req.params.collection === 'telephony') {
    values = normalizeTelephonyRecord(req, values);
    const validationError = validateTelephonyRecord(values, rows);
    if (validationError) return res.status(400).json({ error: validationError });
  } else if (req.params.collection === 'businesses') {
    if (!String(values.name || '').trim()) return res.status(400).json({ error: 'Tenant name is required' });
    if (!String(values.email || '').trim()) return res.status(400).json({ error: 'Owner email is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email).trim())) return res.status(400).json({ error: 'Owner email must be a valid email address' });
    if (values.phoneNumbers && !/^\+[1-9]\d{7,14}$/.test(String(values.phoneNumbers))) return res.status(400).json({ error: 'Phone number must use international format, for example +255712345678' });
    values = normalizeBusinessRecord(values);
  } else if (req.params.collection === 'settings') {
    const normalized = normalizePlatformSetting(values, rows);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    values = normalized.values;
  } else if (req.params.collection === 'announcements') {
    const normalized = normalizePlatformAnnouncement(values);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    values = normalized.values;
  }
  const record = { ...values, id: validateId(req.body?.id) ? req.body.id : dashboardStore.id(req.params.collection.slice(0, -1)), createdAt: now(), updatedAt: now() };
  rows.unshift(record);
  const event = { id: dashboardStore.id('activity'), action: 'created', collection: req.params.collection, recordId: record.id, label: String(record.name || record.business || record.email || record.id), at: now() };
  store.platform.activity.unshift(event);
  dashboardStore.write(store);
  return res.status(201).json({ ok: true, data: record, record });
});

router.patch('/platform/:collection/:itemId', maybeRequireAuth, (req, res, next) => platformMutate(req, res, next, false));
router.put('/platform/:collection/:itemId', maybeRequireAuth, (req, res, next) => platformMutate(req, res, next, false));
router.delete('/platform/:collection/:itemId', maybeRequireAuth, (req, res, next) => platformMutate(req, res, next, true));

function platformMutate(req, res, next, remove) {
  const store = dashboardStore.read();
  if (!requirePlatformAdmin(req, res, store)) return;
  if (req.params.collection === 'users') return platformUserMutate(req, res, remove);
  const rows = store.platform.collections[req.params.collection];
  if (!Array.isArray(rows)) return next();
  const index = rows.findIndex((row) => String(row.id) === String(req.params.itemId));
  if (index < 0) return res.status(404).json({ error: 'Record not found' });
  let normalizedValues;
  if (!remove && req.params.collection === 'telephony') {
    if (findUnsafeTelephonyField(req.body)) return res.status(400).json({ error: 'Provider credentials must remain in server environment configuration and cannot be saved here' });
    normalizedValues = normalizeTelephonyRecord(req, sanitizeTelephonyRecord(req.body), rows[index]);
    const validationError = validateTelephonyRecord(normalizedValues, rows, rows[index].id);
    if (validationError) return res.status(400).json({ error: validationError });
  }
  if (!remove && req.params.collection === 'aiUsage') {
    for (const field of ['transcriptionLimitMinutes', 'summaryLimit', 'costLimit']) {
      if (req.body?.[field] === undefined) continue;
      const value = Number(req.body[field]);
      if (!Number.isFinite(value) || value < 0) return res.status(400).json({ error: `${field} must be zero or greater` });
    }
  }
  if (!remove && req.params.collection === 'businesses') {
    const email = String(req.body?.email ?? rows[index]?.email ?? '').trim();
    if (!email) return res.status(400).json({ error: 'Owner email is required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Owner email must be a valid email address' });
  }
  if (!remove && req.params.collection === 'settings') {
    const normalized = normalizePlatformSetting({ ...rows[index], ...sanitizeRecord(req.body) }, rows, rows[index].id);
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    normalizedValues = normalized.values;
  }
  if (!remove && req.params.collection === 'announcements') {
    const normalized = normalizePlatformAnnouncement({ ...rows[index], ...sanitizeRecord(req.body) });
    if (normalized.error) return res.status(400).json({ error: normalized.error });
    normalizedValues = normalized.values;
  }
  if (remove) rows.splice(index, 1);
  else rows[index] = { ...rows[index], ...(['telephony', 'settings', 'announcements'].includes(req.params.collection) ? normalizedValues : sanitizeRecord(req.body)), id: rows[index].id, updatedAt: now() };
  const event = { id: dashboardStore.id('activity'), action: remove ? 'deleted' : 'updated', collection: req.params.collection, recordId: req.params.itemId, label: String(rows[index]?.name || rows[index]?.business || req.params.itemId), at: now() };
  store.platform.activity.unshift(event);
  dashboardStore.write(store);
  return res.json({ ok: true, deleted: remove, data: remove ? null : rows[index], activity: event });
}

function platformUserMutate(req, res, remove) {
  const found = dashboardStore.findUserById(req.params.itemId);
  if (!found) return res.status(404).json({ error: 'User not found' });
  if (remove && String(found.user.email || '').toLowerCase() === String(req.userEmail || '').toLowerCase()) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  if (remove) {
    const result = dashboardStore.updateUserAcrossTenants(req.params.itemId, {}, true);
    return res.json({ ok: true, deleted: true, id: req.params.itemId, tenantId: result.tenantId });
  }

  const values = {};
  for (const field of ['name', 'email', 'role', 'status', 'team']) {
    if (req.body?.[field] !== undefined) values[field] = String(req.body[field]).trim();
  }
  if (values.name !== undefined && !values.name) return res.status(400).json({ error: 'User name is required' });
  if (values.email !== undefined) {
    if (!/^\S+@\S+\.\S+$/.test(values.email)) return res.status(400).json({ error: 'Email must be valid' });
    values.email = values.email.toLowerCase();
    const existing = dashboardStore.findUserByEmail(values.email);
    if (existing && String(existing.user.id) !== String(req.params.itemId)) return res.status(409).json({ error: 'Email is already registered' });
  }
  if (values.role !== undefined && !tenantRoles.has(values.role)) return res.status(400).json({ error: 'Invalid user role' });
  if (values.status !== undefined && !['active', 'disabled'].includes(values.status)) return res.status(400).json({ error: 'Invalid account status' });
  const result = dashboardStore.updateUserAcrossTenants(req.params.itemId, values, false);
  const tenant = dashboardStore.getTenant(result.tenantId);
  const data = publicRecord({
    ...result.user,
    tenantId: result.tenantId,
    tenantName: tenant?.name || result.tenantId,
    business: tenant?.name || result.tenantId,
  });
  return res.json({ ok: true, deleted: false, data, record: data });
}

const telephonyFields = new Set(['kind', 'name', 'type', 'country', 'environment', 'capabilities', 'business', 'tenantId', 'status', 'callbackUrl', 'eventsUrl', 'routing']);

function normalizeBusinessRecord(values) {
  const name = String(values.name || '').trim();
  const tenantId = dashboardStore.createTenant(name);
  return {
    ...values,
    name,
    businessId: tenantId,
    tenantId,
    type: 'Business',
    status: 'active',
    registrationDate: now(),
  };
}

function normalizePlatformAnnouncement(values) {
  const title = String(values.title || '').trim();
  const body = String(values.body || '').trim();
  const audience = String(values.audience || '').trim();
  if (!title) return { error: 'Announcement title is required' };
  if (!body) return { error: 'Announcement message is required' };
  if (!audience) return { error: 'A tenant audience is required' };

  let tenantId = '';
  let business = 'All tenants';
  if (audience !== 'all') {
    const tenant = dashboardStore.getTenant(audience);
    if (!tenant) return { error: 'Selected tenant was not found' };
    tenantId = tenant.id;
    business = tenant.name;
  }

  return {
    values: {
      ...values,
      title,
      body,
      audience,
      tenantId,
      business,
      status: 'draft',
      publishAt: '',
    },
  };
}

function telephonyPublicBase(req) {
  return String(process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}

function normalizeTelephonyRecord(req, values, existing = {}) {
  const kind = String(values.kind || existing.kind || '').toLowerCase();
  const requestedTenantId = String(values.tenantId || existing.tenantId || req.tenantId).trim();
  let tenant = null;
  try {
    tenant = dashboardStore.getTenant(requestedTenantId);
  } catch {
    tenant = null;
  }
  const configured = String(process.env.AT_USERNAME || '').trim() && String(process.env.AT_API_KEY || '').trim();
  const publicBase = telephonyPublicBase(req);
  const routing = kind === 'web' ? 'web' : ['phone', 'web', 'all'].includes(String(values.routing || existing.routing).toLowerCase()) ? String(values.routing || existing.routing).toLowerCase() : 'all';
  return {
    ...values,
    kind,
    type: kind === 'number' ? 'Voice-enabled virtual number' : kind === 'web' ? 'Web client' : "Africa's Talking voice provider",
    environment: 'live',
    capabilities: 'voice, events',
    business: ['number', 'web'].includes(kind) ? tenant?.name || '' : '',
    tenantId: ['number', 'web'].includes(kind) ? requestedTenantId : '',
    routing,
    status: existing.status || (kind === 'provider' && configured ? 'configured' : 'unconfigured'),
    callbackUrl: `${publicBase}/voice/actions`,
    eventsUrl: `${publicBase}/voice/events`,
  };
}

function sanitizeTelephonyRecord(body) {
  const source = sanitizeRecord(body);
  return Object.fromEntries(Object.entries(source).filter(([key]) => telephonyFields.has(key)));
}

function findUnsafeTelephonyField(body) {
  return Object.keys(sanitizeRecord(body)).find((key) => /(api.?key|secret|token|password|credential)/i.test(key));
}

function validateTelephonyRecord(record, rows, currentId = null) {
  const kind = String(record.kind || '').trim().toLowerCase();
  const name = String(record.name || '').trim();
  if (!['provider', 'web', 'number'].includes(kind)) return 'Record type must be provider, web, or phone number';
  if (!name) return kind === 'web' ? 'Web client name is required' : 'Provider or phone number is required';
  if (name.length > 200) return 'Provider, web client, or phone number is too long';
  if (kind === 'number' && !/^\+[1-9]\d{7,14}$/.test(name)) return 'Phone numbers must use international E.164 format, for example +255712345678';
  if (record.routing && !['phone', 'web', 'all'].includes(String(record.routing).toLowerCase())) return 'Routing service must be phone, web, or all';
  if (['number', 'web'].includes(kind)) {
    if (!record.tenantId) return 'A business must be selected for this telephony record';
    try {
      if (!dashboardStore.getTenant(String(record.tenantId))) return 'The selected business was not found';
    } catch {
      return 'The selected business was not found';
    }
  }
  for (const field of ['callbackUrl', 'eventsUrl']) {
    if (!record[field]) continue;
    try {
      const parsed = new URL(String(record[field]));
      if (!['http:', 'https:'].includes(parsed.protocol)) return `${field} must use HTTP or HTTPS`;
    } catch {
      return `${field} must be a valid URL`;
    }
  }
  const duplicate = rows.find((row) => row.id !== currentId && String(row.kind || '').toLowerCase() === kind && String(row.name || '').trim() === name);
  if (duplicate) return kind === 'number' ? 'This phone number is already in the inventory' : 'This provider is already in the inventory';
  return null;
}

module.exports = router;
