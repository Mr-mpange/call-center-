const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const { DatabaseSync } = require('node:sqlite');

const dbFile = process.env.DASHBOARD_DB_FILE || path.join(process.cwd(), 'data', 'dashboard.sqlite');
const tenantContext = new AsyncLocalStorage();
let database;
const snapshotVersions = new WeakMap();

const platformCollections = [
  'businesses', 'users', 'subscriptions', 'finance', 'telephony', 'monitoring',
  'aiUsage', 'support', 'feedback', 'announcements', 'health', 'security',
  'auditLogs', 'ivr', 'integrations', 'settings',
];

function seedPlatformConfiguration() {
  return {
    general: {
      platformName: 'MPANGE AI Call Center',
      supportEmail: '',
    },
    operations: {
      allowRegistration: true,
    },
    locale: {
      defaultCountry: 'Tanzania',
      defaultTimezone: 'Africa/Dar_es_Salaam',
    },
  };
}

function seedRolePermissions() {
  return [
    { perm: 'Take & make calls', admin: true, supervisor: true, agent: true },
    { perm: 'Listen / whisper / barge', admin: true, supervisor: true, agent: false },
    { perm: 'Edit queues & IVR', admin: true, supervisor: true, agent: false },
    { perm: 'View analytics', admin: true, supervisor: true, agent: false },
    { perm: 'Export call recordings', admin: true, supervisor: false, agent: false },
    { perm: 'Manage users & billing', admin: true, supervisor: false, agent: false },
  ];
}

function seedStore() {
  return {
    version: 3,
    updatedAt: new Date().toISOString(),
    agents: [], liveCalls: [], history: [], contacts: [], queues: [], callbacks: [],
    voicemails: [], tickets: [], support: [], feedback: [], campaigns: [], integrations: [],
    phoneNumbers: [], invoices: [], auditLog: [], helpArticles: [], faqs: [], users: [],
    settings: {
      company: { name: '', timezone: 'Africa/Dar_es_Salaam', defaultLanguage: 'English' },
      queues: [], privacy: { recordingConsent: false, retentionDays: 0 },
      alerts: { missedCalls: false, slaBreach: false },
      businessHours: [],
    },
    rolePermissions: seedRolePermissions(), intents: [], callArtifacts: {}, ivrFlows: [], forwardingGroups: [],
    platform: { collections: Object.fromEntries(platformCollections.map((name) => [name, []])), activity: [], configuration: seedPlatformConfiguration() },
  };
}

function mergeStore(seed, parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const platform = source.platform && typeof source.platform === 'object' ? source.platform : {};
  const collections = platform.collections && typeof platform.collections === 'object' ? platform.collections : {};
  const settings = source.settings && typeof source.settings === 'object' ? source.settings : {};
  const savedRolePermissions = Array.isArray(source.rolePermissions) && source.rolePermissions.length ? source.rolePermissions : seed.rolePermissions;
  return {
    ...seed,
    ...source,
    version: 3,
    rolePermissions: savedRolePermissions,
    settings: {
      ...seed.settings,
      ...settings,
      company: { ...seed.settings.company, ...(settings.company && typeof settings.company === 'object' ? settings.company : {}) },
      privacy: { ...seed.settings.privacy, ...(settings.privacy && typeof settings.privacy === 'object' ? settings.privacy : {}) },
      alerts: { ...seed.settings.alerts, ...(settings.alerts && typeof settings.alerts === 'object' ? settings.alerts : {}) },
      businessHours: Array.isArray(settings.businessHours) ? settings.businessHours : seed.settings.businessHours,
    },
    platform: {
      ...seed.platform,
      ...platform,
      collections: { ...seed.platform.collections, ...collections },
      configuration: {
        ...seed.platform.configuration,
        ...(platform.configuration && typeof platform.configuration === 'object' ? platform.configuration : {}),
        general: { ...seed.platform.configuration.general, ...(platform.configuration?.general && typeof platform.configuration.general === 'object' ? platform.configuration.general : {}) },
        operations: { ...seed.platform.configuration.operations, ...(platform.configuration?.operations && typeof platform.configuration.operations === 'object' ? platform.configuration.operations : {}) },
        locale: { ...seed.platform.configuration.locale, ...(platform.configuration?.locale && typeof platform.configuration.locale === 'object' ? platform.configuration.locale : {}) },
      },
    },
  };
}

function currentTenantId() {
  return tenantContext.getStore()?.tenantId || 'workspace';
}

function validateTenantId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{2,80}$/.test(value)) throw new Error('Invalid tenant identifier');
  return value;
}

function databaseHandle() {
  if (database) return database;
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  database = new DatabaseSync(dbFile);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dashboard_state (
      tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS dashboard_state_updated_idx ON dashboard_state(updated_at);
    CREATE TABLE IF NOT EXISTS recording_sources (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL,
      call_id TEXT NOT NULL,
      source_url TEXT,
      storage_key TEXT,
      mime_type TEXT,
      duration_sec INTEGER,
      status TEXT NOT NULL DEFAULT 'available',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, call_id)
    );
    CREATE INDEX IF NOT EXISTS recording_sources_business_idx ON recording_sources(tenant_id, business_id);
    CREATE INDEX IF NOT EXISTS recording_sources_call_idx ON recording_sources(tenant_id, call_id);
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_id TEXT,
      call_id TEXT,
      provider TEXT NOT NULL,
      operation TEXT NOT NULL,
      duration_ms INTEGER,
      input_bytes INTEGER,
      input_audio_seconds REAL,
      output_bytes INTEGER,
      output_audio_seconds REAL,
      input_characters INTEGER,
      output_characters INTEGER,
      success INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ai_usage_events_tenant_idx ON ai_usage_events(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS ai_usage_events_call_idx ON ai_usage_events(tenant_id, call_id);
    CREATE TABLE IF NOT EXISTS ai_voice_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_id TEXT,
      call_id TEXT,
      provider_session_id TEXT,
      language TEXT NOT NULL DEFAULT 'sw',
      status TEXT NOT NULL DEFAULT 'active',
      turn_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      ended_at TEXT
    );
    CREATE INDEX IF NOT EXISTS ai_voice_sessions_tenant_idx ON ai_voice_sessions(tenant_id, created_at);
    CREATE INDEX IF NOT EXISTS ai_voice_sessions_call_idx ON ai_voice_sessions(tenant_id, call_id);
    CREATE TABLE IF NOT EXISTS voice_businesses (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL,
      name TEXT NOT NULL,
      routing TEXT NOT NULL DEFAULT 'parallel',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, business_id)
    );
    CREATE TABLE IF NOT EXISTS voice_business_numbers (
      tenant_id TEXT NOT NULL,
      business_id TEXT NOT NULL,
      phone_number TEXT NOT NULL UNIQUE,
      PRIMARY KEY (tenant_id, business_id, phone_number),
      FOREIGN KEY (tenant_id, business_id) REFERENCES voice_businesses(tenant_id, business_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS voice_business_agents (
      tenant_id TEXT NOT NULL,
      business_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      number TEXT,
      client_name TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tenant_id, business_id, agent_id),
      FOREIGN KEY (tenant_id, business_id) REFERENCES voice_businesses(tenant_id, business_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS voice_business_number_idx ON voice_business_numbers(phone_number);
    CREATE TABLE IF NOT EXISTS inbound_voice_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL,
      provider_session_id TEXT NOT NULL,
      called_number TEXT NOT NULL,
      caller_number TEXT,
      status TEXT NOT NULL,
      eligible_agents_json TEXT NOT NULL DEFAULT '[]',
      winning_agent_id TEXT,
      failure_reason TEXT,
      ring_started_at TEXT NOT NULL,
      answered_at TEXT,
      connected_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (tenant_id, provider_session_id)
    );
    CREATE INDEX IF NOT EXISTS inbound_voice_sessions_business_status_idx ON inbound_voice_sessions(tenant_id, business_id, status);
    CREATE TABLE IF NOT EXISTS sip_agent_identities (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      email TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_enc TEXT NOT NULL,
      business_ids_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS sip_agent_identities_username_idx ON sip_agent_identities(username);
    CREATE INDEX IF NOT EXISTS sip_agent_identities_status_idx ON sip_agent_identities(status, expires_at);
    CREATE TABLE IF NOT EXISTS gateway_event_dedup (
      event_key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL
    );
  `);
  // Additive migration for databases created before the ARI gateway existed.
  // Every column is nullable so older rows remain readable.
  const inboundColumns = new Set(database.prepare('PRAGMA table_info(inbound_voice_sessions)').all().map((column) => column.name));
  const gatewayColumns = {
    gateway: 'TEXT',
    gateway_channel_id: 'TEXT',
    gateway_bridge_id: 'TEXT',
    gateway_agent_channel_id: 'TEXT',
    gateway_agent_username: 'TEXT',
    media_state: 'TEXT',
    media_evidence_json: 'TEXT',
    media_verified_at: 'TEXT',
  };
  for (const [name, type] of Object.entries(gatewayColumns)) {
    if (!inboundColumns.has(name)) database.exec(`ALTER TABLE inbound_voice_sessions ADD COLUMN ${name} ${type}`);
  }
  database.exec('CREATE INDEX IF NOT EXISTS inbound_voice_sessions_channel_idx ON inbound_voice_sessions(tenant_id, gateway_channel_id)');
  return database;
}

function ensureTenant(tenantId, name = 'Workspace') {
  const id = validateTenantId(tenantId);
  const db = databaseHandle();
  const timestamp = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO tenants (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)').run(id, name, timestamp, timestamp);
  const state = db.prepare('SELECT tenant_id FROM dashboard_state WHERE tenant_id = ?').get(id);
  if (!state) db.prepare('INSERT INTO dashboard_state (tenant_id, version, state_json, updated_at) VALUES (?, ?, ?, ?)').run(id, 3, JSON.stringify(seedStore()), timestamp);
  return id;
}

function createTenant(name) {
  const tenantId = `tenant-${crypto.randomUUID()}`;
  ensureTenant(tenantId, String(name || 'Workspace').trim() || 'Workspace');
  return tenantId;
}

function read(tenantId = currentTenantId()) {
  const id = ensureTenant(tenantId);
  const row = databaseHandle().prepare('SELECT state_json, updated_at FROM dashboard_state WHERE tenant_id = ?').get(id);
  try {
    const store = mergeStore(seedStore(), JSON.parse(row.state_json));
    snapshotVersions.set(store, row.updated_at);
    return store;
  } catch (error) {
    throw new Error(`Dashboard state for tenant ${id} is not valid JSON: ${error.message}`);
  }
}

function write(store, tenantId = currentTenantId()) {
  const id = ensureTenant(tenantId);
  const db = databaseHandle();
  const timestamp = new Date().toISOString();
  const next = { ...store, version: 3, updatedAt: timestamp };
  const expectedUpdatedAt = snapshotVersions.get(store);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = expectedUpdatedAt
      ? db.prepare('UPDATE dashboard_state SET version = ?, state_json = ?, updated_at = ? WHERE tenant_id = ? AND updated_at = ?').run(3, JSON.stringify(next), timestamp, id, expectedUpdatedAt)
      : db.prepare('UPDATE dashboard_state SET version = ?, state_json = ?, updated_at = ? WHERE tenant_id = ?').run(3, JSON.stringify(next), timestamp, id);
    if (result.changes !== 1) throw new Error('Concurrent dashboard update detected; retry the operation');
    db.prepare('UPDATE tenants SET updated_at = ? WHERE id = ?').run(timestamp, id);
    db.exec('COMMIT');
    snapshotVersions.set(next, timestamp);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return next;
}

function update(mutator, tenantId = currentTenantId()) {
  const store = read(tenantId);
  return write(mutator(store) || store, tenantId);
}

function findUserByEmail(email) {
  const db = databaseHandle();
  const rows = db.prepare('SELECT tenant_id, state_json FROM dashboard_state').all();
  const normalized = String(email || '').toLowerCase();
  for (const row of rows) {
    const state = JSON.parse(row.state_json);
    const user = Array.isArray(state.users) ? state.users.find((item) => String(item.email || '').toLowerCase() === normalized) : null;
    if (user) return { tenantId: row.tenant_id, user };
  }
  return null;
}

function listTenants() {
  return databaseHandle().prepare('SELECT id, name, created_at, updated_at FROM tenants ORDER BY name COLLATE NOCASE, id').all().map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

function listUsers() {
  const tenants = new Map(listTenants().map((tenant) => [tenant.id, tenant]));
  const rows = databaseHandle().prepare('SELECT tenant_id, state_json FROM dashboard_state').all();
  return rows.flatMap((row) => {
    let state;
    try { state = JSON.parse(row.state_json); } catch { return []; }
    const tenant = tenants.get(row.tenant_id);
    return Array.isArray(state.users) ? state.users.map((user) => ({
      ...user,
      // Older registrations did not persist per-user timestamps. Use the
      // owning tenant timestamps for those legacy records until they are
      // updated, without fabricating an operational date.
      createdAt: user.createdAt || tenant?.createdAt || null,
      updatedAt: user.updatedAt || tenant?.updatedAt || user.createdAt || tenant?.createdAt || null,
      tenantCreatedAt: tenant?.createdAt || null,
      tenantUpdatedAt: tenant?.updatedAt || null,
      tenantId: row.tenant_id,
      tenantName: tenant?.name || row.tenant_id,
      business: tenant?.name || row.tenant_id,
    })) : [];
  });
}

function findUserById(userId) {
  const rows = databaseHandle().prepare('SELECT tenant_id, state_json FROM dashboard_state').all();
  for (const row of rows) {
    let state;
    try { state = JSON.parse(row.state_json); } catch { continue; }
    const index = Array.isArray(state.users) ? state.users.findIndex((user) => String(user.id) === String(userId)) : -1;
    if (index >= 0) return { tenantId: row.tenant_id, index, user: state.users[index] };
  }
  return null;
}

function updateUserAcrossTenants(userId, values, remove = false) {
  const found = findUserById(userId);
  if (!found) return null;
  const store = read(found.tenantId);
  const index = Array.isArray(store.users) ? store.users.findIndex((user) => String(user.id) === String(userId)) : -1;
  if (index < 0) return null;
  if (remove) store.users.splice(index, 1);
  else store.users[index] = { ...store.users[index], ...values, id: store.users[index].id, updatedAt: new Date().toISOString() };
  write(store, found.tenantId);
  return { tenantId: found.tenantId, user: remove ? null : store.users[index] };
}

function listInvoices() {
  const tenants = new Map(listTenants().map((tenant) => [tenant.id, tenant]));
  const rows = databaseHandle().prepare('SELECT tenant_id, state_json FROM dashboard_state').all();
  return rows.flatMap((row) => {
    let state;
    try { state = JSON.parse(row.state_json); } catch { return []; }
    const tenant = tenants.get(row.tenant_id);
    return Array.isArray(state.invoices) ? state.invoices.map((invoice) => ({
      ...invoice,
      tenantId: row.tenant_id,
      tenantName: tenant?.name || row.tenant_id,
      business: invoice.business || tenant?.name || row.tenant_id,
      transactionId: invoice.transactionId || invoice.id,
      date: invoice.date || invoice.period,
    })) : [];
  });
}

function listTenantRecords(collection) {
  const tenants = new Map(listTenants().map((tenant) => [tenant.id, tenant]));
  const rows = databaseHandle().prepare('SELECT tenant_id, state_json FROM dashboard_state').all();
  return rows.flatMap((row) => {
    let state;
    try { state = JSON.parse(row.state_json); } catch { return []; }
    const tenant = tenants.get(row.tenant_id);
    return Array.isArray(state[collection]) ? state[collection].map((record) => ({
      ...record,
      tenantId: row.tenant_id,
      tenantName: tenant?.name || row.tenant_id,
      business: record.business || tenant?.name || row.tenant_id,
    })) : [];
  });
}

function normalizeRecordingSource(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    businessId: row.business_id,
    callId: row.call_id,
    sourceUrl: row.source_url || null,
    storageKey: row.storage_key || null,
    mimeType: row.mime_type || null,
    durationSec: row.duration_sec == null ? null : Number(row.duration_sec),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getRecordingSource(tenantId = currentTenantId(), callId) {
  const id = ensureTenant(tenantId);
  if (!String(callId || '').trim()) return null;
  const row = databaseHandle().prepare(
    'SELECT * FROM recording_sources WHERE tenant_id = ? AND call_id = ?',
  ).get(id, String(callId));
  return normalizeRecordingSource(row);
}

function listRecordingSources(tenantId = currentTenantId(), businessId) {
  const id = ensureTenant(tenantId);
  const rows = businessId
    ? databaseHandle().prepare('SELECT * FROM recording_sources WHERE tenant_id = ? AND business_id = ? ORDER BY created_at DESC').all(id, String(businessId))
    : databaseHandle().prepare('SELECT * FROM recording_sources WHERE tenant_id = ? ORDER BY created_at DESC').all(id);
  return rows.map(normalizeRecordingSource);
}

function upsertRecordingSource(tenantId = currentTenantId(), values = {}) {
  const id = ensureTenant(tenantId);
  const callId = String(values.callId || '').trim();
  if (!callId) throw new Error('callId is required');
  const sourceUrl = values.sourceUrl == null ? null : String(values.sourceUrl).trim() || null;
  const storageKey = values.storageKey == null ? null : String(values.storageKey).trim() || null;
  if (!sourceUrl && !storageKey) throw new Error('sourceUrl or storageKey is required');
  const businessId = String(values.businessId || id).trim();
  if (!/^[A-Za-z0-9_-]{2,120}$/.test(businessId)) throw new Error('Invalid business identifier');
  const timestamp = new Date().toISOString();
  const sourceId = String(values.id || `recording-${crypto.randomUUID()}`);
  databaseHandle().prepare(`
    INSERT INTO recording_sources (id, tenant_id, business_id, call_id, source_url, storage_key, mime_type, duration_sec, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tenant_id, call_id) DO UPDATE SET
      business_id = excluded.business_id,
      source_url = excluded.source_url,
      storage_key = excluded.storage_key,
      mime_type = excluded.mime_type,
      duration_sec = excluded.duration_sec,
      status = excluded.status,
      updated_at = excluded.updated_at
  `).run(
    sourceId,
    id,
    businessId,
    callId,
    sourceUrl,
    storageKey,
    values.mimeType == null ? null : String(values.mimeType),
    values.durationSec == null ? null : Math.max(0, Number(values.durationSec) || 0),
    String(values.status || 'available'),
    timestamp,
    timestamp,
  );
  return getRecordingSource(id, callId);
}

function getTenant(tenantId) {
  const row = databaseHandle().prepare('SELECT id, name, created_at, updated_at FROM tenants WHERE id = ?').get(validateTenantId(tenantId));
  return row ? { id: row.id, name: row.name, createdAt: row.created_at, updatedAt: row.updated_at } : null;
}

function normalizeVoiceBusiness(row) {
  if (!row) return null;
  const db = databaseHandle();
  return {
    id: row.business_id,
    tenantId: row.tenant_id,
    name: row.name,
    routing: row.routing,
    numbers: db.prepare('SELECT phone_number FROM voice_business_numbers WHERE tenant_id = ? AND business_id = ? ORDER BY phone_number').all(row.tenant_id, row.business_id).map((item) => item.phone_number),
    agents: db.prepare('SELECT agent_id, name, type, number, client_name FROM voice_business_agents WHERE tenant_id = ? AND business_id = ? ORDER BY position, agent_id').all(row.tenant_id, row.business_id).map((agent) => ({
      id: agent.agent_id, name: agent.name, type: agent.type,
      ...(agent.type === 'web' ? { clientName: agent.client_name } : { number: agent.number }),
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listVoiceBusinesses(tenantId) {
  const db = databaseHandle();
  const rows = tenantId
    ? db.prepare('SELECT * FROM voice_businesses WHERE tenant_id = ? ORDER BY name').all(validateTenantId(tenantId))
    : db.prepare('SELECT * FROM voice_businesses ORDER BY tenant_id, name').all();
  return rows.map(normalizeVoiceBusiness);
}

function getVoiceBusiness(tenantId, businessId) {
  const row = databaseHandle().prepare('SELECT * FROM voice_businesses WHERE tenant_id = ? AND business_id = ?').get(validateTenantId(tenantId), String(businessId));
  return normalizeVoiceBusiness(row);
}

function findVoiceBusinessByNumber(phoneNumber) {
  const row = databaseHandle().prepare(`SELECT b.* FROM voice_businesses b JOIN voice_business_numbers n
    ON n.tenant_id = b.tenant_id AND n.business_id = b.business_id WHERE n.phone_number = ?`).get(String(phoneNumber));
  return normalizeVoiceBusiness(row);
}

function upsertVoiceBusiness(tenantId, business) {
  const id = validateTenantId(tenantId);
  const businessId = String(business.id || '');
  if (!/^[A-Za-z0-9_-]{2,64}$/.test(businessId)) throw new Error('Invalid business identifier');
  const db = databaseHandle();
  const timestamp = new Date().toISOString();
  const existing = db.prepare('SELECT created_at FROM voice_businesses WHERE tenant_id = ? AND business_id = ?').get(id, businessId);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`INSERT INTO voice_businesses (tenant_id, business_id, name, routing, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, business_id) DO UPDATE SET name=excluded.name, routing=excluded.routing, updated_at=excluded.updated_at`)
      .run(id, businessId, String(business.name), String(business.routing || 'parallel'), existing?.created_at || business.createdAt || timestamp, timestamp);
    db.prepare('DELETE FROM voice_business_numbers WHERE tenant_id = ? AND business_id = ?').run(id, businessId);
    db.prepare('DELETE FROM voice_business_agents WHERE tenant_id = ? AND business_id = ?').run(id, businessId);
    const insertNumber = db.prepare('INSERT INTO voice_business_numbers (tenant_id, business_id, phone_number) VALUES (?, ?, ?)');
    for (const number of business.numbers || []) insertNumber.run(id, businessId, String(number));
    const insertAgent = db.prepare(`INSERT INTO voice_business_agents (tenant_id, business_id, agent_id, name, type, number, client_name, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    (business.agents || []).forEach((agent, position) => insertAgent.run(id, businessId, String(agent.id || `agent-${position + 1}`), String(agent.name || `Agent ${position + 1}`), agent.type === 'web' ? 'web' : 'phone', agent.type === 'web' ? null : (agent.number || null), agent.type === 'web' ? (agent.clientName || null) : null, position));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return getVoiceBusiness(id, businessId);
}

function deleteVoiceBusiness(tenantId, businessId) {
  return databaseHandle().prepare('DELETE FROM voice_businesses WHERE tenant_id = ? AND business_id = ?').run(validateTenantId(tenantId), String(businessId)).changes > 0;
}

function runWithTenant(tenantId, callback) {
  return tenantContext.run({ tenantId: validateTenantId(tenantId) }, callback);
}

function normalizeUsageNumber(value, { integer = false } = {}) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return integer ? Math.floor(parsed) : parsed;
}

function recordAiUsage(values = {}) {
  const tenantId = ensureTenant(values.tenantId || currentTenantId());
  const timestamp = new Date().toISOString();
  const recordId = String(values.id || `ai-usage-${crypto.randomUUID()}`);
  databaseHandle().prepare(`
    INSERT INTO ai_usage_events (
      id, tenant_id, business_id, call_id, provider, operation, duration_ms,
      input_bytes, input_audio_seconds, output_bytes, output_audio_seconds,
      input_characters, output_characters, success, error_code, retry_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    recordId,
    tenantId,
    values.businessId == null ? null : String(values.businessId),
    values.callId == null ? null : String(values.callId),
    String(values.provider || 'unknown'),
    String(values.operation || 'unknown'),
    normalizeUsageNumber(values.durationMs, { integer: true }),
    normalizeUsageNumber(values.inputBytes, { integer: true }),
    normalizeUsageNumber(values.inputAudioSeconds),
    normalizeUsageNumber(values.outputBytes, { integer: true }),
    normalizeUsageNumber(values.outputAudioSeconds),
    normalizeUsageNumber(values.inputCharacters, { integer: true }),
    normalizeUsageNumber(values.outputCharacters, { integer: true }),
    values.success === true ? 1 : 0,
    values.errorCode == null ? null : String(values.errorCode).slice(0, 120),
    normalizeUsageNumber(values.retryCount, { integer: true }) || 0,
    timestamp,
  );
  return {
    id: recordId,
    tenantId,
    businessId: values.businessId == null ? null : String(values.businessId),
    callId: values.callId == null ? null : String(values.callId),
    provider: String(values.provider || 'unknown'),
    operation: String(values.operation || 'unknown'),
    durationMs: normalizeUsageNumber(values.durationMs, { integer: true }),
    inputBytes: normalizeUsageNumber(values.inputBytes, { integer: true }),
    inputAudioSeconds: normalizeUsageNumber(values.inputAudioSeconds),
    outputBytes: normalizeUsageNumber(values.outputBytes, { integer: true }),
    outputAudioSeconds: normalizeUsageNumber(values.outputAudioSeconds),
    inputCharacters: normalizeUsageNumber(values.inputCharacters, { integer: true }),
    outputCharacters: normalizeUsageNumber(values.outputCharacters, { integer: true }),
    success: values.success === true,
    errorCode: values.errorCode == null ? null : String(values.errorCode).slice(0, 120),
    retryCount: normalizeUsageNumber(values.retryCount, { integer: true }) || 0,
    createdAt: timestamp,
  };
}

function listAiUsage(tenantId = currentTenantId(), filters = {}) {
  const id = ensureTenant(tenantId);
  const clauses = ['tenant_id = ?'];
  const params = [id];
  if (filters.provider) { clauses.push('provider = ?'); params.push(String(filters.provider)); }
  if (filters.operation) { clauses.push('operation = ?'); params.push(String(filters.operation)); }
  if (filters.callId) { clauses.push('call_id = ?'); params.push(String(filters.callId)); }
  const limit = Math.max(1, Math.min(1000, Number(filters.limit) || 100));
  params.push(limit);
  const rows = databaseHandle().prepare(`SELECT * FROM ai_usage_events WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC LIMIT ?`).all(...params);
  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    businessId: row.business_id,
    callId: row.call_id,
    provider: row.provider,
    operation: row.operation,
    durationMs: row.duration_ms,
    inputBytes: row.input_bytes,
    inputAudioSeconds: row.input_audio_seconds,
    outputBytes: row.output_bytes,
    outputAudioSeconds: row.output_audio_seconds,
    inputCharacters: row.input_characters,
    outputCharacters: row.output_characters,
    success: Boolean(row.success),
    errorCode: row.error_code,
    retryCount: row.retry_count,
    createdAt: row.created_at,
  }));
}

function normalizeVoiceSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenantId: row.tenant_id,
    businessId: row.business_id,
    callId: row.call_id,
    providerSessionId: row.provider_session_id,
    language: row.language,
    status: row.status,
    turnCount: row.turn_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
  };
}

function createAiVoiceSession(values = {}) {
  const tenantId = ensureTenant(values.tenantId || currentTenantId());
  const timestamp = new Date().toISOString();
  const sessionId = String(values.id || `ai-voice-${crypto.randomUUID()}`);
  databaseHandle().prepare(`
    INSERT INTO ai_voice_sessions (
      id, tenant_id, business_id, call_id, provider_session_id, language,
      status, turn_count, created_at, updated_at, ended_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', 0, ?, ?, NULL)
  `).run(
    sessionId,
    tenantId,
    values.businessId == null ? null : String(values.businessId),
    values.callId == null ? null : String(values.callId),
    values.providerSessionId == null ? null : String(values.providerSessionId),
    String(values.language || 'sw'),
    timestamp,
    timestamp,
  );
  return getAiVoiceSession(tenantId, sessionId);
}

function getAiVoiceSession(tenantId = currentTenantId(), sessionId) {
  const id = ensureTenant(tenantId);
  const row = databaseHandle().prepare('SELECT * FROM ai_voice_sessions WHERE tenant_id = ? AND id = ?').get(id, String(sessionId || ''));
  return normalizeVoiceSession(row);
}

function updateAiVoiceSession(tenantId = currentTenantId(), sessionId, values = {}) {
  const id = ensureTenant(tenantId);
  const current = getAiVoiceSession(id, sessionId);
  if (!current) return null;
  const timestamp = new Date().toISOString();
  const providerSessionId = values.providerSessionId === undefined ? current.providerSessionId : values.providerSessionId;
  const status = values.status === undefined ? current.status : String(values.status);
  const turnCount = values.turnCount === undefined ? current.turnCount : Math.max(0, Number(values.turnCount) || 0);
  const endedAt = values.endedAt === undefined ? current.endedAt : values.endedAt;
  databaseHandle().prepare(`
    UPDATE ai_voice_sessions
    SET provider_session_id = ?, status = ?, turn_count = ?, updated_at = ?, ended_at = ?
    WHERE tenant_id = ? AND id = ?
  `).run(providerSessionId || null, status, turnCount, timestamp, endedAt || null, id, String(sessionId));
  return getAiVoiceSession(id, sessionId);
}

function normalizeInboundVoiceSession(row) {
  if (!row) return null;
  let eligibleAgents = [];
  let mediaEvidence = null;
  try { eligibleAgents = JSON.parse(row.eligible_agents_json || '[]'); } catch { eligibleAgents = []; }
  try { mediaEvidence = row.media_evidence_json ? JSON.parse(row.media_evidence_json) : null; } catch { mediaEvidence = null; }
  return {
    id: row.id, tenantId: row.tenant_id, businessId: row.business_id,
    providerSessionId: row.provider_session_id, calledNumber: row.called_number,
    callerNumber: row.caller_number, status: row.status, eligibleAgents,
    winningAgentId: row.winning_agent_id, failureReason: row.failure_reason,
    ringStartedAt: row.ring_started_at, answeredAt: row.answered_at,
    connectedAt: row.connected_at, endedAt: row.ended_at,
    gateway: row.gateway || null,
    gatewayChannelId: row.gateway_channel_id || null,
    gatewayBridgeId: row.gateway_bridge_id || null,
    gatewayAgentChannelId: row.gateway_agent_channel_id || null,
    gatewayAgentUsername: row.gateway_agent_username || null,
    mediaState: row.media_state || null,
    mediaEvidence,
    mediaVerifiedAt: row.media_verified_at || null,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function getInboundVoiceSession(tenantId, sessionId) {
  const id = ensureTenant(tenantId);
  return normalizeInboundVoiceSession(databaseHandle().prepare(
    'SELECT * FROM inbound_voice_sessions WHERE tenant_id = ? AND (id = ? OR provider_session_id = ?)'
  ).get(id, String(sessionId || ''), String(sessionId || '')));
}

function listInboundVoiceSessions(tenantId, businessIds = [], statuses = ['ringing']) {
  const id = ensureTenant(tenantId);
  const businesses = Array.from(new Set((businessIds || []).map(String)));
  const allowedStatuses = (statuses || []).filter((status) => ['ringing', 'accepted', 'connecting', 'connected'].includes(String(status))).map(String);
  if (!businesses.length || !allowedStatuses.length) return [];
  const businessParams = businesses.map(() => '?').join(',');
  const statusParams = allowedStatuses.map(() => '?').join(',');
  const rows = databaseHandle().prepare(`
    SELECT * FROM inbound_voice_sessions
    WHERE tenant_id = ? AND business_id IN (${businessParams}) AND status IN (${statusParams})
    ORDER BY ring_started_at ASC
  `).all(id, ...businesses, ...allowedStatuses);
  return rows.map(normalizeInboundVoiceSession);
}

function createInboundVoiceSession(values = {}) {
  const tenantId = ensureTenant(values.tenantId || currentTenantId());
  const timestamp = new Date().toISOString();
  const id = String(values.id || `inbound-${crypto.randomUUID()}`);
  const inserted = databaseHandle().prepare(`
    INSERT OR IGNORE INTO inbound_voice_sessions (
      id, tenant_id, business_id, provider_session_id, called_number, caller_number,
      status, eligible_agents_json, ring_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'ringing', ?, ?, ?, ?)
  `).run(id, tenantId, String(values.businessId), String(values.providerSessionId), String(values.calledNumber),
    values.callerNumber ? String(values.callerNumber) : null, JSON.stringify(values.eligibleAgents || []), timestamp, timestamp, timestamp);
  const session = getInboundVoiceSession(tenantId, values.providerSessionId);
  return { session, created: Number(inserted.changes) === 1 };
}

// Single conditional UPDATE is an atomic first-answer-wins claim in SQLite.
function claimInboundVoiceSession(tenantId, sessionId, agentId) {
  const id = ensureTenant(tenantId);
  const timestamp = new Date().toISOString();
  const result = databaseHandle().prepare(`
    UPDATE inbound_voice_sessions
    SET status = 'accepted', winning_agent_id = ?, answered_at = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ? AND status = 'ringing' AND winning_agent_id IS NULL
      AND EXISTS (
        SELECT 1 FROM json_each(inbound_voice_sessions.eligible_agents_json)
        WHERE json_extract(json_each.value, '$.id') = ?
      )
      AND NOT EXISTS (
        SELECT 1 FROM inbound_voice_sessions active
        WHERE active.tenant_id = inbound_voice_sessions.tenant_id
          AND active.winning_agent_id = ?
          AND active.status IN ('accepted', 'connecting', 'connected')
          AND active.id <> inbound_voice_sessions.id
      )
  `).run(String(agentId), timestamp, timestamp, id, String(sessionId), String(agentId), String(agentId));
  return { claimed: Number(result.changes) === 1, session: getInboundVoiceSession(id, sessionId) };
}

function rejectInboundVoiceSession(tenantId, sessionId, agentId) {
  const id = ensureTenant(tenantId);
  const current = getInboundVoiceSession(id, sessionId);
  if (!current || current.status !== 'ringing') return { rejected: false, session: current };
  const remaining = current.eligibleAgents.filter((agent) => String(agent.id) !== String(agentId));
  const timestamp = new Date().toISOString();
  const result = databaseHandle().prepare(`
    UPDATE inbound_voice_sessions SET eligible_agents_json = ?, status = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ? AND status = 'ringing'
  `).run(JSON.stringify(remaining), remaining.length ? 'ringing' : 'missed', timestamp, id, String(sessionId));
  return { rejected: Number(result.changes) === 1, session: getInboundVoiceSession(id, sessionId) };
}

function isInboundAgentBusy(tenantId, agentId) {
  const id = ensureTenant(tenantId);
  return Boolean(databaseHandle().prepare(`
    SELECT 1 FROM inbound_voice_sessions
    WHERE tenant_id = ? AND winning_agent_id = ? AND status IN ('accepted', 'connecting', 'connected')
    LIMIT 1
  `).get(id, String(agentId)));
}

function updateInboundVoiceSession(tenantId, sessionId, values = {}) {
  const id = ensureTenant(tenantId);
  const current = getInboundVoiceSession(id, sessionId);
  if (!current) return null;
  const allowed = new Set(['ringing', 'accepted', 'connecting', 'connected', 'ended', 'failed', 'missed']);
  const status = allowed.has(String(values.status)) ? String(values.status) : current.status;
  const timestamp = new Date().toISOString();
  const winningAgentId = values.winningAgentId === undefined ? current.winningAgentId : values.winningAgentId;
  const failureReason = values.failureReason === undefined ? current.failureReason : values.failureReason;
  const answeredAt = values.answeredAt === undefined ? current.answeredAt : values.answeredAt;
  const connectedAt = values.connectedAt === undefined ? current.connectedAt : values.connectedAt;
  const endedAt = values.endedAt === undefined ? current.endedAt : values.endedAt;
  databaseHandle().prepare(`
    UPDATE inbound_voice_sessions SET status = ?, winning_agent_id = ?, failure_reason = ?,
      answered_at = ?, connected_at = ?, ended_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?
  `).run(status, winningAgentId || null, failureReason || null, answeredAt || null, connectedAt || null, endedAt || null, timestamp, id, String(sessionId));
  return getInboundVoiceSession(id, sessionId);
}

function findInboundVoiceSessionByChannel(tenantId, channelId) {
  if (!channelId) return null;
  const id = ensureTenant(tenantId);
  return normalizeInboundVoiceSession(databaseHandle().prepare(
    'SELECT * FROM inbound_voice_sessions WHERE tenant_id = ? AND gateway_channel_id = ?'
  ).get(id, String(channelId)));
}

function findInboundVoiceSessionAnyTenant(sessionId) {
  if (!sessionId) return null;
  const row = databaseHandle().prepare(
    'SELECT * FROM inbound_voice_sessions WHERE id = ? OR provider_session_id = ? LIMIT 1'
  ).get(String(sessionId), String(sessionId));
  return normalizeInboundVoiceSession(row);
}

function findInboundVoiceSessionByChannelAnyTenant(channelId) {
  if (!channelId) return null;
  return normalizeInboundVoiceSession(databaseHandle().prepare(
    'SELECT * FROM inbound_voice_sessions WHERE gateway_channel_id = ? LIMIT 1'
  ).get(String(channelId)));
}

function findInboundVoiceSessionByAgentChannelAnyTenant(channelId) {
  if (!channelId) return null;
  return normalizeInboundVoiceSession(databaseHandle().prepare(
    'SELECT * FROM inbound_voice_sessions WHERE gateway_agent_channel_id = ? LIMIT 1'
  ).get(String(channelId)));
}

function findInboundVoiceSessionByBridgeAnyTenant(bridgeId) {
  if (!bridgeId) return null;
  return normalizeInboundVoiceSession(databaseHandle().prepare(
    'SELECT * FROM inbound_voice_sessions WHERE gateway_bridge_id = ? LIMIT 1'
  ).get(String(bridgeId)));
}

// A provider webhook and a gateway Stasis event can represent the same call.
// Reuse a very recent ringing session only when it has not yet been attached
// to a gateway channel, so two genuinely concurrent calls are never merged.
function findRecentInboundVoiceSession(tenantId, businessId, calledNumber, callerNumber, withinMs = 30_000) {
  const id = ensureTenant(tenantId);
  const since = new Date(Date.now() - Math.max(0, Number(withinMs) || 30_000)).toISOString();
  const normalizedCalled = String(calledNumber || '').replace(/[^\d+]/g, '');
  const normalizedCaller = String(callerNumber || '').replace(/[^\d+]/g, '');
  return normalizeInboundVoiceSession(databaseHandle().prepare(`
    SELECT * FROM inbound_voice_sessions
    WHERE tenant_id = ? AND business_id = ? AND called_number = ?
      AND COALESCE(caller_number, '') = ? AND status = 'ringing'
      AND gateway_channel_id IS NULL AND ring_started_at >= ?
    ORDER BY ring_started_at DESC LIMIT 1
  `).get(id, String(businessId), normalizedCalled, normalizedCaller, since));
}

function attachInboundVoiceGateway(tenantId, sessionId, values = {}) {
  const id = ensureTenant(tenantId);
  const current = getInboundVoiceSession(id, sessionId);
  if (!current) return null;
  const timestamp = new Date().toISOString();
  databaseHandle().prepare(`
    UPDATE inbound_voice_sessions SET gateway = ?, gateway_channel_id = ?, gateway_bridge_id = ?,
      gateway_agent_channel_id = ?, gateway_agent_username = ?, media_state = ?, updated_at = ?
    WHERE tenant_id = ? AND id = ?
  `).run(
    values.gateway === undefined ? current.gateway : (values.gateway || null),
    values.gatewayChannelId === undefined ? current.gatewayChannelId : (values.gatewayChannelId || null),
    values.gatewayBridgeId === undefined ? current.gatewayBridgeId : (values.gatewayBridgeId || null),
    values.gatewayAgentChannelId === undefined ? current.gatewayAgentChannelId : (values.gatewayAgentChannelId || null),
    values.gatewayAgentUsername === undefined ? current.gatewayAgentUsername : (values.gatewayAgentUsername || null),
    values.mediaState === undefined ? current.mediaState : (values.mediaState || null),
    timestamp, id, String(sessionId),
  );
  return getInboundVoiceSession(id, sessionId);
}

function recordInboundMediaEvidence(tenantId, sessionId, evidence = {}, markConnected = true) {
  const id = ensureTenant(tenantId);
  const current = getInboundVoiceSession(id, sessionId);
  if (!current) return null;
  const timestamp = new Date().toISOString();
  const status = markConnected && current.status !== 'connected' ? 'connected' : current.status;
  const connectedAt = markConnected ? (current.connectedAt || timestamp) : current.connectedAt;
  databaseHandle().prepare(`
    UPDATE inbound_voice_sessions SET status = ?, media_state = ?, media_evidence_json = ?,
      media_verified_at = ?, connected_at = ?, updated_at = ? WHERE tenant_id = ? AND id = ?
  `).run(
    status,
    markConnected ? 'verified' : 'transport',
    JSON.stringify(evidence || {}),
    markConnected ? timestamp : current.mediaVerifiedAt,
    connectedAt || null,
    timestamp, id, String(sessionId),
  );
  return getInboundVoiceSession(id, sessionId);
}

function rememberGatewayEvent(eventKey, ttlMs = 10 * 60_000) {
  const key = String(eventKey || '').trim();
  if (!key) return false;
  const db = databaseHandle();
  const timestamp = new Date().toISOString();
  const inserted = db.prepare('INSERT OR IGNORE INTO gateway_event_dedup (event_key, created_at) VALUES (?, ?)').run(key, timestamp);
  if (Number(inserted.changes) === 1) {
    const cutoff = new Date(Date.now() - Math.max(60_000, Number(ttlMs) || 600_000)).toISOString();
    db.prepare('DELETE FROM gateway_event_dedup WHERE created_at < ?').run(cutoff);
    return true;
  }
  return false;
}

function normalizeSipIdentity(row) {
  if (!row) return null;
  let businessIds = [];
  try { businessIds = JSON.parse(row.business_ids_json || '[]'); } catch { businessIds = []; }
  return {
    tenantId: row.tenant_id,
    userId: row.user_id,
    agentId: row.agent_id,
    email: row.email,
    username: row.username,
    passwordEnc: row.password_enc,
    businessIds,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getSipAgentIdentityByUser(tenantId, userId) {
  const id = ensureTenant(tenantId);
  return normalizeSipIdentity(databaseHandle().prepare(
    'SELECT * FROM sip_agent_identities WHERE tenant_id = ? AND user_id = ?'
  ).get(id, String(userId)));
}

function getSipAgentIdentityByUsername(username) {
  return normalizeSipIdentity(databaseHandle().prepare(
    'SELECT * FROM sip_agent_identities WHERE username = ?'
  ).get(String(username || '')));
}

function upsertSipAgentIdentity(values = {}) {
  const tenantId = ensureTenant(values.tenantId || currentTenantId());
  const timestamp = new Date().toISOString();
  databaseHandle().prepare(`
    INSERT INTO sip_agent_identities (
      tenant_id, user_id, agent_id, email, username, password_enc, business_ids_json,
      status, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, user_id) DO UPDATE SET
      agent_id = excluded.agent_id, email = excluded.email, username = excluded.username,
      password_enc = excluded.password_enc, business_ids_json = excluded.business_ids_json,
      status = excluded.status, expires_at = excluded.expires_at, updated_at = excluded.updated_at
  `).run(
    tenantId, String(values.userId), String(values.agentId || values.userId), String(values.email || '').toLowerCase(),
    String(values.username), String(values.passwordEnc), JSON.stringify(values.businessIds || []),
    String(values.status || 'active'), values.expiresAt || null, timestamp, timestamp,
  );
  return getSipAgentIdentityByUser(tenantId, values.userId);
}

function listSipAgentIdentities({ tenantId, status = 'active' } = {}) {
  const rows = tenantId
    ? databaseHandle().prepare('SELECT * FROM sip_agent_identities WHERE tenant_id = ? AND status = ? ORDER BY created_at').all(validateTenantId(tenantId), String(status))
    : databaseHandle().prepare('SELECT * FROM sip_agent_identities WHERE status = ? ORDER BY created_at').all(String(status));
  return rows.map(normalizeSipIdentity);
}

function revokeSipAgentIdentity(tenantId, userId) {
  const id = ensureTenant(tenantId);
  return databaseHandle().prepare(
    "UPDATE sip_agent_identities SET status = 'revoked', updated_at = ? WHERE tenant_id = ? AND user_id = ?"
  ).run(new Date().toISOString(), id, String(userId)).changes > 0;
}

function revokeExpiredSipAgentIdentities(nowIso = new Date().toISOString()) {
  return databaseHandle().prepare(
    "UPDATE sip_agent_identities SET status = 'expired', updated_at = ? WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?"
  ).run(nowIso, nowIso).changes;
}

const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;

module.exports = {
  read, write, update, id, dbFile, storeFile: dbFile, createTenant, ensureTenant,
  findUserByEmail, findUserById, updateUserAcrossTenants, listTenants, listUsers, listInvoices, listTenantRecords,
  getRecordingSource, listRecordingSources, upsertRecordingSource, getTenant, runWithTenant, currentTenantId,
  recordAiUsage, listAiUsage,
  createAiVoiceSession, getAiVoiceSession, updateAiVoiceSession,
  createInboundVoiceSession, getInboundVoiceSession, listInboundVoiceSessions, claimInboundVoiceSession, rejectInboundVoiceSession, isInboundAgentBusy, updateInboundVoiceSession,
  findInboundVoiceSessionByChannel, findRecentInboundVoiceSession, attachInboundVoiceGateway, recordInboundMediaEvidence,
  findInboundVoiceSessionAnyTenant, findInboundVoiceSessionByChannelAnyTenant,
  findInboundVoiceSessionByAgentChannelAnyTenant, findInboundVoiceSessionByBridgeAnyTenant,
  rememberGatewayEvent,
  getSipAgentIdentityByUser, getSipAgentIdentityByUsername, upsertSipAgentIdentity, listSipAgentIdentities,
  revokeSipAgentIdentity, revokeExpiredSipAgentIdentities,
  listVoiceBusinesses, getVoiceBusiness, findVoiceBusinessByNumber, upsertVoiceBusiness, deleteVoiceBusiness,
};
