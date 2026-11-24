import { createFileRoute } from "@tanstack/react-router";
import { HistoryPage } from "@/components/pages/HistoryPage";

export const Route = createFileRoute("/admin/history")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; direction?: "inbound" | "outbound" } => ({
    ...(typeof search.q === "string" ? { q: search.q } : {}),
    ...(search.direction === "inbound" || search.direction === "outbound"
      ? { direction: search.direction }
      : {}),
  }),
  component: HistoryPage,
});
