import { createFileRoute, Outlet } from "@tanstack/react-router";
import { HistoryPage } from "@/components/pages/HistoryPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/history")({
  head: () => pageHead("Call History", "Searchable log of past inbound and outbound calls."),
  validateSearch: (
    s: Record<string, unknown>,
  ): { q?: string; direction?: "inbound" | "outbound" } => ({
    ...(typeof s["q"] === "string" ? { q: s["q"] } : {}),
    ...(s["direction"] === "inbound" || s["direction"] === "outbound"
      ? { direction: s["direction"] }
      : {}),
  }),
  component: HistoryRoute,
});

function HistoryRoute() {
  // Keep the history list mounted behind the dynamic call-details sheet.
  return <><HistoryPage /><Outlet /></>;
}
