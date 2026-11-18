const { MediaBridgeAdapter } = require('./mediaBridge');

class AsteriskMediaBridge extends MediaBridgeAdapter {
  constructor(controller) {
    super();
    if (!controller) throw new Error('AsteriskMediaBridge requires an ARI controller');
    this.controller = controller;
    this.providerName = 'asterisk';
  }

  isConfigured() {
    return Boolean(this.controller?.status?.().started);
  }

  gatewayReady() {
    const status = this.controller.status();
    return Boolean(status.started && status.ari?.configured);
  }

  async createSession(call = {}) {
    if (!this.gatewayReady()) {
      return { available: false, reason: 'Asterisk ARI gateway is not configured or has not started' };
    }
    if (!call.gatewayChannelId && call.gateway !== 'asterisk') {
      return {
        available: false,
        reason: 'This call has no trusted Asterisk channel; refusing to fabricate a media session',
      };
    }
    return {
      id: call.id,
      available: true,
      provider: 'asterisk',
      tenantId: call.tenantId,
      gatewayChannelId: call.gatewayChannelId,
      gatewayBridgeId: call.gatewayBridgeId || null,
    };
  }

  async prepareInboundCall(call = {}) {
    if (!call.gatewayChannelId) {
      return { prepared: false, reason: 'No Asterisk caller channel is attached to this call' };
    }
    return { prepared: true, provider: 'asterisk', channelId: call.gatewayChannelId };
  }

  async connectAgent(sessionId, agent) {
    if (!this.gatewayReady()) {
      return { connected: false, reason: 'Asterisk ARI gateway is not connected' };
    }
    return this.controller.connectAgent(sessionId, agent);
  }

  async disconnectAgent(sessionId, agentId) {
    return this.controller.disconnectAgent(sessionId, agentId);
  }

  async terminateSession(sessionId) {
    return this.controller.terminateSession(sessionId);
  }

  async getSessionStatus(sessionId) {
    return this.controller.getSessionStatus(sessionId);
  }

  async handleGatewayEvent(event) {
    return this.controller.handleGatewayEvent(event);
  }

  async markMediaReady(sessionId, agentId, evidence) {
    const session = await this.controller.getSessionStatus(sessionId);
    if (!session?.available) return { verified: false, reason: 'Inbound call session not found' };
    return this.controller.markMediaReady(session.tenantId, sessionId, agentId, evidence, 'browser-webrtc');
  }
}

module.exports = { AsteriskMediaBridge };
