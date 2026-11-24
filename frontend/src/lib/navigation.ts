import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  BookOpen,
  Contact,
  FileClock,
  FileCheck2,
  Headphones,
  History,
  LayoutDashboard,
  ListOrdered,
  Megaphone,
  MessageSquare,
  Phone,
  PhoneCall,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  UserCog,
  Users,
  Voicemail,
  WalletCards,
  Workflow,
} from "lucide-react";
import { rolePermissions } from "@/lib/permissions";
import type { AppUser } from "@/lib/domain-types";

export type NavigationRole = "agent" | "supervisor" | "tenant-admin" | "platform-admin";

export type PermissionName =
  | "Take & make calls"
  | "Listen / whisper / barge"
  | "Edit queues & IVR"
  | "View analytics"
  | "Manage users & billing";

export type ConfiguredPermission = {
  perm: PermissionName;
  admin: boolean;
  supervisor: boolean;
  agent: boolean;
};

export type NavigationItem = {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  match?: readonly string[];
  exact?: boolean;
  permission?: PermissionName;
};

export type NavigationGroup = {
  title: string;
  items: readonly NavigationItem[];
};

const item = (definition: Omit<NavigationItem, "match"> & { match?: readonly string[] }) =>
  definition;

/**
 * The menu is intentionally a capability map, not a second route tree. Every
 * destination below maps to a page that already exists in the application.
 */
export const navigationConfig: Record<NavigationRole, readonly NavigationGroup[]> = {
  agent: [
    {
      title: "Workspace",
      items: [
        item({ id: "overview", label: "Overview", to: "/", icon: LayoutDashboard, exact: true }),
        item({
          id: "call-console",
          label: "Call Console",
          to: "/live-calls",
          icon: PhoneCall,
          permission: "Take & make calls",
          match: ["/live-calls"],
        }),
        item({
          id: "my-tasks",
          label: "My Tasks",
          to: "/callbacks",
          icon: Ticket,
          match: ["/callbacks", "/tickets"],
        }),
        item({
          id: "customers",
          label: "Customers",
          to: "/contacts",
          icon: Contact,
          match: ["/contacts"],
        }),
        item({
          id: "call-history",
          label: "Call History",
          to: "/history",
          icon: History,
          match: ["/history"],
        }),
        item({
          id: "voicemail",
          label: "Voicemail",
          to: "/voicemail",
          icon: Voicemail,
          match: ["/voicemail"],
        }),
        item({
          id: "my-statistics",
          label: "My Statistics",
          to: "/analytics",
          icon: BarChart3,
          match: ["/analytics"],
        }),
      ],
    },
  ],
  supervisor: [
    {
      title: "Team workspace",
      items: [
        item({
          id: "team-overview",
          label: "Team Overview",
          to: "/",
          icon: LayoutDashboard,
          exact: true,
        }),
        item({
          id: "live-monitoring",
          label: "Live Monitoring",
          to: "/live-calls",
          icon: Activity,
          permission: "Listen / whisper / barge",
          match: ["/live-calls"],
        }),
        item({
          id: "queues",
          label: "Queues",
          to: "/queue",
          icon: ListOrdered,
          permission: "Edit queues & IVR",
          match: ["/queue"],
        }),
        item({ id: "agents", label: "Agents", to: "/agents", icon: Users, match: ["/agents"] }),
        item({
          id: "quality-reviews",
          label: "Quality Reviews",
          to: "/feedback",
          icon: FileCheck2,
          match: ["/feedback"],
        }),
        item({
          id: "team-reports",
          label: "Reports",
          to: "/analytics",
          icon: BarChart3,
          permission: "View analytics",
          match: ["/analytics"],
        }),
      ],
    },
  ],
  "tenant-admin": [
    {
      title: "Organization",
      items: [
        item({
          id: "admin-overview",
          label: "Overview",
          to: "/admin",
          icon: LayoutDashboard,
          exact: true,
        }),
        item({
          id: "users-roles",
          label: "Users & Roles",
          to: "/admin/users",
          icon: UserCog,
          permission: "Manage users & billing",
          match: ["/admin/users"],
        }),
        item({
          id: "call-routing",
          label: "Call Routing",
          to: "/admin/queue",
          icon: Workflow,
          permission: "Edit queues & IVR",
          match: ["/admin/queue"],
        }),
        item({
          id: "phone-ivr",
          label: "Phone & IVR",
          to: "/admin/ivr",
          icon: Phone,
          permission: "Edit queues & IVR",
          match: ["/admin/ivr"],
        }),
        item({
          id: "knowledge-base",
          label: "Knowledge Base",
          to: "/admin/help",
          icon: BookOpen,
          match: ["/admin/help"],
        }),
        item({
          id: "support",
          label: "Support",
          to: "/admin/support",
          icon: Headphones,
          match: ["/admin/support"],
        }),
        item({
          id: "admin-reports",
          label: "Reports",
          to: "/admin/analytics",
          icon: BarChart3,
          permission: "View analytics",
          match: ["/admin/analytics"],
        }),
        item({
          id: "admin-settings",
          label: "Settings",
          to: "/admin/settings",
          icon: Settings,
          match: ["/admin/settings", "/admin/audit-log"],
        }),
      ],
    },
  ],
  "platform-admin": [
    {
      title: "Management",
      items: [
        item({
          id: "platform-overview",
          label: "Overview",
          to: "/platform/dashboard",
          icon: LayoutDashboard,
          exact: true,
          match: ["/platform/dashboard"],
        }),
        item({
          id: "tenants",
          label: "Tenants",
          to: "/platform/businesses",
          icon: Users,
          match: ["/platform/businesses"],
        }),
        item({
          id: "platform-users",
          label: "Users",
          to: "/platform/users",
          icon: UserCog,
          match: ["/platform/users"],
        }),
        item({
          id: "subscriptions-billing",
          label: "Subscriptions & Billing",
          to: "/platform/billing",
          icon: WalletCards,
          match: ["/platform/billing", "/platform/subscriptions", "/platform/finance"],
        }),
      ],
    },
    {
      title: "Operations",
      items: [
        item({
          id: "telephony",
          label: "Telephony",
          to: "/platform/telephony",
          icon: PhoneCall,
          match: ["/platform/telephony", "/platform/ivr"],
        }),
        item({
          id: "ai-usage",
          label: "AI & Usage",
          to: "/platform/ai-usage",
          icon: Sparkles,
          match: ["/platform/ai-usage"],
        }),
        item({
          id: "support",
          label: "Support",
          to: "/platform/support",
          icon: Headphones,
          match: ["/platform/support"],
        }),
        item({
          id: "feedback",
          label: "Feedback",
          to: "/platform/feedback",
          icon: MessageSquare,
          match: ["/platform/feedback"],
        }),
        item({
          id: "announcements",
          label: "Announcements",
          to: "/platform/announcements",
          icon: Megaphone,
          match: ["/platform/announcements"],
        }),
        item({
          id: "platform-health",
          label: "Platform Health",
          to: "/platform/health",
          icon: Activity,
          match: ["/platform/health", "/platform/monitoring"],
        }),
      ],
    },
    {
      title: "Administration",
      items: [
        item({
          id: "security-access",
          label: "Security & Access",
          to: "/platform/security",
          icon: ShieldCheck,
          match: ["/platform/security"],
        }),
        item({
          id: "audit-logs",
          label: "Audit Logs",
          to: "/platform/audit-logs",
          icon: FileClock,
          match: ["/platform/audit-logs", "/platform/audit-log"],
        }),
        item({
          id: "global-settings",
          label: "Global Settings",
          to: "/platform/settings",
          icon: Settings,
          match: ["/platform/settings"],
        }),
      ],
    },
  ],
};

const permissionRole: Record<
  Exclude<NavigationRole, "platform-admin">,
  "admin" | "supervisor" | "agent"
> = {
  agent: "agent",
  supervisor: "supervisor",
  "tenant-admin": "admin",
};

export function hasNavigationPermission(
  role: NavigationRole,
  permission: PermissionName,
  permissions: readonly ConfiguredPermission[] = rolePermissions,
) {
  if (role === "platform-admin") return true;
  const key = permissionRole[role];
  return Boolean(permissions.find((entry) => entry.perm === permission)?.[key]);
}

export function getNavigation(
  role: NavigationRole,
  permissions: readonly ConfiguredPermission[] = rolePermissions,
) {
  return navigationConfig[role].map((group) => ({
    ...group,
    items: group.items.filter(
      (navItem) =>
        !navItem.permission || hasNavigationPermission(role, navItem.permission, permissions),
    ),
  }));
}

export function getActiveNavigationItem(groups: readonly NavigationGroup[], pathname: string) {
  const matches = groups
    .flatMap((group) => group.items)
    .filter((navItem) =>
      (navItem.match ?? [navItem.to]).some((pattern) =>
        navItem.exact || pattern === "/"
          ? pathname === pattern
          : pathname === pattern || pathname.startsWith(`${pattern}/`),
      ),
    )
    .sort((a, b) => (b.match?.[0]?.length ?? b.to.length) - (a.match?.[0]?.length ?? a.to.length));

  return matches[0] ?? null;
}

export function roleFromAppUser(role: AppUser["role"]): NavigationRole {
  if (role === "Org Admin") return "tenant-admin";
  if (role === "Supervisor") return "supervisor";
  return "agent";
}

export function landingPathForRole(role: string): "/" | "/admin" | "/platform/dashboard" {
  if (role === "Platform Admin") return "/platform/dashboard";
  if (role === "Org Admin") return "/admin";
  return "/";
}
