import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "@/components/AuthPage";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/register")({
  head: () => pageHead("Create an Account", "Create your MPANGE Call Center account."),
  component: Register,
});

function Register() {
  return <AuthPage initialMode="register" />;
}
