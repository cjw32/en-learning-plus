import { describe, expect, it } from "vitest";
import { pronunciationRolloutCapabilities } from "../pronunciation";

describe("pronunciation Web progressive rollout", () => {
  it.each([
    [{ VITE_PRONUNCIATION_CAPTURE_ENABLED: "true" }, ["recording"]],
    [
      {
        VITE_PRONUNCIATION_CAPTURE_ENABLED: "true",
        VITE_PRONUNCIATION_UPLOAD_ENABLED: "true",
      },
      ["recording", "upload"],
    ],
    [
      {
        VITE_PRONUNCIATION_CAPTURE_ENABLED: "true",
        VITE_PRONUNCIATION_UPLOAD_ENABLED: "true",
        VITE_PRONUNCIATION_PROVIDER_ENABLED: "true",
      },
      ["recording", "upload", "provider"],
    ],
    [
      {
        VITE_PRONUNCIATION_CAPTURE_ENABLED: "true",
        VITE_PRONUNCIATION_UPLOAD_ENABLED: "true",
        VITE_PRONUNCIATION_PROVIDER_ENABLED: "true",
        VITE_PRONUNCIATION_RESULT_DISPLAY_ENABLED: "true",
      },
      ["recording", "upload", "provider", "resultDisplay"],
    ],
    [
      {
        VITE_PRONUNCIATION_CAPTURE_ENABLED: "true",
        VITE_PRONUNCIATION_UPLOAD_ENABLED: "true",
        VITE_PRONUNCIATION_PROVIDER_ENABLED: "true",
        VITE_PRONUNCIATION_RESULT_DISPLAY_ENABLED: "true",
        VITE_PRONUNCIATION_LEARNING_WRITE_ENABLED: "true",
      },
      ["recording", "upload", "provider", "resultDisplay", "learningWrite"],
    ],
    [
      {
        VITE_PRONUNCIATION_CAPTURE_ENABLED: "true",
        VITE_PRONUNCIATION_UPLOAD_ENABLED: "true",
        VITE_PRONUNCIATION_PROVIDER_ENABLED: "true",
        VITE_PRONUNCIATION_RESULT_DISPLAY_ENABLED: "true",
        VITE_PRONUNCIATION_COACH_SUMMARY_ENABLED: "true",
      },
      ["recording", "upload", "provider", "resultDisplay", "coachSummary"],
    ],
  ])(
    "derives only prerequisites-satisfied capabilities",
    (environment, enabled) => {
      const capabilities = pronunciationRolloutCapabilities(environment);
      expect(
        Object.entries(capabilities)
          .filter(([, value]) => value)
          .map(([key]) => key),
      ).toEqual(enabled);
    },
  );

  it("turns every new UI capability off atomically on rollback", () => {
    expect(pronunciationRolloutCapabilities({})).toEqual({
      recording: false,
      upload: false,
      provider: false,
      resultDisplay: false,
      learningWrite: false,
      coachSummary: false,
    });
  });
});
