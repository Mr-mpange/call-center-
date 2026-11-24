import { createFileRoute } from "@tanstack/react-router";
import { LiveCalls } from "@/components/pages/LiveCalls";

export const Route = createFileRoute("/admin/live-calls")({ component: LiveCalls });
