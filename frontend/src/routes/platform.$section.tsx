import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Activity,
  Building2,
  Copy,
  CreditCard,
  CheckCircle2,
  Check,
  Eye,
  Headphones,
  MessageSquare,
  Megaphone,
  PhoneCall,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Settings,
  SlidersHorizontal,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SuperAdminShell } from "@/components/AppShell";
import { DataTable, type Column } from "@/components/DataTable";
import { DateRangeFilter } from "@/components/DateRangeFilter";
import { FilterSelect } from "@/components/FilterSelect";
import { EmptyState, KpiCard, PageHeader, Panel, StatusBadge } from "@/components/kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import {
  type PlatformRecord,
  type PlatformStore,
  type PlatformValue,
} from "@/lib/platform-store";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import type { DateFilterValue } from "@/components/date-range";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/platform/$section")({
  head: ({ params }) =>
    pageHead(
      pages[params.section]?.title ?? "Platform console",
      "Platform administration workspace.",
    ),
  component: PlatformSection,
});

type Field = {
  key: string;
  label: string;
  type?: "text" | "email" | "tel" | "number" | "date";
  required?: boolean;
  form?: boolean;
};
type Row = PlatformRecord;
type TenantOption = { id: string; name: string };
type PageDefinition = {
  title: string;
  description: string;
  collection: string;
  columns: Field[];
  modules: string[];
};

const tenantPlanOptions = ["Free", "Starter", "Professional", "Enterprise"] as const;

type SectionMeta = {
  actionLabel: string;
  actionHref?: string;
  showAction?: boolean;
  panelTitle: string;
  searchPlaceholder: string;
  emptyBody: string;
};

const sectionMeta: Record<string, SectionMeta> = {
  businesses: { actionLabel: "Add tenant", panelTitle: "Tenant directory", searchPlaceholder: "Search tenants, owners, plans…", emptyBody: "Onboard a tenant to begin managing memberships, plans, and usage." },
  users: { actionLabel: "", showAction: false, panelTitle: "Platform user directory", searchPlaceholder: "Search registered users, tenants, roles…", emptyBody: "Registered platform users will appear here after they create an account." },
  subscriptions: { actionLabel: "Create subscription", panelTitle: "Subscription portfolio", searchPlaceholder: "Search tenants, plans, billing status…", emptyBody: "Subscription data will appear when billing is connected." },
  finance: { actionLabel: "Review billing", actionHref: "/platform/billing", panelTitle: "Financial records", searchPlaceholder: "Search invoices, tenants, payment status…", emptyBody: "Financial records will appear when a billing provider is connected." },
  billing: { actionLabel: "", showAction: false, panelTitle: "Invoice records and payment status", searchPlaceholder: "Search invoices, tenants, payment status…", emptyBody: "No persisted invoice records are available yet." },
  telephony: { actionLabel: "Configure telephony", actionHref: "/platform/settings", panelTitle: "Telephony inventory", searchPlaceholder: "Search providers, numbers, tenants…", emptyBody: "Configure a provider or number when telephony infrastructure is connected." },
  monitoring: { actionLabel: "Review call events", actionHref: "/platform/health", panelTitle: "Call and execution events", searchPlaceholder: "Search calls, providers, queues…", emptyBody: "Call events will appear when the telephony monitoring source is connected." },
  support: { actionLabel: "", showAction: false, panelTitle: "Support queue", searchPlaceholder: "Search tickets, tenants, requesters…", emptyBody: "Support requests will appear here when users submit them." },
  feedback: { actionLabel: "", showAction: false, panelTitle: "Feedback review queue", searchPlaceholder: "Search feedback, tenants, categories…", emptyBody: "Feedback submissions will appear here when users send them." },
  announcements: { actionLabel: "Create announcement", panelTitle: "Announcement lifecycle", searchPlaceholder: "Search notices, tenant audiences, publication status…", emptyBody: "Create a draft announcement for a tenant audience to begin the publication workflow." },
  integrations: { actionLabel: "Configure integration", actionHref: "/platform/settings", panelTitle: "Integration registry", searchPlaceholder: "Search integrations, providers, capabilities…", emptyBody: "Connect an integration to populate this registry." },
  ivr: { actionLabel: "Create IVR template", panelTitle: "IVR platform inventory", searchPlaceholder: "Search templates, node types, availability…", emptyBody: "IVR templates will appear when the platform workflow service is connected." },
  settings: { actionLabel: "", showAction: false, panelTitle: "Platform configuration", searchPlaceholder: "Search platform configuration…", emptyBody: "Platform configuration is not available." },
};

type SectionMetric = { label: string; value: string; hint: string; icon: typeof Activity };

function sectionMetrics(section: string, rows: PlatformRecord[]): SectionMetric[] {
  const status = (row: PlatformRecord) => String(row.status ?? "").toLowerCase();
  const count = (predicate: (row: PlatformRecord) => boolean) => rows.filter(predicate).length;
  const recent = rows.filter((row) => {
    const timestamp = Date.parse(String(row.createdAt ?? ""));
    return Number.isFinite(timestamp) && timestamp >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  });
  switch (section) {
    case "businesses":
      return [
        { label: "Active tenants", value: String(count((row) => ["active", "trial"].includes(status(row)))), hint: "Active or trial organizations", icon: Building2 },
        { label: "Suspended tenants", value: String(count((row) => status(row) === "suspended")), hint: "Requires review", icon: AlertTriangle },
        { label: "New registrations", value: String(recent.length), hint: "Last 30 days", icon: Users },
      ];
    case "users": {
      const recentSignIns = count((row) => {
        const timestamp = Date.parse(String(row.lastLogin ?? ""));
        return Number.isFinite(timestamp) && timestamp >= Date.now() - 30 * 24 * 60 * 60 * 1000;
      });
      return [
        { label: "Active accounts", value: String(count((row) => status(row) === "active")), hint: "Can sign in", icon: Users },
        { label: "Recent sign-ins", value: String(recentSignIns), hint: "Last 30 days", icon: Activity },
        { label: "Platform admins", value: String(count((row) => `${row.role ?? ""} ${row.globalRole ?? ""}`.toLowerCase().includes("admin"))), hint: "Global access roles", icon: ShieldCheck },
      ];
    }
    case "billing":
    case "finance":
      return [
        { label: "Paid revenue", value: formatAiCost(rows.filter((row) => ["paid", "completed", "success"].includes(status(row))).reduce((sum, row) => sum + Number(row.amount ?? 0), 0), rows[0]?.currency ?? "TZS"), hint: "Paid billing records", icon: CreditCard },
        { label: "Outstanding invoices", value: String(count((row) => ["due", "overdue", "pending"].includes(status(row)))), hint: "Due or pending", icon: Activity },
        { label: "Failed payments", value: String(count((row) => ["failed", "declined", "error"].includes(status(row)))), hint: "Requires review", icon: AlertTriangle },
      ];
    case "subscriptions":
      return [
        { label: "Active subscriptions", value: String(count((row) => status(row) === "active")), hint: "Current subscriptions", icon: CreditCard },
        { label: "Trial accounts", value: String(count((row) => status(row) === "trial")), hint: "Trial period", icon: Activity },
        { label: "Suspended plans", value: String(count((row) => status(row) === "suspended")), hint: "Requires review", icon: AlertTriangle },
      ];
    case "telephony":
      return [
        { label: "Connected providers", value: String(count((row) => String(row.kind ?? "").toLowerCase() === "provider" && status(row) === "connected")), hint: "Provider connections", icon: PhoneCall },
        { label: "Phone numbers", value: String(count((row) => String(row.kind ?? "").toLowerCase() === "number")), hint: "Inventory records", icon: PhoneCall },
        { label: "Paused resources", value: String(count((row) => ["paused", "error", "failed"].includes(status(row)))), hint: "Requires attention", icon: AlertTriangle },
      ];
    case "monitoring":
      return [
        { label: "Call events", value: String(rows.length), hint: "Reported executions", icon: PhoneCall },
        { label: "Failed calls", value: String(count((row) => ["failed", "error", "missed"].includes(status(row)))), hint: "Reported failures", icon: AlertTriangle },
        { label: "Storage reported", value: `${rows.reduce((sum, row) => sum + Number(row.recordingStorageGb ?? 0), 0).toFixed(2)} GB`, hint: "Recording storage", icon: Activity },
      ];
    case "support":
      return [
        { label: "Open tickets", value: String(count((row) => !["resolved", "closed", "completed"].includes(status(row)))), hint: "Needs attention", icon: Headphones },
        { label: "Unassigned", value: String(count((row) => !String(row.assignedAdmin ?? "").trim())), hint: "No administrator", icon: Users },
        { label: "High priority", value: String(count((row) => String(row.priority ?? "").toLowerCase() === "high")), hint: "Priority queue", icon: AlertTriangle },
      ];
    case "feedback":
      return [
        { label: "Open feedback", value: String(count((row) => !["resolved", "closed"].includes(status(row)))), hint: "Awaiting review", icon: MessageSquare },
        { label: "Bug reports", value: String(count((row) => String(row.category ?? "").toLowerCase() === "bug")), hint: "Product issues", icon: AlertTriangle },
        { label: "Feature requests", value: String(count((row) => ["suggestion", "feature request"].includes(String(row.category ?? "").toLowerCase()))), hint: "Product ideas", icon: Sparkles },
      ];
    case "announcements":
      return [
        { label: "Drafts", value: String(count((row) => status(row) === "draft")), hint: "Not published", icon: Megaphone },
        { label: "Scheduled", value: String(count((row) => status(row) === "scheduled")), hint: "Awaiting publication", icon: Activity },
        { label: "Published", value: String(count((row) => status(row) === "published")), hint: "Publication history", icon: CheckCircle2 },
      ];
    case "integrations":
      return [
        { label: "Connected", value: String(count((row) => ["connected", "active"].includes(status(row)))), hint: "Configured integrations", icon: CheckCircle2 },
        { label: "Needs attention", value: String(count((row) => ["error", "failed", "degraded"].includes(status(row)))), hint: "Connection issues", icon: AlertTriangle },
        { label: "Capabilities", value: String(new Set(rows.flatMap((row) => String(row.capabilities ?? "").split(",").map((value) => value.trim()).filter(Boolean))).size), hint: "Reported capabilities", icon: Sparkles },
      ];
    case "settings":
      return [
        { label: "Configured", value: String(count((row) => Boolean(String(row.value ?? "").trim()))), hint: "Saved values", icon: CheckCircle2 },
        { label: "Unconfigured", value: String(count((row) => !String(row.value ?? "").trim())), hint: "Needs a value", icon: AlertTriangle },
        { label: "Categories", value: String(new Set(rows.map((row) => String(row.category ?? "")).filter(Boolean)).size), hint: "Settings groups", icon: Settings },
      ];
    default:
      return [
        { label: "Available records", value: String(rows.length), hint: "Current section", icon: Activity },
        { label: "Active statuses", value: String(count((row) => ["active", "ready", "healthy"].includes(status(row)))), hint: "Reported active/ready", icon: CheckCircle2 },
        { label: "Attention needed", value: String(count((row) => ["failed", "error", "degraded", "suspended"].includes(status(row)))), hint: "Reported issues", icon: AlertTriangle },
      ];
  }
}

const pages: Record<string, PageDefinition> = {
  businesses: {
    title: "Tenants",
    description: "Search, onboard, edit, suspend, and reactivate platform tenants.",
    collection: "businesses",
    columns: [
      { key: "name", label: "Tenant name", required: true },
      { key: "businessId", label: "Tenant ID", form: false },
      { key: "type", label: "Organization type", form: false },
      { key: "email", label: "Owner email", type: "email", required: true },
      { key: "contact", label: "Owner" },
      { key: "country", label: "Country", required: true },
      { key: "phoneNumbers", label: "Phone number", type: "tel" },
      { key: "plan", label: "Subscription plan", required: true },
      { key: "operators", label: "Operators", type: "number", form: false },
      { key: "calls", label: "Total calls", type: "number", form: false },
      { key: "status", label: "Account status", form: false },
      { key: "registrationDate", label: "Registration date", type: "date", form: false },
    ],
    modules: [
      "All tenants",
      "Onboarding",
      "Active tenants",
      "Suspended tenants",
      "Tenant memberships",
      "Tenant usage",
    ],
  },
  users: {
    title: "Platform Users",
    description: "View the users registered across the platform and their tenant workspaces.",
    collection: "users",
    columns: [
      { key: "name", label: "User name", required: true },
      { key: "email", label: "Email", type: "email", required: true },
      { key: "business", label: "Tenant / workspace", form: false },
      { key: "role", label: "Role", form: false },
      { key: "status", label: "Account status", form: false },
      { key: "lastLogin", label: "Last login", type: "date", form: false },
    ],
    modules: [
      "All users",
      "Superadmins",
      "Business administrators",
      "Operators",
      "Tenant memberships",
      "Roles & permissions",
      "Access sessions",
    ],
  },
  telephony: {
    title: "Telephony Infrastructure",
    description: "Keep an inventory of providers and telephony configuration records.",
    collection: "telephony",
    columns: [
      { key: "kind", label: "Record type (provider, web, or number)", required: true },
      { key: "name", label: "Provider / number", required: true },
      { key: "type", label: "Provider or number type" },
      { key: "country", label: "Country" },
      { key: "environment", label: "Environment" },
      { key: "capabilities", label: "Capabilities" },
      { key: "business", label: "Assigned business" },
      { key: "status", label: "Allocation / connection status" },
    ],
    modules: [
      "Provider management",
      "Provider credentials (never store secrets here)",
      "Phone number inventory",
      "Number allocation",
      "SIP trunks",
      "Webhooks",
      "Routing configuration",
      "Provider monitoring",
      "Usage & costs",
    ],
  },
  ivr: {
    title: "IVR Platform Management",
    description: "Catalog IVR templates and supported platform workflow capabilities.",
    collection: "ivr",
    columns: [
      { key: "name", label: "Template or node", required: true },
      { key: "category", label: "Category" },
      { key: "version", label: "Version" },
      { key: "tenantAvailability", label: "Business availability" },
      { key: "executionStatus", label: "Execution support" },
      { key: "status", label: "Status" },
    ],
    modules: [
      "Global IVR templates",
      "Node library",
      "Supported node types",
      "Execution engine",
      "Simulation infrastructure",
      "Platform flow monitoring",
      "Node version management",
    ],
  },
  subscriptions: {
    title: "Plans & Subscriptions",
    description:
      "Maintain plan and subscription records.",
    collection: "subscriptions",
    columns: [
      { key: "business", label: "Business", required: true },
      { key: "plan", label: "Plan", required: true },
      { key: "billingCycle", label: "Billing cycle" },
      { key: "monthlyPrice", label: "Monthly price", type: "number" },
      { key: "includedMinutes", label: "Included minutes", type: "number" },
      { key: "operators", label: "Operator limit", type: "number" },
      { key: "renewalDate", label: "Renewal date", type: "date" },
      { key: "status", label: "Status" },
    ],
    modules: [
      "Subscription plans",
      "Create plan",
      "All subscriptions",
      "Trial accounts",
      "Expired subscriptions",
      "Usage limits",
      "Discounts & promotions",
    ],
  },
  finance: {
    title: "Finance & Revenue",
    description:
      "Track financial records.",
    collection: "finance",
    columns: [
      { key: "transactionId", label: "Transaction / invoice ID", required: true },
      { key: "business", label: "Business" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "currency", label: "Currency" },
      { key: "provider", label: "Payment provider" },
      { key: "reference", label: "Reference" },
      { key: "date", label: "Date", type: "date" },
      { key: "status", label: "Status" },
    ],
    modules: [
      "Financial overview",
      "Transactions",
      "Business payments",
      "Invoices",
      "Revenue reports",
      "Provider costs",
      "Usage billing",
      "Refunds & adjustments",
    ],
  },
  billing: {
    title: "Subscriptions & Billing",
    description: "Manage subscription plans, invoices, revenue, and payment status.",
    collection: "finance",
    columns: [
      { key: "transactionId", label: "Invoice / transaction ID", required: true },
      { key: "business", label: "Tenant" },
      { key: "plan", label: "Plan" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "currency", label: "Currency" },
      { key: "provider", label: "Payment provider" },
      { key: "date", label: "Invoice date", type: "date" },
      { key: "status", label: "Payment status" },
    ],
    modules: ["Subscription plans", "Invoices", "Payment status", "Usage limits", "Failed payments", "Billing history"],
  },
  "ai-usage": {
    title: "AI & Usage",
    description: "Review transcription, summary, provider usage, limits, and failed jobs.",
    collection: "aiUsage",
    columns: [
      { key: "business", label: "Tenant", required: true },
      { key: "provider", label: "Provider" },
      { key: "period", label: "Reporting period" },
      { key: "transcriptionMinutes", label: "Transcription minutes", type: "number" },
      { key: "summaryJobs", label: "Summary jobs", type: "number" },
      { key: "aiCost", label: "AI cost", type: "number" },
      { key: "failedJobs", label: "Failed jobs", type: "number" },
      { key: "status", label: "Status" },
    ],
    modules: ["Provider configuration", "Usage by tenant", "Processing queue", "Failed jobs", "Usage limits", "Cost reporting"],
  },
  monitoring: {
    title: "Platform Monitoring",
    description:
      "Review call and service records.",
    collection: "monitoring",
    columns: [
      { key: "callId", label: "Call / execution ID", required: true },
      { key: "business", label: "Business" },
      { key: "phone", label: "Phone number (masked)" },
      { key: "direction", label: "Direction" },
      { key: "provider", label: "Provider" },
      { key: "status", label: "Status" },
      { key: "flow", label: "IVR flow" },
      { key: "department", label: "Department" },
      { key: "operator", label: "Operator" },
      { key: "duration", label: "Duration" },
      { key: "startedAt", label: "Started at", type: "date" },
    ],
    modules: [
      "Live calls monitor",
      "Active IVR executions",
      "Call failures",
      "Queue monitoring",
      "API monitoring",
      "Background jobs",
      "WebSocket monitoring",
      "System logs",
      "Error tracking",
    ],
  },
  health: {
    title: "Platform Health",
    description: "Review service checks, background jobs, storage, and active incidents.",
    collection: "health",
    columns: [
      { key: "service", label: "Service", required: true },
      { key: "status", label: "Health status" },
      { key: "lastCheck", label: "Last checked", type: "date" },
      { key: "latency", label: "Latency (ms)", type: "number" },
      { key: "failureCount", label: "Processing failures", type: "number" },
      { key: "incident", label: "Incident" },
    ],
    modules: ["Service checks", "Background jobs", "Processing failures", "Storage availability", "Incidents", "Maintenance windows"],
  },
  integrations: {
    title: "Integrations & APIs",
    description:
      "Maintain a registry of integrations and provider connections.",
    collection: "integrations",
    columns: [
      { key: "name", label: "Integration", required: true },
      { key: "provider", label: "Provider" },
      { key: "category", label: "Category" },
      { key: "capabilities", label: "Capabilities" },
      { key: "connectedBusinesses", label: "Businesses" },
      { key: "lastHealthCheck", label: "Last health check", type: "date" },
      { key: "status", label: "Status" },
    ],
    modules: [
      "API management",
      "API documentation",
      "Webhook management",
      "SMS providers",
      "AI providers",
      "Payment providers",
      "External integrations",
    ],
  },
  security: {
    title: "Security & Access",
    description: "Manage platform administrator access, authentication policies, and sessions.",
    collection: "security",
    columns: [
      { key: "event", label: "Event", required: true },
      { key: "actor", label: "Actor" },
      { key: "resource", label: "Resource" },
      { key: "business", label: "Business" },
      { key: "ip", label: "Source IP" },
      { key: "result", label: "Result" },
      { key: "requestId", label: "Request ID" },
      { key: "timestamp", label: "Timestamp", type: "date" },
    ],
    modules: [
      "Administrator access",
      "Authentication policies",
      "Session revocation",
      "Access reviews",
      "Suspicious activity",
      "Support access controls",
    ],
  },
  "audit-logs": {
    title: "Audit Logs",
    description: "Search administrative activity by actor, action, resource, tenant, and result.",
    collection: "auditLogs",
    columns: [
      { key: "actor", label: "Actor", required: true },
      { key: "action", label: "Action", required: true },
      { key: "resource", label: "Affected resource" },
      { key: "business", label: "Tenant" },
      { key: "timestamp", label: "Timestamp", type: "date" },
      { key: "result", label: "Result" },
    ],
    modules: ["Administrative activity", "Tenant scope", "Security events", "Export history"],
  },
  support: {
    title: "Support",
    description:
      "Track support tickets and maintenance records.",
    collection: "support",
    columns: [
      { key: "ticketId", label: "Ticket ID", required: true },
      { key: "business", label: "Tenant" },
      { key: "requester", label: "Requester" },
      { key: "category", label: "Category" },
      { key: "subject", label: "Subject", required: true },
      { key: "description", label: "Conversation" },
      { key: "priority", label: "Priority" },
      { key: "assignedAdmin", label: "Assigned administrator" },
      { key: "status", label: "Status" },
      { key: "internalNote", label: "Internal note" },
      { key: "created", label: "Created", type: "date" },
      { key: "updated", label: "Last updated", type: "date" },
    ],
    modules: [
      "Support tickets",
      "Business requests",
      "Incident management",
      "Service status",
      "Maintenance windows",
      "Authorized support sessions",
    ],
  },
  feedback: {
    title: "Feedback",
    description: "Review suggestions, bugs, feature requests, and administrative responses.",
    collection: "feedback",
    columns: [
      { key: "business", label: "Tenant" },
      { key: "submitter", label: "Submitter" },
      { key: "category", label: "Category" },
      { key: "description", label: "Description", required: true },
      { key: "status", label: "Status" },
      { key: "adminResponse", label: "Administrative response" },
    ],
    modules: ["Suggestions", "Bug reports", "Feature requests", "Related tickets", "Response queue"],
  },
  announcements: {
    title: "Announcements",
    description: "Draft, preview, schedule, and publish platform or tenant-targeted notices.",
    collection: "announcements",
    columns: [
      { key: "title", label: "Title", required: true },
      { key: "body", label: "Message", required: true },
      { key: "audience", label: "Tenant audience", required: true },
      { key: "business", label: "Target tenant", form: false },
      { key: "status", label: "Status", form: false },
      { key: "publishAt", label: "Publish at", type: "date", form: false },
    ],
    modules: ["Drafts", "Preview", "Scheduled publication", "Publication history", "Delivery status"],
  },
  settings: {
    title: "Platform Settings",
    description:
      "Manage persisted platform configuration values and their status.",
    collection: "settings",
    columns: [
      { key: "setting", label: "Setting", required: true },
      { key: "category", label: "Category" },
      { key: "value", label: "Value" },
      { key: "updated", label: "Updated", type: "date", form: false },
      { key: "status", label: "Status" },
    ],
    modules: [
      "General settings",
      "Platform branding",
      "Email configuration",
      "Notification configuration",
      "Feature flags",
      "System configuration",
      "Backup & recovery",
    ],
  },
};

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  fontSize: 12,
};

function PlatformSection() {
  const { section } = Route.useParams();
  const [store, setStore] = useState<PlatformStore>({ version: 2, collections: {}, activity: [] });
  const [loaded, setLoaded] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [editing, setEditing] = useState<PlatformRecord | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<PlatformRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformRecord | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [userTenantFilter, setUserTenantFilter] = useState("all");
  const [userStatusFilter, setUserStatusFilter] = useState("all");
  const [userLoginFilter, setUserLoginFilter] = useState("all");
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const definition = pages[section];
  const formFields = definition?.columns.filter((field) => field.form !== false) ?? [];

  const refresh = async () => {
    try {
      const response = await apiGet<{ data: { collections: Record<string, PlatformRecord[]>; activity: PlatformStore["activity"] } }>("platform/data");
      setStore({ version: 2, collections: response.data.collections ?? {}, activity: response.data.activity ?? [] });
      if (section === "announcements") {
        const tenantsResponse = await apiGet<{ data: TenantOption[] }>("tenants");
        setTenantOptions(Array.isArray(tenantsResponse.data) ? tenantsResponse.data : []);
      }
      setStorageError("");
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : "Platform API unavailable");
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    if (section === "settings") return;
    void refresh();
  }, [section]);

  const rows = definition ? (store.collections[definition.collection] ?? []) : [];
  const meta = sectionMeta[section] ?? {
    actionLabel: "Add record",
    panelTitle: definition?.title ?? "Records",
    searchPlaceholder: "Search records…",
    emptyBody: "Available records will appear here when connected.",
  };
  const measuredCollection = definition?.collection === "finance" || definition?.collection === "monitoring";
  const metrics = sectionMetrics(section, rows);
  const userTenantOptions = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.business ?? row.tenantName ?? row.tenantId ?? "")).filter(Boolean))).sort(),
    [rows],
  );
  const userDirectoryRows = useMemo(() => {
    if (section !== "users") return rows;
    const now = Date.now();
    return rows.filter((row) => {
      const tenant = String(row.business ?? row.tenantName ?? row.tenantId ?? "");
      const status = String(row.status ?? "").toLowerCase();
      const lastLogin = Date.parse(String(row.lastLogin ?? ""));
      const tenantMatches = userTenantFilter === "all" || tenant === userTenantFilter;
      const statusMatches = userStatusFilter === "all" || status === userStatusFilter;
      const loginMatches = userLoginFilter === "all"
        || (userLoginFilter === "Never signed in" && !Number.isFinite(lastLogin))
        || (userLoginFilter === "Last 7 days" && Number.isFinite(lastLogin) && lastLogin >= now - 7 * 24 * 60 * 60 * 1000)
        || (userLoginFilter === "Last 30 days" && Number.isFinite(lastLogin) && lastLogin >= now - 30 * 24 * 60 * 60 * 1000);
      return tenantMatches && statusMatches && loginMatches;
    });
  }, [rows, section, userLoginFilter, userStatusFilter, userTenantFilter]);
  const beginCreate = () => {
    setEditing(null);
    setForm(Object.fromEntries(formFields.map((field) => [
      field.key,
      section === "settings" && field.key === "status"
        ? "active"
        : section === "announcements" && field.key === "audience"
          ? "all"
          : "",
    ])));
    setDialogOpen(true);
  };
  const beginEdit = (record: PlatformRecord) => {
    setEditing(record);
    setForm(
      Object.fromEntries(
        formFields.map((field) => [field.key, String(record[field.key] ?? "")]),
      ),
    );
    setDialogOpen(true);
  };
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!definition) return;
    const values: Record<string, PlatformValue> = {};
    for (const field of formFields) {
      const value = form[field.key]?.trim() ?? "";
      if (field.required && !value) {
        toast.error(`${field.label} is required`);
        return;
      }
      if (field.type === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) {
        toast.error(`Enter a valid ${field.label.toLowerCase()}`);
        return;
      }
      if (field.type === "number" && value && !Number.isFinite(Number(value))) {
        toast.error(`${field.label} must be a number`);
        return;
      }
      values[field.key] = field.type === "number" && value ? Number(value) : value;
    }
    try {
      const response = editing
        ? await apiPatch<{ data: PlatformRecord }>(`platform/${definition.collection}/${editing.id}`, values)
        : await apiPost<{ data: PlatformRecord }>(`platform/${definition.collection}`, values);
      const next = { ...store, collections: { ...store.collections, [definition.collection]: editing ? (store.collections[definition.collection] ?? []).map((row) => row.id === editing.id ? response.data : row) : [response.data, ...(store.collections[definition.collection] ?? [])] } };
      setStore(next);
      setDialogOpen(false);
      toast.success(editing ? "Record updated" : "Record added");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Record was not saved");
    }
  };

  if (section === "dashboard")
    return (
      <PlatformDashboard
        store={store}
        loaded={loaded}
          onRefresh={() => { void refresh(); }}
      />
    );
  if (section === "ai-usage")
    return (
      <AiUsagePage
        store={store}
        loaded={loaded}
      />
    );
  if (section === "telephony") return <TelephonyPage store={store} onRefresh={() => { void refresh(); }} />;
  if (section === "limits") return <PlatformLimitsPage store={store} onRefresh={() => { void refresh(); }} />;
  if (section === "security") return <SecurityAccessPage store={store} />;
  if (section === "audit-logs") return <AuditLogsPage store={store} />;
  if (section === "health") return <PlatformHealthPage store={store} />;
  if (section === "settings") return <PlatformSettingsPage />;
  if (!definition)
    return (
      <SuperAdminShell>
        <PageHeader
          title="Page not found"
          description="Choose a platform section from the sidebar."
        />
      </SuperAdminShell>
    );

  const columns: Column<Row>[] = [
    ...definition.columns.map((field) => ({
      id: field.key,
      header: field.label,
      sortValue: (record: Row) => record[field.key] ?? "",
      cell: (record: Row) =>
        field.key.toLowerCase() === "status" || field.key.toLowerCase() === "result" ? (
          <StatusBadge status={String(record[field.key] ?? "Not set")} />
        ) : (
          <span className={field === definition.columns[0] ? "font-medium" : undefined}>
            {field.key === "lastLogin"
              ? (record[field.key] ? new Date(String(record[field.key])).toLocaleString() : "Never signed in")
              : section === "announcements" && field.key === "audience"
                ? (record.business ?? (record.audience === "all" ? "All tenants" : record.audience ?? "—"))
              : field.key === "business"
                ? (record.business ?? record.tenantName ?? record.tenantId ?? "—")
                : record[field.key] ?? "—"}
          </span>
        ),
    })),
    {
      id: "actions",
      header: "Actions",
      cell: (record) => (
        <div data-print-hide className="flex items-center gap-1">
          {(section === "users" || section === "support" || section === "feedback" || measuredCollection) && (
            <Button size="icon" variant="ghost" className="h-8 w-8" title="View details" aria-label="View details" onClick={() => setDetailRow(record)}>
              <Eye className="h-4 w-4" />
            </Button>
          )}
          {section !== "support" && section !== "feedback" && !measuredCollection && (
            <>
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Edit" aria-label="Edit" onClick={() => beginEdit(record)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" aria-label="Delete" onClick={() => setDeleteTarget(record)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];
  return (
    <SuperAdminShell>
      <nav data-print-hide aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link to="/platform/dashboard" className="hover:text-foreground">
          Platform
        </Link>
        <span className="mx-2">/</span>
        <span aria-current="page" className="text-foreground">
          {definition.title}
        </span>
      </nav>
      <PageHeader
        title={definition.title}
        description={definition.description}
        actions={meta.showAction === false ? undefined : (
          meta.actionHref ? (
            <Button asChild><Link to={meta.actionHref as any}>{meta.actionLabel}</Link></Button>
          ) : (
            <Button
              onClick={beginCreate}
              size={section === "announcements" ? "icon" : "default"}
              aria-label={section === "announcements" ? "Create announcement" : undefined}
              title={section === "announcements" ? "Create announcement" : undefined}
            >
              {section === "announcements" ? <Megaphone className="h-4 w-4" /> : <><Plus className="h-4 w-4" />{meta.actionLabel}</>}
            </Button>
          )
        )}
      />
      {storageError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/30 bg-danger-soft px-4 py-3 text-sm text-destructive"
        >
          {storageError}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        {metrics.map((metric) => <KpiCard key={metric.label} label={metric.label} value={loaded ? metric.value : "—"} icon={metric.icon} hint={metric.hint} />)}
      </div>
      <Panel
        title={meta.panelTitle}
        action={<span className="text-xs text-muted-foreground">{section === "users" && userDirectoryRows.length !== rows.length ? `${userDirectoryRows.length} of ${rows.length}` : `${rows.length} total`}</span>}
      >
        {rows.length ? (
          <DataTable
            label={definition.title}
            rows={userDirectoryRows}
            columns={columns}
            rowKey={(row) => row.id}
            searchText={(row) => Object.values(row).join(" ")}
            searchPlaceholder={meta.searchPlaceholder}
            toolbar={section === "users" ? <>
              <FilterSelect label="Tenant" allLabel="All tenants" value={userTenantFilter} onChange={setUserTenantFilter} options={userTenantOptions} />
              <FilterSelect label="Status" allLabel="All statuses" value={userStatusFilter} onChange={setUserStatusFilter} options={Array.from(new Set(rows.map((row) => String(row.status ?? "").toLowerCase()).filter(Boolean))).sort()} />
              <FilterSelect label="Last sign-in" allLabel="All last sign-ins" value={userLoginFilter} onChange={setUserLoginFilter} options={["Last 7 days", "Last 30 days", "Never signed in"]} />
            </> : undefined}
          />
        ) : (
          <EmptyState
            title={`No ${definition.title.toLowerCase()} data available`}
            body={meta.emptyBody}
            action={meta.showAction === false || measuredCollection ? undefined : <Button
              onClick={beginCreate}
              size={section === "announcements" ? "icon" : "default"}
              aria-label={section === "announcements" ? "Create announcement" : undefined}
              title={section === "announcements" ? "Create announcement" : undefined}
            >
              {section === "announcements" ? <Megaphone className="h-4 w-4" /> : <><Plus className="h-4 w-4" />{meta.actionLabel}</>}
            </Button>}
          />
        )}
      </Panel>
      {section !== "users" && <Panel title="Workspace capabilities">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {definition.modules.map((module) => (
              <div key={module} className="surface-recessed rounded-[16px] px-3 py-2.5 text-sm">
                {module}
              </div>
            ))}
          </div>
        </Panel>}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
          <DialogTitle>
            {editing
              ? section === "announcements" ? "Edit announcement" : "Edit record"
              : section === "announcements" ? "Create announcement" : section === "settings" ? "Add setting" : "Add record"}
          </DialogTitle>
            <DialogDescription>Review your changes before saving.</DialogDescription>
          </DialogHeader>
          <form
            id="platform-record-form"
            onSubmit={submit}
            className={section === "announcements" ? "grid gap-4 py-2" : "grid gap-4 py-2 sm:grid-cols-2"}
          >
            {formFields.map((field) => (
              <div key={field.key} className="space-y-1.5">
                <Label htmlFor={`record-${field.key}`}>
                  {field.label}
                  {field.required ? " *" : ""}
                </Label>
                {section === "businesses" && field.key === "country" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" className="h-10 w-full justify-start transition-[transform,background-color] duration-200 data-[state=open]:scale-[1.01]">
                        {form[field.key] || "Select country"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)]">
                      {telephonyCountries.map(([code, label]) => (
                        <DropdownMenuItem key={code} onSelect={() => setForm((current) => {
                          const dialCode = countryDialCodes[label];
                          const previousDialCode = countryDialCodes[current.country] ?? "";
                          const currentNumber = String(current.phoneNumbers ?? "").trim();
                          const nationalNumber = previousDialCode && currentNumber.startsWith(previousDialCode)
                            ? currentNumber.slice(previousDialCode.length).replace(/\D/g, "")
                            : currentNumber.replace(/^\+\d*/, "").replace(/\D/g, "");
                          return { ...current, country: label, phoneNumbers: nationalNumber ? `${dialCode}${nationalNumber}` : dialCode };
                        })}>
                          {label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : section === "businesses" && field.key === "plan" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" className="h-10 w-full justify-start transition-[transform,background-color] duration-200 data-[state=open]:scale-[1.01]">
                        {form[field.key] || "Select subscription plan"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuRadioGroup
                        value={form[field.key] ?? ""}
                        onValueChange={(value) => setForm((current) => ({ ...current, plan: value }))}
                      >
                        {tenantPlanOptions.map((plan) => (
                          <DropdownMenuRadioItem key={plan} value={plan} className="transition-colors duration-200">
                            {plan}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : section === "announcements" && field.key === "body" ? (
                  <Textarea
                    id={`record-${field.key}`}
                    required={field.required}
                    value={form[field.key] ?? ""}
                    rows={8}
                    placeholder="Write the announcement message…"
                    className="min-h-40 resize-y"
                    onChange={(event) => setForm((current) => ({ ...current, [field.key]: event.target.value }))}
                  />
                ) : section === "announcements" && field.key === "audience" ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="outline" className="h-10 w-full justify-start transition-[transform,background-color] duration-200 data-[state=open]:scale-[1.01]">
                        {form[field.key] === "all"
                          ? "All tenants"
                          : tenantOptions.find((tenant) => tenant.id === form[field.key])?.name || "Select tenant"}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)]">
                      <DropdownMenuRadioGroup
                        value={form[field.key] ?? ""}
                        onValueChange={(value) => setForm((current) => ({ ...current, audience: value }))}
                      >
                        <DropdownMenuRadioItem value="all" className="transition-colors duration-200">
                          All tenants
                        </DropdownMenuRadioItem>
                        {tenantOptions.map((tenant) => (
                          <DropdownMenuRadioItem key={tenant.id} value={tenant.id} className="transition-colors duration-200">
                            {tenant.name}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <Input
                    id={`record-${field.key}`}
                    type={field.type ?? "text"}
                    required={field.required}
                    value={form[field.key] ?? ""}
                    onChange={(event) => setForm((current) => {
                      if (section !== "businesses" || field.key !== "phoneNumbers") return { ...current, [field.key]: event.target.value };
                      const dialCode = countryDialCodes[current.country] ?? "";
                      const entered = event.target.value.replace(/[^\d+]/g, "");
                      if (!dialCode) return { ...current, phoneNumbers: entered };
                      const nationalNumber = entered.startsWith(dialCode)
                        ? entered.slice(dialCode.length).replace(/\D/g, "")
                        : entered.replace(/^\+\d*/, "").replace(/\D/g, "");
                      return { ...current, phoneNumbers: `${dialCode}${nationalNumber}` };
                    })}
                  />
                )}
              </div>
            ))}
          </form>
          <DialogFooter>
            <Button type="submit" form="platform-record-form">
              {editing ? "Save changes" : section === "announcements" ? "Create announcement" : section === "settings" ? "Add setting" : "Add record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Sheet open={Boolean(detailRow)} onOpenChange={(open) => { if (!open) setDetailRow(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{definition.title} details</SheetTitle>
            <SheetDescription>
              Review the complete record without leaving this page.
            </SheetDescription>
          </SheetHeader>
          {detailRow && (
            <div className="grid gap-3 py-6 sm:grid-cols-2">
              {definition.columns.map((field) => {
                const value = detailRow[field.key];
                return (
                  <div key={field.key} className="surface-recessed rounded-xl px-3 py-2.5">
                    <div className="text-xs font-medium text-muted-foreground">{field.label}</div>
                    <div className="mt-1 text-sm font-medium text-foreground">
                      {field.key.toLowerCase() === "status" || field.key.toLowerCase() === "result" ? (
                        <StatusBadge status={String(value ?? "Not set")} />
                  ) : field.key === "amount" ? (
                    `${Number(value ?? 0).toLocaleString()} ${String(detailRow.currency ?? "")}`.trim()
                  ) : section === "announcements" && field.key === "audience" ? (
                    String(detailRow.business ?? (value === "all" ? "All tenants" : value ?? "Not established"))
                  ) : (
                        field.key === "lastLogin" ? (value ? new Date(String(value)).toLocaleString() : "Never signed in") : String(value ?? "Not established")
                      )}
                    </div>
                  </div>
                );
              })}
              <div className="surface-recessed rounded-xl px-3 py-2.5">
                <div className="text-xs font-medium text-muted-foreground">Created</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {(() => {
                    const createdAt = detailRow.createdAt ?? detailRow.tenantCreatedAt;
                    return createdAt ? new Date(String(createdAt)).toLocaleString() : "Not established";
                  })()}
                </div>
              </div>
              <div className="surface-recessed rounded-xl px-3 py-2.5">
                <div className="text-xs font-medium text-muted-foreground">Last updated</div>
                <div className="mt-1 text-sm font-medium text-foreground">
                  {(() => {
                    const updatedAt = detailRow.updatedAt ?? detailRow.tenantUpdatedAt ?? detailRow.createdAt ?? detailRow.tenantCreatedAt;
                    return updatedAt ? new Date(String(updatedAt)).toLocaleString() : "Not established";
                  })()}
                </div>
              </div>
            </div>
          )}
          <SheetFooter>
            <Button variant="outline" onClick={() => setDetailRow(null)}>Close</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {definition.title.toLowerCase()} record?</DialogTitle>
            <DialogDescription>
              This removes the selected record from this local platform workspace and writes an audit event. This action cannot be undone here.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="surface-recessed rounded-xl px-3 py-2.5 text-sm text-foreground">
              <span className="text-muted-foreground">Selected record: </span>
              {String(deleteTarget.name ?? deleteTarget.title ?? deleteTarget.service ?? deleteTarget.business ?? deleteTarget.email ?? deleteTarget.transactionId ?? deleteTarget.id)}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return;
                try {
                  await apiDelete(`platform/${definition.collection}/${deleteTarget.id}`);
                  setStore((current) => ({ ...current, collections: { ...current.collections, [definition.collection]: (current.collections[definition.collection] ?? []).filter((row) => row.id !== deleteTarget.id) } }));
                  setDeleteTarget(null);
                  toast.success("Record deleted");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Record was not deleted");
                }
              }}
            >
              Delete record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminShell>
  );
}

type PlatformConfiguration = {
  general: { platformName: string; supportEmail: string };
  operations: { allowRegistration: boolean };
  locale: { defaultCountry: string; defaultTimezone: string };
};

type PlatformSettingsResponse = {
  configuration: PlatformConfiguration;
  provider: { name: string; configured: boolean; environment: string; credentialsManagedBy: string };
};

const emptyPlatformConfiguration: PlatformConfiguration = {
  general: { platformName: "", supportEmail: "" },
  operations: { allowRegistration: true },
  locale: { defaultCountry: "Tanzania", defaultTimezone: "Africa/Dar_es_Salaam" },
};

function PlatformSettingsPage() {
  const [configuration, setConfiguration] = useState<PlatformConfiguration>(emptyPlatformConfiguration);
  const [provider, setProvider] = useState<PlatformSettingsResponse["provider"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void apiGet<{ data: PlatformSettingsResponse }>("platform/settings")
      .then((response) => {
        if (!active) return;
        setConfiguration({ ...emptyPlatformConfiguration, ...response.data.configuration });
        setProvider(response.data.provider);
        setError("");
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Platform settings are unavailable");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const saveSection = async (section: keyof PlatformConfiguration) => {
    setSaving(section);
    try {
      const response = await apiPut<{ data: PlatformSettingsResponse }>("platform/settings", { section, values: configuration[section] });
      setConfiguration(response.data.configuration);
      setProvider(response.data.provider);
      toast.success("Platform settings saved");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Platform settings were not saved");
    } finally {
      setSaving(null);
    }
  };

  return (
    <SuperAdminShell>
      <PageHeader title="Platform Settings" description="Manage the application-wide configuration used by every tenant. Provider credentials remain server-managed." />
      {error && <div role="alert" className="rounded-md border border-destructive/30 bg-danger-soft px-4 py-3 text-sm text-destructive">{error}</div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Project identity" action={<Button size="sm" onClick={() => { void saveSection("general"); }} disabled={saving !== null || loading}><Save className="h-3.5 w-3.5" />{saving === "general" ? "Saving…" : "Save"}</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="platform-name">Platform name</Label><Input id="platform-name" value={configuration.general.platformName} onChange={(event) => setConfiguration((current) => ({ ...current, general: { ...current.general, platformName: event.target.value } }))} /></div>
            <div className="grid gap-1.5 sm:col-span-2"><Label htmlFor="platform-support-email">Support email</Label><Input id="platform-support-email" type="email" value={configuration.general.supportEmail} onChange={(event) => setConfiguration((current) => ({ ...current, general: { ...current.general, supportEmail: event.target.value } }))} placeholder="support@example.com" /></div>
          </div>
        </Panel>

        <Panel title="Operations" action={<Button size="sm" onClick={() => { void saveSection("operations"); }} disabled={saving !== null || loading}><Save className="h-3.5 w-3.5" />{saving === "operations" ? "Saving…" : "Save"}</Button>}>
          <div className="flex items-start justify-between gap-4 border-b border-border py-3">
            <div><Label htmlFor="allow-registration">Allow new registrations</Label><p className="text-xs text-muted-foreground">Controls whether new platform accounts can be created.</p></div>
            <Switch id="allow-registration" checked={configuration.operations.allowRegistration} onCheckedChange={(checked) => setConfiguration((current) => ({ ...current, operations: { ...current.operations, allowRegistration: checked } }))} />
          </div>
        </Panel>

        <Panel title="Default locale" action={<Button size="sm" onClick={() => { void saveSection("locale"); }} disabled={saving !== null || loading}><Save className="h-3.5 w-3.5" />{saving === "locale" ? "Saving…" : "Save"}</Button>}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5"><Label htmlFor="platform-country">Default country</Label><Input id="platform-country" value={configuration.locale.defaultCountry} onChange={(event) => setConfiguration((current) => ({ ...current, locale: { ...current.locale, defaultCountry: event.target.value } }))} /></div>
            <div className="grid gap-1.5"><Label htmlFor="platform-timezone">Default timezone</Label><Input id="platform-timezone" value={configuration.locale.defaultTimezone} onChange={(event) => setConfiguration((current) => ({ ...current, locale: { ...current.locale, defaultTimezone: event.target.value } }))} placeholder="Africa/Dar_es_Salaam" /></div>
          </div>
        </Panel>

        <Panel title="Provider configuration" action={provider ? <StatusBadge status={provider.configured ? "Configured" : "Unavailable"} /> : undefined}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Voice and messaging provider</span><span className="font-medium">{provider?.name ?? "Loading…"}</span></div>
            <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">Environment</span><span className="font-medium capitalize">{provider?.environment ?? "—"}</span></div>
          </div>
        </Panel>
      </div>
    </SuperAdminShell>
  );
}

type TelephonyConfig = {
  provider: { name: string; configured: boolean; missing: string[]; environment: string };
  webhooks: { callbackUrl: string; eventsUrl: string; publicBase: string };
  tenant: { id: string; name: string };
};

type TelephonyForm = {
  kind: "web" | "number";
  name: string;
  country: string;
  tenantId: string;
  routing: "phone" | "web" | "all";
};

type TelephonyTenant = { id: string; name: string };

const telephonyCountries = [
  ["TZ", "Tanzania"], ["KE", "Kenya"], ["UG", "Uganda"], ["RW", "Rwanda"],
  ["BI", "Burundi"], ["ET", "Ethiopia"], ["GH", "Ghana"], ["NG", "Nigeria"],
  ["ZA", "South Africa"], ["ZM", "Zambia"], ["ZW", "Zimbabwe"], ["MW", "Malawi"],
  ["MZ", "Mozambique"], ["CD", "Democratic Republic of the Congo"], ["SO", "Somalia"],
  ["SN", "Senegal"], ["CI", "Côte d’Ivoire"], ["CM", "Cameroon"], ["EG", "Egypt"],
  ["GB", "United Kingdom"], ["US", "United States"],
] as const;

const countryDialCodes: Record<string, string> = {
  Tanzania: "+255",
  Kenya: "+254",
  Uganda: "+256",
  Rwanda: "+250",
  Burundi: "+257",
  Ethiopia: "+251",
  Ghana: "+233",
  Nigeria: "+234",
  "South Africa": "+27",
  Zambia: "+260",
  Zimbabwe: "+263",
  Malawi: "+265",
  Mozambique: "+258",
  "Democratic Republic of the Congo": "+243",
  Somalia: "+252",
  Senegal: "+221",
  "Côte d’Ivoire": "+225",
  Cameroon: "+237",
  Egypt: "+20",
  "United Kingdom": "+44",
  "United States": "+1",
};

function TelephonyPage({ store, onRefresh }: { store: PlatformStore; onRefresh: () => void }) {
  const [config, setConfig] = useState<TelephonyConfig | null>(null);
  const [configError, setConfigError] = useState("");
  const [tenants, setTenants] = useState<TelephonyTenant[]>([]);
  const [copiedLabel, setCopiedLabel] = useState("");
  const [editing, setEditing] = useState<PlatformRecord | null>(null);
  const [form, setForm] = useState<TelephonyForm>(() => emptyTelephonyForm("number"));
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [recordFilter, setRecordFilter] = useState<"all" | "web" | "number">("all");
  const records = store.collections.telephony ?? [];
  const providers = records.filter((row) => String(row.kind ?? "").toLowerCase() === "provider");
  const numbers = records.filter((row) => String(row.kind ?? "").toLowerCase() === "number");
  const visibleRecords = records.filter((row) => recordFilter === "all" || (recordFilter === "web" ? String(row.kind ?? "").toLowerCase() === "web" || String(row.type ?? "").toLowerCase().includes("web") : String(row.kind ?? "").toLowerCase() === "number"));

  useEffect(() => {
    void apiGet<{ data: TelephonyConfig }>("platform/telephony/config")
      .then((response) => { setConfig(response.data); setConfigError(""); })
      .catch((error) => setConfigError(error instanceof Error ? error.message : "Telephony configuration is unavailable"));
    void apiGet<{ data?: TelephonyTenant[]; tenants?: TelephonyTenant[] }>("tenants")
      .then((response) => setTenants(response.tenants ?? response.data ?? []))
      .catch((error) => setConfigError(error instanceof Error ? error.message : "Business list is unavailable"));
  }, []);

  function openEditor(kind: "web" | "number", record?: PlatformRecord) {
    setEditing(record ?? null);
    setForm({
      ...emptyTelephonyForm(kind),
      ...(record ? {
        kind,
        name: String(record.name ?? ""),
        country: String(record.country ?? ""),
        tenantId: String(record.tenantId ?? ""),
        routing: record.routing === "phone" || record.routing === "web" || record.routing === "all" ? record.routing : kind === "web" ? "web" : "all",
      } : {}),
    });
    setDialogOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    if (!form.tenantId) { toast.error("Select a business for this telephony record"); return; }
    if (!name) { toast.error(form.kind === "number" ? "Phone number is required" : "Select a web client"); return; }
    if (form.kind === "number" && !/^\+[1-9]\d{7,14}$/.test(name)) {
      toast.error("Use an international phone number, for example +255712345678");
      return;
    }
    if (form.kind === "number" && !form.country) { toast.error("Select the phone number country"); return; }
    const selectedTenant = tenants.find((tenant) => tenant.id === form.tenantId);
    const callbackUrl = config?.webhooks.callbackUrl || String(editing?.callbackUrl ?? "");
    const eventsUrl = config?.webhooks.eventsUrl || String(editing?.eventsUrl ?? "");
    const values: Record<string, PlatformValue> = {
      kind: form.kind,
      name,
      country: form.country.trim(),
      type: form.kind === "number" ? "Voice-enabled virtual number" : "Web client",
      environment: config?.provider.environment || "live",
      capabilities: "voice, events",
      business: selectedTenant?.name || "",
      tenantId: form.tenantId,
      routing: form.kind === "web" ? "web" : form.routing,
      status: String(editing?.status ?? "unconfigured"),
      callbackUrl,
      eventsUrl,
    };
    setSaving(true);
    try {
      let savedId = editing?.id;
      if (editing) {
        await apiPatch(`platform/telephony/${editing.id}`, values);
      } else {
        const response = await apiPost<{ data?: PlatformRecord; record?: PlatformRecord }>("platform/telephony", values);
        savedId = response.data?.id ?? response.record?.id;
      }

      let verificationError = "";
      if (form.kind === "number" && savedId) {
        try {
          await apiPost(`platform/telephony/${savedId}/verify`);
        } catch (error) {
          verificationError = error instanceof Error ? error.message : "Africa’s Talking could not verify this number";
        }
      }

      setDialogOpen(false);
      if (verificationError) {
        toast.error(`Number saved, but provider verification failed: ${verificationError}`);
      } else {
        toast.success(form.kind === "number"
          ? "Number saved and verified with Africa’s Talking"
          : (editing ? "Telephony record updated" : "Telephony record saved"));
      }
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Telephony record was not saved");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    try {
      await apiDelete(`platform/telephony/${deleteTarget.id}`);
      setDeleteTarget(null);
      toast.success("Telephony record removed");
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Telephony record was not removed");
    }
  }

  async function verify(record: PlatformRecord) {
    try {
      await apiPost(`platform/telephony/${record.id}/verify`);
      toast.success(`${record.name} verified with Africa’s Talking`);
      onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Africa’s Talking could not verify this number");
      onRefresh();
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedLabel(label);
      window.setTimeout(() => setCopiedLabel((current) => current === label ? "" : current), 2000);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy ${label.toLowerCase()}`);
    }
  }

  return (
    <SuperAdminShell>
      <nav data-print-hide aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <Link to="/platform/dashboard" className="hover:text-foreground">Platform</Link>
        <span className="mx-2">/</span>
        <span aria-current="page" className="text-foreground">Telephony</span>
      </nav>
      <PageHeader
        title="Telephony"
        description="Configure the Africa’s Talking connection, central webhooks, and tenant phone-number inventory."
        actions={<div className="flex items-center gap-2"><Button size="icon" variant="outline" title="Configure telephony" aria-label="Configure telephony" onClick={() => openEditor("number")}><SlidersHorizontal className="h-4 w-4" /></Button></div>}
      />
      {configError && <div role="alert" className="rounded-md border border-destructive/30 bg-danger-soft px-4 py-3 text-sm text-destructive">{configError}</div>}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Provider records" value={String(providers.length)} icon={Settings} hint="Server-side connection records" />
        <KpiCard label="Phone numbers" value={String(numbers.length)} icon={PhoneCall} hint="Assigned virtual numbers" />
        <KpiCard label="Credentials" value={config?.provider.configured ? "Configured" : "Unavailable"} icon={config?.provider.configured ? CheckCircle2 : AlertTriangle} hint={config?.provider.configured ? `${config.provider.environment} environment` : `Missing ${config?.provider.missing.join(", ") || "server settings"}`} />
      </div>
      <Panel title="Central webhook endpoints" action={<span className="text-xs text-muted-foreground">Use the same URLs for every voice-enabled number</span>}>
        <div className="grid gap-3 lg:grid-cols-2">{[["Voice callback", config?.webhooks.callbackUrl], ["Call events", config?.webhooks.eventsUrl]].map(([label, value]) => { const copied = copiedLabel === label; return <div key={label} className="surface-recessed rounded-[16px] p-3"><div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div><div className="flex items-center gap-2"><code className="min-w-0 flex-1 break-all text-xs text-foreground">{value || "Loading endpoint…"}</code><Button size={copied ? "sm" : "icon"} variant="ghost" title={copied ? "Copied" : `Copy ${label}`} aria-label={copied ? `${label} copied` : `Copy ${label}`} disabled={!value} onClick={() => { if (value) void copy(value, label); }}>{copied ? <><Check className="h-4 w-4" />Copied</> : <Copy className="h-4 w-4" />}</Button></div></div>; })}</div>
      </Panel>
      <Panel title="Telephony inventory" action={<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="sm">Record type: {recordFilter === "all" ? "All" : recordFilter === "web" ? "Web" : "Phone number"}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setRecordFilter("all")}>All</DropdownMenuItem><DropdownMenuItem onSelect={() => setRecordFilter("web")}>Web</DropdownMenuItem><DropdownMenuItem onSelect={() => setRecordFilter("number")}>Phone number</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}>
        {visibleRecords.length ? <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="whitespace-nowrap">Number / client</TableHead>
              <TableHead className="whitespace-nowrap">Verification</TableHead>
              <TableHead className="whitespace-nowrap">Type</TableHead>
              <TableHead className="whitespace-nowrap">Tenant / workspace</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead>Routing</TableHead>
              <TableHead className="min-w-[230px]">Callback URL</TableHead>
              <TableHead className="min-w-[230px]">Events URL</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleRecords.map((record) => {
              const kind = String(record.kind ?? "record").toLowerCase();
              const verificationStatus = String(record.providerVerification?.status ?? record.status ?? "").toLowerCase();
              const verified = verificationStatus === "verified";
              const type = kind === "number" ? "Phone number" : kind === "web" ? "Web client" : String(record.type ?? kind);
              return <TableRow key={record.id}>
                <TableCell className="whitespace-nowrap font-medium">{String(record.name ?? "Not established")}</TableCell>
                <TableCell><StatusBadge status={verified ? "verified" : "unverified"} /></TableCell>
                <TableCell className="whitespace-nowrap">{type}</TableCell>
                <TableCell className="whitespace-nowrap">{String(record.business ?? "Not assigned")}</TableCell>
                <TableCell className="whitespace-nowrap">{String(record.country ?? "Not configured")}</TableCell>
                <TableCell className="whitespace-nowrap capitalize">{String(record.environment ?? "Not configured")}</TableCell>
                <TableCell className="whitespace-nowrap">{String(record.capabilities ?? "Not configured")}</TableCell>
                <TableCell className="whitespace-nowrap capitalize">{String(record.routing ?? "Not configured")}</TableCell>
                <TableCell className="max-w-[300px] break-all text-xs">{String(record.callbackUrl ?? "Not configured")}</TableCell>
                <TableCell className="max-w-[300px] break-all text-xs">{String(record.eventsUrl ?? "Not configured")}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {kind === "number" && <Button size="icon" variant="ghost" title={verified ? "Verified with Africa’s Talking — click to verify again" : "Verify with Africa’s Talking"} aria-label={`Verify ${String(record.name ?? "phone number")} with Africa’s Talking`} onClick={() => { void verify(record); }}>{verified ? <CheckCircle2 className="h-4 w-4 text-success" /> : <RefreshCw className="h-4 w-4" />}</Button>}
                    {["web", "number"].includes(kind) && <Button size="sm" variant="outline" onClick={() => openEditor(kind === "number" ? "number" : "web", record)}>Edit</Button>}
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(record)}>Remove</Button>
                  </div>
                </TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table> : <EmptyState title="No telephony records" body={recordFilter === "all" ? "Use the icon control above to assign a business web client or phone number." : `No ${recordFilter === "web" ? "web" : "phone number"} records are available.`} />}
      </Panel>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{editing ? "Edit telephony record" : form.kind === "web" ? "Add web client" : "Configure telephony"}</DialogTitle><DialogDescription>{form.kind === "web" ? "Select the business client. Africa’s Talking, environment, status, capabilities, and webhook URLs are detected automatically." : "Select the tenant, enter the Africa’s Talking number, choose its country and routing service, then save."}</DialogDescription></DialogHeader>
          <form id="telephony-form" onSubmit={save} className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>Tenant / business *</Label><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="h-10 w-full justify-start truncate" disabled={!tenants.length}>{tenants.find((tenant) => tenant.id === form.tenantId)?.name || (tenants.length ? "Select tenant" : "No tenants available")}</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)]">{tenants.length ? tenants.map((tenant) => <DropdownMenuItem key={tenant.id} onSelect={() => setForm((current) => ({ ...current, tenantId: tenant.id, name: current.kind === "web" ? tenant.name : current.name }))}>{tenant.name}</DropdownMenuItem>) : <DropdownMenuItem disabled>No tenants available</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu></div>
            {form.kind === "number" && <div className="space-y-1.5"><Label htmlFor="telephony-name">Phone number *</Label><Input id="telephony-name" type="tel" placeholder="+255712345678" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>}
            {form.kind === "number" && <div className="space-y-1.5"><Label>Country *</Label><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="h-10 w-full justify-start">{form.country || "Select country"}</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="max-h-64 w-[var(--radix-dropdown-menu-trigger-width)]">{telephonyCountries.map(([code, label]) => <DropdownMenuItem key={code} onSelect={() => setForm((current) => ({ ...current, country: label }))}>{label}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div>}
            {form.kind === "number" && <div className="space-y-1.5"><Label>Routing service *</Label><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" className="h-10 w-full justify-start">{form.routing === "phone" ? "Phone number" : form.routing === "web" ? "Web" : "All"}</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]"><DropdownMenuItem onSelect={() => setForm((current) => ({ ...current, routing: "phone" }))}>Phone number</DropdownMenuItem><DropdownMenuItem onSelect={() => setForm((current) => ({ ...current, routing: "web" }))}>Web</DropdownMenuItem><DropdownMenuItem onSelect={() => setForm((current) => ({ ...current, routing: "all" }))}>All</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>}
          </form>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="submit" form="telephony-form" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Save record"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Remove telephony record?</DialogTitle><DialogDescription>This removes only the MPANGE inventory record. It does not release or delete the number in Africa’s Talking.</DialogDescription></DialogHeader><p className="surface-recessed rounded-xl px-3 py-2.5 text-sm">{deleteTarget?.name}</p><DialogFooter><Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button variant="destructive" onClick={() => { void remove(); }}>Remove record</Button></DialogFooter></DialogContent></Dialog>
    </SuperAdminShell>
  );
}

function emptyTelephonyForm(kind: "web" | "number"): TelephonyForm {
  return { kind, name: "", country: "", tenantId: "", routing: kind === "web" ? "web" : "all" };
}

function PlatformDashboard({
  store,
  loaded,
  onRefresh,
}: {
  store: PlatformStore;
  loaded: boolean;
  onRefresh: () => void;
}) {
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({ label: "Last 7 days", range: "7d" });
  const businesses = store.collections.businesses ?? [];
  const users = store.collections.users ?? [];
  const numbers = store.collections.telephony ?? [];
  const subscriptions = store.collections.subscriptions ?? [];
  const calls = store.collections.monitoring ?? [];
  const transactions = store.collections.finance ?? [];
  const aiUsage = store.collections.aiUsage ?? [];
  const support = store.collections.support ?? [];
  const feedback = store.collections.feedback ?? [];
  const health = store.collections.health ?? [];
  const active = (value: unknown) => String(value ?? "").toLowerCase() === "active";
  const statusIs = (record: PlatformRecord, values: string[]) => values.includes(String(record.status ?? "").toLowerCase());
  const chartDays = dateFilterDays(dateFilter);
  const growth = lastNDays(businesses, "createdAt", chartDays);
  const callVolume = lastNDays(calls, "startedAt", chartDays);
  const revenue = lastNDays(transactions, "date", chartDays);
  const subscriptionCounts = ["active", "trial", "expired", "suspended"].map((status) => ({
    status,
    count: subscriptions.filter((item) => String(item.status ?? "").toLowerCase() === status)
      .length,
  }));
  const providers = numbers.filter((item) => String(item.kind ?? "").toLowerCase() === "provider");
  const phoneNumberRecords = numbers.filter(
    (item) => String(item.kind ?? "").toLowerCase() === "number",
  );
  const activeTenants = businesses.filter((item) => active(item.status));
  const activeUsers = users.filter((item) => active(item.status));
  const failedCalls = calls.filter((item) => statusIs(item, ["failed", "error", "missed"]));
  const paidRevenue = transactions
    .filter((item) => statusIs(item, ["paid", "completed", "success"]))
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const outstandingInvoices = transactions.filter((item) => statusIs(item, ["due", "overdue", "pending"]));
  const failedPayments = transactions.filter((item) => statusIs(item, ["failed", "declined", "error"]));
  const openSupport = support.filter((item) => !statusIs(item, ["resolved", "closed", "completed"]));
  const unresolvedFeedback = feedback.filter((item) => !statusIs(item, ["resolved", "closed", "completed"]));
  const failedAiJobs = aiUsage.reduce((sum, item) => sum + Number(item.failedJobs ?? 0), 0);
  const transcriptionMinutes = aiUsage.reduce((sum, item) => sum + Number(item.transcriptionMinutes ?? 0), 0);
  const aiCost = aiUsage.reduce((sum, item) => sum + Number(item.aiCost ?? 0), 0);
  const recordingStorage = calls.reduce((sum, item) => sum + Number(item.recordingStorageGb ?? 0), 0);
  const healthIssues = health.filter((item) => !statusIs(item, ["healthy", "ok", "available", "connected"]));
  const metric = (available: boolean, value: number, suffix = "") => available ? `${value.toLocaleString()}${suffix}` : "—";

  return (
    <SuperAdminShell>
      <nav data-print-hide aria-label="Breadcrumb" className="text-xs text-muted-foreground">
        <span aria-current="page" className="text-foreground">
          Platform Overview
        </span>
      </nav>
      <PageHeader
        title="Platform Overview"
        description="Cross-tenant platform metrics, operations, and administrative activity."
        actions={
          <>
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} />
            <Button variant="outline" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricLink to="/platform/businesses"><KpiCard label="Total tenants" value={loaded ? String(businesses.length) : "—"} icon={Building2} hint="Open tenant management" /></MetricLink>
        <MetricLink to="/platform/businesses"><KpiCard label="Active tenants" value={loaded ? String(activeTenants.length) : "—"} icon={Building2} hint="Current status" /></MetricLink>
        <MetricLink to="/platform/users"><KpiCard label="Total users" value={loaded ? String(users.length) : "—"} icon={Users} hint="Open user management" /></MetricLink>
        <MetricLink to="/platform/users"><KpiCard label="Active users" value={loaded ? String(activeUsers.length) : "—"} icon={Users} hint="Current status" /></MetricLink>
        <MetricLink to="/platform/billing"><KpiCard label="Subscription revenue" value={transactions.length ? paidRevenue.toLocaleString() : "—"} icon={CreditCard} hint={transactions.length ? "Paid records" : "Billing data unavailable"} /></MetricLink>
        <MetricLink to="/platform/billing"><KpiCard label="Outstanding invoices" value={transactions.length ? String(outstandingInvoices.length) : "—"} icon={CreditCard} hint="Due or pending" /></MetricLink>
        <MetricLink to="/platform/billing"><KpiCard label="Failed payments" value={transactions.length ? String(failedPayments.length) : "—"} icon={AlertTriangle} hint="Payment records" /></MetricLink>
        <MetricLink to="/platform/telephony"><KpiCard label="Call volume" value={String(calls.length)} icon={PhoneCall} hint="Recorded call events" /></MetricLink>
        <MetricLink to="/platform/telephony"><KpiCard label="Failed calls" value={calls.length ? String(failedCalls.length) : "—"} icon={AlertTriangle} hint="Call failure records" /></MetricLink>
        <MetricLink to="/platform/ai-usage"><KpiCard label="Recording storage" value={calls.length ? metric(true, recordingStorage, " GB") : "—"} icon={PhoneCall} hint="Reported storage usage" /></MetricLink>
        <MetricLink to="/platform/ai-usage"><KpiCard label="Transcription usage" value={aiUsage.length ? metric(true, transcriptionMinutes, " min") : "—"} icon={Sparkles} hint="Reported provider usage" /></MetricLink>
        <MetricLink to="/platform/ai-usage"><KpiCard label="AI costs" value={aiUsage.length ? aiCost.toLocaleString() : "—"} icon={Sparkles} hint={aiUsage.length ? "Reported provider costs" : "Usage data unavailable"} /></MetricLink>
        <MetricLink to="/platform/support"><KpiCard label="Open support tickets" value={support.length ? String(openSupport.length) : "—"} icon={Headphones} hint="Needs attention" /></MetricLink>
        <MetricLink to="/platform/feedback"><KpiCard label="Unresolved feedback" value={feedback.length ? String(unresolvedFeedback.length) : "—"} icon={MessageSquare} hint="Needs review" /></MetricLink>
        <MetricLink to="/platform/health"><KpiCard label="Failed AI jobs" value={aiUsage.length ? String(failedAiJobs) : "—"} icon={AlertTriangle} hint="Processing failures" /></MetricLink>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Business records created"
        >
          {businesses.length ? (
            <TrendChart data={growth} dataKey="value" color="var(--chart-1)" name="Tenant registrations" />
          ) : (
            <EmptyState
              title="No business records"
              body="Add business records to see their creation trend."
            />
          )}
        </Panel>
        <Panel
          title="Call records by date"
        >
          {calls.length ? (
            <TrendChart data={callVolume} dataKey="value" color="var(--chart-2)" name="Call events" />
          ) : (
            <EmptyState
              title="No call records"
              body="Call monitoring records will appear here when available."
            />
          )}
        </Panel>
        <Panel
          title="Transaction records by date"
        >
          {transactions.length ? (
            <TrendChart data={revenue} dataKey="value" color="var(--chart-3)" name="Transactions" />
          ) : (
            <EmptyState
              title="No transaction records"
              body="No financial data is available."
            />
          )}
        </Panel>
        <Panel
          title="Subscription records"
          action={<span className="text-xs text-muted-foreground">Entered statuses</span>}
        >
          {subscriptions.length ? (
            <div className="space-y-4">
              {subscriptionCounts.map(({ status, count }) => (
                <div key={status} className="grid grid-cols-[100px_1fr_40px] items-center gap-3">
                  <span className="text-sm capitalize">{status}</span>
                  <div className="soft-progress-track h-2 overflow-hidden rounded">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${subscriptions.length ? (count / subscriptions.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <span className="text-right font-mono text-sm">{count}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No subscription records"
              body="Add subscription records to see the distribution."
            />
          )}
        </Panel>
        <Panel
          title="Provider entries"
          action={
            <Link to="/platform/telephony" className="text-xs text-primary hover:underline">
              Manage inventory
            </Link>
          }
        >
          {providers.length ? (
            <div className="space-y-2">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between border-b border-border py-2 last:border-0"
                >
                  <span className="text-sm font-medium">{provider.name}</span>
                  <StatusBadge status={String(provider.status ?? "Not set")} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No provider records"
              body="No telephony provider is configured."
            />
          )}
        </Panel>
        <Panel
          title="Recent workspace activity"
          action={<span className="text-xs text-muted-foreground">Activity log</span>}
        >
          {store.activity.length ? (
            <ul className="space-y-3">
              {store.activity.slice(0, 6).map((event) => (
                <li
                  key={event.id}
                  className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium capitalize">
                      {event.action} · {event.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {event.collection} · {new Date(event.at).toLocaleString()}
                    </p>
                  </div>
                  <Activity className="h-4 w-4 shrink-0 text-muted-foreground" />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No recorded activity"
              body="Create, edit, and delete actions will appear here."
            />
          )}
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Panel
          title="Recent tenant registrations"
          action={<Link to="/platform/businesses" className="text-xs text-primary hover:underline">View all</Link>}
        >
          {businesses.length ? (
            <ul className="space-y-3">
              {businesses.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((tenant) => (
                <li key={tenant.id} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                  <div><p className="text-sm font-medium">{tenant.name ?? tenant.business ?? "Unnamed tenant"}</p><p className="text-xs text-muted-foreground">{new Date(tenant.createdAt).toLocaleDateString()}</p></div>
                  <StatusBadge status={String(tenant.status ?? "Not set")} />
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No tenant registrations" body="Tenant registrations will appear here when available." />}
        </Panel>
        <Panel
          title="Support tickets requiring attention"
          action={<Link to="/platform/support" className="text-xs text-primary hover:underline">Open support</Link>}
        >
          {openSupport.length ? (
            <ul className="space-y-3">
              {openSupport.slice(0, 5).map((ticket) => (
                <li key={ticket.id} className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0">
                  <div><p className="text-sm font-medium">{ticket.subject ?? ticket.ticketId ?? "Support ticket"}</p><p className="text-xs text-muted-foreground">{ticket.business ?? "Tenant not established"}</p></div>
                  <StatusBadge status={String(ticket.priority ?? ticket.status ?? "open")} />
                </li>
              ))}
            </ul>
          ) : <EmptyState title="No open support tickets" body={support.length ? "All recorded tickets are resolved." : "Support data is unavailable."} />}
        </Panel>
        <Panel
          title="Actionable alerts"
          action={<Link to="/platform/health" className="text-xs text-primary hover:underline">Platform health</Link>}
        >
          <ul className="space-y-3 text-sm">
            {failedPayments.length > 0 && <li className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" /><span>{failedPayments.length} failed payment records require review.</span></li>}
            {failedAiJobs > 0 && <li className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-warning" /><span>{failedAiJobs} AI processing failures require retry or investigation.</span></li>}
            {healthIssues.length > 0 && <li className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-warning" /><span>{healthIssues.length} service checks are not healthy.</span></li>}
            {!failedPayments.length && !failedAiJobs && !healthIssues.length && <li className="flex items-start gap-2 text-muted-foreground"><CheckCircle2 className="mt-0.5 h-4 w-4 text-success" /><span>{health.length ? "No recorded service alerts." : "Service health data is unavailable."}</span></li>}
          </ul>
        </Panel>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="AI processing and usage" action={<Link to="/platform/ai-usage" className="text-xs text-primary hover:underline">View AI & Usage</Link>}>
          {aiUsage.length ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <StatValue label="Transcription" value={`${transcriptionMinutes.toLocaleString()} min`} />
              <StatValue label="Summary jobs" value={aiUsage.reduce((sum, item) => sum + Number(item.summaryJobs ?? 0), 0).toLocaleString()} />
              <StatValue label="Failed jobs" value={String(failedAiJobs)} />
            </div>
          ) : <EmptyState title="AI usage unavailable" body="Connect a supported AI usage provider to report transcription, summary, and cost data." />}
        </Panel>
        <Panel title="Service health" action={<Link to="/platform/health" className="text-xs text-primary hover:underline">View checks</Link>}>
          {health.length ? (
            <ul className="space-y-2">{health.slice(0, 6).map((service) => <li key={service.id} className="flex items-center justify-between gap-3"><span className="text-sm">{service.service ?? "Service"}</span><StatusBadge status={String(service.status ?? "unknown")} /></li>)}</ul>
          ) : <EmptyState title="Health checks unavailable" body="Connect monitoring checks to report service status and processing failures." />}
        </Panel>
      </div>
    </SuperAdminShell>
  );
}

type AiUsageTab = "usage" | "jobs" | "providers" | "limits";

function PlatformLimitsPage({
  store,
  onRefresh,
}: {
  store: PlatformStore;
  onRefresh: () => void;
}) {
  const rows = store.collections.aiUsage ?? [];
  const [editing, setEditing] = useState<PlatformRecord | null>(null);
  const [form, setForm] = useState({ transcriptionLimitMinutes: "", summaryLimit: "", costLimit: "" });

  function beginEdit(row: PlatformRecord) {
    setEditing(row);
    setForm({
      transcriptionLimitMinutes: String(row.transcriptionLimitMinutes ?? ""),
      summaryLimit: String(row.summaryLimit ?? ""),
      costLimit: String(row.costLimit ?? ""),
    });
  }

  async function saveLimits() {
    if (!editing) return;
    const values = {
      transcriptionLimitMinutes: Number(form.transcriptionLimitMinutes),
      summaryLimit: Number(form.summaryLimit),
      costLimit: Number(form.costLimit),
    };
    if (Object.values(values).some((value) => !Number.isFinite(value) || value < 0)) {
      toast.error("Limits must be zero or greater");
      return;
    }
    try {
      await apiPatch(`platform/aiUsage/${editing.id}`, values);
      setEditing(null);
      onRefresh();
      toast.success("AI usage limits saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "AI usage limits were not saved");
    }
  }

  const columns: Column<PlatformRecord>[] = [
    { id: "business", header: "Tenant", sortValue: (row) => String(row.business ?? ""), cell: (row) => <span className="font-medium">{row.business ?? "Not established"}</span> },
    { id: "provider", header: "Provider", cell: (row) => row.provider ?? "Not established" },
    { id: "transcription", header: "Transcription limit", sortValue: (row) => Number(row.transcriptionLimitMinutes ?? 0), cell: (row) => `${Number(row.transcriptionLimitMinutes ?? 0).toLocaleString()} min` },
    { id: "summaries", header: "Summary limit", sortValue: (row) => Number(row.summaryLimit ?? 0), cell: (row) => Number(row.summaryLimit ?? 0).toLocaleString() },
    { id: "cost", header: "Cost limit", sortValue: (row) => Number(row.costLimit ?? 0), cell: (row) => formatAiCost(row.costLimit, row.currency) },
    { id: "actions", header: "Actions", className: "text-right", cell: (row) => <Button size="sm" variant="outline" onClick={() => beginEdit(row)}>Edit limits</Button> },
  ];

  return (
    <SuperAdminShell>
      <PlatformBreadcrumb label="AI Usage Limits" />
      <PageHeader title="AI Usage Limits" description="Set persisted transcription, summary, and cost limits for each tenant usage record." />
      <Panel title="Configured limits" action={<span className="text-xs text-muted-foreground">{rows.length} records</span>}>
        {rows.length ? (
          <DataTable label="AI usage limits" rows={rows} columns={columns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search tenants or providers…" />
        ) : (
          <EmptyState title="No AI usage records" body="Limits become editable after an authorized AI usage record is connected." />
        )}
      </Panel>
      <Dialog open={Boolean(editing)} onOpenChange={(open) => { if (!open) setEditing(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit AI usage limits</DialogTitle>
            <DialogDescription>{editing?.business ?? "Tenant"} · {editing?.provider ?? "Provider"}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-1.5"><Label htmlFor="limit-transcription">Transcription minutes</Label><Input id="limit-transcription" type="number" min="0" step="1" value={form.transcriptionLimitMinutes} onChange={(event) => setForm({ ...form, transcriptionLimitMinutes: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="limit-summary">Summary jobs</Label><Input id="limit-summary" type="number" min="0" step="1" value={form.summaryLimit} onChange={(event) => setForm({ ...form, summaryLimit: event.target.value })} /></div>
            <div className="grid gap-1.5"><Label htmlFor="limit-cost">Cost limit</Label><Input id="limit-cost" type="number" min="0" step="0.01" value={form.costLimit} onChange={(event) => setForm({ ...form, costLimit: event.target.value })} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={() => void saveLimits()}>Save limits</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminShell>
  );
}

function AiUsagePage({
  store,
  loaded,
}: {
  store: PlatformStore;
  loaded: boolean;
}) {
  const rows = store.collections.aiUsage ?? [];
  const [tab, setTab] = useState<AiUsageTab>("usage");
  const [dateFilter, setDateFilter] = useState<DateFilterValue>({ label: "This month", range: "month" });
  const [tenant, setTenant] = useState("all");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [detailRow, setDetailRow] = useState<PlatformRecord | null>(null);

  const tenants = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.business ?? "")).filter(Boolean))).sort(),
    [rows],
  );
  const providers = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.provider ?? "")).filter(Boolean))).sort(),
    [rows],
  );
  const statuses = useMemo(
    () => Array.from(new Set(rows.map((row) => String(row.status ?? "")).filter(Boolean))).sort(),
    [rows],
  );
  const filteredRows = useMemo(() => {
    return rows.filter((row) => {
      return (
        isWithinDateFilter(row, "updatedAt", dateFilter) &&
        (tenant === "all" || String(row.business ?? "") === tenant) &&
        (provider === "all" || String(row.provider ?? "") === provider) &&
        (status === "all" || String(row.status ?? "") === status)
      );
    });
  }, [rows, dateFilter, tenant, provider, status]);
  const transcriptionMinutes = filteredRows.reduce(
    (sum, row) => sum + Number(row.transcriptionMinutes ?? 0),
    0,
  );
  const completedSummaries = filteredRows.reduce(
    (sum, row) => sum + Math.max(Number(row.summaryJobs ?? 0) - Number(row.failedJobs ?? 0), 0),
    0,
  );
  const totalSummaryJobs = filteredRows.reduce((sum, row) => sum + Number(row.summaryJobs ?? 0), 0);
  const failedJobs = filteredRows.reduce((sum, row) => sum + Number(row.failedJobs ?? 0), 0);
  const aiCost = filteredRows.reduce((sum, row) => sum + Number(row.aiCost ?? 0), 0);
  const currencyValues = Array.from(new Set(filteredRows.map((row) => String(row.currency ?? "")).filter(Boolean)));
  const currency = currencyValues.length === 1 ? currencyValues[0] : currencyValues.length ? "Mixed currency" : "USD";
  const successRate = totalSummaryJobs ? Math.round((completedSummaries / totalSummaryJobs) * 100) : null;
  const usageTrend = useMemo(() => usageByDay(filteredRows, dateFilterDays(dateFilter)), [filteredRows, dateFilter]);
  const providerRows = useMemo(() => summarizeAiProviders(filteredRows), [filteredRows]);
  const failedJobRows = useMemo(
    () => filteredRows
      .filter((row) => Number(row.failedJobs ?? 0) > 0)
      .map((row) => ({
        ...row,
        id: `failed-${row.id}`,
        tenant: row.business,
        jobType: "Summary and transcription processing",
        failedCount: Number(row.failedJobs ?? 0),
        processingStatus: "failed",
        processingAt: row.updatedAt,
      })),
    [filteredRows],
  );

  const usageColumns: Column<PlatformRecord>[] = [
    { id: "business", header: "Tenant", sortValue: (row) => String(row.business ?? ""), cell: (row) => <span className="font-medium">{row.business ?? "Not established"}</span> },
    { id: "period", header: "Historical period", sortValue: (row) => String(row.period ?? ""), cell: (row) => row.period ?? "Not established" },
    { id: "provider", header: "Provider", cell: (row) => row.provider ?? "Not established" },
    { id: "transcriptionMinutes", header: "Transcription", sortValue: (row) => Number(row.transcriptionMinutes ?? 0), cell: (row) => `${Number(row.transcriptionMinutes ?? 0).toLocaleString()} min` },
    { id: "summaryJobs", header: "Completed summaries", sortValue: (row) => Number(row.summaryJobs ?? 0), cell: (row) => Math.max(Number(row.summaryJobs ?? 0) - Number(row.failedJobs ?? 0), 0).toLocaleString() },
    { id: "aiCost", header: "AI cost", sortValue: (row) => Number(row.aiCost ?? 0), cell: (row) => formatAiCost(row.aiCost, row.currency) },
    { id: "status", header: "Status", cell: (row) => <StatusBadge status={String(row.status ?? "unavailable")} /> },
    { id: "details", header: "", className: "w-[110px]", cell: (row) => <div data-print-hide><Button size="sm" variant="outline" onClick={() => setDetailRow(row)}>View details</Button></div> },
  ];
  const failedColumns: Column<PlatformRecord>[] = [
    { id: "tenant", header: "Tenant", sortValue: (row) => String(row.tenant ?? ""), cell: (row) => <span className="font-medium">{row.tenant ?? "Not established"}</span> },
    { id: "jobType", header: "Job", cell: (row) => row.jobType ?? "AI processing" },
    { id: "failedCount", header: "Failed jobs", sortValue: (row) => Number(row.failedCount ?? 0), cell: (row) => row.failedCount ?? "0" },
    { id: "processingAt", header: "Processing timestamp", sortValue: (row) => String(row.processingAt ?? ""), cell: (row) => row.processingAt ? new Date(String(row.processingAt)).toLocaleString() : "Not established" },
    { id: "action", header: "Action", className: "w-[150px]", cell: () => <Button size="sm" variant="outline" onClick={() => toast.info("Retry requires the processing worker to be connected")}>Retry</Button> },
  ];
  const providerColumns: Column<PlatformRecord>[] = [
    { id: "provider", header: "Provider", sortValue: (row) => String(row.provider ?? ""), cell: (row) => <span className="font-medium">{row.provider ?? "Not established"}</span> },
    { id: "tenantCount", header: "Tenants", sortValue: (row) => Number(row.tenantCount ?? 0), cell: (row) => row.tenantCount ?? "0" },
    { id: "transcriptionMinutes", header: "Transcription", sortValue: (row) => Number(row.transcriptionMinutes ?? 0), cell: (row) => `${Number(row.transcriptionMinutes ?? 0).toLocaleString()} min` },
    { id: "aiCost", header: "AI cost", sortValue: (row) => Number(row.aiCost ?? 0), cell: (row) => formatAiCost(row.aiCost, row.currency) },
    { id: "status", header: "Status", cell: (row) => <StatusBadge status={String(row.status ?? "unavailable")} /> },
  ];
  const limitsColumns: Column<PlatformRecord>[] = [
    { id: "business", header: "Tenant", sortValue: (row) => String(row.business ?? ""), cell: (row) => <span className="font-medium">{row.business ?? "Not established"}</span> },
    { id: "transcription", header: "Transcription usage", cell: (row) => `${Number(row.transcriptionMinutes ?? 0).toLocaleString()} / ${Number(row.transcriptionLimitMinutes ?? 0).toLocaleString()} min` },
    { id: "summaries", header: "Summary usage", cell: (row) => `${Number(row.summaryJobs ?? 0).toLocaleString()} / ${Number(row.summaryLimit ?? 0).toLocaleString()}` },
    { id: "cost", header: "Cost usage", cell: (row) => `${formatAiCost(row.aiCost, row.currency)} / ${formatAiCost(row.costLimit, row.currency)}` },
  ];

  return (
    <SuperAdminShell>
      <PlatformBreadcrumb label="AI & Usage" />
      <PageHeader
        title="AI & Usage"
        description="Review transcription, summary processing, provider usage, costs, limits, and failures."
        actions={
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} className="justify-self-start" />
            <Button asChild variant="outline" className="col-span-2 w-full sm:col-span-1 sm:w-auto"><Link to="/platform/limits"><SlidersHorizontal className="h-4 w-4" />Manage limits</Link></Button>
          </div>
        }
      />
      <div data-print-hide className="flex flex-wrap items-end gap-2 rounded-[18px] surface-recessed p-3">
        <FilterSelect label="Tenants" value={tenant} onChange={setTenant} options={tenants} />
        <FilterSelect label="Providers" value={provider} onChange={setProvider} options={providers} />
        <FilterSelect label="Processing status" value={status} onChange={setStatus} options={statuses} />
      </div>
      <p className="text-xs text-muted-foreground">{loaded ? `${filteredRows.length} usage records in the selected reporting period.` : "Loading usage data…"} Historical period labels come from usage records; processing timestamps are shown separately.</p>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard label="Transcription minutes" value={loaded ? transcriptionMinutes.toLocaleString() : "—"} icon={Sparkles} hint="Filtered usage" />
        <KpiCard label="Completed summaries" value={loaded ? completedSummaries.toLocaleString() : "—"} icon={CheckCircle2} hint={`${successRate === null ? "Unavailable" : `${successRate}% processing success`}`} />
        <KpiCard label="AI cost" value={loaded ? formatAiCost(aiCost, currency) : "—"} icon={CreditCard} hint="Reported provider cost" />
        <KpiCard label="Failed jobs" value={loaded ? failedJobs.toLocaleString() : "—"} icon={AlertTriangle} hint={failedJobs ? "Requires review" : "No failures in filter"} />
        <KpiCard label="Usage limit" value={loaded && filteredRows.length ? `${Math.round((transcriptionMinutes / Math.max(filteredRows.reduce((sum, row) => sum + Number(row.transcriptionLimitMinutes ?? 0), 0), 1)) * 100)}%` : "—"} icon={Activity} hint="Transcription limit used" />
      </div>
      <div data-print-hide className="flex flex-wrap gap-2" role="tablist" aria-label="AI usage sections">
        {(["usage", "jobs", "providers", "limits"] as AiUsageTab[]).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className={`soft-button rounded-xl px-4 py-2 text-sm font-medium capitalize ${tab === value ? "surface-recessed text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {value === "jobs" ? "Processing Jobs" : value}
          </button>
        ))}
      </div>
      {tab === "usage" && <>
        <div className="grid gap-4 xl:grid-cols-[1.35fr_.65fr]">
          <Panel title="Usage over time" action={<span className="text-xs text-muted-foreground">Transcription minutes</span>}>
            {filteredRows.length ? <TrendChart data={usageTrend} dataKey="value" color="var(--chart-1)" name="Transcription minutes" /> : <EmptyState title="Usage unavailable for this filter" body="Choose a broader period or connect an AI usage provider." />}
          </Panel>
          <Panel title="Processing success" action={<span className="text-xs text-muted-foreground">Summary jobs</span>}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <StatValue label="Completed" value={completedSummaries.toLocaleString()} />
              <StatValue label="Failed" value={failedJobs.toLocaleString()} />
              <StatValue label="Success rate" value={successRate === null ? "Unavailable" : `${successRate}%`} />
            </div>
          </Panel>
        </div>
        <Panel title="Tenant usage detail" action={<span className="text-xs text-muted-foreground">{filteredRows.length} filtered</span>}>
          {filteredRows.length ? <DataTable label="AI usage" rows={filteredRows} columns={usageColumns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search tenant, provider, or period…" /> : <EmptyState title="No AI usage in this period" body="There is no usage data matching the selected tenant, provider, and processing status." />}
        </Panel>
      </>}
      {tab === "jobs" && <Panel title="Recent failed processing jobs" action={<span className="text-xs text-muted-foreground">{failedJobRows.length} affected tenants</span>}>
        {failedJobRows.length ? <DataTable label="Failed AI processing jobs" rows={failedJobRows} columns={failedColumns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search failed jobs…" /> : <EmptyState title="No failed jobs in this period" body="Processing failures will appear here when reported by the connected worker." />}
        <p className="mt-3 text-xs text-muted-foreground">Processing rows are view-only until a worker is connected and can enforce authorization and idempotency.</p>
      </Panel>}
      {tab === "providers" && <Panel title="Provider usage and cost" action={<span className="text-xs text-muted-foreground">Grouped from filtered records</span>}>
        {providerRows.length ? <DataTable label="AI providers" rows={providerRows} columns={providerColumns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search providers…" /> : <EmptyState title="No providers reported" body="Configure a supported transcription or summary provider to report usage." />}
      </Panel>}
      {tab === "limits" && <Panel title="Configured usage limits" action={<Link to="/platform/limits" className="text-xs text-primary hover:underline">Manage limits</Link>}>
        {filteredRows.length ? <DataTable label="AI usage limits" rows={filteredRows} columns={limitsColumns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search tenant limits…" /> : <EmptyState title="No configured limits" body="Usage limits are unavailable until a supported configuration source is connected." />}
      </Panel>}
      <Dialog open={Boolean(detailRow)} onOpenChange={(open) => { if (!open) setDetailRow(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>AI usage details</DialogTitle><DialogDescription>Measured usage is read-only and cannot rewrite historical consumption or billing evidence.</DialogDescription></DialogHeader>
          {detailRow && <div className="grid gap-2 text-sm sm:grid-cols-2">
            <StatValue label="Tenant" value={String(detailRow.business ?? "Not established")} />
            <StatValue label="Historical period" value={String(detailRow.period ?? "Not established")} />
            <StatValue label="Processing provider" value={String(detailRow.provider ?? "Not established")} />
            <StatValue label="Transcription" value={`${Number(detailRow.transcriptionMinutes ?? 0).toLocaleString()} minutes`} />
            <StatValue label="Completed summaries" value={Math.max(Number(detailRow.summaryJobs ?? 0) - Number(detailRow.failedJobs ?? 0), 0).toLocaleString()} />
            <StatValue label="Processing timestamp" value={detailRow.updatedAt ? new Date(detailRow.updatedAt).toLocaleString() : "Not established"} />
          </div>}
          <DialogFooter><Button variant="outline" onClick={() => setDetailRow(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </SuperAdminShell>
  );
}

function PlatformBreadcrumb({ label }: { label: string }) {
  return (
    <nav data-print-hide aria-label="Breadcrumb" className="text-xs text-muted-foreground">
      <Link to="/platform/dashboard" className="hover:text-foreground">Platform</Link>
      <span className="mx-2">/</span>
      <span aria-current="page" className="text-foreground">{label}</span>
    </nav>
  );
}

function SecurityAccessPage({ store }: { store: PlatformStore }) {
  const users = store.collections.users ?? [];
  const policies = store.collections.security ?? [];
  const administrators = users.filter((user) => `${user.role ?? ""} ${user.globalRole ?? ""}`.toLowerCase().includes("admin"));
  const activeAdministrators = administrators.filter((user) => String(user.status ?? "").toLowerCase() === "active");
  const columns: Column<PlatformRecord>[] = [
    { id: "event", header: "Event", cell: (row) => <span className="font-medium">{row.event ?? "—"}</span> },
    { id: "actor", header: "Actor", cell: (row) => row.actor ?? "—" },
    { id: "resource", header: "Resource", cell: (row) => row.resource ?? "—" },
    { id: "business", header: "Tenant", cell: (row) => row.business ?? "Platform" },
    { id: "result", header: "Result", cell: (row) => <StatusBadge status={String(row.result ?? "unknown")} /> },
  ];
  return (
    <SuperAdminShell>
      <PlatformBreadcrumb label="Security & Access" />
      <PageHeader title="Security & Access" description="Review administrator access, authentication policies, and session controls." actions={<Button asChild variant="outline"><Link to="/platform/audit-logs">Open audit logs</Link></Button>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Platform administrators" value={String(administrators.length)} icon={ShieldCheck} hint="Accounts with admin role" />
        <KpiCard label="Active administrators" value={String(activeAdministrators.length)} icon={CheckCircle2} hint="Current account status" />
        <KpiCard label="Security events" value={String(policies.length)} icon={Activity} hint="Recorded events" />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Authentication and access policies">
          <div className="grid gap-2 sm:grid-cols-2">
            {["Administrator MFA", "Session revocation", "Tenant boundary checks", "Support access approval"].map((policy) => (
              <div key={policy} className="surface-recessed rounded-[16px] p-3"><p className="text-sm font-medium">{policy}</p><p className="mt-1 text-xs text-muted-foreground">Configuration is available when an identity provider is connected.</p></div>
            ))}
          </div>
        </Panel>
        <Panel title="Sensitive action controls">
          <ul className="space-y-3 text-sm text-muted-foreground">
            <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />Role changes require an authorized platform administrator.</li>
            <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />Destructive changes must be confirmed and recorded.</li>
            <li className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />Secrets and provider credentials are not displayed here.</li>
          </ul>
        </Panel>
      </div>
      <Panel title="Recent security events">
        {policies.length ? <DataTable label="Security events" rows={policies} columns={columns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search security events…" /> : <EmptyState title="No security events" body="Security events will appear here when connected identity and audit services report them." />}
      </Panel>
    </SuperAdminShell>
  );
}

function AuditLogsPage({ store }: { store: PlatformStore }) {
  const rows: PlatformRecord[] = (store.collections.auditLogs ?? store.activity.map((event) => ({
    id: event.id,
    createdAt: event.at,
    updatedAt: event.at,
    actor: "Platform administrator",
    action: event.action,
    resource: event.collection,
    business: "Platform",
    timestamp: event.at,
    result: "success",
  }))).slice(0, 500);
  const columns: Column<PlatformRecord>[] = [
    { id: "actor", header: "Actor", cell: (row) => <span className="font-medium">{row.actor ?? "—"}</span> },
    { id: "action", header: "Action", cell: (row) => <StatusBadge status={String(row.action ?? "unknown")} /> },
    { id: "resource", header: "Affected resource", cell: (row) => row.resource ?? "—" },
    { id: "business", header: "Tenant scope", cell: (row) => row.business ?? "Platform" },
    { id: "timestamp", header: "Timestamp", cell: (row) => row.timestamp ?? row.createdAt },
    { id: "result", header: "Result", cell: (row) => <StatusBadge status={String(row.result ?? "unknown")} /> },
  ];
  return (
    <SuperAdminShell>
      <PlatformBreadcrumb label="Audit Logs" />
      <PageHeader title="Audit Logs" description="Searchable administrative activity with actor, resource, tenant scope, timestamp, and result." />
      <Panel title="Administrative activity" action={<span className="text-xs text-muted-foreground">{rows.length} events</span>}>
        {rows.length ? <DataTable label="Audit logs" rows={rows} columns={columns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search actor, action, resource…" /> : <EmptyState title="No audit events" body="Administrative activity will appear here after an authorized action is recorded." />}
      </Panel>
    </SuperAdminShell>
  );
}

function PlatformHealthPage({ store }: { store: PlatformStore }) {
  const rows = store.collections.health ?? [];
  const healthy = rows.filter((row) => ["healthy", "ok", "available", "connected"].includes(String(row.status ?? "").toLowerCase()));
  const degraded = rows.filter((row) => !healthy.includes(row));
  const columns: Column<PlatformRecord>[] = [
    { id: "service", header: "Service", cell: (row) => <span className="font-medium">{row.service ?? "—"}</span> },
    { id: "status", header: "Status", cell: (row) => <StatusBadge status={String(row.status ?? "unknown")} /> },
    { id: "lastCheck", header: "Last checked", cell: (row) => row.lastCheck ?? row.updatedAt },
    { id: "latency", header: "Latency", cell: (row) => row.latency ? `${row.latency} ms` : "—" },
    { id: "failureCount", header: "Processing failures", cell: (row) => row.failureCount ?? "—" },
    { id: "incident", header: "Incident", cell: (row) => row.incident ?? "—" },
  ];
  return (
    <SuperAdminShell>
      <PlatformBreadcrumb label="Platform Health" />
      <PageHeader title="Platform Health" description="Service checks, background jobs, storage availability, and active incidents." />
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard label="Checks reported" value={String(rows.length)} icon={Activity} hint="Connected monitoring records" />
        <KpiCard label="Healthy services" value={String(healthy.length)} icon={CheckCircle2} hint="Reported healthy or available" />
        <KpiCard label="Degraded or unknown" value={String(degraded.length)} icon={AlertTriangle} hint="Requires attention or configuration" />
      </div>
      <Panel title="Service checks" action={<span className="text-xs text-muted-foreground">No synthetic health data</span>}>
        {rows.length ? <DataTable label="Platform health" rows={rows} columns={columns} rowKey={(row) => row.id} searchText={(row) => Object.values(row).join(" ")} searchPlaceholder="Search services…" /> : <EmptyState title="Health checks unavailable" body="Connect monitoring sources to report service status, processing failures, storage availability, and incidents." />}
      </Panel>
      <Panel title="Required monitoring sources">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{["API and web", "Background jobs", "Telephony providers", "Storage and queues"].map((source) => <div key={source} className="surface-recessed rounded-[16px] p-3 text-sm">{source}<p className="mt-1 text-xs text-muted-foreground">Unknown until a health check is connected.</p></div>)}</div>
      </Panel>
    </SuperAdminShell>
  );
}

function MetricLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link
      to={to as any}
      className="block rounded-[20px] transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </Link>
  );
}

function StatValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-recessed rounded-[16px] p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold">{value}</p>
    </div>
  );
}

function lastNDays(records: PlatformRecord[], dateField = "createdAt", count = 7) {
  const now = new Date();
  const days = Array.from({ length: count }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (count - 1 - index));
    return date;
  });
  return days.map((date) => {
    const dateKey = date.toISOString().slice(0, 10);
    const total = records.filter(
      (record) => String(record[dateField] ?? record.createdAt ?? "").slice(0, 10) === dateKey,
    ).length;
    return {
      day: date.toLocaleDateString(
        undefined,
        count > 14 ? { day: "numeric", month: "short" } : { weekday: "short" },
      ),
      value: total,
    };
  });
}

function usageByDay(records: PlatformRecord[], count: number) {
  const daysToShow = Math.min(Math.max(count, 1), 90);
  const days = Array.from({ length: daysToShow }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (daysToShow - 1 - index));
    return date;
  });
  return days.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const value = records
      .filter((record) => String(record.updatedAt ?? record.createdAt ?? "").slice(0, 10) === key)
      .reduce((sum, record) => sum + Number(record.transcriptionMinutes ?? 0), 0);
    return {
      day: date.toLocaleDateString(undefined, daysToShow > 14 ? { day: "numeric", month: "short" } : { weekday: "short" }),
      value,
    };
  });
}

function summarizeAiProviders(records: PlatformRecord[]): PlatformRecord[] {
  const grouped = new Map<string, PlatformRecord>();
  for (const record of records) {
    const name = String(record.provider ?? "Not established");
    const existing = grouped.get(name);
    if (existing) {
      existing.tenantCount = Number(existing.tenantCount ?? 0) + 1;
      existing.transcriptionMinutes = Number(existing.transcriptionMinutes ?? 0) + Number(record.transcriptionMinutes ?? 0);
      existing.aiCost = Number(existing.aiCost ?? 0) + Number(record.aiCost ?? 0);
      existing.failedJobs = Number(existing.failedJobs ?? 0) + Number(record.failedJobs ?? 0);
      if (Number(record.failedJobs ?? 0) > 0) existing.status = "degraded";
    } else {
      grouped.set(name, {
        id: `provider-${name}`,
        createdAt: String(record.createdAt ?? ""),
        updatedAt: String(record.updatedAt ?? ""),
        provider: name,
        tenantCount: 1,
        transcriptionMinutes: Number(record.transcriptionMinutes ?? 0),
        aiCost: Number(record.aiCost ?? 0),
        failedJobs: Number(record.failedJobs ?? 0),
        currency: String(record.currency ?? "USD"),
        status: Number(record.failedJobs ?? 0) > 0 ? "degraded" : "ready",
      });
    }
  }
  return Array.from(grouped.values());
}

function formatAiCost(value: unknown, currency: unknown) {
  const amount = Number(value ?? 0);
  const code = String(currency ?? "USD");
  return `${code} ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dateFilterDays(value: DateFilterValue) {
  if (value.range === "today") return 1;
  if (value.range === "7d") return 7;
  if (value.range === "14d") return 14;
  if (value.range === "month") return 30;
  if (value.from && value.to) {
    const from = Date.parse(`${value.from}T00:00:00`);
    const to = Date.parse(`${value.to}T00:00:00`);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      return Math.max(1, Math.floor((to - from) / 86_400_000) + 1);
    }
  }
  return 7;
}

function isWithinDateFilter(record: PlatformRecord, field: string, value: DateFilterValue) {
  const raw = String(record[field] ?? record.createdAt ?? "");
  if (!raw) return false;
  if (value.range === "custom" && value.from) {
    const day = raw.slice(0, 10);
    return day >= value.from && (!value.to || day <= value.to);
  }
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return false;
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - dateFilterDays(value) + 1);
  return timestamp >= start.getTime();
}

function TrendChart({
  data,
  dataKey,
  color,
  name,
}: {
  data: { day: string; value: number }[];
  dataKey: string;
  color: string;
  name: string;
}) {
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="day" tick={axis} axisLine={false} tickLine={false} />
          <YAxis tick={axis} axisLine={false} tickLine={false} width={36} />
          <Tooltip contentStyle={tooltipStyle} />
          <Area
            type="monotone"
            dataKey={dataKey}
            name={name}
            stroke={color}
            fill={color}
            fillOpacity={0.14}
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
