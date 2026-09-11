import { mcpConfirmationSelectorSchema } from "@en/common/mcp";
import type { RouteLocationNormalized } from "vue-router";

export const MCP_CONFIRMATION_ROUTE_NAME = "mcp-write-confirmation";

export function confirmationSelectorFromRoute(
  route: Pick<RouteLocationNormalized, "params">,
): string | null {
  const candidate = Array.isArray(route.params.selector)
    ? route.params.selector[0]
    : route.params.selector;
  const parsed = mcpConfirmationSelectorSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export default [
  {
    path: "/mcp/confirmations/:selector",
    name: MCP_CONFIRMATION_ROUTE_NAME,
    component: () => import("@/views/McpConfirmation/index.vue"),
    props: (route: RouteLocationNormalized) => ({
      selector: confirmationSelectorFromRoute(route) ?? "",
    }),
    meta: { requiresAuth: true, requiresRecentAuthentication: true },
    beforeEnter: (to: RouteLocationNormalized) => {
      const selector = confirmationSelectorFromRoute(to);
      if (!selector) return { path: "/" };
      if (Object.keys(to.query).length > 0 || to.hash) {
        return {
          name: MCP_CONFIRMATION_ROUTE_NAME,
          params: { selector },
          replace: true,
        };
      }
      return true;
    },
  },
];
