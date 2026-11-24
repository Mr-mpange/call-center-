import { createFileRoute } from "@tanstack/react-router";
import { CampaignsPage } from "@/components/pages/CampaignsPage";

export const Route = createFileRoute("/admin/campaigns")({ component: CampaignsPage });
