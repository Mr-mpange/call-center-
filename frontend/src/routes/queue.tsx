import { createFileRoute } from "@tanstack/react-router";
import { QueuePage } from "@/components/pages/QueuePage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/queue")({
  head: () =>
    pageHead("Call Queue", "Queue overview, waiting callers, routing and overflow settings."),
  component: QueuePage,
});
