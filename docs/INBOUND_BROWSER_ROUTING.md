# Inbound browser-agent routing

## What is implemented

The Africa's Talking voice callback resolves the called DID to one tenant-scoped business. When configured web agents are authenticated, connected to the dashboard event stream, active, and not busy, the server creates one idempotent inbound session and fans `incoming_call` to every eligible agent over authenticated server-sent events. Once a real media bridge adapter is configured, the callback uses a supported `Say` + `Enqueue` response so the caller can wait. Until then, it plays a clear unavailable message instead of leaving the caller parked in a queue that cannot be connected.

The first accept is claimed with a conditional SQLite `UPDATE`; only an agent listed in that session's eligible-agent snapshot can claim. Other connected agents receive `call_answered_elsewhere`. Rejecting removes that agent from the ringing set. Provider terminal events end the session and restore agent availability. Browser agents are matched to business membership by configured `userId`, `email`, or their stable Africa's Talking WebRTC `clientName`.

## Browser/API flow

- `GET /api/voice/stream` — authenticated SSE stream; the tenant and business memberships come from the signed-in server-side identity.
- `POST /api/voice/presence` — authenticated presence heartbeat.
- `POST /api/voice/inbound-calls/:callId/accept` — atomic first-answer-wins claim.
- `POST /api/voice/inbound-calls/:callId/reject` — decline this agent's offer.
- `POST /api/voice/inbound-calls/:callId/end` — end an accepted session.

The existing softphone displays inbound caller/business information and answer/reject controls. The browser requests microphone permission on answer. A notification, claim, or queued caller is not marked as connected audio.

## Persistence and concurrency

The existing SQLite store creates `inbound_voice_sessions` automatically (no separate migration command). It stores tenant/business/provider IDs, DID/caller, eligible agents, winner, status, ring/answer/connect/end times, and failure details. Provider session uniqueness makes webhook retries idempotent. SQLite conditional updates make claims atomic and prevent one agent winning multiple active calls.

The realtime transport and current presence map are process-local. For a multi-instance deployment, replace the in-memory event/presence transport with a shared Redis/pub-sub adapter; the persistence and atomic claim remain database-backed.

## Media bridge status

`src/services/mediaBridge.js` defines `createSession`, `connectAgent`, `disconnectAgent`, `terminateSession`, and `getSessionStatus`. The default adapter is fail-closed and never reports a connected call. A real adapter must bridge the queued Africa's Talking caller leg to the browser WebRTC media leg, and only its positive confirmation can set `connected`.

Live browser audio still requires a provider-supported SIP/WebRTC gateway and the corresponding Africa's Talking SIP trunk provisioning/IP whitelist. Do not configure the DID as `trunk:` until the gateway is deployed and reachable. The provider documents SIP-trunk callback routing separately from VoiceXML callbacks; the current app retains the VoiceXML callback and uses the documented `Enqueue` action to keep callers waiting while browser signaling runs.

The currently available Africa's Talking callback flow does not provide a verified signed-webhook header in this project. Before public production exposure, configure an application-level callback secret or provider-supported source validation without guessing provider signatures.

## Verification

`npm test` covers fan-out to 1/3/10 agents, tenant isolation, presence eligibility, duplicate callbacks, one-winner claims, one active call per agent, and configured/unconfigured bridge behavior. These are signaling/database tests—not a live telephony or live audio bridge test.
