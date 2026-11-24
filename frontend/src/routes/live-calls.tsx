import { createFileRoute } from "@tanstack/react-router";
import { LiveCalls } from "@/components/pages/LiveCalls";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/live-calls")({
  head: () => pageHead("Live Calls", "Monitor active calls, callers, agents and queue wait times."),
  component: LiveCalls,
});
