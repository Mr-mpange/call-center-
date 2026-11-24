export type CallDirection = "inbound" | "outbound";
export type CallStatus = "ringing" | "in-progress" | "on-hold" | "wrap-up";
export type CallOutcome = "resolved" | "missed" | "abandoned" | "escalated" | "voicemail";
export type AgentStatus = "available" | "on-call" | "break" | "offline";

export interface Agent {
  id: string;
  name: string;
  team: string;
  role: "Agent" | "Supervisor" | "Org Admin";
  status: AgentStatus;
  callsToday: number;
  avgHandle: number;
  languages: string[];
  voicemail?: string;
}
export interface LiveCall {
  id: string;
  caller: string;
  phone: string;
  direction: CallDirection;
  status: CallStatus;
  queue: string;
  agentId: string | null;
  durationSec: number;
  waitSec: number;
  language: "Kiswahili" | "English";
  intent: string;
}
export interface CallRecord {
  id: string;
  tenantId?: string;
  tenantName?: string;
  businessId?: string;
  at: string;
  caller: string;
  phone: string;
  direction: CallDirection;
  agent: string;
  queue: string;
  durationSec: number;
  outcome: CallOutcome;
  summary: string;
}
export interface Contact {
  id: string;
  name: string;
  phone: string;
  email: string;
  company: string;
  city: string;
  lastContact: string;
  totalCalls: number;
  doNotCall: boolean;
  consent: boolean;
  notes: string;
}
export interface Queue {
  id: string;
  name: string;
  waiting: number;
  longestWaitSec: number;
  agents: number;
  priority: "High" | "Normal" | "Low";
  slaTargetSec: number;
  overflowTo: string;
}
export type CampaignStatus = "running" | "paused" | "scheduled" | "completed" | "draft";
export interface Campaign {
  id: string;
  name: string;
  type: "Outbound calls" | "Survey" | "Reminder";
  status: CampaignStatus;
  queue: string;
  contacts: number;
  reached: number;
  conversions: number;
  start: string;
  owner: string;
}
export interface Intent {
  id: string;
  name: string;
  example: string;
  calls: number;
  automated: number;
  handoff: string;
}

export type TicketStatus = "open" | "in-progress" | "escalated" | "resolved";
export interface Ticket {
  id: string;
  subject: string;
  customer: string;
  phone: string;
  channel: "Call" | "SMS" | "WhatsApp" | "Email";
  priority: "High" | "Normal" | "Low";
  status: TicketStatus;
  assignee: string;
  created: string;
  slaHours: number;
}
export interface Callback {
  id: string;
  customer: string;
  phone: string;
  reason: string;
  due: string;
  agent: string;
  language: "Kiswahili" | "English";
  status: "scheduled" | "completed" | "missed" | "cancelled";
  attempts: number;
}
export interface Voicemail {
  id: string;
  from: string;
  phone: string;
  queue: string;
  at: string;
  durationSec: number;
  transcript: string;
  heard: boolean;
}
export interface Feedback {
  id: string;
  customer: string;
  agent: string;
  queue: string;
  csat: number;
  nps: number;
  comment: string;
  at: string;
}
export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: "Org Admin" | "Supervisor" | "Agent";
  team: string;
  status: "active" | "invited" | "disabled";
  lastLogin: string;
  mfa: boolean;
}
export interface Integration {
  id: string;
  name: string;
  category: string;
  status: "connected" | "error" | "disabled";
  lastSync: string;
  detail: string;
}
export interface WebhookEvent {
  id: string;
  event: string;
  endpoint: string;
  code: number;
  at: string;
  ms: number;
}
export interface Invoice {
  id: string;
  period: string;
  minutes: number;
  sms: number;
  seats: number;
  amount: number;
  status: "paid" | "due" | "overdue";
}
export interface AuditEntry {
  id: string;
  at: string;
  user: string;
  action: string;
  target: string;
  ip: string;
  severity: "low" | "normal" | "high";
}
