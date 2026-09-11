import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { describe, expect, it } from "vitest";
import McpConfirmation from "../index.vue";

const pending = Object.freeze({
  schemaVersion: "en-learning.mcp.confirmation.v1",
  status: "pending",
  clientDisplayName: "Example Learning Client",
  toolName: "submit_answer",
  exercise: Object.freeze({
    title: "Project meeting practice",
    itemCount: 2,
    version: "exercise.v1",
  }),
  operationSummary: Object.freeze({
    answerCount: 2,
    willSaveAttempt: true,
    willUpdateMastery: true,
    willUpdateReviewSchedule: true,
    notice: "Your answers will be graded and saved to your learning history.",
  }),
  operationSummaryDigest: "a".repeat(64),
  expiresAt: "2026-09-11T08:05:00.000Z",
  retryInstruction: "After confirming, retry the original MCP call.",
});

function mountPage(
  confirmation: Record<string, unknown> = pending,
  props: Record<string, unknown> = {},
) {
  return mount(McpConfirmation, {
    attachTo: document.body,
    props: {
      selector: "R4nd0m-opaque-selector-with-enough-entropy_0001",
      confirmation,
      ...props,
    },
    global: {
      stubs: {
        RouterLink: {
          props: ["to"],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  });
}

describe("MCP write confirmation comprehension", () => {
  it("makes at least 90% of the scripted save consequences directly visible", () => {
    const wrapper = mountPage();
    const text = wrapper.text();
    const checks = [
      text.includes("Example Learning Client"),
      text.includes("submit_answer"),
      text.includes("Project meeting practice"),
      text.includes("2 answers"),
      text.includes("graded"),
      text.includes("saved to your learning history"),
      text.includes("mastery"),
      text.includes("review schedule"),
      text.includes("expires"),
      text.includes("retry the original MCP call"),
    ];

    expect(checks.filter(Boolean).length / checks.length).toBeGreaterThanOrEqual(
      0.9,
    );
    expect(wrapper.html()).not.toContain("correctAnswer");
    expect(wrapper.html()).not.toContain("answerDigest");
    expect(wrapper.html()).not.toContain("Bearer");
    wrapper.unmount();
  });

  it("emits one digest-bound confirm decision and prevents double activation", async () => {
    const wrapper = mountPage();
    const confirm = wrapper.get('[data-testid="confirm-submit"]');

    await confirm.trigger("click");
    await confirm.trigger("click");

    expect(wrapper.emitted("decide")).toEqual([
      [
        {
          decision: "confirm",
          operationSummaryDigest: pending.operationSummaryDigest,
        },
      ],
    ]);
    expect(confirm.attributes("disabled")).toBeDefined();
    expect(wrapper.get('[role="status"]').text()).toContain("Confirming");
    wrapper.unmount();
  });

  it("keeps reject explicit and describes that rejection saves nothing", async () => {
    const wrapper = mountPage();
    const reject = wrapper.get('[data-testid="reject-submit"]');

    expect(reject.text()).toMatch(/reject/i);
    expect(wrapper.text()).toMatch(/rejecting saves nothing/i);
    await reject.trigger("click");

    expect(wrapper.emitted("decide")).toEqual([
      [
        {
          decision: "reject",
          operationSummaryDigest: pending.operationSummaryDigest,
        },
      ],
    ]);
    wrapper.unmount();
  });
});

describe("MCP write confirmation accessibility and recovery states", () => {
  it("focuses the page heading and exposes native keyboard-safe controls", async () => {
    const wrapper = mountPage();
    await nextTick();
    const heading = wrapper.get("h1");
    const confirm = wrapper.get('[data-testid="confirm-submit"]');
    const reject = wrapper.get('[data-testid="reject-submit"]');

    expect(heading.attributes("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(heading.element);
    expect(confirm.element.tagName).toBe("BUTTON");
    expect(confirm.attributes("type")).toBe("button");
    expect(confirm.attributes("aria-describedby")).toBeTruthy();
    expect(reject.element.tagName).toBe("BUTTON");
    expect(reject.attributes("type")).toBe("button");
    wrapper.unmount();
  });

  it.each([
    ["confirmed", "retry the original MCP call"],
    ["rejected", "No learning data was saved"],
    ["expired", "expired"],
    ["consumed", "already been used"],
  ])("renders the terminal %s state without decision buttons", (status, message) => {
    const wrapper = mountPage({ ...pending, status });

    expect(wrapper.get('[role="status"]').text()).toContain(message);
    expect(wrapper.find('[data-testid="confirm-submit"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="reject-submit"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("announces recoverable network errors and emits an explicit retry", async () => {
    const wrapper = mountPage(pending, {
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "The confirmation status could not be loaded.",
        retryable: true,
      },
    });

    expect(wrapper.get('[role="alert"]').text()).toContain(
      "The confirmation status could not be loaded.",
    );
    await wrapper.get('[data-testid="retry-confirmation"]').trigger("click");
    expect(wrapper.emitted("retry")).toHaveLength(1);
    wrapper.unmount();
  });

  it("offers same-site reauthentication and authorization revocation recovery", () => {
    const wrapper = mountPage(
      {
        schemaVersion: "en-learning.mcp.confirmation.v1",
        status: "unauthorized",
      },
      { error: null },
    );
    const reauthenticate = wrapper.get(
      '[data-testid="reauthenticate-confirmation"]',
    );
    const revoke = wrapper.get('[data-testid="revoke-client-access"]');

    expect(reauthenticate.attributes("href")).toBe(
      "/?reauth=mcp-confirmation",
    );
    expect(revoke.attributes("href")).toBe("/setting/index");
    expect(wrapper.text()).toMatch(/same account/i);
    wrapper.unmount();
  });
});
