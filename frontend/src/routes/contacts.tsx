import { createFileRoute } from "@tanstack/react-router";
import { ContactsPage } from "@/components/pages/ContactsPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/contacts")({
  head: () => pageHead("Contacts", "Customer records, call history, consent and notes."),
  component: ContactsPage,
});
