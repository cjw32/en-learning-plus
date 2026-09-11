import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import mcpRoutes, {
  MCP_CONFIRMATION_ROUTE_NAME,
  confirmationSelectorFromRoute,
} from "@/router/mcp";
import { routeAuthenticationGuard } from "@/router";
import { useUserStore } from "@/stores/user";

const selector = "R4nd0m-opaque-selector-with-enough-entropy_0001";

function route(overrides: Record<string, unknown> = {}) {
  return {
    params: { selector },
    query: {},
    hash: "",
    matched: [{ meta: { requiresAuth: true } }],
    name: MCP_CONFIRMATION_ROUTE_NAME,
    ...overrides,
  };
}

describe("MCP confirmation route policy", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("accepts only a bounded opaque selector", () => {
    expect(confirmationSelectorFromRoute(route() as never)).toBe(selector);
    expect(
      confirmationSelectorFromRoute(
        route({ params: { selector: "https://attacker.invalid" } }) as never,
      ),
    ).toBeNull();
  });

  it("uses the existing sign-in route and preserves only the selector", () => {
    expect(routeAuthenticationGuard(route() as never)).toEqual({
      path: "/",
      query: { reauth: "mcp-confirmation", selector },
    });
    expect(
      JSON.stringify(
        routeAuthenticationGuard(
          route({ query: { redirect: "https://attacker.invalid" } }) as never,
        ),
      ),
    ).not.toContain("attacker.invalid");
  });

  it("allows an authenticated user and strips query/hash at route entry", () => {
    useUserStore().setUser({
      id: "learner_confirmation_route",
      name: "Learner",
      phone: "10000000000",
      wordNumber: 0,
      dayNumber: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      token: { accessToken: "access", refreshToken: "refresh" },
    });
    expect(routeAuthenticationGuard(route() as never)).toBe(true);

    const confirmationRoute = mcpRoutes[0]!;
    expect(confirmationRoute.meta).toMatchObject({
      requiresAuth: true,
      requiresRecentAuthentication: true,
    });
    expect(
      confirmationRoute.beforeEnter(
        route({ query: { token: "private" }, hash: "#private" }) as never,
      ),
    ).toEqual({
      name: MCP_CONFIRMATION_ROUTE_NAME,
      params: { selector },
      replace: true,
    });
  });
});
