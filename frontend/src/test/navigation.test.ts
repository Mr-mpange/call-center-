import { describe, expect, it } from "vitest";
import {
  getActiveNavigationItem,
  getNavigation,
  navigationConfig,
  roleFromAppUser,
} from "@/lib/navigation";

const labels = (role: keyof typeof navigationConfig) =>
  getNavigation(role).flatMap((group) => group.items.map((item) => item.label));

describe("role-based navigation", () => {
  it("keeps the agent workspace compact and capability-based", () => {
    expect(labels("agent")).toEqual([
      "Overview",
      "Call Console",
      "My Tasks",
      "Customers",
      "Call History",
      "Voicemail",
      "My Statistics",
    ]);
  });

  it("exposes the configured destinations for supervisor, tenant, and platform roles", () => {
    expect(labels("supervisor")).toEqual([
      "Team Overview",
      "Live Monitoring",
      "Queues",
      "Agents",
      "Quality Reviews",
      "Reports",
    ]);
    expect(labels("tenant-admin")).toEqual([
      "Overview",
      "Users & Roles",
      "Call Routing",
      "Phone & IVR",
      "Knowledge Base",
      "Support",
      "Reports",
      "Settings",
    ]);
    expect(labels("platform-admin")).toEqual([
      "Overview",
      "Tenants",
      "Users",
      "Subscriptions & Billing",
      "Telephony",
      "AI & Usage",
      "Support",
      "Feedback",
      "Announcements",
      "Platform Health",
      "Security & Access",
      "Audit Logs",
      "Global Settings",
    ]);
  });

  it("highlights one parent destination for nested legacy routes", () => {
    const agent = getNavigation("agent");
    const tenant = getNavigation("tenant-admin");
    const platform = getNavigation("platform-admin");

    expect(getActiveNavigationItem(agent, "/tickets")?.id).toBe("my-tasks");
    expect(getActiveNavigationItem(agent, "/voicemail")?.id).toBe("voicemail");
    expect(getActiveNavigationItem(tenant, "/admin/audit-log")?.id).toBe("admin-settings");
    expect(getActiveNavigationItem(platform, "/platform/security")?.id).toBe("security-access");
    expect(getActiveNavigationItem(platform, "/platform/audit-logs")?.id).toBe("audit-logs");
  });

  it("maps the existing application roles to the central navigation roles", () => {
    expect(roleFromAppUser("Agent")).toBe("agent");
    expect(roleFromAppUser("Supervisor")).toBe("supervisor");
    expect(roleFromAppUser("Org Admin")).toBe("tenant-admin");
  });
});
