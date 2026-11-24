import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("matches every platform console destination", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const paths = [
      "/platform/dashboard",
      "/platform/businesses",
      "/platform/users",
      "/platform/billing",
      "/platform/telephony",
      "/platform/ivr",
      "/platform/ai-usage",
      "/platform/subscriptions",
      "/platform/finance",
      "/platform/monitoring",
      "/platform/integrations",
      "/platform/security",
      "/platform/audit-logs",
      "/platform/support",
      "/platform/feedback",
      "/platform/announcements",
      "/platform/health",
      "/platform/settings",
    ];
    for (const path of paths) {
      expect(router.matchRoutes(path).at(-1)?.routeId, `expected a route for ${path}`).not.toBe(
        rootRouteId,
      );
    }
  });
});
