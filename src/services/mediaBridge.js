// Provider-neutral media bridge contract. A call must never be presented as
// connected unless the selected adapter confirms that both gateway channels
// are joined and that RTP evidence exists in both directions.
class MediaBridgeAdapter {
  async createSession(_call) { throw new Error('createSession must be implemented by a media bridge'); }
  async connectAgent(_bridgeSessionId, _agent) { throw new Error('connectAgent must be implemented by a media bridge'); }
  async disconnectAgent(_bridgeSessionId, _agentId) { throw new Error('disconnectAgent must be implemented by a media bridge'); }
  async terminateSession(_bridgeSessionId) { throw new Error('terminateSession must be implemented by a media bridge'); }
  async getSessionStatus(_bridgeSessionId) { throw new Error('getSessionStatus must be implemented by a media bridge'); }
  // Optional lifecycle hooks. Adapters that own an inbound gateway implement
  // these; provider callbacks can keep using the core contract.
  async prepareInboundCall(_call) { return { prepared: false, reason: 'prepareInboundCall is not supported by this adapter' }; }
  async handleGatewayEvent(_event) { return { handled: false, reason: 'handleGatewayEvent is not supported by this adapter' }; }
}

class UnconfiguredMediaBridge extends MediaBridgeAdapter {
  async createSession() { return { available: false, reason: 'No verified SIP/WebRTC media bridge is configured' }; }
  async connectAgent() { return { connected: false, reason: 'No verified SIP/WebRTC media bridge is configured' }; }
  async disconnectAgent() { return { disconnected: false, reason: 'No media bridge is configured' }; }
  async terminateSession() { return { terminated: false, reason: 'No media bridge is configured' }; }
  async getSessionStatus() { return { status: 'unavailable', connected: false }; }
  async prepareInboundCall() { return { prepared: false, reason: 'No verified SIP/WebRTC media bridge is configured' }; }
  async handleGatewayEvent() { return { handled: false, reason: 'No media bridge is configured' }; }
}

const unavailable = new UnconfiguredMediaBridge();
let adapter = unavailable;
const requiredMethods = ['createSession', 'connectAgent', 'disconnectAgent', 'terminateSession', 'getSessionStatus'];
const optionalMethods = ['prepareInboundCall', 'handleGatewayEvent'];

function setMediaBridgeAdapter(next = unavailable) {
  if (next !== unavailable && requiredMethods.some((method) => typeof next?.[method] !== 'function')) {
    throw new Error(`Media bridge adapter must implement: ${requiredMethods.join(', ')}`);
  }
  adapter = next;
  return adapter;
}

const mediaBridge = Object.fromEntries(requiredMethods.map((method) => [method, (...args) => adapter[method](...args)]));
for (const method of optionalMethods) {
  mediaBridge[method] = (...args) => (
    typeof adapter[method] === 'function'
      ? adapter[method](...args)
      : Promise.resolve({ handled: false, reason: `${method} is not supported by this adapter` })
  );
}

function getMediaBridgeAdapter() { return adapter; }
function isConfigured() { return adapter !== unavailable && adapter.isConfigured?.() !== false; }
function providerName() { return adapter.providerName || (adapter === unavailable ? 'unconfigured' : 'unknown'); }

module.exports = {
  MediaBridgeAdapter, UnconfiguredMediaBridge, mediaBridge, setMediaBridgeAdapter,
  getMediaBridgeAdapter, isConfigured, providerName,
};
