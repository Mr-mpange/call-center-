#!/usr/bin/env node
'use strict';

/**
 * Local end-to-end tenant inbound call test.
 *
 *   node test/e2e/asterisk-inbound-browser.js
 *
 * What it proves (against the real local Asterisk 22 gateway, not a mock):
 *   1. backend + ARI gateway start and connect
 *   2. three authenticated browser agents of one business register over WSS
 *   3. a SIPp caller reaches the business DID (5551001 -> tenant E.164 DID)
 *   4. all three agents ring through the existing SSE dispatcher
 *   5. agent A accepts; the backend atomically awards the call to A
 *   6. agents B and C stop ringing
 *   7. Asterisk originates a WebRTC channel to agent A and ARI bridges both legs
 *   8. bidirectional RTP is verified from browser WebRTC stats + Asterisk CLI
 *   9. hangup from the browser side tears the call down
 *  10. a second call hangs up from the caller side and also cleans up
 *
 * Africa's Talking is NOT involved and is not required.
 */

const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..', '..');
const shotRoot = path.join(root, 'screenshot-to-pixel');
const infra = path.join(root, 'infrastructure', 'asterisk');

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 3399);
const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 4179);
const DB_FILE = path.join(root, 'data', 'asterisk-e2e.sqlite');
const BUSINESS_FILE = path.join(root, 'data', 'asterisk-e2e-businesses.json');
const EVENT_FILE = path.join(root, 'data', 'asterisk-e2e-events.jsonl');
const REPORT_FILE = path.join(root, 'data', 'asterisk-e2e-report.json');
const AGENTS_FILE = path.join(root, 'infrastructure', 'asterisk', 'runtime', 'pjsip-agents.conf');

const TENANT = 'e2e-voice-tenant';
const BUSINESS = 'e2e-voice-business';
const BUSINESS_NAME = 'E2E Test Business';
const DID = '+255699920003';
const LOCAL_DID = '5551001';
const CALLER = '+255700000099';

const AUTH_SECRET = 'asterisk-e2e-auth-secret-0123456789abcdef';
const SIP_SECRET = 'asterisk-e2e-sip-secret-0123456789abcdef';

const ARI_BASE = 'https://127.0.0.1:8089';
const ARI_USER = process.env.ASTERISK_ARI_USERNAME || 'mpange_gateway';
const ARI_PASS = process.env.ASTERISK_ARI_PASSWORD || '497701c26622488944db3732d1c7e1942c049a25d211c7beb9ea537d7c1a988a';

const AGENTS = [
  { key: 'A', userId: 'e2e-user-a', agentId: 'e2e-agent-a', email: 'e2e-agent-a@example.test', name: 'E2E Agent A', password: 'E2eAgentAPass1!' },
  { key: 'B', userId: 'e2e-user-b', agentId: 'e2e-agent-b', email: 'e2e-agent-b@example.test', name: 'E2E Agent B', password: 'E2eAgentBPass1!' },
  { key: 'C', userId: 'e2e-user-c', agentId: 'e2e-agent-c', email: 'e2e-agent-c@example.test', name: 'E2E Agent C', password: 'E2eAgentCPass1!' },
];

// The seed step requires src modules directly in this process, so the isolated
// database paths and secrets must be installed before those modules load their
// module-level file handles. Otherwise the harness would write into the
// developer's real data/dashboard.sqlite.
process.env.DASHBOARD_DB_FILE = DB_FILE;
process.env.VOICE_BUSINESSES_FILE = BUSINESS_FILE;
process.env.VOICE_LOG_FILE = EVENT_FILE;
process.env.AUTH_SECRET = AUTH_SECRET;
process.env.SIP_CREDENTIAL_SECRET = SIP_SECRET;

const children = [];
const records = [];
// SIP usernames are provisioned per agent and deliberately not returned by the
// session status API, so the harness matches gateway rows with the identity it
// provisioned for the agent it is about to make answer (agent A).
let winnerSipUsername = null;
// Kept so a failed run can dump what each softphone was actually showing.
let openedSessions = null;
const report = { startedAt: new Date().toISOString(), checks: [], calls: [] };
let exitCode = 1;

function log(message) {
  const stamp = new Date().toISOString().slice(11, 23);
  process.stdout.write(`[${stamp}] ${typeof message === 'string' ? message : JSON.stringify(message)}\n`);
}

function tail(text, lines = 20) {
  return String(text || '').split('\n').filter((line) => line.trim()).slice(-lines).join(' | ') || '(no output)';
}

function check(name, ok, detail) {
  report.checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? null : detail });
  log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  return Boolean(ok);
}

function assert(name, condition, detail) {
  const ok = check(name, condition, detail);
  if (!ok) throw new Error(`${name} failed${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}

async function waitFor(fn, { timeout = 30_000, interval = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() <= deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${label} (last: ${last instanceof Error ? last.message : JSON.stringify(last)})`);
}

async function httpJson(url, { method = 'GET', token, body, timeoutMs = 15_000, headers: extraHeaders = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json', ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    return { status: response.status, ok: response.ok, payload };
  } finally {
    clearTimeout(timer);
  }
}

function ariRequest(method, pathname) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      `${ARI_BASE}${pathname}`,
      {
        method,
        auth: `${ARI_USER}:${ARI_PASS}`,
        rejectUnauthorized: false,
        timeout: 10_000,
      },
      (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          let payload = null;
          try { payload = body ? JSON.parse(body) : null; } catch { payload = body; }
          resolve({ status: response.statusCode, ok: response.statusCode >= 200 && response.statusCode < 300, payload });
        });
      },
    );
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('ARI request timed out')));
    request.end();
  });
}

function dockerSync(args, options = {}) {
  return execFileSync('docker', args, {
    cwd: infra,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function startChild(name, command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.push(child);
  const record = { name, child, output: '' };
  records.push(record);
  child.stdout.on('data', (chunk) => { record.output += chunk; if (process.env.E2E_VERBOSE) log(`[${name}] ${chunk}`.trimEnd()); });
  child.stderr.on('data', (chunk) => { record.output += chunk; if (process.env.E2E_VERBOSE) log(`[${name}] ${chunk}`.trimEnd()); });
  child.on('close', () => {
    const index = children.indexOf(child);
    if (index >= 0) children.splice(index, 1);
  });
  return record;
}

function startSipp(scenarioArgs) {
  const record = startChild(
    'sipp',
    'docker',
    ['compose', '--profile', 'test', 'run', '--rm', '-T', '--no-deps', 'sipp-tenant', ...scenarioArgs],
    { cwd: infra },
  );
  record.done = new Promise((resolve) => {
    record.child.on('close', (code) => resolve({ code, output: record.output }));
  });
  return record;
}

function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}

function seedDatabase() {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${DB_FILE}${suffix}`, { force: true });
  }
  fs.rmSync(BUSINESS_FILE, { force: true });
  fs.rmSync(EVENT_FILE, { force: true });
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

  const dashboardStore = require(path.join(root, 'src', 'utils', 'dashboardStore'));
  const voiceBusinessStore = require(path.join(root, 'src', 'utils', 'voiceBusinessStore'));
  const { clientNameFor } = require(path.join(root, 'src', 'services', 'voiceAgentRouting'));

  dashboardStore.ensureTenant(TENANT, 'E2E Voice Tenant');
  const store = dashboardStore.read(TENANT);
  store.users = AGENTS.map((agent) => ({
    id: agent.userId,
    name: agent.name,
    email: agent.email,
    role: 'Agent',
    status: 'active',
    tenantId: TENANT,
    passwordHash: passwordHash(agent.password),
  }));
  dashboardStore.write(store, TENANT);
  voiceBusinessStore.upsert(TENANT, {
    id: BUSINESS,
    tenantId: TENANT,
    name: BUSINESS_NAME,
    numbers: [DID],
    routing: 'parallel',
    agents: AGENTS.map((agent) => ({
      id: agent.agentId,
      name: agent.name,
      type: 'web',
      clientName: clientNameFor(TENANT, agent.email),
    })),
  });
  log(`Seeded tenant ${TENANT} with ${AGENTS.length} browser agents and DID ${DID}`);
}

function backendEnv() {
  return {
    ...process.env,
    PORT: String(BACKEND_PORT),
    NODE_ENV: 'development',
    DASHBOARD_DB_FILE: DB_FILE,
    VOICE_BUSINESSES_FILE: BUSINESS_FILE,
    VOICE_LOG_FILE: EVENT_FILE,
    AUTH_SECRET,
    API_AUTH_REQUIRED: 'true',
    SIP_CREDENTIAL_SECRET: SIP_SECRET,
    MEDIA_BRIDGE_PROVIDER: 'asterisk',
    ASTERISK_ARI_URL: ARI_BASE,
    ASTERISK_ARI_USERNAME: ARI_USER,
    ASTERISK_ARI_PASSWORD: ARI_PASS,
    ASTERISK_ARI_APP: 'call-center',
    ASTERISK_ARI_INSECURE: 'true',
    ASTERISK_WSS_URL: 'wss://127.0.0.1:8089/ws',
    ASTERISK_SIP_DOMAIN: 'localhost',
    ASTERISK_INBOUND_CONTEXTS: 'from-test-sip,from-at-trunk,from-sip',
    ASTERISK_TEST_DID_ALIASES: `${LOCAL_DID}:${DID}`,
    ASTERISK_LOCAL_TEST_CONTEXTS: 'from-test-sip',
    INBOUND_BROWSER_RING_TIMEOUT_MS: '25000',
    ASTERISK_AGENT_REGISTRATION_WAIT_MS: '8000',
    ASTERISK_AGENT_ORIGINATE_TIMEOUT_MS: '8000',
    ASTERISK_MEDIA_READY_TIMEOUT_MS: '20000',
    ASTERISK_PJSIP_PROVISIONING: 'file',
    ASTERISK_PJSIP_AGENTS_FILE: AGENTS_FILE,
    ASTERISK_CLI_ENABLED: 'true',
    ASTERISK_CLI_BIN: 'docker',
    ASTERISK_CLI_DOCKER_CONTAINER: 'asterisk-asterisk-1',
    CORS_ORIGINS: `http://127.0.0.1:${FRONTEND_PORT}`,
    // Keep the Africa's Talking paths inert for this local test.
    AT_USERNAME: 'sandbox',
    NILEAGI_ENABLED: 'false',
  };
}

async function startBackend() {
  const record = startChild('backend', process.execPath, [path.join(root, 'src', 'server.js')], {
    cwd: root,
    env: backendEnv(),
  });
  try {
    await waitFor(async () => {
      const health = await httpJson(`http://127.0.0.1:${BACKEND_PORT}/health`, { timeoutMs: 5_000 });
      if (!health.ok) return false;
      const gateway = health.payload?.mediaGateway;
      return Boolean(gateway?.started && gateway?.adapterConfigured && gateway?.controller?.started && gateway?.controller?.ari?.connected);
    }, { timeout: 60_000, label: 'backend health with a connected ARI gateway' });
  } catch (error) {
    throw new Error(`${error.message} :: backend output: ${tail(record.output)}`);
  }
  assert('ARI controller connected', true, 'GET /health reports mediaGateway.controller.ari.connected');
  return record;
}

async function startFrontend() {
  const record = startChild(
    'frontend',
    path.join(shotRoot, 'node_modules', '.bin', 'vite'),
    ['dev', '--host', '127.0.0.1', '--port', String(FRONTEND_PORT), '--strictPort'],
    { cwd: shotRoot, env: { ...process.env, VITE_API_BASE_URL: `http://127.0.0.1:${BACKEND_PORT}/api` } },
  );
  let lastStatus = 'unreachable';
  try {
    await waitFor(async () => {
      // The TanStack Start SSR server answers document routes with 406 when a
      // client advertises only application/json.
      const response = await httpJson(`http://127.0.0.1:${FRONTEND_PORT}/login`, {
        timeoutMs: 15_000,
        headers: { Accept: 'text/html,application/xhtml+xml' },
      });
      lastStatus = response.status;
      return response.status === 200;
    }, { timeout: 120_000, label: 'frontend dev server' });
  } catch (error) {
    throw new Error(`${error.message} (last HTTP status: ${lastStatus}) :: frontend output: ${tail(record.output)}`);
  }
  return record;
}

async function login(agent) {
  const response = await httpJson(`http://127.0.0.1:${BACKEND_PORT}/api/auth/login`, {
    method: 'POST',
    body: { email: agent.email, password: agent.password },
  });
  if (!response.ok) throw new Error(`Login failed for ${agent.email}: ${JSON.stringify(response.payload)}`);
  return response.payload;
}

async function sipCredentials(token) {
  const response = await httpJson(`http://127.0.0.1:${BACKEND_PORT}/api/voice/sip-credentials`, { token });
  if (!response.ok) throw new Error(`SIP credential provisioning failed: ${JSON.stringify(response.payload)}`);
  return response.payload.identity;
}

function makeToneWav() {
  const file = path.join(os.tmpdir(), `mpange-e2e-mic-${process.pid}.wav`);
  const rate = 8000;
  const samples = rate * 4;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i += 1) {
    buffer.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 7000), 44 + i * 2);
  }
  fs.writeFileSync(file, buffer);
  return file;
}

async function openBrowserAgents(logins) {
  const { chromium } = require(path.join(shotRoot, 'node_modules', 'playwright'));
  const tonePath = makeToneWav();
  const browser = await chromium.launch({
    args: [
      '--ignore-certificate-errors',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${tonePath}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
    ],
  });
  children.push(browser);
  const sessions = [];
  for (let index = 0; index < AGENTS.length; index += 1) {
    const agent = AGENTS[index];
    const loginPayload = logins[index];
    const context = await browser.newContext({
      permissions: ['microphone'],
      ignoreHTTPSErrors: true,
      viewport: { width: 1440, height: 900 },
    });
    await context.addInitScript(
      ({ token, user }) => {
        window.localStorage.setItem('mpange.auth.token', token);
        window.localStorage.setItem('mpange.auth.user', JSON.stringify(user));
      },
      { token: loginPayload.token, user: loginPayload.user },
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => log(`[${agent.key} pageerror] ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        log(`[${agent.key} console.${message.type()}] ${message.text()}`);
      }
    });
    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      const isCallApi = /\/(accept|media-ready|reject|end)(\?|$)/.test(url);
      if (status >= 400) {
        log(`[${agent.key} HTTP ${status}] ${response.request().method()} ${url}`);
      } else if (isCallApi) {
        // The accept/media-ready exchanges decide whether a call ever becomes
        // connected, so keep their bodies instead of logging only failures.
        const body = await response.text().catch(() => '');
        log(`[${agent.key} HTTP ${status}] ${response.request().method()} ${url} :: ${body.slice(0, 700)}`);
      }
    });
    page.on('requestfailed', (request) => {
      log(`[${agent.key} requestfailed] ${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'unknown'}`);
    });
    // Capture the raw SIP framing the browser receives so a rejected header
    // can be diagnosed from the exact bytes instead of a parser warning.
    page.on('websocket', (socket) => {
      socket.on('framereceived', (frame) => {
        const text = String(frame.payload ?? '');
        if (/^(INVITE|SIP\/2\.0|ACK|BYE|REGISTER|CANCEL) /m.test(text)) {
          log(`[${agent.key} sip<] ${text.slice(0, 3000)}`);
        }
      });
      socket.on('framesent', (frame) => {
        const text = String(frame.payload ?? '');
        if (/^(INVITE|SIP\/2\.0|ACK|BYE|REGISTER|CANCEL) /m.test(text)) {
          // Generous slice: the browser's 200 OK carries its full SDP answer,
          // including every ICE candidate — the one thing that tells us which
          // host addresses the softphone offered media on.
          log(`[${agent.key} sip>] ${text.slice(0, 4000)}`);
        }
      });
    });
    await page.goto(`http://127.0.0.1:${FRONTEND_PORT}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('button[aria-label="Open phone"]').waitFor({ state: 'visible', timeout: 30_000 });
    sessions.push({ agent, context, page, token: loginPayload.token });
  }
  return { browser, sessions, tonePath };
}

async function waitForSipRegistration(identities) {
  await waitFor(async () => {
    const states = await Promise.all(identities.map(async (identity) => {
      const result = await ariRequest('GET', `/ari/endpoints/PJSIP/${encodeURIComponent(identity.username)}`);
      return { username: identity.username, state: result.payload?.state || 'unknown' };
    }));
    const offline = states.filter((item) => String(item.state).toLowerCase() !== 'online');
    if (offline.length) return false;
    return states;
  }, { timeout: 45_000, interval: 500, label: 'all browser SIP endpoints registered over WSS' });
  assert('Browser SIP registration', true, identities.map((identity) => `${identity.username}=online`).join(', '));
}

async function latestSession() {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(DB_FILE);
  try {
    const row = db.prepare(
      'SELECT id, status FROM inbound_voice_sessions WHERE tenant_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1',
    ).get(TENANT);
    return row || null;
  } finally {
    db.close();
  }
}

async function sessionStatus(token, sessionId) {
  const response = await httpJson(
    `http://127.0.0.1:${BACKEND_PORT}/api/voice/inbound-calls/${encodeURIComponent(sessionId)}/status`,
    { token },
  );
  return response;
}

async function waitForIncoming(sessions, label) {
  for (const session of sessions) {
    const section = session.page.locator('section[aria-label="Softphone"]');
    await section.waitFor({ state: 'visible', timeout: 30_000 });
    await session.page.getByRole('button', { name: 'Answer', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    const text = await section.innerText();
    if (!text.includes('Incoming call')) throw new Error(`${session.agent.key} is not showing an incoming call: ${text}`);
  }
  check(label, true, sessions.map((session) => session.agent.key).join(','));
}

async function waitUntilStoppedRinging(session, label) {
  await waitFor(async () => {
    const section = session.page.locator('section[aria-label="Softphone"]');
    if (!(await section.isVisible())) return true;
    const text = await section.innerText();
    return !text.includes('Incoming call') && !text.includes('Answer');
  }, { timeout: 20_000, label: `${session.agent.key} ${label}` });
  check(label, true, session.agent.key);
}

// Polls until the call is genuinely verified: backend status connected with
// browser-reported two-way RTP, an ARI bridge holding both legs, both channels
// Up, and bidirectional packets visible in the Asterisk CLI. Throws (and is
// retried by waitFor) until every condition holds, so a bare ARI bridge
// without human-audible audio never passes.
async function collectVerifiedCall(token, sessionId) {
  const response = await sessionStatus(token, sessionId);
  if (!response.ok) throw new Error(`status endpoint returned ${response.status}: ${JSON.stringify(response.payload)}`);
  const session = response.payload.session;
  if (session.status !== 'connected') throw new Error(`call status is ${session.status}`);
  const evidence = session.mediaEvidence || {};
  if (!(Number(evidence.inboundBytes) > 0 && Number(evidence.outboundBytes) > 0)) {
    throw new Error(`browser RTP evidence incomplete (${evidence.inboundBytes || 0}/${evidence.outboundBytes || 0})`);
  }
  if (!session.bridgeId || !session.callerChannelId || !session.agentChannelId) {
    throw new Error('gateway media resources are not assigned yet');
  }

  const bridge = await ariRequest('GET', `/ari/bridges/${encodeURIComponent(session.bridgeId)}`);
  if (!bridge.ok) throw new Error(`ARI bridge is missing (${bridge.status})`);
  const channels = Array.isArray(bridge.payload?.channels) ? bridge.payload.channels : [];
  if (!channels.includes(session.callerChannelId) || !channels.includes(session.agentChannelId)) {
    throw new Error(`bridge does not contain both legs: ${JSON.stringify(channels)}`);
  }

  const caller = await ariRequest('GET', `/ari/channels/${encodeURIComponent(session.callerChannelId)}`);
  const agent = await ariRequest('GET', `/ari/channels/${encodeURIComponent(session.agentChannelId)}`);
  if (caller.payload?.state !== 'Up' || agent.payload?.state !== 'Up') {
    throw new Error(`channel states caller=${caller.payload?.state} agent=${agent.payload?.state}`);
  }

  // Real Asterisk 22 channelstats: the channel column is the channel name
  // with the "PJSIP/" prefix stripped and truncated to 18 characters, so no
  // row contains "PJSIP/" and the endpoint username only appears truncated.
  // Reuse the backend parser so both sides read the gateway the same way, and
  // take the freshest matching row: a failed earlier attempt can leave the
  // same agent's endpoint up in a second, older row.
  const asteriskCli = require(path.join(root, 'src', 'services', 'asteriskCli'));
  const stats = dockerSync(['exec', 'asterisk-asterisk-1', 'asterisk', '-rx', 'pjsip show channelstats']);
  const rows = asteriskCli.parseChannelStats(stats);
  const agentRow = asteriskCli.findChannelRow(rows, {
    username: winnerSipUsername,
    channelId: session.agentChannelId,
  });
  if (!agentRow) {
    throw new Error(
      `Asterisk channelstats has no line for the agent channel `
      + `(username=${winnerSipUsername} rows=${JSON.stringify(rows.map((row) => row.channel))})`,
    );
  }
  const rx = agentRow.rxPackets;
  const tx = agentRow.txPackets;
  if (!(rx > 0 && tx > 0)) {
    throw new Error(`CLI RTP is one-way or missing (rx=${rx} tx=${tx} uptime=${agentRow.uptimeSeconds}s)`);
  }

  return { session, evidence, bridge: bridge.payload, cli: { rx, tx, channel: agentRow.channel, codec: agentRow.codec } };
}

async function verifyTwoWayMedia(token, sessionId, label) {
  // Rethrow so waitFor's timeout message includes the concrete reason
  // (channelstats line, missing bridge, one-way RTP, ...) instead of "false".
  const detail = await waitFor(() => collectVerifiedCall(token, sessionId), {
    timeout: 40_000,
    interval: 500,
    label: `${label}: verified two-way media`,
  });
  assert('call status is connected', detail.session.status === 'connected', detail.session.status);
  assert('media verified timestamp recorded', Boolean(detail.session.mediaVerifiedAt), detail.session.mediaVerifiedAt);
  assert('browser reported inbound RTP bytes', Number(detail.evidence.inboundBytes) > 0, detail.evidence.inboundBytes);
  assert('browser reported outbound RTP bytes', Number(detail.evidence.outboundBytes) > 0, detail.evidence.outboundBytes);
  assert('gateway bridge id assigned', Boolean(detail.session.bridgeId), detail.session.bridgeId);
  assert('caller channel id assigned', Boolean(detail.session.callerChannelId), detail.session.callerChannelId);
  assert('agent channel id assigned', Boolean(detail.session.agentChannelId), detail.session.agentChannelId);
  const channels = Array.isArray(detail.bridge?.channels) ? detail.bridge.channels : [];
  assert(
    'ARI bridge contains caller and agent channels',
    channels.includes(detail.session.callerChannelId) && channels.includes(detail.session.agentChannelId),
    channels,
  );
  assert('Asterisk CLI reports bidirectional RTP on the agent channel', detail.cli.rx > 0 && detail.cli.tx > 0, detail.cli);
  check(`${label}: verified two-way media (browser RTP + Asterisk CLI)`, true, {
    inboundBytes: detail.evidence.inboundBytes,
    outboundBytes: detail.evidence.outboundBytes,
    source: detail.evidence.source,
    rx: detail.cli.rx,
    tx: detail.cli.tx,
  });
  return detail;
}

async function waitForEnded(token, sessionId, label, timeout = 90_000) {
  // Resolves with the terminal session so callers can assert on its status.
  return waitFor(async () => {
    const response = await sessionStatus(token, sessionId);
    return response.ok && ['ended', 'failed', 'missed'].includes(response.payload?.session?.status)
      ? response.payload.session
      : false;
  }, { timeout, label });
}

async function runCallScenario({ label, hangupFrom, token, sessions }) {
  // The caller-hangup scenario sends its own BYE after a <pause/> whose length
  // is set with -d, and that pause starts as soon as Asterisk answers the
  // caller (which happens at Stasis start, before any agent answers), so it
  // must comfortably outlive ringing + bridging + media verification. The
  // agent-hangup scenario has no pause at all: it waits for the BYE Asterisk
  // sends when the browser hangs up and answers it (see
  // sipp-inbound-uac-wait-bye.xml), so -d is omitted there.
  const scenario = hangupFrom === 'caller' ? 'sipp-inbound-uac.xml' : 'sipp-inbound-uac-wait-bye.xml';
  const scenarioArgs = [
    '-sf', `/sipp-scenarios/${scenario}`, '-s', LOCAL_DID, 'asterisk:5060', '-m', '1',
    '-rtp_echo', '-mp', '6004', '-trace_err', '-timeout', '300s',
  ];
  if (hangupFrom === 'caller') scenarioArgs.push('-d', '45000');
  const caller = startSipp(scenarioArgs);
  try {
    await waitForIncoming(sessions, `${label}: all three agents ring`);
    const sessionId = (await latestSession())?.id;
    assert(`${label}: inbound session created for DID ${DID}`, Boolean(sessionId), sessionId);

    const winner = sessions[0];
    await winner.page.getByRole('button', { name: 'Answer', exact: true }).click();
    await waitFor(async () => {
      const text = await winner.page.locator('section[aria-label="Softphone"]').innerText();
      return text.includes('Connected ·');
    }, { timeout: 45_000, label: `${label}: winning agent sees Connected` });
    check(`${label}: winning agent UI is connected`, true);

    await waitUntilStoppedRinging(sessions[1], `${label}: agent B stopped ringing`);
    await waitUntilStoppedRinging(sessions[2], `${label}: agent C stopped ringing`);

    const detail = await verifyTwoWayMedia(token, sessionId, label);

    if (hangupFrom === 'agent') {
      await winner.page.locator('button[aria-label="End call"]').click();
      await waitForEnded(token, sessionId, `${label}: session ended after browser hangup`);
      check(`${label}: browser hangup ended the session`, true);
      const bridgeGone = await ariRequest('GET', `/ari/bridges/${encodeURIComponent(detail.session.bridgeId)}`);
      const callerGone = await ariRequest('GET', `/ari/channels/${encodeURIComponent(detail.session.callerChannelId)}`);
      check(`${label}: bridge destroyed`, bridgeGone.status === 404, bridgeGone.status);
      check(`${label}: caller channel destroyed`, callerGone.status === 404, callerGone.status);
    } else {
      const ended = await waitForEnded(token, sessionId, `${label}: session ended after caller hangup`);
      check(`${label}: caller BYE ended the session`, ended.status === 'ended', ended.status);
      const callerGone = await ariRequest('GET', `/ari/channels/${encodeURIComponent(detail.session.callerChannelId)}`);
      check(`${label}: caller channel destroyed`, callerGone.status === 404, callerGone.status);
      await waitFor(async () => {
        const text = await winner.page.locator('section[aria-label="Softphone"]').innerText();
        return !text.includes('Connected ·');
      }, { timeout: 20_000, label: `${label}: winning agent UI released` });
      check(`${label}: winning agent UI released`, true);
    }

    // Bounded so a SIPp instance that ignores the remote BYE cannot hang the
    // harness; the teardown checks above already proved the call was cleared.
    const sippResult = await Promise.race([
      caller.done,
      new Promise((resolve) => setTimeout(
        () => resolve({ code: 'stalled', output: caller.output, stalled: true }),
        20_000,
      )),
    ]);
    check(`${label}: SIPp caller completed`, sippResult.code === 0, {
      code: sippResult.code,
      tail: String(sippResult.output).split('\n').slice(-8).join(' | '),
    });
    report.calls.push({ label, hangupFrom, sessionId, detail: { evidence: detail.evidence, cli: detail.cli } });
    return sessionId;
  } finally {
    if (caller.child.exitCode === null) {
      caller.child.kill('SIGKILL');
      // The compose client can die before the containerized SIPp process.
      // Force-remove the service container so a lingering caller with a dead
      // dialog cannot answer the next call's SIP traffic with stale messages.
      try {
        dockerSync(['compose', '--profile', 'test', 'rm', '-sf', 'sipp-tenant']);
      } catch (error) {
        log(`note: could not remove the SIPp container: ${error.message}`);
      }
    }
  }
}

async function main() {
  log('=== Local Asterisk -> browser end-to-end tenant call test ===');
  log(`backend  http://127.0.0.1:${BACKEND_PORT}`);
  log(`frontend http://127.0.0.1:${FRONTEND_PORT}`);

  const asteriskState = dockerSync(['inspect', '--format', '{{.State.Health.Status}}', 'asterisk-asterisk-1']).trim();
  assert('Asterisk container is healthy', asteriskState === 'healthy', asteriskState);
  // Capture raw SIP on the gateway side as well, so a rejected header can be
  // traced from both ends of the dialog.
  dockerSync(['exec', 'asterisk-asterisk-1', 'asterisk', '-rx', 'pjsip set logger on']);

  fs.writeFileSync(AGENTS_FILE, '; runtime agent endpoints are generated by the test\n', { mode: 0o600 });

  seedDatabase();
  await startBackend();
  await startFrontend();

  const identities = [];
  const logins = [];
  for (const agent of AGENTS) {
    const loginPayload = await login(agent);
    logins.push(loginPayload);
    const identity = await sipCredentials(loginPayload.token);
    identities.push(identity);
    check(`SIP identity provisioned for ${agent.key}`, Boolean(identity?.username && identity?.password), identity?.username);
  }

  const generated = fs.readFileSync(AGENTS_FILE, 'utf8');
  assert(
    'per-agent endpoints written to the Asterisk runtime include',
    identities.every((identity) => generated.includes(`[${identity.username}]`)),
    identities.map((identity) => identity.username).join(','),
  );
  // Docker Desktop's bind-mount ownership can lag the chown for a moment, so
  // the authoritative check is whether the Asterisk daemon user can actually
  // read the generated endpoints.
  const readable = await waitFor(async () => {
    const output = dockerSync([
      'exec', '-u', 'asterisk', 'asterisk-asterisk-1', 'sh', '-c',
      'cat /etc/asterisk/runtime/pjsip-agents.conf >/dev/null 2>&1 && echo readable || echo denied',
    ]).trim();
    return output.includes('readable') ? 'readable' : false;
  }, { timeout: 20_000, interval: 500, label: 'asterisk user reading the generated endpoints' })
    .catch(() => 'denied');
  const ownership = dockerSync([
    'exec', 'asterisk-asterisk-1', 'stat', '-c', '%U:%G:%a', '/etc/asterisk/runtime/pjsip-agents.conf',
  ]).trim();
  assert('Asterisk can read the generated agent endpoints', readable === 'readable', { readable, ownership });

  const { browser, sessions } = await openBrowserAgents(logins);
  openedSessions = sessions;
  try {
    await waitForSipRegistration(identities);
    winnerSipUsername = identities[0].username;

    log('--- Call 1: browser agent hangs up ---');
    await runCallScenario({ label: 'call-1-agent-hangup', hangupFrom: 'agent', token: logins[0].token, sessions });

    log('--- Call 2: caller hangs up ---');
    await runCallScenario({ label: 'call-2-caller-hangup', hangupFrom: 'caller', token: logins[0].token, sessions });

    exitCode = report.checks.every((item) => item.ok) ? 0 : 1;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.passed = report.checks.filter((item) => item.ok).length;
    report.failed = report.checks.filter((item) => !item.ok).length;
    fs.writeFileSync(REPORT_FILE, `${JSON.stringify(report, null, 2)}\n`);
    log(`Report written to ${REPORT_FILE} (${report.passed} passed, ${report.failed} failed)`);
    await browser.close().catch(() => undefined);
  }
}

function cleanup() {
  for (const child of children.splice(0)) {
    try {
      if (child.kill) child.kill('SIGKILL');
      else if (child.close) void child.close();
    } catch { /* already gone */ }
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(130); });
process.on('SIGTERM', () => { cleanup(); process.exit(143); });

main()
  .then(() => { cleanup(); process.exit(exitCode); })
  .catch(async (error) => {
    log(`FAIL  ${error.stack || error.message}`);
    try {
      const gatewayLog = dockerSync(['logs', '--tail', '400', 'asterisk-asterisk-1']);
      const lines = gatewayLog.split('\n');
      const windows = [];
      for (let index = 0; index < lines.length; index += 1) {
        // Asterisk prefixes every logger line with "[date] LEVEL[..]:"; strip
        // it before matching so SIP headers inside a packet dump are found.
        const text = lines[index]
          .replace(/^\[[^\]]*\]\s*/, '')
          .replace(/^[A-Z]+\[[^\]]*\](?:\[[^\]]*\])*:\s*/, '');
        if (/^(INVITE sip:|SIP\/2\.0 \d|From: |To: )/.test(text)) windows.push(...lines.slice(index, index + 14));
      }
      if (windows.length) log(`--- asterisk SIP log (headers) ---\n${windows.slice(-200).join('\n')}`);
      else log('--- asterisk SIP log: no SIP headers captured ---');
    } catch (gatewayError) {
      log(`--- asterisk SIP log unavailable: ${gatewayError.message} ---`);
    }
    if (openedSessions) {
      for (const session of openedSessions) {
        try {
          const text = await session.page.locator('section[aria-label="Softphone"]').innerText();
          log(`--- ${session.agent.key} softphone ---\n${text}`);
        } catch (uiError) {
          log(`--- ${session.agent.key} softphone unavailable: ${uiError.message} ---`);
        }
      }
    }
    for (const record of records) {
      if (!record.output.trim()) continue;
      if (record.name === 'backend') {
        // Morgan's request log drowns the gateway decisions; keep those lines.
        const gatewayLines = record.output.split('\n')
          .filter((line) => /\[ARI\]|\[SIP\]|\[Voice|error|Error/i.test(line));
        log(`--- backend gateway log ---\n${gatewayLines.slice(-200).join('\n') || '(no gateway lines captured)'}`);
      }
      log(`--- ${record.name} output (tail) ---\n${tail(record.output, 60)}`);
    }
    cleanup();
    process.exit(1);
  });
