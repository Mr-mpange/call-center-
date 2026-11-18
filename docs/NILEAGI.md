# NileAGI backend integration (Phase 1)

This integration is backend-only and disabled by default. It does not change the call flow, telephony callbacks, or frontend.

## What was verified

- NileAGI describes Rafiki as an early Kiswahili voice-assistant preview that listens, answers aloud, and continues the conversation.
- NileAGI publishes separate Swahili STT and TTS research model services. Their model cards document local HTTP endpoints: STT `POST /v1/transcribe` on port 8094 and TTS `POST /v1/speech` on port 8093.
- The published STT model is Swahili speech to Swahili text. The published TTS model is Swahili text to 24 kHz mono speech.

The Rafiki API documentation now verifies API v1 at `https://api.rafiki.nileagi.com`, Bearer API keys beginning with `rk_`, and routes for health, Talk, speech synthesis, speech transcription, sessions, voices, and usage. It documents HTTP turns, not a WebSocket telephony stream. Commercial data-retention and production telephony terms still require confirmation.

## Implemented status

| Capability | Status |
| --- | --- |
| Provider abstraction and feature flags | Implemented and unit-tested |
| Tenant-scoped usage events in SQLite | Implemented and unit-tested |
| Safe provider/status endpoint | Implemented and unit-tested through existing route auth |
| Documented local Swahili STT adapter | Implemented, not live-tested |
| Documented local Swahili TTS adapter | Implemented, not live-tested |
| English STT/TTS | Unsupported by the verified model cards |
| Hosted Rafiki API health/voices/synthesis adapter | Implemented and live-tested |
| Hosted Rafiki transcription/Talk adapter | Implemented and live-tested using generated WAV audio; Talk returned transcript, reply, and audio URL |
| Real-time streaming, VAD, barge-in, hosted voice sessions | Unsupported/not documented |
| Telephony audio conversion to Africa's Talking format | Not yet implemented |
| Live telephony end-to-end test | Blocked until a supported provider deployment is supplied |

## Configuration

Copy the NileAGI section from `.env.example` into the server environment. Keep `NILEAGI_ENABLED=false` until the local services, licensing, privacy approval, and live tests are complete.

For the documented local adapter, configure for example:

```dotenv
NILEAGI_ENABLED=true
NILEAGI_ADAPTER=rafiki-api
NILEAGI_BASE_URL=https://api.rafiki.nileagi.com
NILEAGI_API_KEY=rk_live_...
NILEAGI_STT_ENABLED=true
NILEAGI_TTS_ENABLED=true
NILEAGI_VOICE_ENABLED=true
NILEAGI_VOICE_TRANSPORT=http-turns
NILEAGI_MEDIA_GATEWAY_KEY=replace-with-at-least-32-random-characters
```

The hosted adapter sends the API key only in the server-side `Authorization: Bearer` header. It currently defaults speech requests to `sw`/Kiswahili; no English support is claimed without a verified language capability.

## Live phone conversation bridge

The backend exposes an authenticated, tenant-scoped Rafiki turn bridge:

- `GET /voice/ai/status`
- `POST /voice/ai/sessions`
- `POST /voice/ai/sessions/:sessionId/turn` with an `audio/*` body and `X-Tenant-Id`
- `POST /voice/ai/sessions/:sessionId/end` with `X-Tenant-Id`

These endpoints are protected by `NILEAGI_MEDIA_GATEWAY_KEY`, persist session/turn metadata in SQLite, call the verified Rafiki `Talk` API, and return the provider transcript, reply, and `audio_url`.

They are not connected directly to the existing Africa's Talking VoiceXML callback. For a real inbound or outbound AI agent, configure Africa's Talking SIP trunking to a PBX/media gateway, then have that gateway send caller audio turns to these endpoints and play the returned audio. Set `NILEAGI_VOICE_TRANSPORT=sip-media-gateway` only after that transport is installed and tested. The normal XML callback remains the existing IVR/agent route.

## Internal endpoints

- `GET /api/ai/providers/nileagi` — supervisor/admin status, with no secret values.
- `GET /api/ai/usage` — supervisor/admin usage events scoped to the authenticated tenant.

The provider is not wired into live inbound or outbound call routing. This is deliberate: a failed or unknown AI provider must not alter existing customer-facing telephony behavior.

## Testing

Run `npm test` for deterministic unit/configuration/tenant-isolation tests. Run `npm run test:nileagi:live` only after a real local service or an official NileAGI integration contract is available; it skips with an explicit reason when not configured. No mocked test is reported as a live success.

## Production gate

Production telephony use is **blocked** until NileAGI confirms recording/audio data handling, retention, pricing/usage metering, and the required telephony audio format. The hosted API adapter is not connected to live inbound/outbound call routing by default.
