# MPANGE IVR Frontend Audit and Implementation Plan

Audit date: 2026-11-03  
Scope: current `screenshot-to-pixel` repository. Per user direction, implementation is frontend-only; no backend, database, migrations, or provider integrations will be added.

## Audit findings

### Existing functionality

- The app is a React 19 / TypeScript frontend using TanStack Start and file-based routes (`src/routes/`).
- IVR is exposed at `/ivr` in `src/routes/ivr.tsx`; its editor is `src/components/ivr/FlowBuilder.tsx` and node/flow types and helpers live in `src/lib/ivr.ts`.
- The editor uses `@xyflow/react` and already supports adding the existing greeting, message, menu, hours, queue, ring-group, transfer, voicemail, and hangup nodes; connecting/deleting edges; repositioning nodes; editing basic node fields; duplicating flows; and fitting/zooming/minimap controls.
- Existing flow data is saved in browser `localStorage` under `mpange.ivr.flows.v1`. The route and builder both read/write that same key, so there are two owners for flow lifecycle and persistence.
- Structural checks are implemented in `validateFlow`, but are limited to missing linear destinations, missing menu destinations, missing business-hours branches, and malformed transfer numbers.
- `nextStep` contains limited routing logic for keypad, open/closed, custom routes, and linear nodes. It is a helper, not a complete execution engine.
- Existing UI modules for agents, queues, contacts, phone numbers, integrations, live calls, voicemail, and audit screens are present and reusable as UI references.
- Unit coverage in `src/test/ivr.test.ts` covers basic flow helpers and forwarding-group behavior.

### Existing architecture and data sources

- There is no backend application module, API route, workflow service, database client, schema, or migration directory in this repository. `src/server.ts` delegates HTTP requests to TanStack Start and normalizes SSR errors; it does not implement call or IVR APIs.
- The former illustrative data modules were removed during backend integration. Domain types now live in `src/lib/domain-types.ts`, while operational data is expected from authenticated API responses.
- Flow CRUD and “publish” are browser-only state changes. Publishing toggles a boolean and does not create an immutable version or assign a live number.
- The login page explicitly allows any valid-looking email/password and says authentication is not connected. The app shell identifies a “Demo Tenant”; tenant switching is disabled. Role permission data is illustrative and does not protect routes or operations.
- `PhoneProvider` generates local tones, timers, and in-memory call state. It does not connect to SIP, Africa's Talking, a carrier, or another telephony provider. Its keypad plays a local DTMF tone; digits do not enter the IVR workflow.
- Integration statuses and call/queue/agent metrics are static sample data, not provider state or real-time events. No WebSocket or event stream was found.
- No configured persistent store, tenant identity, or production telephony credentials are present in the inspected project files.

### Existing IVR limitations

- Flow and node types cover only the current small caller-menu feature set. There is no schema/version field, business ID, trigger type, audio asset, queue ID, execution context, or run history.
- Current node configuration is mostly label/text/target selection. Business hours do not carry timezone or schedules, and queues/groups resolve to display-name lists rather than operational records.
- The canvas supports basic editing, but not the requested searchable categorized library, node duplication, undo/redo, keyboard editing, grouping, copy/paste, or canvas search.
- The current Test preview enumerates graph paths and animates them. It does not ask for simulated caller input or execute one caller's chosen DTMF/condition path. It must not be described as production call simulation.
- Validation does not inspect unsupported node types, unresolved targets, unreachable nodes, cycles, terminal outcomes, timeout/retry behavior, or publish readiness.
- There is no version history or rollback. Existing `published` is mutable draft state.
- Phone number selection comes from static demo records and does not write an assignment.

### Compatibility and repository state

- Existing route, flow helpers, React Flow canvas, and Radix UI controls are reusable and should be extended rather than replaced.
- The repository contains pre-existing working-tree edits (including IVR, package, config, and Lovable-removal changes) before this audit. Preserve those edits; do not reset or revert them.
- No schema migration is applicable for the frontend-only scope. A later backend phase would need an independently planned, backward-compatible migration once the actual persistence platform is selected.

## Missing requested capabilities

The following cannot honestly be presented as operational in this frontend-only repository: multi-tenant isolation, authenticated authorization, production flow storage, telephony triggers/actions, real queues/departments/agents, provider integrations, immutable publishing/versioning, real execution history, live call monitoring, WebSockets, and external side effects. These require a separate backend/provider implementation and must remain clearly unavailable in the UI.

The frontend can implement safely now: a categorized editor library with supported current node types, accessible disabled placeholders for backend-dependent node types, richer local configuration, structural validation/readiness, and an actual deterministic in-browser simulation of the supported workflow definition using simulated DTMF, hours, caller data, no-input, and invalid-input scenarios. Simulation must not call the phone provider or perform external side effects.

## Frontend implementation plan

1. **Audit (complete):** document existing architecture, reusable modules, limits, and integration risks.
2. **Builder enhancement:** extend the current React Flow editor in place; organize available nodes into a searchable categorized library; label unavailable capabilities; improve selection, configuration, duplication, keyboard actions, and local save/restore while preserving existing flows.
3. **Validation and publish readiness:** distinguish errors, warnings, and recommendations; validate references, branches, reachability, and supported node kinds; navigate to the offending node. Keep “publish” clearly a local draft/demo action until a server exists.
4. **Frontend simulation engine:** execute a single simulated call from START through the graph with deterministic node handlers; expose caller number/language, DTMF, hours/open state, invalid/no input, step/pause/resume/restart/stop; record per-node state, selected edge, timestamps, outputs, and safe error details; never invoke real phone/provider functions.
5. **Local draft history:** if implemented in this scope, label it browser-local and non-authoritative; do not imply immutable server versions or production assignment.
6. **Tenant/provider-dependent phases:** explicitly out of scope per user instruction not to create the backend. Keep integration-only controls unavailable and document prerequisites.
7. **Verification:** run the project's relevant unit/build checks for frontend changes; add focused tests for the deterministic simulation and validation helpers.

## Required database/API changes

None for this frontend-only work. No API endpoints will be created. A future backend requires tenant-scoped flows and immutable versions, phone-number assignments, execution/run/node-event records, authorization checks, and provider adapters, but the concrete schema and API are deferred until the actual backend and telephony platform are specified.

## Compatibility and safety risks

- Old flow records in localStorage may lack fields introduced by the editor. Read/write changes should be additive and include tolerant normalization.
- The two current flow lifecycle owners can overwrite one another. The UI changes should keep one canonical in-memory flow source per builder session and preserve the existing storage key.
- Demo phone/queue/agent records must not be treated as verified production resources.
- Simulated speech, call transfer, SMS/email, recording, payment, and HTTP integrations must remain local-only or disabled; they must not call `PhoneProvider` or external services.
- Browser-local flow data is not shared across users/devices and is not a secure tenant boundary.

## Frontend work completed in this pass

- Kept the existing React Flow canvas and added a searchable, categorized node library. Existing nodes are identified as locally simulatable; backend-dependent requested nodes are visible as disabled/unavailable.
- Added node duplication, canvas search/focus, keyboard undo/redo, and delete/duplicate shortcuts while retaining browser-local flow persistence.
- Expanded local DTMF menu configuration with retry count, no-input timeout, and connectable invalid-input/no-input fallback outlets.
- Added structural validation with clickable node issues, warnings for unreachable nodes and loops, invalid references and duplicate keypad keys.
- Replaced path-color playback with a deterministic local simulator that executes the current graph, business-hours condition and keypad selection. It supports manual input and built-in open/billing, after-hours, invalid-key, and no-response scenarios; pause, resume, step, restart and stop; per-node status, followed-edge animation, timing, logs, inspection, summary, and browser-tab execution history with masked caller numbers.
- The local simulator never invokes the phone provider or external services. Queue, ring-group, transfer, and voicemail endpoints produce descriptive simulated outcomes only.
- Renamed publishing and phone-number controls to identify the local preview. Publishing remains a browser-local flag and does not assign a real number or route calls.

## Completion status

- Audit: complete.
- Frontend builder, validation, and local simulation: implemented for the existing supported node types; tested as listed in the delivery summary.
- Broader UI requirements still outstanding include richer audio/TTS assets, additional node configuration surfaces, grouping and multi-selection workflows, compare/rollback version screens, and more comprehensive scenario authoring.
- Backend, tenant isolation, persistent immutable versions, production telephony, real call routing, and live execution are not implemented and are intentionally not being created in this frontend-only scope.
