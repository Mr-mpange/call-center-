import { createFileRoute } from "@tanstack/react-router";
import { QueuePage } from "@/components/pages/QueuePage";

export const Route = createFileRoute("/admin/queue")({ component: QueuePage });
