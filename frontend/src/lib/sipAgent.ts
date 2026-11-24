import { Web } from "sip.js";

export interface SipIdentity {
  username: string;
  password: string;
  aor: string;
  wsUrl: string;
  sipDomain: string;
  expiresAt?: string | null;
  businessIds?: string[];
}

export interface SipMediaEvidence {
  inboundBytes: number;
  outboundBytes: number;
  inboundPackets: number;
  outboundPackets: number;
  connectionState: string | null;
  audioLevel: number | null;
  capturedAt: string;
}

export interface SipAgentHandlers {
  onRegistered?: () => void;
  onRegistrationFailed?: (reason: string) => void;
  /** Return true only when the backend has already authorized this call. */
  shouldAnswerIncomingCall?: () => boolean;
  onIncomingCall?: () => void;
  onCallAnswered?: () => void;
  onCallHangup?: () => void;
  onDisconnected?: (reason: string) => void;
  onReconnecting?: (attempt: number) => void;
}

type SessionAccess = {
  session?: {
    sessionDescriptionHandler?: { peerConnection?: RTCPeerConnection };
  };
};

const RETRY_DELAYS = [1_000, 2_000, 4_000, 8_000, 15_000];

export class SipAgent {
  private user: Web.SimpleUser | null = null;
  private identity: SipIdentity | null = null;
  private handlers: SipAgentHandlers = {};
  private remoteAudio: HTMLAudioElement | null = null;
  private registered = false;
  private destroyed = false;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private connectGeneration = 0;

  isRegistered() {
    return this.registered && Boolean(this.user?.isConnected());
  }

  getIdentity() {
    return this.identity;
  }

  private createAudioElement() {
    if (typeof document === "undefined") return null;
    const audio = document.createElement("audio");
    audio.autoplay = true;
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("data-mpange-sip-audio", "true");
    audio.style.display = "none";
    document.body.appendChild(audio);
    this.remoteAudio = audio;
    return audio;
  }

  async connect(identity: SipIdentity, handlers: SipAgentHandlers = {}) {
    if (!identity?.wsUrl?.startsWith("wss://")) {
      throw new Error("Asterisk browser SIP requires a secure wss:// URL");
    }
    if (!identity.aor?.startsWith("sip:") || !identity.username || !identity.password) {
      throw new Error("The browser SIP identity is incomplete");
    }
    this.destroyed = false;
    this.identity = identity;
    this.handlers = handlers;
    this.clearReconnect();
    return this.connectOnce(identity);
  }

  private async connectOnce(identity: SipIdentity) {
    const generation = ++this.connectGeneration;
    if (this.user) {
      try { await this.user.disconnect(); } catch { /* replace stale user */ }
      this.user = null;
    }
    const audio = this.remoteAudio || this.createAudioElement();
    let resolveRegistered: (() => void) | null = null;
    let rejectRegistered: ((error: Error) => void) | null = null;
    const user = new Web.SimpleUser(identity.wsUrl, {
      aor: identity.aor,
      media: {
        constraints: { audio: true, video: false },
        ...(audio ? { remote: { audio } } : {}),
      },
      userAgentOptions: {
        authorizationUsername: identity.username,
        authorizationPassword: identity.password,
        displayName: "MPANGE Agent",
        logLevel: "warn",
      },
      delegate: {
        onRegistered: () => {
          if (generation !== this.connectGeneration || this.destroyed) return;
          this.registered = true;
          this.reconnectAttempt = 0;
          resolveRegistered?.();
          resolveRegistered = null;
          rejectRegistered = null;
          this.handlers.onRegistered?.();
        },
        onUnregistered: () => {
          if (generation !== this.connectGeneration) return;
          this.registered = false;
        },
        onServerDisconnect: (error?: Error) => {
          if (generation !== this.connectGeneration || this.destroyed) return;
          this.registered = false;
          const reason = error?.message || "SIP WSS connection closed";
          rejectRegistered?.(new Error(reason));
          rejectRegistered = null;
          resolveRegistered = null;
          this.handlers.onDisconnected?.(reason);
          this.scheduleReconnect();
        },
        onCallReceived: () => {
          if (generation !== this.connectGeneration || this.destroyed) return;
          this.handlers.onIncomingCall?.();
          const authorized = this.handlers.shouldAnswerIncomingCall?.() === true;
          if (!authorized) {
            // A SIP INVITE that was not authorized by the backend must not be
            // answered. This blocks direct/unauthorized calls to the endpoint.
            void this.user?.hangup().catch(() => undefined);
            return;
          }
          void this.user?.answer()
            .then(() => {
              void this.remoteAudio?.play().catch(() => undefined);
            })
            .catch((error: unknown) => {
              this.handlers.onRegistrationFailed?.(
                error instanceof Error ? error.message : "Could not answer the SIP media call",
              );
            });
        },
        onCallAnswered: () => {
          if (generation !== this.connectGeneration || this.destroyed) return;
          void this.remoteAudio?.play().catch(() => undefined);
          this.handlers.onCallAnswered?.();
        },
        onCallHangup: () => {
          if (generation !== this.connectGeneration || this.destroyed) return;
          this.handlers.onCallHangup?.();
        },
      },
    });
    this.user = user;
    const registered = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error("SIP registration timed out over WSS")),
        15_000,
      );
      resolveRegistered = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      rejectRegistered = (error) => {
        window.clearTimeout(timeout);
        reject(error);
      };
    });
    await user.connect();
    await user.register();
    await registered;
    return this;
  }

  private scheduleReconnect() {
    if (this.destroyed || !this.identity || this.reconnectTimer !== null) return;
    const delay = RETRY_DELAYS[Math.min(this.reconnectAttempt, RETRY_DELAYS.length - 1)];
    this.reconnectAttempt += 1;
    this.handlers.onReconnecting?.(this.reconnectAttempt);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed || !this.identity) return;
      void this.connectOnce(this.identity).catch((error: unknown) => {
        this.handlers.onRegistrationFailed?.(
          error instanceof Error ? error.message : "SIP reconnection failed",
        );
        this.scheduleReconnect();
      });
    }, delay);
  }

  private clearReconnect() {
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async answer() {
    if (!this.user) throw new Error("The SIP agent is not registered");
    await this.user.answer();
    void this.remoteAudio?.play().catch(() => undefined);
  }

  async hangup() {
    try { await this.user?.hangup(); } catch { /* already ended */ }
    this.registered = Boolean(this.user?.isConnected());
  }

  mute() { this.user?.mute(); }
  unmute() { this.user?.unmute(); }
  async hold() { await this.user?.hold(); }
  async unhold() { await this.user?.unhold(); }
  async sendDTMF(tone: string) { await this.user?.sendDTMF(tone); }

  peerConnection(): RTCPeerConnection | null {
    const user = this.user as unknown as SessionAccess | null;
    return user?.session?.sessionDescriptionHandler?.peerConnection || null;
  }

  async collectMediaEvidence(): Promise<SipMediaEvidence> {
    const peer = this.peerConnection();
    if (!peer) {
      return {
        inboundBytes: 0, outboundBytes: 0, inboundPackets: 0, outboundPackets: 0,
        connectionState: null, audioLevel: null, capturedAt: new Date().toISOString(),
      };
    }
    const report = await peer.getStats();
    let inboundBytes = 0;
    let outboundBytes = 0;
    let inboundPackets = 0;
    let outboundPackets = 0;
    let audioLevel: number | null = null;
    report.forEach((stat) => {
      const value = stat as unknown as {
        type: string; kind?: string; mediaType?: string;
        bytesReceived?: number; bytesSent?: number;
        packetsReceived?: number; packetsSent?: number;
        audioLevel?: number;
      };
      if (value.type === "inbound-rtp" && (value.kind === "audio" || value.mediaType === "audio")) {
        inboundBytes += Number(value.bytesReceived || 0);
        inboundPackets += Number(value.packetsReceived || 0);
        if (typeof value.audioLevel === "number") audioLevel = value.audioLevel;
      }
      if (value.type === "outbound-rtp" && (value.kind === "audio" || value.mediaType === "audio")) {
        outboundBytes += Number(value.bytesSent || 0);
        outboundPackets += Number(value.packetsSent || 0);
      }
    });
    return {
      inboundBytes,
      outboundBytes,
      inboundPackets,
      outboundPackets,
      connectionState: peer.connectionState,
      audioLevel,
      capturedAt: new Date().toISOString(),
    };
  }

  async waitForBidirectionalMedia(timeoutMs = 12_000): Promise<SipMediaEvidence | null> {
    const deadline = Date.now() + Math.max(1, timeoutMs);
    let latest: SipMediaEvidence | null = null;
    while (Date.now() <= deadline) {
      latest = await this.collectMediaEvidence();
      if (latest.inboundBytes > 0 && latest.outboundBytes > 0) return latest;
      await new Promise((resolve) => window.setTimeout(resolve, 400));
    }
    return latest && latest.inboundBytes > 0 && latest.outboundBytes > 0 ? latest : null;
  }

  async destroy() {
    this.destroyed = true;
    this.clearReconnect();
    this.connectGeneration += 1;
    this.registered = false;
    try { await this.user?.hangup(); } catch { /* no active call */ }
    try { await this.user?.unregister(); } catch { /* socket may be gone */ }
    try { await this.user?.disconnect(); } catch { /* socket may be gone */ }
    this.user = null;
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio.remove();
      this.remoteAudio = null;
    }
  }
}
