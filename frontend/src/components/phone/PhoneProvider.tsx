import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import type { AfricastalkingClient } from "africastalking-client";
import {
  cleanNumber,
  DTMF,
  formatNumber,
  isDialable,
  lookupName,
  normalizeDialNumber,
} from "@/lib/phone";
import { API_BASE_URL, apiGet, apiPost } from "@/lib/api";
import { SipAgent, type SipIdentity } from "@/lib/sipAgent";

export type PhoneStatus =
  "idle" | "dialing" | "ringing" | "incoming" | "connecting" | "connected" | "ended";
export type PhoneOutcome = "completed" | "missed" | "declined" | "cancelled" | "transferred";

export interface ActiveCall {
  id: string;
  number: string;
  name: string | null;
  direction: "inbound" | "outbound";
  status: PhoneStatus;
  startedAt: number | null;
  muted: boolean;
  held: boolean;
  recording: boolean;
  inboundSessionId?: string;
  businessName?: string;
}

export interface PhoneLogEntry {
  id: string;
  number: string;
  name: string | null;
  direction: "inbound" | "outbound";
  at: number;
  durationSec: number;
  outcome: PhoneOutcome;
}

interface PhoneApi {
  open: boolean;
  setOpen: (v: boolean) => void;
  call: ActiveCall | null;
  log: PhoneLogEntry[];
  elapsed: number;
  dial: (number: string, name?: string | null) => Promise<boolean>;
  answer: () => void;
  decline: () => void;
  hangup: () => void;
  toggle: (key: "muted" | "held" | "recording") => void;
  sendDigit: (d: string) => void;
  transfer: (to: string) => void;
  ringIn: (number: string, name?: string | null) => void;
  takeCall: (number: string, name?: string | null) => void;
}

const PhoneContext = createContext<PhoneApi | null>(null);

/** Simple Web Audio tone generator for browser-side DTMF, ringback and ringing. */
class ToneEngine {
  private ctx: AudioContext | null = null;
  private loop: number | null = null;

  private ensure() {
    if (typeof window === "undefined") return null;
    try {
      const AudioContextCtor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return null;
      if (!this.ctx) this.ctx = new AudioContextCtor();
      return this.ctx;
    } catch {
      return null;
    }
  }

  private async ready() {
    const ctx = this.ensure();
    if (ctx?.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        return null;
      }
    }
    return ctx;
  }

  beep(freqs: number[], ms: number, vol = 0.06, ctx = this.ensure()) {
    if (!ctx) return;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(vol, t);
    g.gain.setValueAtTime(vol, t + ms / 1000 - 0.02);
    g.gain.linearRampToValueAtTime(0, t + ms / 1000);
    g.connect(ctx.destination);
    for (const f of freqs) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + ms / 1000);
    }
  }

  pattern(freqs: number[], onMs: number, periodMs: number, vol = 0.04) {
    this.stop();
    const play = () => {
      void this.ready().then((ctx) => this.beep(freqs, onMs, vol, ctx ?? undefined));
    };
    play();
    this.loop = window.setInterval(play, periodMs);
  }

  stop() {
    if (this.loop !== null) window.clearInterval(this.loop);
    this.loop = null;
  }
}

const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : String(Date.now());

export function PhoneProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [log, setLog] = useState<PhoneLogEntry[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const timers = useRef<number[]>([]);
  const tonesRef = useRef<ToneEngine | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderCallIdRef = useRef<string | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const recorderStartedAtRef = useRef(0);
  const voiceClientRef = useRef<AfricastalkingClient | null>(null);
  const voiceClientReadyRef = useRef<Promise<AfricastalkingClient> | null>(null);
  const sipAgentRef = useRef<SipAgent | null>(null);
  /** Inbound session the backend has authorized this browser to answer. */
  const sipAuthorizedCallRef = useRef<string | null>(null);
  const sipMediaConfirmingRef = useRef<Set<string>>(new Set());
  const incomingCallHandlerRef = useRef<(payload?: unknown) => void>(() => undefined);
  const manualHangupRef = useRef<string | null>(null);
  const finishRef = useRef<(outcome: PhoneOutcome) => void>(() => undefined);
  const pendingInboundRef = useRef<
    Array<{ callId: string; callerNumber: string; businessName: string }>
  >([]);
  callRef.current = call;

  const tones = () => (tonesRef.current ??= new ToneEngine());
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  useEffect(() => {
    if (call?.status !== "connected" || !call.startedAt) return;
    const i = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(i);
  }, [call?.startedAt, call?.status]);

  useEffect(
    () => () => {
      clearTimers();
      tonesRef.current?.stop();
      recorderRef.current?.stop();
      recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceClientRef.current?.destroy();
      voiceClientRef.current = null;
      void sipAgentRef.current?.destroy();
      sipAgentRef.current = null;
    },
    [],
  );

  const elapsed =
    call?.status === "connected" && call.startedAt
      ? Math.max(0, Math.floor((now - call.startedAt) / 1000))
      : 0;
  const busy = () => !!callRef.current && callRef.current.status !== "ended";

  const stopBrowserRecording = useCallback((callId: string) => {
    if (recorderCallIdRef.current !== callId) return;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
    recorderStreamRef.current = null;
    recorderCallIdRef.current = null;
    recorderChunksRef.current = [];
    recorderStartedAtRef.current = 0;
  }, []);

  const startBrowserRecording = useCallback(async (callId: string) => {
    void callId;
    toast.info("Call recording is unavailable until provider storage is configured");
  }, []);

  const ensureVoiceClient = useCallback(async () => {
    if (voiceClientRef.current) return voiceClientRef.current;
    if (voiceClientReadyRef.current) return voiceClientReadyRef.current;

    const ready = (async () => {
      const { default: Africastalking } = await import("africastalking-client");
      const response = await apiPost<{ token?: string }>("voice/capability-token", {});
      if (!response.token)
        throw new Error("Africa's Talking did not return a WebRTC capability token");
      const client = new Africastalking.Client(response.token);
      voiceClientRef.current = client;
      const readyPromise = new Promise<AfricastalkingClient>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Browser voice connection timed out")),
          15_000,
        );
        client.on(
          "ready",
          () => {
            window.clearTimeout(timeout);
            resolve(client);
          },
          false,
        );
        client.on(
          "notready",
          () => {
            window.clearTimeout(timeout);
            reject(new Error("Browser voice is not ready"));
          },
          false,
        );
      });
      client.on(
        "calling",
        () => setCall((current) => (current ? { ...current, status: "dialing" } : current)),
        false,
      );
      client.on("incomingcall", (payload) => incomingCallHandlerRef.current(payload), false);
      client.on(
        "callaccepted",
        () => {
          const current = callRef.current;
          if (!current) return;
          setNow(Date.now());
          setCall((active) =>
            active
              ? { ...active, status: "connected", startedAt: active.startedAt ?? Date.now() }
              : active,
          );
        },
        false,
      );
      client.on(
        "hangup",
        (payload) => {
          const current = callRef.current;
          if (!current || manualHangupRef.current === current.id) return;
          const cause =
            typeof payload === "string"
              ? { reason: payload, code: "" }
              : payload && typeof payload === "object"
                ? {
                    reason: String((payload as { reason?: unknown }).reason || ""),
                    code: String((payload as { code?: unknown }).code || ""),
                  }
                : { reason: "", code: "" };
          const providerCause = [
            cause.reason,
            cause.code && cause.code !== cause.reason ? `code ${cause.code}` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          const connected = current.status === "connected";
          if (providerCause) {
            toast[connected ? "info" : "error"](
              connected
                ? `Call ended: ${providerCause}`
                : `Call could not connect: ${providerCause}`,
            );
          }
          finishRef.current(connected ? "completed" : "missed");
        },
        false,
      );
      await readyPromise;
      return client;
    })();
    voiceClientReadyRef.current = ready;
    try {
      return await ready;
    } catch (error) {
      voiceClientReadyRef.current = null;
      (voiceClientRef.current as unknown as { destroy?: () => void } | null)?.destroy?.();
      voiceClientRef.current = null;
      throw error;
    }
  }, []);

  const finish = useCallback(
    (outcome: PhoneOutcome) => {
      const c = callRef.current;
      if (!c || c.status === "ended") return;
      let currentUser: { name?: string } = {};
      try {
        currentUser = JSON.parse(window.localStorage.getItem("mpange.auth.user") ?? "{}");
      } catch {
        currentUser = {};
      }
      clearTimers();
      tones().stop();
      tones().beep([480, 620], 250);
      if (c.inboundSessionId) {
        sipAuthorizedCallRef.current = null;
        sipMediaConfirmingRef.current.delete(c.inboundSessionId);
        void sipAgentRef.current?.hangup();
      }
      const durationSec = c.startedAt ? Math.floor((Date.now() - c.startedAt) / 1000) : 0;
      stopBrowserRecording(c.id);
      if (!c.inboundSessionId)
        void apiPost("calls", {
          id: c.id,
          phone: c.number,
          caller: c.name || "Customer",
          agent: currentUser.name || undefined,
          queue: "General",
          direction: c.direction,
          at: new Date().toISOString(),
          durationSec,
          outcome:
            outcome === "completed" || outcome === "transferred"
              ? "resolved"
              : outcome === "declined" || outcome === "cancelled"
                ? "missed"
                : outcome,
        }).catch((error) =>
          toast.error(error instanceof Error ? error.message : "Call record was not saved"),
        );
      setLog((l) =>
        [
          {
            id: c.id,
            number: c.number,
            name: c.name,
            direction: c.direction,
            at: Date.now(),
            durationSec,
            outcome,
          },
          ...l,
        ].slice(0, 50),
      );
      // Clear the active call immediately. The call record is saved in the
      // background, but the browser control should not remain in an ended state.
      setCall(null);
      callRef.current = null;
    },
    [stopBrowserRecording],
  );

  const connect = useCallback((id: string) => {
    tones().stop();
    const t = Date.now();
    setNow(t);
    setCall((cur) =>
      cur?.id === id ? { ...cur, status: "connected", startedAt: cur.startedAt ?? t } : cur,
    );
  }, []);

  /**
   * The backend marks an accepted inbound call `connecting` once Asterisk has
   * answered the browser SIP leg. It only becomes `connected` after this
   * browser proves that RTP packets are flowing in both directions. Never
   * report audio before that evidence exists.
   */
  const confirmSipMedia = useCallback(
    async (inboundSessionId: string) => {
      const agent = sipAgentRef.current;
      if (!agent || sipMediaConfirmingRef.current.has(inboundSessionId)) return;
      sipMediaConfirmingRef.current.add(inboundSessionId);
      let reported = false;
      try {
        for (let attempt = 0; attempt < 3 && !reported; attempt += 1) {
          const evidence = await agent.waitForBidirectionalMedia(attempt === 0 ? 12_000 : 5_000);
          if (!evidence) {
            if (attempt === 0)
              toast.error("Browser audio did not establish in both directions", {
                description: "The call will end instead of showing a false connection.",
              });
            break;
          }
          try {
            const result = await apiPost<{ verified?: boolean }>(
              `voice/inbound-calls/${encodeURIComponent(inboundSessionId)}/media-ready`,
              { stats: evidence },
            );
            if (result.verified) {
              reported = true;
              const active = callRef.current;
              if (active?.inboundSessionId === inboundSessionId) connect(active.id);
            }
          } catch (error) {
            if (attempt === 2) {
              toast.error(
                error instanceof Error ? error.message : "Could not confirm browser call media",
              );
            } else {
              await new Promise((resolve) => window.setTimeout(resolve, 750));
            }
          }
        }
      } finally {
        sipMediaConfirmingRef.current.delete(inboundSessionId);
      }
    },
    [connect],
  );

  /**
   * Register this browser as its own per-agent Asterisk WebRTC endpoint. No
   * ARI, trunk or other agent's credentials are ever sent to the browser.
   */
  useEffect(() => {
    let stopped = false;
    let retryTimer: number | null = null;

    const clearRetry = () => {
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      retryTimer = null;
    };

    const setup = async () => {
      if (stopped) return;
      const authToken = window.localStorage.getItem("mpange.auth.token");
      if (!authToken) return;
      try {
        const response = await apiGet<{ identity?: SipIdentity }>("voice/sip-credentials");
        if (stopped || !response.identity) return;
        const agent = new SipAgent();
        sipAgentRef.current = agent;
        await agent.connect(response.identity, {
          onRegistered: () => undefined,
          onRegistrationFailed: (reason) => {
            console.warn("[SIP] browser media registration failed:", reason);
          },
          shouldAnswerIncomingCall: () =>
            Boolean(sipAuthorizedCallRef.current) &&
            callRef.current?.inboundSessionId === sipAuthorizedCallRef.current,
          onIncomingCall: () => {
            const active = callRef.current;
            if (active?.inboundSessionId)
              setCall((current) =>
                current?.id === active.id ? { ...current, status: "connecting" } : current,
              );
          },
          onCallAnswered: () => {
            const active = callRef.current;
            if (active?.inboundSessionId) void confirmSipMedia(active.inboundSessionId);
          },
          onCallHangup: () => {
            // The backend owns the authoritative hangup. Its call_ended event
            // clears the UI; do not invent an outcome from the SIP leg alone.
          },
          onDisconnected: (reason) => {
            console.warn("[SIP] browser media transport disconnected:", reason);
          },
          onReconnecting: (attempt) => {
            console.warn(`[SIP] reconnecting browser media transport (attempt ${attempt})`);
          },
        });
      } catch (error) {
        if (stopped) return;
        console.warn(
          "[SIP] browser media identity unavailable:",
          error instanceof Error ? error.message : error,
        );
        sipAgentRef.current = null;
        // Registration failures are recoverable (for example while the local
        // Asterisk container restarts). Retry without blocking outbound calls.
        retryTimer = window.setTimeout(() => void setup(), 10_000);
      }
    };

    const onAuthReady = () => {
      clearRetry();
      void setup();
    };
    const onAuthLogout = () => {
      clearRetry();
      sipAuthorizedCallRef.current = null;
      const agent = sipAgentRef.current;
      sipAgentRef.current = null;
      void agent?.destroy();
    };

    void setup();
    window.addEventListener("mpange:auth-ready", onAuthReady);
    window.addEventListener("mpange:auth-logout", onAuthLogout);
    return () => {
      stopped = true;
      clearRetry();
      window.removeEventListener("mpange:auth-ready", onAuthReady);
      window.removeEventListener("mpange:auth-logout", onAuthLogout);
    };
  }, [confirmSipMedia]);

  finishRef.current = finish;

  const dial = useCallback(
    async (raw: string, name?: string | null) => {
      if (busy()) {
        toast.error("Finish the current call first");
        setOpen(true);
        return false;
      }
      const number = normalizeDialNumber(raw);
      if (!isDialable(number)) {
        toast.error("Enter a valid phone number", {
          description: "Use 3–15 digits, e.g. +255 712 345 678 or extension 101.",
        });
        return false;
      }
      clearTimers();
      const c: ActiveCall = {
        id: newId(),
        number,
        name: name ?? lookupName(number),
        direction: "outbound",
        status: "dialing",
        startedAt: null,
        muted: false,
        held: false,
        recording: false,
      };
      tones().pattern([440, 480], 1000, 3000, 0.05);
      setCall(c);
      setOpen(true);
      try {
        const client = await ensureVoiceClient();
        if (callRef.current?.id !== c.id) return false;
        client.call(number);
      } catch (error) {
        tones().stop();
        setCall((current) => (current?.id === c.id ? null : current));
        toast.error(error instanceof Error ? error.message : "Browser voice call was not started");
        return false;
      }
      setCall((current) => (current?.id === c.id ? { ...current, status: "ringing" } : current));
      return true;
    },
    [ensureVoiceClient],
  );

  const ringIn = useCallback(
    (raw: string, name?: string | null, inboundSessionId?: string, businessName?: string) => {
      if (busy()) {
        toast.error("Finish the current call first");
        return;
      }
      clearTimers();
      const number = cleanNumber(raw);
      const c: ActiveCall = {
        id: newId(),
        number,
        name: name ?? lookupName(number),
        direction: "inbound",
        status: "incoming",
        startedAt: null,
        muted: false,
        held: false,
        recording: false,
        ...(inboundSessionId ? { inboundSessionId } : {}),
        ...(businessName ? { businessName } : {}),
      };
      setCall(c);
      callRef.current = c;
      tones().pattern([440, 480], 1000, 3000, 0.05);
      later(() => {
        if (callRef.current?.id === c.id && callRef.current.status === "incoming") {
          finish("missed");
          toast.warning(`Missed call from ${c.name ?? formatNumber(number)}`);
        }
      }, 25_000);
    },
    [finish],
  );

  incomingCallHandlerRef.current = (payload) => {
    const data = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const number = String(data["from"] || data["phoneNumber"] || data["number"] || "").trim();
    const name = String(data["name"] || data["caller"] || "").trim() || null;
    if (!number) {
      toast.error("Incoming call received without a caller number");
      return;
    }
    ringIn(number, name);
  };

  const offerInbound = useCallback(
    (offer: { callId?: unknown; callerNumber?: unknown; businessName?: unknown }) => {
      const callId = String(offer.callId || "");
      const callerNumber = String(offer.callerNumber || "");
      const businessName = String(offer.businessName || "Business");
      if (!callId || !callerNumber || callRef.current?.inboundSessionId === callId) return;
      if (busy() || pendingInboundRef.current.length > 0) {
        if (!pendingInboundRef.current.some((pending) => pending.callId === callId)) {
          pendingInboundRef.current.push({ callId, callerNumber, businessName });
        }
        return;
      }
      ringIn(callerNumber, null, callId, businessName);
      setOpen(true);
    },
    [ringIn],
  );

  useEffect(() => {
    if (call || !pendingInboundRef.current.length) return;
    const next = pendingInboundRef.current.shift();
    if (next) {
      ringIn(next.callerNumber, null, next.callId, next.businessName);
      setOpen(true);
    }
  }, [call, ringIn]);

  useEffect(() => {
    let stopped = false;
    let controller: AbortController | null = null;
    let heartbeat: number | null = null;
    const handleEvent = (type: string, data: Record<string, unknown>) => {
      const callId = String(data["callId"] || data["sessionId"] || "");
      if (type === "incoming_call") {
        offerInbound({ callId, callerNumber: data["callerNumber"], businessName: data["businessName"] });
      } else if (type === "call_answered_elsewhere") {
        pendingInboundRef.current = pendingInboundRef.current.filter(
          (pending) => pending.callId !== callId,
        );
        if (callRef.current?.inboundSessionId === callId) {
          finishRef.current("missed");
          toast.info("Another agent answered this call");
        }
      } else if (type === "call_accepted" && callRef.current?.inboundSessionId === callId) {
        setCall((current) =>
          current?.inboundSessionId === callId ? { ...current, status: "connecting" } : current,
        );
      } else if (type === "call_connecting" && callRef.current?.inboundSessionId === callId) {
        setCall((current) =>
          current?.inboundSessionId === callId ? { ...current, status: "connecting" } : current,
        );
      } else if (type === "call_connected" && callRef.current?.inboundSessionId === callId) {
        connect(callRef.current.id);
      } else if (type === "call_ended") {
        pendingInboundRef.current = pendingInboundRef.current.filter(
          (pending) => pending.callId !== callId,
        );
        if (callRef.current?.inboundSessionId === callId) {
          finishRef.current(callRef.current.status === "connected" ? "completed" : "missed");
        }
      }
    };
    const connectStream = async () => {
      const authToken = window.localStorage.getItem("mpange.auth.token");
      if (!authToken || stopped) return;
      controller = new AbortController();
      try {
        const response = await fetch(`${API_BASE_URL}/voice/stream`, {
          headers: { Authorization: `Bearer ${authToken}`, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;
        heartbeat = window.setInterval(() => {
          void apiPost("voice/presence", {}).catch(() => undefined);
        }, 15_000);
        void apiGet<{
          calls?: Array<{ callId: string; callerNumber: string; businessName: string }>;
        }>("voice/inbound-calls")
          .then((snapshot) => (snapshot.calls || []).forEach((offer) => offerInbound(offer)))
          .catch(() => undefined);
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const packets = buffer.split("\n\n");
          buffer = packets.pop() || "";
          for (const packet of packets) {
            const type = packet.match(/^event:\s*(.+)$/m)?.[1]?.trim();
            const data = packet.match(/^data:\s*(.+)$/m)?.[1];
            if (!type || !data) continue;
            try {
              handleEvent(type, JSON.parse(data) as Record<string, unknown>);
            } catch {
              /* Ignore malformed event frames. */
            }
          }
        }
      } catch {
        /* Retry on transient disconnect; outbound calling remains usable. */
      }
      if (heartbeat !== null) window.clearInterval(heartbeat);
      if (!stopped && window.localStorage.getItem("mpange.auth.token"))
        window.setTimeout(() => void connectStream(), 1500);
    };
    const onAuthReady = () => void connectStream();
    const onAuthLogout = () => {
      controller?.abort();
      if (heartbeat !== null) window.clearInterval(heartbeat);
    };
    void connectStream();
    window.addEventListener("mpange:auth-ready", onAuthReady);
    window.addEventListener("mpange:auth-logout", onAuthLogout);
    return () => {
      stopped = true;
      controller?.abort();
      if (heartbeat !== null) window.clearInterval(heartbeat);
      window.removeEventListener("mpange:auth-ready", onAuthReady);
      window.removeEventListener("mpange:auth-logout", onAuthLogout);
    };
  }, [connect, offerInbound]);

  const takeCall = useCallback(
    (raw: string, name?: string | null) => {
      if (busy()) {
        toast.error("Finish the current call first");
        setOpen(true);
        return;
      }
      clearTimers();
      const number = cleanNumber(raw);
      const c: ActiveCall = {
        id: newId(),
        number,
        name: name ?? lookupName(number),
        direction: "inbound",
        status: "connected",
        startedAt: Date.now(),
        muted: false,
        held: false,
        recording: false,
      };
      setNow(Date.now());
      setCall(c);
      setOpen(true);
      void startBrowserRecording(c.id);
    },
    [startBrowserRecording],
  );

  const answer = useCallback(() => {
    const c = callRef.current;
    if (c?.status !== "incoming") return;
    clearTimers();
    if (c.inboundSessionId) {
      const inboundSessionId = c.inboundSessionId;
      // Authorize exactly one backend-approved inbound call to be answered by
      // the browser SIP endpoint. The SIP INVITE arrives only after the
      // backend claims this call and originates the agent leg.
      sipAuthorizedCallRef.current = inboundSessionId;
      setCall((current) =>
        current?.id === c.id ? { ...current, status: "connecting" } : current,
      );
      void (async () => {
        try {
          if (navigator.mediaDevices?.getUserMedia) {
            const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            permissionStream.getTracks().forEach((track) => track.stop());
          }
          const result = await apiPost<{
            mediaConnected?: boolean;
            transportConnected?: boolean;
            awaitingMediaEvidence?: boolean;
            bridge?: { reason?: string };
          }>(`voice/inbound-calls/${encodeURIComponent(inboundSessionId)}/accept`, {});
          if (result.mediaConnected) {
            connect(c.id);
            return;
          }
          if (result.awaitingMediaEvidence || result.transportConnected) {
            // Asterisk has bridged the caller and browser SIP leg. Stay in
            // "connecting" until this browser reports bidirectional RTP and
            // the backend publishes call_connected.
            return;
          }
          sipAuthorizedCallRef.current = null;
          toast.error("Call could not connect to browser audio", {
            description: result.bridge?.reason || "Media bridge is not configured",
          });
          finishRef.current("missed");
        } catch (error) {
          sipAuthorizedCallRef.current = null;
          toast.error(error instanceof Error ? error.message : "Could not accept this call");
          finishRef.current("declined");
        }
      })();
      setOpen(true);
      return;
    }
    try {
      voiceClientRef.current?.answer();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "The incoming call could not be answered",
      );
      finish("declined");
      return;
    }
    connect(c.id);
    setOpen(true);
  }, [connect, finish]);

  const decline = useCallback(() => {
    const current = callRef.current;
    sipAuthorizedCallRef.current = null;
    if (current?.inboundSessionId)
      void apiPost(
        `voice/inbound-calls/${encodeURIComponent(current.inboundSessionId)}/reject`,
        {},
      ).catch(() => undefined);
    if (callRef.current?.status === "incoming") {
      try {
        voiceClientRef.current?.hangup();
      } catch {
        /* local cleanup still completes */
      }
    }
    finish("declined");
  }, [finish]);

  const hangup = useCallback(() => {
    const current = callRef.current;
    const s = current?.status;
    if (!s || s === "ended") return;
    sipAuthorizedCallRef.current = null;
    if (current.inboundSessionId) {
      // Reject while still ringing; only an assigned winner may end a call
      // that the backend already claimed.
      const path = s === "incoming" || s === "ringing" ? "reject" : "end";
      void apiPost(
        `voice/inbound-calls/${encodeURIComponent(current.inboundSessionId)}/${path}`,
        {},
      ).catch((error) =>
        toast.error(error instanceof Error ? error.message : "Could not end call"),
      );
    }
    manualHangupRef.current = current.id;
    try {
      voiceClientRef.current?.hangup();
    } catch {
      /* local cleanup still completes */
    }
    finish(s === "connected" ? "completed" : s === "incoming" ? "declined" : "cancelled");
  }, [finish]);

  const toggle = useCallback(
    (key: "muted" | "held" | "recording") => {
      const current = callRef.current;
      if (!current || current.status !== "connected") return;
      if (key === "recording") {
        if (current.recording) {
          stopBrowserRecording(current.id);
          setCall((cur) => (cur?.id === current.id ? { ...cur, recording: false } : cur));
        } else {
          void startBrowserRecording(current.id);
        }
        return;
      }
      const client = voiceClientRef.current;
      const agent = current.inboundSessionId ? sipAgentRef.current : null;
      if (key === "muted") {
        try {
          if (agent) {
            if (current.muted) agent.unmute();
            else agent.mute();
          } else if (current.muted) client?.unmute();
          else client?.mute();
        } catch {
          /* UI state still updates */
        }
      }
      if (key === "held") {
        try {
          if (agent) {
            if (current.held) void agent.unhold();
            else void agent.hold();
          } else if (current.held) client?.unhold();
          else client?.hold();
        } catch {
          /* UI state still updates */
        }
      }
      setCall((cur) => (cur && cur.status === "connected" ? { ...cur, [key]: !cur[key] } : cur));
    },
    [startBrowserRecording, stopBrowserRecording],
  );

  const sendDigit = useCallback((d: string) => {
    const f = DTMF[d];
    if (f) tones().beep(f, 140);
    const current = callRef.current;
    const agent = current?.inboundSessionId ? sipAgentRef.current : null;
    try {
      if (agent) void agent.sendDTMF(d).catch(() => undefined);
      else voiceClientRef.current?.dtmf(d);
    } catch {
      /* keypad feedback still plays locally */
    }
  }, []);

  const transfer = useCallback((to: string) => {
    if (callRef.current?.status !== "connected") return;
    toast.info(
      `Transfer to ${to} is unavailable until the telephony transfer endpoint is configured`,
    );
  }, []);

  return (
    <PhoneContext.Provider
      value={{
        open,
        setOpen,
        call,
        log,
        elapsed,
        dial,
        answer,
        decline,
        hangup,
        toggle,
        sendDigit,
        transfer,
        ringIn,
        takeCall,
      }}
    >
      {children}
    </PhoneContext.Provider>
  );
}

export function usePhone() {
  const ctx = useContext(PhoneContext);
  if (!ctx) throw new Error("usePhone must be used inside <PhoneProvider>");
  return ctx;
}
