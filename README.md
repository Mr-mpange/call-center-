# Africa's Talking Voice & Messaging Suite (Node.js)

This project demonstrates 1-way SMS, 2-way SMS webhook, Bulk SMS, USSD, Voice, Airtime, and WhatsApp using Africa's Talking Sandbox.
It also includes scaffolding for WhatsApp (inbound webhook and outbound send) via Africa's Talking WhatsApp product.

## Prerequisites
- Node.js 18+
- Africa's Talking account (Sandbox)
- Ngrok (for webhooks)

## Setup
1. Clone or open this project in your IDE.
2. Create a `.env` file based on `.env.example` and fill in your Africa's Talking credentials:
   - `AT_USERNAME=sandbox`
   - `AT_API_KEY=your_sandbox_api_key`
   - Optionally adjust `PORT` (default 3000)
   - For WhatsApp, fill (when available in your account):
     - `AT_WHATSAPP_API_URL` (e.g., `https://content.africastalking.com/whatsapp/send`)
     - `AT_WHATSAPP_SENDER` (your WhatsApp-enabled number or sender identifier)
     - `AT_WHATSAPP_WEBHOOK_SECRET` (optional, if AT provides signature verification)
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the server:
   ```bash
   npm run dev
   # or
   npm start
   ```
5. Health check: open http://localhost:3000/health. The route index is available at http://localhost:3000/api.

## API documentation
The OpenAPI 3.0 / Swagger specification is in [`openapi.yaml`](./openapi.yaml). Import that file into Swagger UI, Swagger Editor, or Postman to browse and try the voice callback, call-log, outbound-call, and dashboard IVR endpoints.

## Frontend dashboard API

The `screenshot-to-pixel` frontend is a call-center console with operator, organization-admin, and platform-admin screens. The backend exposes a tenant-scoped API for those screens under `/api`:

- `GET /api/overview` and `GET /api/analytics` for dashboard metrics.
- `GET/POST/PATCH/PUT/DELETE /api/contacts`, `/agents`, `/queues`, `/campaigns`, `/callbacks`, `/voicemails`, `/tickets`, `/feedback`, `/integrations`, `/users`, `/phone-numbers`, `/invoices`, and `/audit-log`.
- `GET /api/calls`, `GET /api/calls/live`, `GET /api/calls/:callId`, `POST /api/calls/outbound`, and `POST /api/calls/:callId/actions` for call control.
- `GET/POST/PUT/DELETE /api/ivr/flows` plus `/publish` and `/simulate` for the frontend flow builder. Existing provider-facing `/voice/ivr/*` routes remain available separately.
- `GET/POST/PATCH/PUT/DELETE /api/platform/:collection` for platform console collections, with `GET /api/platform/dashboard` for metrics.
- `POST /api/auth/login`, `POST /api/auth/register`, `GET /api/auth/me`, and `POST /api/auth/logout` for the local auth adapter.
- `GET /api/tenants` and `POST /api/tenants/:tenantId/switch` for server-authorized Platform Admin tenant switching. The workspace selector reloads the dashboard with the selected tenant scope; ordinary tenant users cannot switch tenants.
- `GET /api/calls/:callId/recording-url`, transcription and summary job routes, transcript correction, and reviewed follow-up task creation for call artifacts.

List endpoints accept `limit`, `page`/`offset`, `q`, and common exact filters such as `status`, `queue`, `team`, and `direction`. Responses include both `data` and a resource-named property to make the API easy to consume from the existing frontend.

Dashboard records are empty until created through an API workflow and are persisted transactionally in SQLite at `DASHBOARD_DB_FILE` (default `data/dashboard.sqlite`). The application does not read legacy JSON data. Every authenticated token carries a tenant identifier; API reads and writes execute inside that tenant's database state. Set `DASHBOARD_DB_FILE` to a persistent volume, use a strong `AUTH_SECRET`, configure `CORS_ORIGINS`, and keep `API_AUTH_REQUIRED=true` outside isolated local development.

To enable tenant switching for an existing account, set `PLATFORM_ADMIN_EMAILS` in the server `.env` to that account's email, separated by commas, then restart the backend and sign in again. This allowlist is server-side; the frontend cannot grant itself Platform Admin access.

## Ngrok (for webhooks)
Expose your local server:
```bash
ngrok http 3000
```
Copy the https URL, e.g. `https://abc123.ngrok.io`

### Configure Callbacks in Africa's Talking Sandbox Dashboard
- SMS (2-way inbound): set the Inbound Callback URL to `https://<ngrok>/sms/inbound`
- USSD: set the Service Callback URL to `https://<ngrok>/ussd` (or `/ussd/callback`)
- Voice:
  - Events URL: `https://<ngrok>/voice/events`
  - Voice callback URL (for inbound calls and call instructions): `https://<your-public-domain>/voice/actions` (alias: `/voice/inbound`). Set this for each Voice-enabled number. For local development, expose the server with ngrok and use its HTTPS URL.
- WhatsApp:
  - Inbound/Webhook URL: `https://<ngrok>/whatsapp/webhook`

Note: exact placement may vary in the dashboard under products' settings.

## Endpoints

### SMS
- POST `/sms/send`
  - Body: `{ "to": "+254700000000" | ["+254700000000", ...], "message": "Hello", "from": "SENDER_ID_OR_SHORTCODE(optional)" }`
- POST `/sms/bulk`
  - Body: `{ "recipients": ["+254700000001", "+254700000002"], "message": "Hi all", "from": "optional" }`
- POST `/sms/inbound` (webhook from AT)
  - AT posts fields: `text, from, to, date, id, linkId`
  - Responds `200 OK` quickly. We also try an auto-ack.

### USSD
- POST `/ussd`
  - AT posts: `sessionId, serviceCode, phoneNumber, text`
  - Respond with strings starting with `CON` to continue, or `END` to finish. Select 1 to send an SMS to the caller, or 2 to request airtime for the caller. Both use the same credentials as the direct APIs.

### Route index
- GET `/api` lists all currently mounted solutions and their routes.

### Voice
- POST `/voice/call` (alias: `/voice/outbound`)
  - Body: `{ "callFrom": "+254711000000", "callTo": "+254700000000" }`
  - Initiates an outbound call via the Africa's Talking Voice REST API. Tenant dashboard calls use the organization’s configured voice number automatically; a caller ID may only be supplied when it belongs to that organization. Direct `/voice/call` requests must provide `callFrom`. Optional `clientRequestId` can be supplied for tracking. Requires Voice-enabled numbers and a valid API key.
- POST `/voice/inbound` (alias: `/voice/actions`): Voice callback for inbound calls and call instructions. Returns XML for the IVR menu.
- POST `/voice/events`: call status callback.
- GET `/voice/logs`: protected dashboard API listing persisted AT voice event records. Supports `limit` (1–100), `offset`, and exact filters `sessionId`, `direction`, `status`, `callerNumber`, and `destinationNumber`.
- GET `/voice/logs/:sessionId`: protected event history for one call session.
- GET `/voice/businesses?tenantId=...` and POST `/voice/businesses`: tenant-scoped business management.
- GET/PUT/DELETE `/voice/businesses/:businessId?tenantId=...`: retrieve, update, or remove a business in that tenant.
- POST `/voice/businesses/:businessId/agents?tenantId=...`: add an agent.
- PUT/DELETE `/voice/businesses/:businessId/agents/:agentId?tenantId=...`: update or remove an agent.

Configure Africa's Talking's voice callback to `/voice/actions` and its events URL to `/voice/events`. Inbound customer events are matched by the called business number and stored in that tenant's `liveCalls` while active, then upserted once into `history` when the provider reports a terminal state. WebRTC client legs are excluded from customer history. If the event callback is not configured or the number is not assigned to a business route, provider events cannot be attached to a tenant's call history.

Set `VOICE_DASHBOARD_API_KEY` in `.env`; dashboard requests must send `Authorization: Bearer <VOICE_DASHBOARD_API_KEY>`. `/voice/events` appends each event to `data/voice-events.jsonl` by default; set `VOICE_LOG_FILE` to change the path. Business routes, inbound numbers, and agent destinations are persisted in the existing SQLite database (`DASHBOARD_DB_FILE`/`DASHBOARD_STORE_FILE`) and scoped by tenant. Existing `data/voice-businesses.json` records are imported once on first access and kept as a migration backup; it is no longer the active store. Keep the key private and serve the dashboard over HTTPS. Back up the SQLite database and configure Africa's Talking's inbound callback URL to this service's `/voice/actions` endpoint.

##### Business onboarding example
Create a business with an inbound Africa's Talking number. You can create it without agents, then add agents using the dedicated route:

```json
{
  "id": "mpange",
  "tenantId": "your-existing-tenant-id",
  "name": "Mpange Support",
  "numbers": ["+255699920003"],
  "routing": "parallel"
}
```

Send that JSON to `POST /voice/businesses` with the dashboard bearer key. Then add agents one at a time with `POST /voice/businesses/mpange/agents?tenantId=your-existing-tenant-id` and a body like `{"name":"Agent One","number":"+255700000001"}`. Numbers must be E.164 format. Each tenant/business setup is stored in SQLite; incoming calls are matched to the business by its configured inbound number.

##### Dashboard IVR flow routes
The control center can manage one simple keypad menu per configured business. All routes below require the same bearer key:

- `GET /voice/ivr/flows`: list saved flows.
- `GET /voice/ivr/flows/:businessId`: fetch a business flow.
- `POST /voice/ivr/flows`: create or replace a flow; include `businessId` in the body.
- `PUT /voice/ivr/flows/:businessId`: replace a flow.
- `DELETE /voice/ivr/flows/:businessId`: remove the flow. The business then uses direct-to-agent routing again.

Example create/update JSON:

```json
{
  "businessId": "Mpnge",
  "greeting": "Welcome to Mpanges Support.",
  "menuPrompt": "Press 1 to speak to an agent. Press 2 for our opening hours. Press 0 to end the call.",
  "timeoutSeconds": 15,
  "options": [
    { "digit": "1", "label": "Speak to an agent", "action": "dialAgents" },
    { "digit": "2", "label": "Opening hours", "action": "say", "text": "We are open Monday to Friday, from 8 AM to 5 PM." },
    { "digit": "0", "label": "End call", "action": "hangup", "text": "Thank you for calling." }
  ]
}
```

`action` can be `dialAgents` (rings the business's configured agents using its routing mode), `say` (plays `text` and ends that menu interaction), or `hangup` (plays optional `text` and hangs up). Digits must be unique single digits; timeout must be 3–60 seconds. Flows are saved in `data/voice-ivr-flows.json` by default, configurable with `VOICE_IVR_FILE`. To create a flow from a dashboard backend, send `POST /voice/ivr/flows` with the bearer header and the JSON above.

Example dashboard request:

```bash
curl "https://your-domain/voice/logs?limit=25&offset=0" \\
  -H "Authorization: Bearer YOUR_VOICE_DASHBOARD_API_KEY"
```

#### Business call routing
Set `AT_VOICE_BUSINESSES` in `.env` to a JSON array. The example in `.env.example` shows two businesses; replace all example numbers with real numbers before using it. Keep the value on one line in `.env`, or use dotenv's quoted multiline value format as shown in the example.

```env
AT_VOICE_BUSINESSES='[{"id":"acme","name":"Acme Support","numbers":["+254711000001","+254711000002"],"agents":[{"name":"Amina","number":"+254700000001"},{"name":"Juma","number":"+254700000002"}],"routing":"sequential"}]'
```

- `id`: your unique business identifier for configuration and logs. It is not used to pick the route; the called phone number does that.
- `name`: readable business label used in configuration and routing logs.
- `numbers`: one or more inbound Africa's Talking voice numbers assigned to this business. When a call comes in, the callback's `to` (or `destinationNumber`) is matched against this list. All numbers belonging to one business can point to the same callback URL.
- `agents`: the human operators who answer calls, represented by their phone numbers. You can use simple strings (`"+254700000001"`) or objects with a display `name` and dialed `number`. The name is for your own readability; the current router only dials the number. An agent is **not an AI**. If you later want an AI voice agent, it needs a separate voice/AI integration or SIP endpoint and the call must be routed to that endpoint.
- `routing`: `sequential` tries destinations in listed order; `parallel` rings the configured destinations at the same time and connects the first to answer. If omitted, the code uses parallel dialing.
- The callback plays a brief welcome to the caller, then sends a `<Dial>` instruction with `callerId` set to the Africa's Talking number they called, so agents can identify the business line. Only AT's events/dashboard or the receiving phone can confirm that the carrier placed and connected the agent leg.
- The same callback URL can receive outbound call callbacks. The app identifies `direction: "Outbound"` and avoids running inbound business routing again, preventing it from dialing the agent recursively.
- Use international E.164 format (including `+` and country code). Each destination must be reachable for voice calls, and the AT account must be enabled and funded for the relevant routes. Agent numbers do not need to be AT numbers when routing to ordinary mobile/landline phones; AT SIP agents must be provisioned as SIP endpoints.
- Every inbound number must already be active for Voice in your Africa's Talking account. In the dashboard, set each number's callback URL to `/voice/actions` on your public HTTPS server. The app reads the called number and chooses its configured business. A number not listed in the configuration receives a truthful unavailable response.
- Parallel dialing is not an availability-aware queue: it rings every listed human agent for each call. Sequential dialing tries numbers in order. This initial environment-configured router does not track agent availability, handle business hours, keep callers in a queue, or provide a business/agent admin screen.

### Airtime
- POST `/airtime/send`
  - Body: `{ "phoneNumber": "+254700000000", "amount": "10", "currencyCode": "KES" }`

### WhatsApp
- POST `/whatsapp/send`
  - Body: `{ "to": "+254700000000" | ["+254700000000", ...], "message": "Hello via WhatsApp", "mediaUrl": "optional", "template": { ... } }`
  - Uses `AT_WHATSAPP_API_URL` and `AT_WHATSAPP_SENDER` env vars. Requires WhatsApp product access in your AT account.
- POST `/whatsapp/webhook` (webhook from AT WhatsApp)
  - Configure this in the AT dashboard. Events are acknowledged only after request validation; delivery is not reported as successful by this endpoint.
  - Set `AT_WHATSAPP_WEBHOOK_SECRET` when the provider supplies signed webhook requests.

## Testing with curl (Windows PowerShell)

- 1-way SMS
```powershell
curl -Method POST -Uri http://localhost:3000/sms/send -Headers @{"Content-Type"="application/json"} -Body '{"to":"+254700000000","message":"Hello from sandbox"}'
```
- Bulk SMS
```powershell
curl -Method POST -Uri http://localhost:3000/sms/bulk -Headers @{"Content-Type"="application/json"} -Body '{"recipients":["+254700000001","+254700000002"],"message":"Hello bulk"}'
```
- Simulate inbound SMS (use ngrok URL when dashboard calls you)
```powershell
curl -Method POST -Uri http://localhost:3000/sms/inbound -Headers @{"Content-Type"="application/x-www-form-urlencoded"} -Body 'text=Hi&from=%2B254700000000&to=12345'
```
- USSD (local test)
```powershell
curl -Method POST -Uri http://localhost:3000/ussd -Headers @{"Content-Type"="application/x-www-form-urlencoded"} -Body 'sessionId=abc&serviceCode=%2A384%2A123%23&phoneNumber=%2B254700000000&text='
```
- Voice call (sandbox)
```powershell
curl -Method POST -Uri http://localhost:3000/voice/call -Headers @{"Content-Type"="application/json"} -Body '{"callFrom":"+254711000000","callTo":"+254700000000"}'
```
- Airtime (sandbox)
```powershell
curl -Method POST -Uri http://localhost:3000/airtime/send -Headers @{"Content-Type"="application/json"} -Body '{"phoneNumber":"+254700000000","amount":"10","currencyCode":"KES"}'
```
- WhatsApp Send (example)
```powershell
curl -Method POST -Uri http://localhost:3000/whatsapp/send -Headers @{"Content-Type"="application/json"} -Body '{
  "to": "+254700000000",
  "message": "Hello via WhatsApp"
}'
```
- WhatsApp Webhook (simulate)
```powershell
curl -Method POST -Uri http://localhost:3000/whatsapp/webhook -Headers @{"Content-Type"="application/json"} -Body '{
  "event": "message",
  "from": "+254700000000",
  "text": "Hi"
}'

## Notes
- Sandbox may restrict sender IDs, short codes, numbers, and airtime values.
- For 2-way SMS premium flow (subscriptions, linkId), additional setup is required.
- Ensure your `.env` is filled with correct sandbox API key and username.
- For WhatsApp, you need a WhatsApp-enabled sender and the correct REST endpoint from Africa's Talking. Contact AT support or check product docs.

## NileAGI Phase 1 backend integration

The NileAGI adapter is disabled by default and does not change telephony routing or the frontend. See [`docs/NILEAGI.md`](docs/NILEAGI.md) for the verified capability matrix, configuration, protected status/usage endpoints, and live-test gate.
