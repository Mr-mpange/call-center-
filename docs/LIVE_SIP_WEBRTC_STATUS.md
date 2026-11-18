# Live Africa's Talking to browser audio: status and activation

## Verified provider and gateway facts

Africa's Talking documents inbound SIP trunking to a customer PBX. Its setup
requires a voice number, KYC/payment, and sharing the PBX's public IP for
allowlisting. After the provider confirms provisioning, the number's callback
is changed to `trunk:<public-pbx-ip>`. Its SIP-phone instructions also document
returning a `<Dial>` action with a SIP phone destination from a Voice callback.
Those pages do not specify account-specific trunk credentials, provider source
CIDRs, transport/TLS/SRTP policy, codec negotiation, or the destination URI for
this workspace. Those values must come from Africa's Talking support/account
provisioning and must not be guessed.

Official references:

- [Africa's Talking SIP trunk setup](https://help.africastalking.com/en/articles/6049012-what-do-i-need-to-set-up-a-sip-trunk-connection)
- [Receiving calls on a SIP phone](https://help.africastalking.com/en/articles/5947707-how-do-i-receive-calls-on-my-sip-phone-or-any-ip-phone)
- [Africa's Talking voice products](https://africastalking.com/voice)

Asterisk is a viable gateway candidate: its official documentation describes
PJSIP WebRTC endpoints (WSS, ICE, DTLS-SRTP) and ARI mixing bridges for joining
PSTN and endpoint channels. ARI requires an active Stasis WebSocket application
and channel control; merely creating a bridge record does not establish media.

- [Asterisk WebRTC endpoint configuration](https://docs.asterisk.org/Configuration/WebRTC/Configuring-Asterisk-for-WebRTC-Clients/)
- [Asterisk ARI bridges](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-REST-Interface-ARI/Introduction-to-ARI-and-Bridges/)
- [Asterisk ARI channels and Stasis](https://docs.asterisk.org/Configuration/Interfaces/Asterisk-REST-Interface-ARI/Introduction-to-ARI-and-Channels/)

## What is implemented locally

- Resolves incoming Voice callbacks against tenant-owned DIDs and fans an
  authenticated offer to every eligible connected browser agent over the
  existing SSE dispatcher — the Neumorphic dashboard's ringing flow is the only
  ringing system, and the backend remains authoritative for winner selection.
- Stores sessions in SQLite and atomically permits one eligible agent to claim
  (first answer wins); later answers are rejected, and losing agents stop
  ringing.
- A real ARI controller (`src/services/asteriskAriController.js`, selected by
  `MEDIA_BRIDGE_PROVIDER=asterisk`, default fail-closed) runs the Stasis app
  `call-center`: it resolves the tenant from the trusted called number in the
  gateway event (never from a browser parameter), answers the caller, rings
  agents, originates a WebRTC channel to the winning agent, and joins both legs
  in an ARI mixing bridge.
- Per-agent SIP identities are provisioned server-side: usernames are
  deterministic per tenant/user, passwords are random and stored AES-256-GCM
  encrypted, endpoints are rendered into
  `infrastructure/asterisk/runtime/pjsip-agents.conf` and loaded with
  `pjsip reload`. Generated endpoints sit in the `from-webrtc` context, which
  blocks direct dialing to business DIDs.
- The browser softphone registers over WSS with backend-issued credentials and
  answers only the one inbound session the backend authorized for that agent.
  ARI credentials, trunk configuration, and other agents' SIP credentials are
  never returned to browsers; the session status API does not expose the
  gateway agent's SIP username.
- A call becomes `connected` only on media evidence: browser WebRTC stats
  (posted to `/media-ready`) and/or an Asterisk CLI `pjsip show channelstats`
  probe proving bidirectional RTP on the agent channel. Evidence from both
  observers is merged and never erased by a later probe. An ARI bridge by
  itself is only `transport`. If evidence does not arrive in time, the call is
  marked failed and the caller is hung up; it is never re-offered to another
  agent.
- Fails closed when no media bridge is configured; a browser notification or
  successful claim is never presented as connected audio.
- The server's Permissions-Policy permits same-origin microphone capture for
  the browser softphone while continuing to deny camera and geolocation.
- `infrastructure/asterisk/` includes a pinned Asterisk 22 container, local
  PJSIP/WebRTC and TLS configuration, ARI/HTTP configuration, isolated RTP
  ports, health checks, and SIPp test profiles. Local credentials are generated
  into an ignored `.env`; do not copy those test credentials into production.
- `/asterisk-smoke.html` is a separate local SIP.js test page, not a change to
  the production agent softphone.

## Verification performed (2026-11-11)

All commands run from the workspace root unless noted.

- Backend `npm test`: **48/48 passed** across 10 files, including tenant
  isolation across concurrent tenants, duplicate Stasis event deduplication,
  atomic first-answer-wins, no-agent missed calls, unregistered-agent and
  media-negotiation failures (both fail closed without re-offering), caller
  hangup during ringing, agent hangup after connection, ARI disconnect with
  reconnect/backoff (`test/asterisk-ari-controller.test.js`,
  `test/ari-client.test.js`), and `pjsip show channelstats` parsing against
  real Asterisk 22 output (`test/asterisk-cli.test.js`).
- Frontend `npm test` (from `screenshot-to-pixel/`): **27/27 passed** (6
  files).
- Frontend `npm run build` (from `screenshot-to-pixel/`): **succeeded**.
- Full end-to-end run: `node test/e2e/asterisk-inbound-browser.js` against the
  live local Asterisk 22.11.0 container — **46 checks passed, 0 failed, exit
  code 0**. The harness provisions three browser agents for one business and
  proves, per call:
  1. a SIPp caller reaches the business DID (5551001 mapped to the tenant's
     E.164 DID `+255699920003` via `ASTERISK_TEST_DID_ALIASES`) with an E.164
     From header, as a trunk would deliver;
  2. all three agents ring through the existing SSE dispatcher; agent A
     accepts; the backend awards the call to A; agents B and C stop ringing;
  3. Asterisk originates the browser leg and ARI bridges caller and agent
     (bridge contains both channel IDs, both channels `Up`);
  4. two-way media is verified from two independent observers — browser WebRTC
     byte counters and Asterisk CLI packet counters on the agent channel
     (e.g. 3040/3040 bytes, rx 33 / tx 33, codec ulaw);
  5. hangup works from both sides across two calls: call 1 hangs up from the
     browser (session `ended`, bridge and caller channel return 404) and call 2
     hangs up from the caller via SIP BYE (session `ended` as "caller hung up",
     caller channel 404, agent UI released). The SIPp caller completes with
     exit code 0 in both calls — it answers the gateway's BYE rather than
     aborting on it, so no unanswered BYE retransmissions leak into the next
     call.
- Earlier 2026-11-08 local checks remain valid: SIPp UAC to the local echo
  extension and a Playwright WebRTC echo call with a live remote audio track.

One intermediate run failed with zero RTP on both legs after a host network
interface that held the softphone's ICE address (`197.186.9.221`) disappeared
mid-call; the gateway and application behaved fail-closed (media never
verified, call finalized, no false `connected`). Re-running on the stable host
interfaces passed. This is host-environment sensitivity of local WebRTC
testing, not a gateway code path.

## What local verification does not prove

- Automated synthetic audio passed, but human microphone/speaker two-way
  listening was not performed.
- Asterisk is bound to loopback for this workstation test; it cannot receive
  external SIP/RTP traffic, and no Africa's Talking DID has been routed to it.
- The SIP-trunk-to-backend inbound mapping, trunk security settings, and
  provider-side DID route cannot be enabled or tested without the account's
  provisioning details. No live two-way PSTN audio test has been performed.
- The `from-at-trunk` dialplan context exists but has never carried a call
  from a real provider; source validation there must come from confirmed
  provider CIDRs, not guesses.

## Required activation inputs

Before switching any production DID to a trunk, obtain and verify these with
Africa's Talking and the deployment operator:

1. Confirmation that the specific DID is provisioned for inbound SIP trunking,
   and the exact callback/routing value supported for that DID.
2. Africa's Talking signaling source IP/CIDR list, SIP transport and port,
   authentication mode/credentials if applicable, supported codecs, and
   TLS/SRTP requirements.
3. A public PBX host with a stable public IP, DNS/TLS certificate for browser
   WSS, and firewall rules limited to the confirmed provider SIP ranges plus
   the explicitly selected RTP range. Do not expose ARI administration publicly.
4. A TURN service and secure per-agent WebRTC credentials/session authorization.
   Agent SIP extensions are application identities, not personal telephone
   numbers; credentials must be short-lived or rotated and never shared across
   tenants.
5. A gateway-to-application authenticated event path that supplies the actual
   gateway channel ID and called DID. Tenant resolution must use the called DID
   from that trusted gateway event, not a tenant value from a browser.

Deployment should then proceed in staging: validate SIP INVITE and caller/DID
metadata, validate WSS registration and ICE/DTLS, bridge two test endpoints,
verify audio in both directions, test either-side hangup and agent release,
and only then update one test DID. Do not route production DIDs before these
checks pass.

## Local repeatability

From `infrastructure/asterisk/`:

```sh
docker compose up -d --build
docker compose ps
docker compose --profile test run --rm sipp
```

Backend and frontend checks from the workspace root:

```sh
npm test
cd screenshot-to-pixel && npm test && npm run build
```

Full inbound-call end-to-end test (requires the healthy Asterisk container;
seeds its own database in `data/asterisk-e2e.sqlite`, report in
`data/asterisk-e2e-report.json`):

```sh
node test/e2e/asterisk-inbound-browser.js
```

For manual echo testing, run the Vite dev server and visit
`http://127.0.0.1:5173/asterisk-smoke.html`; use the local `.env` values and
press Connect, then Echo. The self-signed certificate is only for local use.
