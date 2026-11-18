'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { once } = require('node:events');

const WebSocket = require('ws');
const { AriClient, normaliseBaseUrl } = require('../src/services/ariClient');

function waitUntil(predicate, { timeout = 10_000, interval = 20, label = 'condition' } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    const tick = () => {
      let result;
      try { result = predicate(); } catch (error) { result = error; }
      if (result) return resolve(result);
      if (Date.now() >= deadline) {
        return reject(new Error(`Timed out waiting for ${label} (last: ${result instanceof Error ? result.message : String(result)})`));
      }
      setTimeout(tick, interval);
    };
    tick();
  });
}

async function startServer(port = 0) {
  const server = new WebSocket.Server({ host: '127.0.0.1', port });
  await once(server, 'listening');
  const connections = [];
  server.on('connection', (socket, request) => {
    connections.push({ socket, request, at: Date.now() });
  });
  return { server, connections, port: server.address().port };
}

function closeServer(server, sockets) {
  for (const socket of sockets) {
    try { socket.terminate(); } catch { /* already gone */ }
  }
  return new Promise((resolve) => server.close(() => resolve()));
}

function makeClient(port, overrides = {}) {
  return new AriClient({
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ari/events`,
    username: 'mpange_gateway',
    password: 'test-ari-password',
    app: 'call-center',
    reconnectBaseMs: 25,
    reconnectMaxMs: 200,
    ...overrides,
  });
}

test('normaliseBaseUrl accepts ws/wss ARI urls and strips event paths', () => {
  assert.equal(normaliseBaseUrl('wss://127.0.0.1:8089/ari/events?app=x'), 'https://127.0.0.1:8089');
  assert.equal(normaliseBaseUrl('ws://localhost:8088/ari'), 'http://localhost:8088');
  assert.equal(normaliseBaseUrl('https://asterisk.example/'), 'https://asterisk.example');
  assert.equal(normaliseBaseUrl(undefined), 'https://127.0.0.1:8089');
});

test('ARI client connects, authenticates and delivers Stasis events', async () => {
  const { server, connections } = await startServer();
  const client = makeClient(server.address().port);
  const statuses = [];
  const events = [];
  client.onStatus((status) => statuses.push(status));
  client.onEvent((event) => events.push(event));

  try {
    client.start();
    assert.equal(client.status().configured, true);
    assert.equal(await client.waitUntilConnected(5_000), true);
    assert.equal(client.status().connected, true);
    assert.ok(client.status().lastConnectedAt);

    await waitUntil(() => connections.length >= 1, { label: 'ARI websocket connection' });
    const auth = connections[0].request.headers.authorization;
    assert.equal(auth, `Basic ${Buffer.from('mpange_gateway:test-ari-password').toString('base64')}`);
    assert.match(connections[0].request.url, /\/ari\/events\?app=call-center/);

    connections[0].socket.send(JSON.stringify({ type: 'StasisStart', application: 'call-center', channel: { id: '1' } }));
    await waitUntil(() => events.length === 1, { label: 'delivered Stasis event' });
    assert.equal(events[0].type, 'StasisStart');
    assert.ok(statuses.some((status) => status.connected));
  } finally {
    client.stop();
    await closeServer(server, connections.map((item) => item.socket));
  }
});

test('an abrupt ARI disconnect reconnects and resets the backoff counter', async () => {
  const { server, connections } = await startServer();
  const client = makeClient(server.address().port);

  try {
    client.start();
    assert.equal(await client.waitUntilConnected(5_000), true);

    // Simulate the Asterisk side dropping the event socket without a close
    // handshake (process restart, network blip).
    connections[0].socket.terminate();
    await waitUntil(() => client.status().connected === false, { label: 'disconnected status' });
    await waitUntil(() => client.status().reconnectAttempt >= 1, { label: 'reconnect scheduled' });
    assert.ok(client.status().lastDisconnectedAt, 'disconnect timestamp is recorded');
    assert.match(client.status().lastError || '', /ARI websocket closed/);

    await waitUntil(() => client.status().connected === true, { timeout: 10_000, label: 'reconnected' });
    await waitUntil(() => connections.length >= 2, { label: 'second websocket connection' });
    assert.equal(client.status().reconnectAttempt, 0, 'backoff counter resets after a successful connect');
    assert.equal(client.status().lastError, null);
  } finally {
    client.stop();
    await closeServer(server, connections.map((item) => item.socket));
  }
});

test('ARI client keeps retrying while Asterisk is down and recovers when it returns', async () => {
  const first = await startServer();
  const port = first.port;
  const client = makeClient(port);

  try {
    client.start();
    assert.equal(await client.waitUntilConnected(5_000), true);

    // Asterisk goes away entirely: every reconnect attempt must fail and the
    // backoff counter must keep climbing instead of giving up silently.
    await closeServer(first.server, first.connections.map((item) => item.socket));
    await waitUntil(() => client.status().connected === false, { label: 'offline status' });
    await waitUntil(() => client.status().reconnectAttempt >= 3, { timeout: 15_000, label: 'persistent retries' });
    assert.equal(client.status().configured, true);
    assert.ok(client.status().lastError, 'last error is retained while offline');

    // Asterisk comes back on the same address: the client recovers on its own.
    const second = await startServer(port);
    try {
      await waitUntil(() => client.status().connected === true, { timeout: 15_000, label: 'recovery after restart' });
      assert.equal(client.status().reconnectAttempt, 0);
      await waitUntil(() => second.connections.length >= 1, { label: 'reconnected socket' });
      second.connections[0].socket.send(JSON.stringify({ type: 'ChannelDestroyed', application: 'call-center' }));
      await waitUntil(() => client.status().connected === true, { label: 'still connected' });
    } finally {
      await closeServer(second.server, second.connections.map((item) => item.socket));
    }
  } finally {
    client.stop();
  }
});

test('stop() cancels reconnects and never opens another socket', async () => {
  const { server, connections } = await startServer();
  const client = makeClient(server.address().port);

  try {
    client.start();
    assert.equal(await client.waitUntilConnected(5_000), true);
    client.stop();
    assert.equal(client.status().connected, false);

    const before = connections.length;
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(connections.length, before, 'no reconnect attempt after stop()');
    assert.equal(client.status().connected, false);

    // Starting again after an intentional stop must work.
    client.start();
    assert.equal(await client.waitUntilConnected(5_000), true);
  } finally {
    client.stop();
    await closeServer(server, connections.map((item) => item.socket));
  }
});

test('start() fails closed when ARI credentials are missing', () => {
  const client = new AriClient({ baseUrl: 'https://127.0.0.1:8089', username: '', password: '' });
  const status = client.start();
  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.match(status.lastError, /ASTERISK_ARI_USERNAME and ASTERISK_ARI_PASSWORD are required/);
  client.stop();
});
