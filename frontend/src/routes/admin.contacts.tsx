import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "@/components/pages/ContactsPage";

export const Route = createFileRoute("/admin/contacts")({ component: ContactsPage });
