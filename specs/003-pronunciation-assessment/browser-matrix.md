# Pronunciation Recorder Browser Matrix

This matrix separates automated capability evidence from real-device evidence. A checked implementation or unit test is not a claim that a named browser/device was manually verified.

## Automated desktop smoke matrix

Command: `pnpm test:e2e -- pronunciation-recorder.spec.ts`

| Engine                | Secure context | getUserMedia | MediaRecorder | WebM/Opus or MP4/AAC | Local URL/context/timer cleanup | Status                                              |
| --------------------- | -------------: | -----------: | ------------: | -------------------: | ------------------------------: | --------------------------------------------------- |
| Chromium (Playwright) |           pass |         pass |          pass |     pass (WebM/Opus) |                            pass | Passed 2026-09-10                                   |
| Firefox (Playwright)  |       required |     required |      required |             required |                        required | Blocked: Playwright Firefox binary is not installed |
| WebKit (Playwright)   |       required |     required |      required |             required |                        required | Blocked: Playwright WebKit binary is not installed  |

The automated smoke uses no microphone input and no learner audio. Permission denial, missing device, interruption, continuous/no-pause behavior and route cleanup are covered by `usePronunciationRecorder.spec.ts` and `PronunciationRecorder.spec.ts` using synthetic browser objects.

## Required real-device matrix

Record the exact browser/OS versions, date, device class, selected codec, permission outcome, start/stop feedback latency, interruption behavior, local playback and cleanup evidence when each run is actually performed. Current and previous stable major versions are required at release time.

| Surface                            | Current stable | Previous stable | Evidence                                                |
| ---------------------------------- | -------------- | --------------- | ------------------------------------------------------- |
| Desktop Chrome / Windows or macOS  | Pending        | Pending         | Not executed; requires a real microphone/device session |
| Desktop Edge / Windows             | Pending        | Pending         | Not executed; requires a real microphone/device session |
| Desktop Firefox / Windows or macOS | Pending        | Pending         | Not executed; requires a real microphone/device session |
| Desktop Safari / macOS             | Pending        | Pending         | Not executed; requires a real microphone/device session |
| Android Chrome                     | Pending        | Pending         | Not executed; requires a real Android device            |
| iOS Safari                         | Pending        | Pending         | Not executed; requires a real iPhone/iPad               |

Release remains blocked if any required surface lacks actual evidence, chooses neither accepted codec, permits a scored recording to pause, exceeds 300 ms local control feedback, fails to recover from permission/device interruption, or retains tracks, audio contexts, timers or object URLs after exit.
