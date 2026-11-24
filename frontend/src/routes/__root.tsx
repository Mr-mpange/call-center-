import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { Toaster } from "@/components/ui/sonner";
import { PhoneProvider } from "@/components/phone/PhoneProvider";
import { Softphone } from "@/components/phone/Softphone";
import { ThemeProvider } from "@/components/ThemeProvider";
import { apiGet } from "@/lib/api";
import { landingPathForRole } from "@/lib/navigation";

const themeBootstrapScript = `
(() => {
  try {
    const saved = localStorage.getItem("mpange.theme");
    const theme = saved === "light" || saved === "dark"
      ? saved
      : (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.dataset.theme = theme;
    root.style.colorScheme = theme;
  } catch {}
})();
`;

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="soft-button inline-flex items-center justify-center rounded-xl border-0 bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "MPANGE AI Call Center" },
      {
        name: "description",
        content: "Multi-tenant AI-assisted contact center by MPANGE TECHNOLOGY SOLUTION Ltd.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap",
      },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();

  useEffect(() => {
    // This app does not ship a service worker. Remove stale workers left by older local builds.
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistrations().then((registrations) => {
      void Promise.all(registrations.map((registration) => registration.unregister()));
    });
  }, []);

  useEffect(() => {
    if (pathname === "/login" || pathname === "/register") return;
    const token = window.localStorage.getItem("mpange.auth.token");
    if (!token) {
      void navigate({ to: "/login", replace: true });
      return;
    }
    let storedUser: { role?: string } | null = null;
    try { storedUser = JSON.parse(window.localStorage.getItem("mpange.auth.user") ?? "null"); } catch { storedUser = null; }
    const role = String(storedUser?.role ?? "");
    const wrongConsole = role === "Platform Admin"
      ? !pathname.startsWith("/platform")
      : role === "Org Admin"
        ? pathname.startsWith("/platform")
        : pathname.startsWith("/admin") || pathname.startsWith("/platform");
    if (wrongConsole && role) {
      void navigate({ to: landingPathForRole(role), replace: true });
      return;
    }
    void apiGet("auth/me").catch(() => {
      window.localStorage.removeItem("mpange.auth.token");
      window.localStorage.removeItem("mpange.auth.user");
      window.dispatchEvent(new Event("mpange:auth-logout"));
      void navigate({ to: "/login", replace: true });
    });
  }, [navigate, pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
        <PhoneProvider>
          <Outlet />
          <div data-print-hide>
            <Softphone />
          </div>
        </PhoneProvider>
        <Toaster richColors position="top-right" />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
