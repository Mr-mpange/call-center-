import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";
import { pageHead } from "@/lib/seo";

export { AuthPage } from "@/components/AuthPage";

export const Route = createFileRoute("/login")({
  head: () => pageHead("Account Access", "Sign in or create an MPANGE Call Center account."),
  component: AuthPage,
});
