const https = require('node:https');
const axios = require('axios');
const WebSocket = require('ws');

function envBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return String(raw).toLowerCase() === 'true';
}

function normaliseBaseUrl(value) {
  const raw = String(value || 'https://127.0.0.1:8089').replace(/\/+$/, '');
  if (raw.startsWith('ws://')) return raw.replace(/^ws:\/\//, 'http://').replace(/\/ari\/events.*$/, '').replace(/\/ari$/, '');
  if (raw.startsWith('wss://')) return raw.replace(/^wss:\/\//, 'https://').replace(/\/ari\/events.*$/, '').replace(/\/ari$/, '');
  return raw;
}

class AriClient {
  constructor(options = {}) {
    this.baseUrl = normaliseBaseUrl(options.baseUrl || process.env.ASTERISK_ARI_URL);
    this.username = options.username || process.env.ASTERISK_ARI_USERNAME || '';
    this.password = options.password || process.env.ASTERISK_ARI_PASSWORD || '';
    this.app = options.app || process.env.ASTERISK_ARI_APP || 'call-center';
    this.insecure = options.insecure === undefined
      ? envBoolean('ASTERISK_ARI_INSECURE', this.baseUrl.startsWith('https://127.0.0.1') || this.baseUrl.startsWith('https://localhost'))
      : options.insecure;
    this.wsUrlOverride = options.wsUrl || process.env.ASTERISK_ARI_WS_URL || '';
    this.reconnectBaseMs = Number(options.reconnectBaseMs || process.env.ASTERISK_ARI_RECONNECT_BASE_MS || 500);
    this.reconnectMaxMs = Number(options.reconnectMaxMs || process.env.ASTERISK_ARI_RECONNECT_MAX_MS || 30_000);
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.socket = null;
    this.reconnectTimer = null;
    this.attempt = 0;
    this.stopped = true;
    this.connected = false;
    this.lastConnectedAt = null;
    this.lastDisconnectedAt = null;
    this.lastError = null;
    this.http = axios.create({
      baseURL: this.baseUrl,
      auth: { username: this.username, password: this.password },
      timeout: Number(process.env.ASTERISK_ARI_HTTP_TIMEOUT_MS || 10_000),
      httpsAgent: this.insecure ? new https.Agent({ rejectUnauthorized: false }) : undefined,
      headers: { Accept: 'application/json' },
      // Callers interpret 404/409 explicitly.
      validateStatus: (status) => status >= 200 && status < 300,
    });
  }

  wsUrl() {
    if (this.wsUrlOverride) return this.wsUrlOverride;
    const wsBase = this.baseUrl.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    return `${wsBase}/ari/events`;
  }

  authHeader() {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
  }

  onEvent(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  onStatus(handler) {
    this.statusListeners.add(handler);
    return () => this.statusListeners.delete(handler);
  }

  publishStatus(extra = {}) {
    const status = { ...this.status(), ...extra };
    for (const listener of this.statusListeners) {
      try { listener(status); } catch { /* listeners must not break the socket */ }
    }
  }

  status() {
    return {
      configured: Boolean(this.baseUrl && this.username && this.password),
      connected: this.connected,
      app: this.app,
      baseUrl: this.baseUrl.replace(/\/\/[^/@]+@/, '//'),
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
      reconnectAttempt: this.attempt,
    };
  }

  start() {
    if (!this.stopped) return this.status();
    if (!this.username || !this.password) {
      this.lastError = 'ASTERISK_ARI_USERNAME and ASTERISK_ARI_PASSWORD are required';
      this.publishStatus();
      return this.status();
    }
    this.stopped = false;
    this.connect();
    return this.status();
  }

  connect() {
    if (this.stopped) return;
    const url = `${this.wsUrl()}?app=${encodeURIComponent(this.app)}&subscribeAll=true`;
    this.socket = new WebSocket(url, {
      headers: { Authorization: this.authHeader() },
      rejectUnauthorized: !this.insecure,
      handshakeTimeout: 10_000,
    });
    this.socket.on('open', () => {
      this.connected = true;
      this.attempt = 0;
      this.lastConnectedAt = new Date().toISOString();
      this.lastError = null;
      console.log(`[ARI] connected to ${this.baseUrl} for Stasis app "${this.app}"`);
      this.publishStatus();
    });
    this.socket.on('message', (data) => {
      let event;
      try { event = JSON.parse(String(data)); } catch { return; }
      for (const listener of this.listeners) {
        Promise.resolve()
          .then(() => listener(event))
          .catch((error) => console.error('[ARI] event handler failed:', error.message));
      }
    });
    this.socket.on('error', (error) => {
      this.lastError = error.message;
      this.publishStatus();
    });
    this.socket.on('close', (code, reason) => {
      const wasConnected = this.connected;
      this.connected = false;
      this.socket = null;
      if (wasConnected) this.lastDisconnectedAt = new Date().toISOString();
      if (this.stopped) return;
      this.lastError = `ARI websocket closed (${code}${reason?.length ? `: ${reason}` : ''})`;
      this.publishStatus();
      const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** this.attempt)) + Math.floor(Math.random() * 250);
      this.attempt += 1;
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
      this.reconnectTimer.unref?.();
    });
  }

  stop() {
    this.stopped = true;
    this.connected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      try { this.socket.close(1000, 'shutdown'); } catch { /* already closed */ }
      this.socket = null;
    }
    this.publishStatus();
  }

  async waitUntilConnected(timeoutMs = 10_000) {
    if (this.connected) return true;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        unsubscribe();
        resolve(false);
      }, Math.max(1, timeoutMs));
      const unsubscribe = this.onStatus((status) => {
        if (status.connected) {
          clearTimeout(timer);
          unsubscribe();
          resolve(true);
        }
      });
    });
  }

  async request(method, pathname, data) {
    const response = await this.http.request({
      method,
      url: pathname,
      data,
      headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    });
    return response.data;
  }
}

module.exports = { AriClient, normaliseBaseUrl };
