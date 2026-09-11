<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type {
  McpConfirmationDecisionInput,
  McpConfirmationView,
} from "@/apis/mcp";
import {
  MCP_CONFIRMATION_SCHEMA_VERSION,
  decideMcpWriteConfirmation,
  getMcpWriteConfirmation,
} from "@/apis/mcp";

type DisplayStatus =
  | McpConfirmationView["status"]
  | "expired"
  | "consumed"
  | "unauthorized";

type DisplayConfirmation =
  | McpConfirmationView
  | Readonly<{
      schemaVersion: "en-learning.mcp.confirmation.v1";
      status: "expired" | "consumed" | "unauthorized";
    }>;

type DisplayError = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

const props = withDefaults(
  defineProps<{
    selector: string;
    confirmation?: DisplayConfirmation | null;
    error?: DisplayError | null;
  }>(),
  { confirmation: null, error: null },
);

const emit = defineEmits<{
  decide: [
    decision: Pick<
      McpConfirmationDecisionInput,
      "decision" | "operationSummaryDigest"
    >,
  ];
  retry: [];
}>();

const heading = ref<HTMLHeadingElement | null>(null);
const current = ref<DisplayConfirmation | null>(props.confirmation);
const currentError = ref<DisplayError | null>(props.error);
const loading = ref(!props.confirmation && !props.error);
const processing = ref(false);
const controller = new AbortController();

watch(
  () => props.confirmation,
  (value) => {
    if (value) current.value = value;
  },
);
watch(
  () => props.error,
  (value) => {
    currentError.value = value;
  },
);

const status = computed<DisplayStatus | null>(() => current.value?.status ?? null);
const view = computed<McpConfirmationView | null>(() =>
  current.value &&
  ["pending", "confirmed", "rejected"].includes(current.value.status)
    ? (current.value as McpConfirmationView)
    : null,
);

const statusMessage = computed(() => {
  if (processing.value) return "Confirming your decision…";
  switch (status.value) {
    case "confirmed":
      return "Confirmation recorded. Please retry the original MCP call.";
    case "rejected":
      return "No learning data was saved. You rejected this request.";
    case "expired":
      return "This confirmation has expired. Return to your MCP client and submit again.";
    case "consumed":
      return "This confirmation has already been used. Check the original MCP call for its saved result.";
    default:
      return "";
  }
});

function clientError(error: unknown): DisplayError {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code);
    if (code === "ERR_NETWORK") {
      return {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "The confirmation status could not be loaded while offline.",
        retryable: true,
      };
    }
  }
  return {
    code: "CONFIRMATION_UNAVAILABLE",
    message: "The confirmation status could not be loaded.",
    retryable: true,
  };
}

async function focusHeading() {
  await nextTick();
  heading.value?.focus();
}

async function load() {
  loading.value = true;
  currentError.value = null;
  try {
    current.value = await getMcpWriteConfirmation(
      props.selector,
      controller.signal,
    );
  } catch (error) {
    currentError.value = clientError(error);
  } finally {
    loading.value = false;
    await focusHeading();
  }
}

async function decide(decision: "confirm" | "reject") {
  if (processing.value || status.value !== "pending" || !view.value) return;
  processing.value = true;
  currentError.value = null;
  const input: McpConfirmationDecisionInput = {
    schemaVersion: MCP_CONFIRMATION_SCHEMA_VERSION,
    decision,
    operationSummaryDigest: view.value.operationSummaryDigest,
  };
  emit("decide", {
    decision: input.decision,
    operationSummaryDigest: input.operationSummaryDigest,
  });
  if (props.confirmation) return;
  try {
    const result = await decideMcpWriteConfirmation(
      props.selector,
      input,
      controller.signal,
    );
    current.value = {
      ...view.value,
      status: result.status,
    };
  } catch (error) {
    currentError.value = clientError(error);
  } finally {
    processing.value = false;
    await focusHeading();
  }
}

async function retry() {
  emit("retry");
  if (!props.confirmation) await load();
}

onMounted(async () => {
  await focusHeading();
  if (!props.confirmation && !props.error) await load();
});
onBeforeUnmount(() => controller.abort());
</script>

<template>
  <main class="confirmation-shell" aria-labelledby="confirmation-title">
    <section class="confirmation-card">
      <p class="eyebrow">en-learning-plus · Secure confirmation</p>
      <h1 id="confirmation-title" ref="heading" tabindex="-1">
        Review learning update
      </h1>

      <p v-if="loading" role="status" aria-live="polite">
        Loading confirmation…
      </p>

      <div v-else-if="currentError" class="state-panel state-panel--error">
        <p role="alert">{{ currentError.message }}</p>
        <button
          v-if="currentError.retryable"
          data-testid="retry-confirmation"
          type="button"
          @click="retry"
        >
          Try again
        </button>
      </div>

      <div v-else-if="status === 'unauthorized'" class="state-panel">
        <p role="alert">
          Sign in again with the same account that authorized the MCP client.
        </p>
        <nav aria-label="Confirmation recovery">
          <RouterLink
            data-testid="reauthenticate-confirmation"
            to="/?reauth=mcp-confirmation"
          >
            Sign in with the same account
          </RouterLink>
          <RouterLink data-testid="revoke-client-access" to="/setting/index">
            Review or revoke client access
          </RouterLink>
        </nav>
      </div>

      <template v-else-if="view">
        <dl class="summary-grid">
          <div>
            <dt>Requesting client</dt>
            <dd>{{ view.clientDisplayName }}</dd>
          </div>
          <div>
            <dt>Action</dt>
            <dd><code>{{ view.toolName }}</code></dd>
          </div>
          <div>
            <dt>Exercise</dt>
            <dd>{{ view.exercise.title || "English learning exercise" }}</dd>
          </div>
          <div>
            <dt>Answers</dt>
            <dd>{{ view.operationSummary.answerCount }} answers</dd>
          </div>
        </dl>

        <section
          v-if="status === 'pending'"
          id="confirmation-effects"
          class="effects"
          aria-labelledby="effects-title"
        >
          <h2 id="effects-title">What confirming will do</h2>
          <p>{{ view.operationSummary.notice }}</p>
          <ul>
            <li v-if="view.operationSummary.willSaveAttempt">
              Your answers will be graded and saved to your learning history.
            </li>
            <li v-if="view.operationSummary.willUpdateMastery">
              Your mastery state will be updated from the grading result.
            </li>
            <li v-if="view.operationSummary.willUpdateReviewSchedule">
              Your review schedule will be updated.
            </li>
          </ul>
          <p class="expiry">
            This request expires at
            <time :datetime="view.expiresAt">{{ view.expiresAt }}</time>.
          </p>
          <p>{{ view.retryInstruction }}</p>
          <p id="reject-effect">Rejecting saves nothing.</p>

          <div class="actions">
            <button
              data-testid="reject-submit"
              type="button"
              :disabled="processing"
              aria-describedby="reject-effect"
              @click="decide('reject')"
            >
              Reject request
            </button>
            <button
              class="primary"
              data-testid="confirm-submit"
              type="button"
              :disabled="processing"
              aria-describedby="confirmation-effects"
              @click="decide('confirm')"
            >
              Confirm and return to client
            </button>
          </div>
        </section>

        <p v-if="statusMessage" role="status" aria-live="polite">
          {{ statusMessage }}
        </p>
      </template>

      <p v-else-if="statusMessage" role="status" aria-live="polite">
        {{ statusMessage }}
      </p>
    </section>
  </main>
</template>

<style scoped>
.confirmation-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem 1rem;
  color: #172033;
  background: #f4f7fb;
}

.confirmation-card {
  width: min(42rem, 100%);
  padding: clamp(1.5rem, 4vw, 3rem);
  border: 1px solid #dce4ef;
  border-radius: 1.25rem;
  background: #fff;
  box-shadow: 0 1.25rem 4rem rgb(42 62 92 / 12%);
}

.eyebrow,
dt,
.expiry {
  color: #526178;
}

.eyebrow {
  margin: 0 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 1.5rem;
  font-size: clamp(1.8rem, 5vw, 2.6rem);
}

h1:focus {
  outline: none;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
  gap: 1rem;
}

.summary-grid div,
.effects,
.state-panel {
  padding: 1rem;
  border-radius: 0.75rem;
  background: #f7f9fc;
}

dt {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
}

dd {
  margin: 0.25rem 0 0;
  font-weight: 650;
}

.effects {
  margin-top: 1.25rem;
}

.effects h2 {
  margin-top: 0;
}

.effects li + li {
  margin-top: 0.5rem;
}

.actions,
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

button,
a {
  min-height: 2.75rem;
  padding: 0.7rem 1rem;
  border: 1px solid #3563e9;
  border-radius: 0.65rem;
  color: #244fc7;
  background: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

button.primary {
  color: #fff;
  background: #3563e9;
}

button:focus-visible,
a:focus-visible {
  outline: 3px solid #f3b33d;
  outline-offset: 3px;
}

button:disabled {
  cursor: wait;
  opacity: 0.65;
}

.state-panel--error {
  border-left: 0.25rem solid #c33b3b;
}
</style>
