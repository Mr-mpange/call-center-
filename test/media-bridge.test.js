const assert = require('node:assert/strict');
const test = require('node:test');
const { mediaBridge, setMediaBridgeAdapter } = require('../src/services/mediaBridge');

test('unconfigured media bridge fails closed and never reports connected', async () => {
  setMediaBridgeAdapter();
  const session = await mediaBridge.createSession({ id: 'call-test' });
  assert.equal(session.available, false);
  const result = await mediaBridge.connectAgent('call-test', { id: 'agent-test' });
  assert.equal(result.connected, false);
});

test('a configured adapter can confirm a real bridge through the contract', async () => {
  const calls = [];
  setMediaBridgeAdapter({
    async createSession(call) { calls.push(['createSession', call.id]); return { id: 'bridge-session' }; },
    async connectAgent(id, agent) { calls.push(['connectAgent', id, agent.id]); return { connected: true }; },
    async disconnectAgent(id, agentId) { calls.push(['disconnectAgent', id, agentId]); return { disconnected: true }; },
    async terminateSession(id) { calls.push(['terminateSession', id]); return { terminated: true }; },
    async getSessionStatus(id) { return { id, status: 'connected', connected: true }; },
  });
  const session = await mediaBridge.createSession({ id: 'call-test' });
  const result = await mediaBridge.connectAgent(session.id, { id: 'agent-test' });
  assert.equal(result.connected, true);
  assert.deepEqual(calls, [['createSession', 'call-test'], ['connectAgent', 'bridge-session', 'agent-test']]);
  setMediaBridgeAdapter();
});
