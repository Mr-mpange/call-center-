import { createFileRoute } from "@tanstack/react-router";
import { AgentsPage } from "@/components/pages/AgentsPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/agents")({
  head: () => pageHead("Agents & Teams", "Agent profiles, teams, availability and workload."),
  component: AgentsPage,
});
