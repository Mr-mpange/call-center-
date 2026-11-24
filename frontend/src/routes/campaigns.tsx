import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "@/components/pages/CampaignsPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/campaigns")({
  head: () => pageHead("Campaigns", "Outbound call, reminder and survey campaigns."),
  component: CampaignsPage,
});
