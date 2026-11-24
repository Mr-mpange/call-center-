import { createFileRoute } from "@tanstack/react-router";
import { AnalyticsPage } from "@/components/pages/AnalyticsPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/analytics")({
  head: () =>
    pageHead("Analytics", "Call volume, service level, language and agent performance reports."),
  component: AnalyticsPage,
});
