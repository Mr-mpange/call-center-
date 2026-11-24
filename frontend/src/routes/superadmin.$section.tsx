import { createFileRoute, redirect } from "@tanstack/react-router";

const legacySections: Record<string, string> = {
  business: "businesses",
  users: "users",
  telephony: "telephony",
  ivr: "ivr",
  subscriptions: "subscriptions",
  finance: "finance",
  monitoring: "monitoring",
  integrations: "integrations",
  security: "security",
  support: "support",
  settings: "settings",
  dashboard: "dashboard",
};

export const Route = createFileRoute("/superadmin/$section")({
  beforeLoad: ({ params }) => {
    const section = legacySections[params.section] ?? "dashboard";
    throw redirect({ to: "/platform/$section", params: { section } });
  },
});
