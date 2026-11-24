# Call artifacts integration contract

The current UI is complete against the local demo artifact adapter, but this repository does not contain an authenticated call provider, object storage, job queue, or AI credentials. The seeded `h1000` conversation is marked as demo data and uses a generated browser audio clip.

## Required server capabilities

Implement these server-side operations before enabling production artifacts:

- `GET /api/tenants/:tenantId/calls/:callId/recording-url` — validate the authenticated user, tenant boundary, and recording-download permission, then return a short-lived signed URL. Never return bucket credentials.
- `POST /api/tenants/:tenantId/calls/:callId/transcription-jobs` — enqueue an idempotent job keyed by `tenantId + callId + artifactVersion`; the worker should support English, Kiswahili, and mixed-language audio when the selected provider supports it.
- `POST /api/tenants/:tenantId/calls/:callId/summary-jobs` — summarize only the authorized transcript and persist confirmed facts separately from suggestions.
- `PATCH /api/tenants/:tenantId/calls/:callId/transcript/:segmentId` — authorize reviewer corrections, preserve the original segment, and append an immutable edit record.
- `POST /api/tenants/:tenantId/calls/:callId/tasks` — accept only an explicitly reviewed task suggestion and reject an existing `tenantId + callId + suggestionId` duplicate.

All artifact reads, searches, downloads, corrections, retries, deletions, and task creation should write an audit event. Recording notices, retention, deletion, and legal hold rules should be tenant-configurable and enforced by the worker/storage service.

## Server-only configuration

The eventual deployment needs server-side values such as:

```text
RECORDING_OBJECT_STORE_BUCKET
RECORDING_SIGNING_SECRET
TRANSCRIPTION_PROVIDER
TRANSCRIPTION_API_KEY
SUMMARY_PROVIDER
SUMMARY_API_KEY
CALL_ARTIFACT_QUEUE
CALL_ARTIFACT_RETENTION_DAYS
```

These values must not be placed in Vite client variables or sent to the browser. Once the server adapter exists, replace `callArtifactProvider` in `src/lib/call-artifacts.ts` with a server-backed implementation and change the demo fallback to `source: "provider"` only after the provider response has been persisted and authorized.
